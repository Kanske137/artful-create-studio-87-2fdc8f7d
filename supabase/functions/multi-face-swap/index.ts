// Edge function: MULTI face-swap (OPTIONAL mode for aiPhoto layers).
//
// Strictly additive — NEVER called by single-face flows. The legacy
// `replicate-face-swap` function and all of its behavior are untouched.
//
// Inputs (JSON body):
//   layerId            — aiPhoto layer id (used for caching + filename)
//   referenceImageUrl  — admin's reference artwork (REQUIRED)
//   prompt             — admin-edited prompt; may contain `{{SLOTS}}`
//   slots              — ordered: [{ id, position }, …]
//   portraits          — { [slotId]: publicPortraitUrl }
//   designId           — used for the output filename
//
// Calls Replicate `google/nano-banana-2` (Nano Banana 2 / Gemini 3.1 Flash
// Image — samma modell som tidigare via Lovable AI Gateway, migrerad
// 2026-07-21 för kostnadskontroll), passing image 1 = reference,
// image 2..N+1 = portraits in slot order.
//
// Always returns HTTP 200. On recoverable errors the body is
// { error, fallback: true, userMessage } so the client can show a friendly
// toast instead of crashing on a non-2xx.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { NANO_BANANA_MODEL, runNanoBanana } from "../_shared/replicate.ts";

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

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function fallbackResponse(userMessage: string, internal: string) {
  console.error(`[multi-face-swap] fallback: ${internal}`);
  return jsonResponse({ error: internal, fallback: true, userMessage });
}

function buildSlotMappingText(slots: Array<{ id: string; position: string }>): string {
  return slots
    .map((s, i) => `- The person at the ${s.position} position becomes the face in image ${i + 2}`)
    .join("\n");
}

async function callNanoBananaOnce(params: {
  promptText: string;
  imageUrls: string[];
}): Promise<
  | { ok: true; bytes: Uint8Array; contentType: string; outputUrl: string }
  | { ok: false; retriable: boolean; status: number; reason: string; userMessage: string }
> {
  const r = await runNanoBanana({ promptText: params.promptText, imageUrls: params.imageUrls });
  if (r.ok) return r;
  console.error("[multi-face-swap] replicate nano-banana error:", r.reason);
  return {
    ok: false,
    retriable: r.retriable,
    status: r.status,
    reason: r.reason,
    userMessage:
      r.status === 429
        ? "AI-tjänsten är överbelastad just nu. Vänta 10–15 sekunder och försök igen."
        : "Vi kunde inte skapa bilden just nu. Försök igen om en stund.",
  };
}

async function callNanoBanana(params: { promptText: string; imageUrls: string[] }) {
  const BACKOFF_MS = [4000, 8000];
  const MAX_ATTEMPTS = BACKOFF_MS.length + 1;
  let lastFail: { reason: string; userMessage: string; status: number } | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const r = await callNanoBananaOnce(params);
    if (r.ok) {
      if (attempt > 1) console.log(`[multi-face-swap] succeeded on retry ${attempt}/${MAX_ATTEMPTS}`);
      return { ok: true as const, ...r };
    }
    lastFail = { reason: r.reason, userMessage: r.userMessage, status: r.status };
    if (!r.retriable || attempt === MAX_ATTEMPTS) break;
    const wait = BACKOFF_MS[attempt - 1];
    console.log(`[multi-face-swap] retriable failure (${r.reason}) — backing off ${wait}ms`);
    await new Promise((r) => setTimeout(r, wait));
  }
  return {
    ok: false as const,
    response: fallbackResponse(
      lastFail?.userMessage ?? "Vi kunde inte skapa bilden just nu. Försök igen om en stund.",
      `${lastFail?.reason ?? "unknown"} (after ${MAX_ATTEMPTS} attempts)`,
    ),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let genId: string | null = null;
  const genT0 = Date.now();
  try {
    const body = await req.json();
    const layerId: string | undefined = body?.layerId;
    const referenceImageUrl: string | undefined = body?.referenceImageUrl;
    const adminPrompt: string = typeof body?.prompt === "string" ? body.prompt : "";
    const slots = Array.isArray(body?.slots) ? body.slots : [];
    const portraits = (body?.portraits ?? {}) as Record<string, string>;
    const designId: string =
      typeof body?.designId === "string" ? body.designId : crypto.randomUUID();

    if (!layerId) return jsonResponse({ error: "layerId required" }, 400);
    if (!referenceImageUrl) return jsonResponse({ error: "referenceImageUrl required" }, 400);
    if (!Array.isArray(slots) || slots.length < 2 || slots.length > 4) {
      return jsonResponse({ error: "slots must be an array of 2-4 entries" }, 400);
    }

    const normalisedSlots: Array<{ id: string; position: string }> = [];
    for (const s of slots) {
      if (!s || typeof s.id !== "string" || typeof s.position !== "string") {
        return jsonResponse({ error: "each slot must have {id, position}" }, 400);
      }
      normalisedSlots.push({ id: s.id, position: s.position });
    }
    const portraitUrls: string[] = [];
    for (const s of normalisedSlots) {
      const url = portraits[s.id];
      if (typeof url !== "string" || !url) {
        return fallbackResponse(
          "Ladda upp ett porträtt per ansikte och försök igen.",
          `missing portrait for slot ${s.id}`,
        );
      }
      portraitUrls.push(url);
    }

    const slotMappingText = buildSlotMappingText(normalisedSlots);
    const promptText = (adminPrompt && adminPrompt.trim().length > 0
      ? adminPrompt
      : `You are given several images. Image 1 is the reference artwork to preserve exactly. Re-render image 1 with the following face replacements: {{SLOTS}}. Keep everything else unchanged. Return one single edited image with the same aspect ratio as image 1.`
    ).replace(/\{\{SLOTS\}\}/g, slotMappingText);

    console.log(
      `[multi-face-swap] start layerId=${layerId} designId=${designId} ` +
      `slots=${normalisedSlots.length} referenceImage=${referenceImageUrl} ` +
      `portraits=${portraitUrls.join(",")}`,
    );

    genId = await genLogStart({
      session_key: typeof body?.sessionKey === "string" ? body.sessionKey : null,
      design_id: designId,
      layer_id: layerId,
      subject_kind: "multiFace",
      provider: NANO_BANANA_MODEL,
      input_image_url: portraitUrls[0] ?? null,
      reference_image_url: referenceImageUrl,
    });

    const result = await callNanoBanana({
      promptText,
      imageUrls: [referenceImageUrl, ...portraitUrls],
    });
    if (!result.ok) {
      await genLogEnd(genId, {
        status: "failed",
        duration_ms: Date.now() - genT0,
        error: "model fallback (se funktionsloggar)",
      });
      return result.response;
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const ext = result.contentType.includes("png") ? "png" : "jpg";
    const path = `${designId}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from("print-files")
      .upload(path, result.bytes, { contentType: result.contentType, upsert: true });
    if (upErr) {
      await genLogEnd(genId, {
        status: "failed",
        duration_ms: Date.now() - genT0,
        error: `Print upload failed: ${upErr.message}`,
      });
      return fallbackResponse(
        "Vi kunde inte spara den genererade bilden. Försök igen.",
        `Print upload failed: ${upErr.message}`,
      );
    }
    const { data: pub } = supabase.storage.from("print-files").getPublicUrl(path);
    const printFileUrl = pub.publicUrl;
    console.log(`[multi-face-swap] done → printFileUrl=${printFileUrl}`);

    await genLogEnd(genId, {
      status: "succeeded",
      duration_ms: Date.now() - genT0,
      output_image_url: printFileUrl,
    });

    return jsonResponse({
      printFileUrl,
      previewUrl: printFileUrl,
      output: printFileUrl,
      modelUsed: NANO_BANANA_MODEL,
      usedReferenceImageUrl: referenceImageUrl,
      usedPortraitUrls: portraitUrls,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[multi-face-swap] error:", msg);
    await genLogEnd(genId, {
      status: "failed",
      duration_ms: Date.now() - genT0,
      error: msg,
    });
    return fallbackResponse("Något gick fel. Försök igen om en stund.", msg);
  }
});
