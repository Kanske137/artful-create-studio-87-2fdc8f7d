// Edge function: kundens tidigare genereringar (Paket F, "Mina bilder" steg 1).
//
// Klienten skickar sin sessionsnyckel (bearer-semantik — oåtkomlig UUID i
// enhetens localStorage) och får ENBART den sessionens lyckade genereringar.
// OBS: cross-device via e-post kräver verifieringskod (Paket G) — e-post-
// kopplingen i gaten är självdeklarerad och får ALDRIG ensam ge åtkomst
// till bilder (annars kan vem som helst skriva någon annans mail och se
// deras familjefoton).
//
// Svarar alltid HTTP 200 med { ok, generations } eller { ok: false, code }.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => null);
    const sessionKey = typeof body?.sessionKey === "string" ? body.sessionKey.trim() : "";
    if (!/^[A-Za-z0-9-]{8,64}$/.test(sessionKey)) {
      return json({ ok: false, code: "invalid_session" });
    }

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data, error } = await db
      .from("generations")
      .select(
        "design_id, subject_kind, handle, layer_id, reference_image_url, output_image_url, style_id, style_label, created_at",
      )
      .eq("session_key", sessionKey)
      .eq("status", "succeeded")
      .not("output_image_url", "is", null)
      .order("created_at", { ascending: false })
      .limit(60);
    if (error) throw new Error(error.message);

    return json({ ok: true, generations: data ?? [] });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("[my-generations] error:", msg);
    return json({ ok: false, code: "server_error", error: msg }, 500);
  }
});
