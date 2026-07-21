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
import { Image } from "https://deno.land/x/imagescript@1.3.0/mod.ts";
import { NANO_BANANA_MODEL, runNanoBanana, runReplicateModel, runReplicateRaw } from "../_shared/replicate.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// cdingram-motorn (Steg 1, bakom ?engine=cdingram). Samma pinnade version
// som replicate-face-swap använder för human-swappar.
const FACE_SWAP_MODEL_NAME = "cdingram/face-swap";
const FACE_SWAP_MODEL_VERSION = "d1d6ea8c8be89d664a07a457526f7128109dee7030fdac424788d762c71ed111";
const FACE_DETECT_MODEL = "adirik/grounding-dino";
const CDINGRAM_PROVIDER = `${FACE_SWAP_MODEL_NAME} x2 (crop-composite)`;
const CROP_FEATHER_PX = 24;

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

// ---------- Engine: cdingram crop-composite (Steg 1 — testflagga) ----------
// Aktiveras ENDAST via ?engine=cdingram (ingen klient skickar den ännu —
// nano-banana-2 förblir default). Flöde: detektera ansiktslådor i referensen
// (grounding-dino, cachas i reference_face_boxes per referens-URL) → beskär
// en generös men EXKLUSIV crop per person → 2× cdingram/face-swap parallellt
// → feather-komposit tillbaka på den orörda referensen. Slot-ordningen
// mappas vänster→höger — samma ordning som mallens slots är definierade i.

interface FaceBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

async function getFaceBoxes(
  referenceUrl: string,
): Promise<{ ok: true; boxes: FaceBox[] } | { ok: false; reason: string }> {
  const db = genLogDb();
  try {
    const { data } = await db
      .from("reference_face_boxes")
      .select("boxes")
      .eq("reference_url", referenceUrl)
      .maybeSingle();
    if (data?.boxes) return { ok: true, boxes: data.boxes as FaceBox[] };
  } catch (e) {
    console.warn("[multi-face-swap] box cache read failed:", e instanceof Error ? e.message : e);
  }

  const det = await runReplicateRaw({
    model: FACE_DETECT_MODEL,
    input: { image: referenceUrl, query: "face", box_threshold: 0.3, show_visualisation: false },
    timeoutMs: 90_000,
  });
  if (!det.ok) return { ok: false, reason: `face detection failed: ${det.reason}` };

  // grounding-dino: { detections: [{ bbox: [x1,y1,x2,y2], label, confidence }] }
  const rawList = (det.output as { detections?: unknown[] })?.detections ?? det.output;
  if (!Array.isArray(rawList)) {
    return { ok: false, reason: `unexpected detection output: ${JSON.stringify(det.output).slice(0, 200)}` };
  }
  const boxes: FaceBox[] = [];
  for (const d of rawList) {
    const bb = (d as { bbox?: number[]; box?: number[] }).bbox ?? (d as { box?: number[] }).box;
    if (Array.isArray(bb) && bb.length === 4) {
      boxes.push({ x1: bb[0], y1: bb[1], x2: bb[2], y2: bb[3] });
    }
  }
  if (boxes.length === 0) return { ok: false, reason: "no faces detected in reference" };

  try {
    await db
      .from("reference_face_boxes")
      .upsert(
        { reference_url: referenceUrl, boxes, provider: FACE_DETECT_MODEL },
        { onConflict: "reference_url" },
      );
  } catch (e) {
    console.warn("[multi-face-swap] box cache write failed:", e instanceof Error ? e.message : e);
  }
  return { ok: true, boxes };
}

/** Expandera de två mest framträdande lådorna till generösa, ömsesidigt
 *  exklusiva beskärningar (delningslinje mitt emellan ansiktena så cdingram
 *  aldrig ser fel persons ansikte i sin crop). */
function cropsFromBoxes(
  boxes: FaceBox[],
  imgW: number,
  imgH: number,
): Array<{ x: number; y: number; w: number; h: number }> {
  const two = [...boxes]
    .sort((a, b) => (b.x2 - b.x1) * (b.y2 - b.y1) - (a.x2 - a.x1) * (a.y2 - a.y1))
    .slice(0, 2)
    .sort((a, b) => a.x1 + a.x2 - (b.x1 + b.x2));
  const [left, right] = two;
  const divider = Math.round((left.x2 + right.x1) / 2);

  const expand = (b: FaceBox, side: "left" | "right") => {
    const w = b.x2 - b.x1;
    const h = b.y2 - b.y1;
    let x1 = Math.round(b.x1 - w * 0.9);
    let x2 = Math.round(b.x2 + w * 0.9);
    let y1 = Math.round(b.y1 - h * 1.4); // rymmer krona/tiara/frisyr
    let y2 = Math.round(b.y2 + h * 1.8); // rymmer hals/axelparti
    if (side === "left") x2 = Math.min(x2, divider);
    else x1 = Math.max(x1, divider);
    x1 = Math.max(0, x1);
    y1 = Math.max(0, y1);
    x2 = Math.min(imgW, x2);
    y2 = Math.min(imgH, y2);
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  };
  return [expand(left, "left"), expand(right, "right")];
}

/** Linjär alfa-ramp runt croppens kant så kompositen smälter in utan skarv. */
function applyFeather(img: Image, feather: number): void {
  const w = img.width;
  const h = img.height;
  const bmp = img.bitmap;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = Math.min(x, y, w - 1 - x, h - 1 - y);
      if (d < feather) {
        const i = (y * w + x) * 4 + 3;
        bmp[i] = Math.round(bmp[i] * (d / feather));
      }
    }
  }
}

async function fetchImage(url: string): Promise<Image> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`image fetch ${r.status} for ${url}`);
  return Image.decode(new Uint8Array(await r.arrayBuffer()));
}

async function runCdingramTwoFaceSwap(params: {
  referenceImageUrl: string;
  /** I slot-ordning; mappas mot ansikten sorterade vänster→höger. */
  portraitUrls: string[];
  designId: string;
}): Promise<
  { ok: true; bytes: Uint8Array; contentType: string; outputUrl: string } | { ok: false; response: Response }
> {
  const fail = (userMessage: string, internal: string) => ({
    ok: false as const,
    response: fallbackResponse(userMessage, internal),
  });

  const boxesRes = await getFaceBoxes(params.referenceImageUrl);
  if (!boxesRes.ok) return fail("Vi kunde inte analysera referensbilden. Försök igen.", boxesRes.reason);
  if (boxesRes.boxes.length < 2) {
    return fail(
      "Referensbilden verkar inte innehålla två ansikten.",
      `only ${boxesRes.boxes.length} face(s) detected in reference`,
    );
  }

  const reference = await fetchImage(params.referenceImageUrl);
  const crops = cropsFromBoxes(boxesRes.boxes, reference.width, reference.height);

  // Ladda upp beskärningarna så cdingram kan hämta dem via publik URL.
  const db = genLogDb();
  const cropUrls: string[] = [];
  for (let i = 0; i < 2; i++) {
    const c = crops[i];
    const piece = reference.clone().crop(c.x, c.y, c.w, c.h);
    const bytes = await piece.encode();
    const path = `mfcrop-${params.designId}-${i}.png`;
    const { error } = await db.storage
      .from("cart-previews")
      .upload(path, bytes, { contentType: "image/png", upsert: true });
    if (error) return fail("Vi kunde inte förbereda bilden. Försök igen.", `crop upload failed: ${error.message}`);
    cropUrls.push(db.storage.from("cart-previews").getPublicUrl(path).data.publicUrl);
  }

  // Två cdingram-swappar PARALLELLT — en per person.
  const swaps = await Promise.all(
    cropUrls.map((cropUrl, i) =>
      runReplicateModel({
        version: FACE_SWAP_MODEL_VERSION,
        input: { input_image: cropUrl, swap_image: params.portraitUrls[i] },
        timeoutMs: 120_000,
      }),
    ),
  );
  for (let i = 0; i < swaps.length; i++) {
    const s = swaps[i];
    if (!s.ok) {
      return fail(
        "Vi kunde inte byta in ett av ansiktena. Prova bilder där ansiktet syns tydligt rakt framifrån.",
        `cdingram swap ${i} failed: ${s.reason}`,
      );
    }
  }

  // Feather-komposit tillbaka på den orörda referensen.
  for (let i = 0; i < 2; i++) {
    const s = swaps[i] as { ok: true; bytes: Uint8Array };
    const c = crops[i];
    let piece = await Image.decode(s.bytes);
    if (piece.width !== c.w || piece.height !== c.h) piece = piece.resize(c.w, c.h);
    applyFeather(piece, CROP_FEATHER_PX);
    reference.composite(piece, c.x, c.y);
  }

  const outBytes = await reference.encodeJPEG(95);
  return { ok: true, bytes: outBytes, contentType: "image/jpeg", outputUrl: "(composited from 2 swaps)" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Testflagga (Steg 1): ?engine=cdingram aktiverar crop-composite-motorn.
  // Default är alltid nano-banana-2 — ingen klient skickar parametern ännu.
  const engine = new URL(req.url).searchParams.get("engine") === "cdingram" ? "cdingram" : "nano";

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

    if (engine === "cdingram" && normalisedSlots.length !== 2) {
      return fallbackResponse(
        "Den här varianten stödjer exakt två personer.",
        `cdingram engine requires exactly 2 slots, got ${normalisedSlots.length}`,
      );
    }

    const provider = engine === "cdingram" ? CDINGRAM_PROVIDER : NANO_BANANA_MODEL;
    console.log(
      `[multi-face-swap] start engine=${engine} layerId=${layerId} designId=${designId} ` +
      `slots=${normalisedSlots.length} referenceImage=${referenceImageUrl} ` +
      `portraits=${portraitUrls.join(",")}`,
    );

    genId = await genLogStart({
      session_key: typeof body?.sessionKey === "string" ? body.sessionKey : null,
      design_id: designId,
      layer_id: layerId,
      subject_kind: "multiFace",
      provider,
      input_image_url: portraitUrls[0] ?? null,
      reference_image_url: referenceImageUrl,
    });

    const result =
      engine === "cdingram"
        ? await runCdingramTwoFaceSwap({ referenceImageUrl, portraitUrls, designId })
        : await callNanoBanana({
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
      modelUsed: provider,
      engine,
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
