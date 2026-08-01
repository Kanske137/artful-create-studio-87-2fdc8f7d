// TILLFÄLLIG admin-testfunktion: A/B-test av face-swap-modeller inför ev.
// byte från cdingram/face-swap (tappar hår/piercings/hudton utanför ansiktet)
// till easel/advanced-face-swap (full-body likhet + hair_source-parameter).
// Tas bort när utvärderingen är klar.
//
// ENDAST admin (samma JWT-gate som generate-asset). Två lägen:
//
//   { action: "schema", model: "easel/advanced-face-swap" }
//     → hämtar modellens input-schema + senaste versions-id från Replicate,
//       så vi slipper gissa fältnamn.
//
//   { action: "run", model: "<allowlistad modell>", input: {...}, filename?: "a-b" }
//     → skapar prediction, pollar, laddar upp resultatet till
//       ai-references/generated/swaptest/<filename>.<ext> (permanent bucket,
//       INTE print-files som gallringscronen städar) och returnerar URL:er.
//
// Modellerna är allowlistade — funktionen är INTE en generell Replicate-proxy.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ADMIN_EMAILS = ["akram@arthena.se"];

// Allowlist: official = anropas via /models/<path>/predictions,
// annars pinnad community-version via /predictions.
const ALLOWED_MODELS: Record<string, { official: boolean; version?: string }> = {
  // OBS: easel/advanced-face-swap är BORTTAGEN från Replicate (finns numera på
  // fal.ai) — kvar i listan ifall den återkommer. ai-avatars är easels
  // kvarvarande Replicate-modell.
  "easel/advanced-face-swap": { official: true },
  "easel/ai-avatars": { official: true },
  "fofr/face-swap-with-ideogram": { official: true },
  "cdingram/face-swap": {
    official: false,
    version: "d1d6ea8c8be89d664a07a457526f7128109dee7030fdac424788d762c71ed111",
  },
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const REPLICATE_API_TOKEN = Deno.env.get("REPLICATE_API_TOKEN");
    if (!REPLICATE_API_TOKEN) throw new Error("REPLICATE_API_TOKEN not configured");

    // Admin-gate: verifiera JWT → user → e-post i vitlistan.
    const authHeader = req.headers.get("authorization") ?? "";
    const authed = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData, error: userErr } = await authed.auth.getUser();
    const email = userData?.user?.email?.toLowerCase() ?? null;
    if (userErr || !email || !ADMIN_EMAILS.includes(email)) {
      return json({ error: "admin only" }, 403);
    }

    const body = await req.json();
    const action: string = body?.action ?? "run";
    const model: string = typeof body?.model === "string" ? body.model : "";

    // Schema-läget är ren metadata-läsning — tillåt valfri modell-slug så vi
    // kan inspektera kandidater utan redeploy. "run" kräver allowlist.
    if (action === "schema") {
      if (!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(model)) {
        return json({ error: `invalid model slug: ${model}` }, 400);
      }
      const r = await fetch(`https://api.replicate.com/v1/models/${model}`, {
        headers: { Authorization: `Bearer ${REPLICATE_API_TOKEN}` },
      });
      const j = await r.json();
      if (!r.ok) return json({ error: `model fetch ${r.status}`, detail: j }, 502);
      return json({
        model,
        latestVersion: j?.latest_version?.id ?? null,
        inputSchema: j?.latest_version?.openapi_schema?.components?.schemas?.Input ?? null,
        description: j?.description ?? null,
      });
    }

    // action === "run"
    const allowed = ALLOWED_MODELS[model];
    if (!allowed) {
      return json({ error: `model not allowlisted: ${model}` }, 400);
    }
    const input = body?.input;
    if (!input || typeof input !== "object") return json({ error: "input required" }, 400);

    const url = allowed.official
      ? `https://api.replicate.com/v1/models/${model}/predictions`
      : "https://api.replicate.com/v1/predictions";
    const payload = allowed.official ? { input } : { version: allowed.version, input };

    const start = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${REPLICATE_API_TOKEN}`,
        "Content-Type": "application/json",
        Prefer: "wait=30",
      },
      body: JSON.stringify(payload),
    });
    let prediction = await start.json();
    if (!start.ok) {
      return json(
        { error: `Replicate start failed ${start.status}`, detail: prediction },
        502,
      );
    }

    const deadline = Date.now() + 150_000;
    while (
      prediction.status !== "succeeded" &&
      prediction.status !== "failed" &&
      prediction.status !== "canceled" &&
      Date.now() < deadline
    ) {
      await new Promise((r) => setTimeout(r, 1500));
      const poll = await fetch(prediction.urls.get, {
        headers: { Authorization: `Bearer ${REPLICATE_API_TOKEN}` },
      });
      prediction = await poll.json();
    }
    if (prediction.status !== "succeeded") {
      return json(
        {
          error: `Replicate ${prediction.status}: ${prediction.error || "timeout"}`,
          metrics: prediction?.metrics ?? null,
        },
        502,
      );
    }

    const output = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
    if (typeof output !== "string" || !output) return json({ error: "no output URL" }, 502);

    // Ladda upp permanent så jämförelsebilderna överlever Replicates gallring.
    const imgRes = await fetch(output);
    if (!imgRes.ok) throw new Error(`Output fetch failed ${imgRes.status}`);
    const bytes = new Uint8Array(await imgRes.arrayBuffer());
    const contentType = imgRes.headers.get("content-type") ?? "image/png";
    const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
    const safeName =
      typeof body?.filename === "string" && /^[a-z0-9-]{1,80}$/.test(body.filename)
        ? body.filename
        : crypto.randomUUID();
    const path = `generated/swaptest/${safeName}.${ext}`;

    const service = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { error: upErr } = await service.storage
      .from("ai-references")
      .upload(path, bytes, { contentType, upsert: true });
    if (upErr) throw new Error(`Upload failed: ${upErr.message}`);
    const { data: pub } = service.storage.from("ai-references").getPublicUrl(path);

    return json({
      model,
      url: pub.publicUrl,
      replicateOutputUrl: output,
      predictTimeSec: prediction?.metrics?.predict_time ?? null,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("easel-swap-test error:", msg);
    return json({ error: msg }, 500);
  }
});
