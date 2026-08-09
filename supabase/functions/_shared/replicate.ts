// Gemensam Replicate-klient för Arthenas edge-funktioner.
//
// Ansvar: skapa en prediction (officiell modell-path eller pinnad community-
// version), polla till terminalstatus inom en deadline och ladda ner output-
// bilden som bytes. Används av alla vägar som migrerats från Lovable AI
// Gateway till Replicate (nano-banana-2 för pet/removeBackground/multi-face)
// samt av cdingram-routingen. De äldre flux-vägarna i replicate-face-swap
// behåller sin lokala polling — de är ett aktivt experimentspår och rörs inte
// av migrationen.
//
// Kostnadskontroll är hela poängen med migrationen: ALL bildgenerering går
// nu via REPLICATE_API_TOKEN och syns i Replicates dashboard/fakturering.

import { Image } from "https://deno.land/x/imagescript@1.3.0/mod.ts";

export interface ReplicateOk {
  ok: true;
  bytes: Uint8Array;
  contentType: string;
  outputUrl: string;
}

export interface ReplicateFail {
  ok: false;
  /** true när ett omförsök är meningsfullt (429/5xx/timeout/tomt svar). */
  retriable: boolean;
  status: number;
  reason: string;
}

export type ReplicateResult = ReplicateOk | ReplicateFail;

interface ReplicateCallOpts {
  /** Officiell modell, t.ex. "google/nano-banana-2". Utesluter `version`. */
  model?: string;
  /** Pinnad community-versionshash (utan modellnamn). Utesluter `model`. */
  version?: string;
  input: Record<string, unknown>;
  /** Total maxtid inklusive polling. Default 120 s. */
  timeoutMs?: number;
}

/** Skapa prediction + polla till terminalstatus. Gemensam kärna för både
 *  bild- och rådata-varianterna nedan. */
async function createAndPoll(
  opts: ReplicateCallOpts,
): Promise<{ ok: true; output: unknown } | ReplicateFail> {
  const token = Deno.env.get("REPLICATE_API_TOKEN");
  if (!token) {
    return { ok: false, retriable: false, status: 0, reason: "REPLICATE_API_TOKEN not configured" };
  }

  const url = opts.model
    ? `https://api.replicate.com/v1/models/${opts.model}/predictions`
    : "https://api.replicate.com/v1/predictions";
  const body = opts.model ? { input: opts.input } : { version: opts.version, input: opts.input };

  // Skapandet retry:as vid 429/5xx (upp till 3 försök, 6s/12s backoff).
  // Viktigt vid Replicates lågkredit-throttling (burst=1) där parallella
  // anrop annars fäller varandra — t.ex. multiface-motorns två swappar.
  const CREATE_ATTEMPTS = 3;
  let prediction: { status?: string; error?: unknown; output?: unknown; urls?: { get: string } } | null = null;
  for (let attempt = 1; attempt <= CREATE_ATTEMPTS; attempt++) {
    const start = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Prefer: "wait=30",
      },
      body: JSON.stringify(body),
    });
    prediction = await start.json().catch(() => null);
    if (start.ok) break;

    const retriable = start.status === 429 || start.status >= 500;
    if (!retriable || attempt === CREATE_ATTEMPTS) {
      return {
        ok: false,
        retriable,
        status: start.status,
        reason: `Replicate start failed ${start.status}: ${JSON.stringify(prediction ?? "").slice(0, 200)}`,
      };
    }
    const wait = attempt * 6000;
    console.log(`[replicate] start ${start.status} — backar av ${wait}ms (försök ${attempt}/${CREATE_ATTEMPTS})`);
    await new Promise((r) => setTimeout(r, wait));
  }

  const deadline = Date.now() + (opts.timeoutMs ?? 120_000);
  while (
    prediction?.status !== "succeeded" &&
    prediction?.status !== "failed" &&
    prediction?.status !== "canceled" &&
    Date.now() < deadline
  ) {
    await new Promise((r) => setTimeout(r, 1500));
    const poll = await fetch(prediction.urls.get, {
      headers: { Authorization: `Bearer ${token}` },
    });
    prediction = await poll.json();
  }

  if (prediction?.status !== "succeeded") {
    return {
      ok: false,
      retriable: true,
      status: 200,
      reason: `Replicate ${prediction?.status ?? "timeout"}: ${String(prediction?.error ?? "no result before deadline").slice(0, 300)}`,
    };
  }

  return { ok: true, output: prediction.output };
}

/** Kör en modell vars output är en bild-URL (eller en array av URL:er) —
 *  laddar ner bilden och returnerar bytes. */
export async function runReplicateModel(opts: ReplicateCallOpts): Promise<ReplicateResult> {
  const r = await createAndPoll(opts);
  if (!r.ok) return r;

  const outputUrl = Array.isArray(r.output) ? r.output[0] : r.output;
  if (typeof outputUrl !== "string" || !outputUrl) {
    return { ok: false, retriable: true, status: 200, reason: "Replicate succeeded but returned no output URL" };
  }

  const img = await fetch(outputUrl);
  if (!img.ok) {
    return {
      ok: false,
      retriable: img.status >= 500,
      status: img.status,
      reason: `Output image fetch failed ${img.status}`,
    };
  }
  return {
    ok: true,
    bytes: new Uint8Array(await img.arrayBuffer()),
    contentType: img.headers.get("content-type") ?? "image/png",
    outputUrl,
  };
}

/** Säkerställ att bilden ryms i lagrings-bucketen. 4K-PNG:er från Nano
 *  Banana 2 är ~20 MB och kan överskrida bucketens file_size_limit — då
 *  omkodas de till JPEG q95 (~3-6 MB, visuellt likvärdigt i tryck).
 *  Bilder under gränsen returneras orörda (förlustfri PNG behålls). */
export async function fitForUpload(
  bytes: Uint8Array,
  contentType: string,
  maxBytes = 14 * 1024 * 1024,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  if (bytes.byteLength <= maxBytes) return { bytes, contentType };
  try {
    const img = await Image.decode(bytes);
    const jpeg = await img.encodeJPEG(95);
    console.log(
      `[fitForUpload] ${Math.round(bytes.byteLength / 1e6)}MB ${contentType} → ` +
        `${Math.round(jpeg.byteLength / 1e6)}MB image/jpeg (${img.width}x${img.height})`,
    );
    return { bytes: jpeg, contentType: "image/jpeg" };
  } catch (e) {
    console.warn("[fitForUpload] re-encode failed — uploading original:", e instanceof Error ? e.message : e);
    return { bytes, contentType };
  }
}

/** Kör en modell och returnera outputen RÅ (JSON/objekt) — för modeller som
 *  inte producerar bilder, t.ex. objektdetektering (grounding-dino). */
export async function runReplicateRaw(
  opts: ReplicateCallOpts,
): Promise<{ ok: true; output: unknown } | ReplicateFail> {
  return createAndPoll(opts);
}

/** Nano Banana 2 (Gemini 3.1 Flash Image) via Replicate — exakt samma modell
 *  som tidigare anropades via Lovable AI Gateway, så alla förhandlade prompter
 *  fungerar oförändrat. 2K-upplösning för tryckkvalitet; aspect ratio följer
 *  input-bilden (referensen) precis som gateway-beteendet. PNG ut = förlustfri
 *  källa för print-files-uppladdningen. */
export const NANO_BANANA_MODEL = "google/nano-banana-2";

export function runNanoBanana(params: {
  promptText: string;
  imageUrls: string[];
  /** "2K" (default) eller "4K". 4K (~3700×4600 px) används för slutbilder
   *  sedan 2026-08-09 — tryckkvalitet för stora format + digitalförsäljning.
   *  Kostnad: ~$0.10 (2K) vs ~$0.15 (4K) per bild; 4K tar ~15 s längre. */
  resolution?: "2K" | "4K";
}): Promise<ReplicateResult> {
  return runReplicateModel({
    model: NANO_BANANA_MODEL,
    input: {
      prompt: params.promptText,
      image_input: params.imageUrls,
      resolution: params.resolution ?? "2K",
      aspect_ratio: "match_input_image",
      output_format: "png",
    },
    timeoutMs: 180_000,
  });
}
