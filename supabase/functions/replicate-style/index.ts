// Edge function: applicera AI-stil på bild via Replicate Flux Kontext Pro.
// Output laddas upp till `print-files` bucket DIREKT så att klienten har en
// färdig print-URL att skicka in i Shopify cart properties (single pipeline).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ---------- analytics: generations-logg (Fas 2) ----------
// Loggar varje generering till `generations`-tabellen (service role). Får
// ALDRIG påverka själva genereringen — alla fel sväljs och loggas bara.
function genLogDb() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

async function genLogStart(row: Record<string, unknown>): Promise<string | null> {
  try {
    const id = crypto.randomUUID();
    const { error } = await genLogDb().from("generations").insert({ id, ...row });
    if (error) throw new Error(error.message);
    return id;
  } catch (e) {
    console.warn("[gen-log] start failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

async function genLogEnd(id: string | null, patch: Record<string, unknown>): Promise<void> {
  if (!id) return;
  try {
    const { error } = await genLogDb()
      .from("generations")
      .update({ ...patch, completed_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw new Error(error.message);
  } catch (e) {
    console.warn("[gen-log] end failed:", e instanceof Error ? e.message : e);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let genId: string | null = null;
  const genT0 = Date.now();
  try {
    const REPLICATE_API_TOKEN = Deno.env.get("REPLICATE_API_TOKEN");
    if (!REPLICATE_API_TOKEN) throw new Error("REPLICATE_API_TOKEN not configured");

    const { imageUrl, prompt, designId, sessionKey } = await req.json();
    if (!imageUrl || !prompt) {
      return new Response(JSON.stringify({ error: "imageUrl and prompt required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    genId = await genLogStart({
      session_key: typeof sessionKey === "string" ? sessionKey : null,
      design_id: typeof designId === "string" ? designId : null,
      subject_kind: "style",
      provider: "black-forest-labs/flux-kontext-pro",
      input_image_url: imageUrl,
    });

    // Starta prediction
    const start = await fetch("https://api.replicate.com/v1/models/black-forest-labs/flux-kontext-pro/predictions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${REPLICATE_API_TOKEN}`,
        "Content-Type": "application/json",
        Prefer: "wait=30",
      },
      body: JSON.stringify({
        input: {
          input_image: imageUrl,
          prompt,
          output_format: "jpg",
          aspect_ratio: "match_input_image",
          safety_tolerance: 2,
        },
      }),
    });

    let prediction = await start.json();
    if (!start.ok) {
      console.error("Replicate start failed", prediction);
      throw new Error(prediction?.detail || "Replicate request failed");
    }

    // Polla om inte klar
    const deadline = Date.now() + 60_000;
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
    if (!output) throw new Error("Replicate succeeded but produced no output URL");

    // Pass-through to print-files bucket so the client can use the public URL
    // directly as `_print_file_url` in the Shopify cart.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const id = (designId && typeof designId === "string" ? designId : crypto.randomUUID());
    const path = `${id}.jpg`;

    const imgRes = await fetch(output);
    if (!imgRes.ok) throw new Error(`Replicate image fetch failed ${imgRes.status}`);
    const imgBlob = await imgRes.blob();

    const { error: upErr } = await supabase.storage
      .from("print-files")
      .upload(path, imgBlob, { contentType: "image/jpeg", upsert: true });
    if (upErr) throw new Error(`Print upload failed: ${upErr.message}`);

    const { data: pub } = supabase.storage.from("print-files").getPublicUrl(path);
    const printFileUrl = pub.publicUrl;

    await genLogEnd(genId, {
      status: "succeeded",
      duration_ms: Date.now() - genT0,
      output_image_url: printFileUrl,
    });

    return new Response(
      JSON.stringify({ output, previewUrl: output, printFileUrl }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("replicate-style error:", msg);
    await genLogEnd(genId, {
      status: "failed",
      duration_ms: Date.now() - genT0,
      error: msg,
    });
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
