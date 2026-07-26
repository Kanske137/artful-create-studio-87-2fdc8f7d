// Admin-verktyg: text-till-bild via Replicate FLUX 1.1 Pro för produktassets
// (referensbilder, bakgrunder, kit-varianter). Skapar från noll med full
// promptkontroll — till skillnad från replicate-style (Kontext) som är en
// REDIGERINGSmodell och ärver källbildens kropp/komposition.
//
// ENDAST admin: JWT:n måste tillhöra en godkänd admin-e-post. Output laddas
// upp till ai-references/generated/ (permanent bucket — INTE print-files som
// gallringscronen städar).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ADMIN_EMAILS = ["akram@arthena.se"];

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
      return new Response(JSON.stringify({ error: "admin only" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { prompt, aspect, filename } = await req.json();
    if (!prompt || typeof prompt !== "string") {
      return new Response(JSON.stringify({ error: "prompt required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const start = await fetch(
      "https://api.replicate.com/v1/models/black-forest-labs/flux-1.1-pro/predictions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${REPLICATE_API_TOKEN}`,
          "Content-Type": "application/json",
          Prefer: "wait=30",
        },
        body: JSON.stringify({
          input: {
            prompt,
            aspect_ratio: typeof aspect === "string" && aspect ? aspect : "3:4",
            output_format: "jpg",
            output_quality: 95,
            safety_tolerance: 2,
            prompt_upsampling: false,
          },
        }),
      },
    );

    let prediction = await start.json();
    if (!start.ok) {
      console.error("Replicate start failed", prediction);
      throw new Error(prediction?.detail || "Replicate request failed");
    }

    const deadline = Date.now() + 90_000;
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
      throw new Error(`Replicate ${prediction.status}: ${prediction.error || "timeout"}`);
    }
    const output = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
    if (!output) throw new Error("No output URL");

    // Ladda upp till permanent bucket med service role.
    const service = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const safeName =
      typeof filename === "string" && /^[a-z0-9-]{1,80}$/.test(filename)
        ? filename
        : crypto.randomUUID();
    const path = `generated/${safeName}.jpg`;
    const imgRes = await fetch(output);
    if (!imgRes.ok) throw new Error(`Image fetch failed ${imgRes.status}`);
    const blob = await imgRes.blob();
    const { error: upErr } = await service.storage
      .from("ai-references")
      .upload(path, blob, { contentType: "image/jpeg", upsert: true });
    if (upErr) throw new Error(`Upload failed: ${upErr.message}`);
    const { data: pub } = service.storage.from("ai-references").getPublicUrl(path);

    return new Response(JSON.stringify({ url: pub.publicUrl }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("generate-asset error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
