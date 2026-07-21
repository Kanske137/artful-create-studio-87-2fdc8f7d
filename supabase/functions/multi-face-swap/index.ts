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
// Calls Lovable AI Gateway with Nano Banana 2 (Gemini 3.1 flash image),
// passing image 1 = reference, image 2..N+1 = portraits in slot order.
//
// Always returns HTTP 200. On recoverable errors the body is
// { error, fallback: true, userMessage } so the client can show a friendly
// toast instead of crashing on a non-2xx.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const AI_GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3.1-flash-image-preview";

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

function base64ToBytes(b64: string): Uint8Array {
  const cleaned = b64.startsWith("data:") ? b64.slice(b64.indexOf(",") + 1) : b64;
  const bin = atob(cleaned);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function buildSlotMappingText(slots: Array<{ id: string; position: string }>): string {
  return slots
    .map((s, i) => `- The person at the ${s.position} position becomes the face in image ${i + 2}`)
    .join("\n");
}

async function callNanoBananaOnce(params: {
  promptText: string;
  imageUrls: string[];
  apiKey: string;
}): Promise<
  | { ok: true; bytes: Uint8Array; contentType: string; outputUrl: string }
  | { ok: false; retriable: boolean; status: number; reason: string; userMessage: string }
> {
  const content: Array<Record<string, unknown>> = [
    { type: "text", text: params.promptText },
  ];
  for (const url of params.imageUrls) {
    content.push({ type: "image_url", image_url: { url } });
  }

  const res = await fetch(AI_GATEWAY_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      modalities: ["image", "text"],
      messages: [{ role: "user", content }],
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    console.error("[multi-face-swap] AI gateway error", res.status, errBody);
    if (res.status === 429) {
      return {
        ok: false, retriable: true, status: 429,
        reason: "Lovable AI rate-limited (429)",
        userMessage: "AI-tjänsten är överbelastad just nu. Vänta 10–15 sekunder och försök igen.",
      };
    }
    if (res.status === 402) {
      return {
        ok: false, retriable: false, status: 402,
        reason: "Lovable AI payment required (402)",
        userMessage: "AI-krediten är slut. Kontakta supporten så löser vi det.",
      };
    }
    const retriable = res.status >= 500;
    return {
      ok: false, retriable, status: res.status,
      reason: `AI gateway error ${res.status}: ${errBody.slice(0, 200)}`,
      userMessage: "Vi kunde inte skapa bilden just nu. Försök igen om en stund.",
    };
  }

  const data = await res.json();
  const usage = data?.usage;
  if (usage) {
    console.log(
      `[multi-face-swap] AI usage prompt=${usage.prompt_tokens ?? "?"} ` +
      `completion=${usage.completion_tokens ?? "?"} total=${usage.total_tokens ?? "?"}`,
    );
  }

  const msg = data?.choices?.[0]?.message;
  const imageUrl: string | undefined =
    msg?.images?.[0]?.image_url?.url ??
    msg?.images?.[0]?.url ??
    (typeof msg?.content === "string" && msg.content.startsWith("data:") ? msg.content : undefined);

  if (!imageUrl) {
    console.error("[multi-face-swap] AI returned no image", JSON.stringify(data).slice(0, 500));
    return {
      ok: false, retriable: true, status: 200,
      reason: "AI gateway response missing image",
      userMessage: "AI-modellen returnerade ingen bild den här gången. Försök igen.",
    };
  }

  let bytes: Uint8Array;
  let contentType = "image/png";
  if (imageUrl.startsWith("data:")) {
    const mimeMatch = imageUrl.match(/^data:([^;]+);base64,/);
    if (mimeMatch) contentType = mimeMatch[1];
    bytes = base64ToBytes(imageUrl);
  } else {
    const r = await fetch(imageUrl);
    if (!r.ok) {
      return {
        ok: false, retriable: r.status >= 500, status: r.status,
        reason: `AI image fetch failed ${r.status}`,
        userMessage: "Vi kunde inte hämta den genererade bilden. Försök igen.",
      };
    }
    bytes = new Uint8Array(await r.arrayBuffer());
    contentType = r.headers.get("content-type") ?? contentType;
  }

  return {
    ok: true,
    bytes,
    contentType,
    outputUrl: imageUrl.startsWith("data:") ? "(inline base64)" : imageUrl,
  };
}

async function callNanoBanana(params: { promptText: string; imageUrls: string[] }) {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) {
    return {
      ok: false as const,
      response: fallbackResponse(
        "Tjänsten är tillfälligt otillgänglig. Försök igen senare.",
        "LOVABLE_API_KEY not configured",
      ),
    };
  }
  const BACKOFF_MS = [4000, 8000];
  const MAX_ATTEMPTS = BACKOFF_MS.length + 1;
  let lastFail: { reason: string; userMessage: string; status: number } | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const r = await callNanoBananaOnce({ ...params, apiKey });
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
      provider: MODEL,
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
      modelUsed: MODEL,
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
