// Edge function: nattlig gallring (Paket C). Triggas av pg_cron (migration
// 20260724150000) kl 02:30 varje natt via pg_net — kräver x-cleanup-secret
// (CLEANUP_CRON_SECRET i secrets) så ingen utomstående kan trigga städning.
//
// Gallringspolicy (Akrams beslut 2026-07-24, speglas i integritetspolicyn):
//   • Mellanfiler (mfcrop-*, mfhair-*, spike-*): raderas efter 7 dagar
//   • Kundbilder/resultat för BESTÄLLDA designs: raderas efter 90 dagar
//   • Övriga kundbilder/resultat: raderas efter 60 dagar
//   • Analytics-rader (events/generations/feedback): raderas efter 365 dagar
//   • Bonus: synkar editor_sessions.last_seen_at från events (rpc
//     sync_last_seen) — klientens direktuppdatering är opålitlig i miljön.
//
// Max ~1500 raderingar per bucket och körning (nattlig cadence hinner ikapp).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cleanup-secret",
};

const DAY_MS = 24 * 60 * 60 * 1000;
const TEMP_MAX_DAYS = 7;
const ORDERED_MAX_DAYS = 90;
const DEFAULT_MAX_DAYS = 60;
const ANALYTICS_MAX_DAYS = 365;
const MAX_DELETES_PER_BUCKET = 1500;
const BUCKETS = ["cart-previews", "print-files"] as const;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Plocka bucket + sökväg ur en publik storage-URL. */
function parseStorageUrl(url: string): { bucket: string; path: string } | null {
  const m = url.match(/\/object\/public\/([^/]+)\/(.+)$/);
  return m ? { bucket: m[1], path: decodeURIComponent(m[2]) } : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const secret = Deno.env.get("CLEANUP_CRON_SECRET");
  if (!secret || req.headers.get("x-cleanup-secret") !== secret) {
    return json({ ok: false, code: "forbidden" }, 403);
  }

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const now = Date.now();
  const report: Record<string, unknown> = {};

  try {
    // 1) Skyddslista: allt som hör till beställda designs får 90 dagar.
    const { data: orderEvents } = await db
      .from("editor_events")
      .select("design_id")
      .eq("type", "order_placed")
      .not("design_id", "is", null)
      .limit(5000);
    const orderedDesigns = new Set<string>(
      (orderEvents ?? []).map((e: { design_id: string }) => e.design_id),
    );

    const protectedPaths = new Set<string>();
    if (orderedDesigns.size > 0) {
      const { data: orderedGens } = await db
        .from("generations")
        .select("design_id, input_image_url, input_image_urls, output_image_url")
        .in("design_id", [...orderedDesigns])
        .limit(5000);
      for (const g of orderedGens ?? []) {
        const urls: string[] = [
          ...(g.input_image_urls ?? []),
          g.input_image_url,
          g.output_image_url,
        ].filter((u: string | null): u is string => !!u);
        for (const u of urls) {
          const p = parseStorageUrl(u);
          if (p) protectedPaths.add(`${p.bucket}/${p.path}`);
        }
      }
    }

    // 2) Storage-gallring per bucket.
    for (const bucket of BUCKETS) {
      let deleted = 0;
      let kept = 0;
      let offset = 0;
      const toDelete: string[] = [];
      for (let page = 0; page < 20; page++) {
        const { data: files, error } = await db.storage
          .from(bucket)
          .list("", { limit: 1000, offset, sortBy: { column: "created_at", order: "asc" } });
        if (error) throw new Error(`${bucket} list: ${error.message}`);
        if (!files || files.length === 0) break;
        offset += files.length;

        for (const f of files) {
          if (!f.name || !f.created_at) continue;
          const ageDays = (now - new Date(f.created_at).getTime()) / DAY_MS;
          const isTemp =
            f.name.startsWith("mfcrop-") ||
            f.name.startsWith("mfhair-") ||
            f.name.startsWith("spike-");
          const designId = f.name.split(".")[0];
          const isProtected =
            protectedPaths.has(`${bucket}/${f.name}`) || orderedDesigns.has(designId);

          const limitDays = isTemp
            ? TEMP_MAX_DAYS
            : isProtected
              ? ORDERED_MAX_DAYS
              : DEFAULT_MAX_DAYS;
          if (ageDays > limitDays) toDelete.push(f.name);
          else kept++;
          if (toDelete.length >= MAX_DELETES_PER_BUCKET) break;
        }
        if (toDelete.length >= MAX_DELETES_PER_BUCKET || files.length < 1000) break;
      }

      for (let i = 0; i < toDelete.length; i += 100) {
        const batch = toDelete.slice(i, i + 100);
        const { error } = await db.storage.from(bucket).remove(batch);
        if (error) {
          console.warn(`[cleanup] ${bucket} remove-fel:`, error.message);
          break;
        }
        deleted += batch.length;
      }
      report[bucket] = { deleted, kept };
    }

    // 3) Analytics-retention (365 dagar).
    const cutoffIso = new Date(now - ANALYTICS_MAX_DAYS * DAY_MS).toISOString();
    const del = async (table: string, col: string) => {
      const { error } = await db.from(table).delete().lt(col, cutoffIso);
      if (error) console.warn(`[cleanup] ${table}:`, error.message);
    };
    await del("editor_events", "ts");
    await del("generations", "created_at");
    await del("generation_feedback", "created_at");
    await del("editor_sessions", "last_seen_at");

    // 4) Synka last_seen_at från events (klient-PATCH:en är opålitlig i miljön).
    const { error: syncErr } = await db.rpc("sync_last_seen");
    if (syncErr) console.warn("[cleanup] sync_last_seen:", syncErr.message);
    report.lastSeenSync = syncErr ? "fel" : "ok";

    console.log("[cleanup] klar:", JSON.stringify(report));
    return json({ ok: true, report });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("[cleanup] error:", msg);
    return json({ ok: false, error: msg, report }, 500);
  }
});
