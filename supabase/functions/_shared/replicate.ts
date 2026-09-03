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

/** Storleksvakt före upload. INGEN lokal omkodning — imagescript-decode av en
 *  4K-bild sprängde edge-funktionens CPU-tak (HTTP 546, 2026-08-09). Bilder
 *  som skulle överskrida bucketgränsen ska undvikas vid källan i stället
 *  (4K beställs som JPEG från Replicate, se runNanoBanana). Vakten loggar
 *  bara så att en framtida regression syns i funktionsloggarna. */
export function fitForUpload(
  bytes: Uint8Array,
  contentType: string,
  maxBytes = 14 * 1024 * 1024,
): { bytes: Uint8Array; contentType: string } {
  if (bytes.byteLength > maxBytes) {
    console.warn(
      `[fitForUpload] ${Math.round(bytes.byteLength / 1e6)}MB ${contentType} överskrider ` +
        `${Math.round(maxBytes / 1e6)}MB — uppladdningen lär nekas av bucketgränsen. ` +
        `Kontrollera att 4K beställs som JPEG från modellen.`,
    );
  }
  return { bytes, contentType };
}

/** Kör en modell och returnera outputen RÅ (JSON/objekt) — för modeller som
 *  inte producerar bilder, t.ex. objektdetektering (grounding-dino). */
export async function runReplicateRaw(
  opts: ReplicateCallOpts,
): Promise<{ ok: true; output: unknown } | ReplicateFail> {
  return createAndPoll(opts);
}

/** Läs bildmått ur JPEG/PNG-headern. Returnerar null för okända format.
 *  Ren header-parsning — INGEN avkodning av pixeldata (4K-decode spränger
 *  edge-funktionens CPU-tak, se fitForUpload). */
export function readImageSize(bytes: Uint8Array): { w: number; h: number } | null {
  // PNG: 8-byte signatur, sedan IHDR med bredd/höjd som big-endian u32.
  if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { w: dv.getUint32(16), h: dv.getUint32(20) };
  }
  // JPEG: skanna SOF-markörerna.
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i < bytes.length) {
      if (bytes[i] !== 0xff) return null;
      const marker = bytes[i + 1];
      i += 2;
      if (marker === 0xd8 || marker === 0xd9) return null;
      const len = (bytes[i] << 8) | bytes[i + 1];
      if (
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf)
      ) {
        const h = (bytes[i + 3] << 8) | bytes[i + 4];
        const w = (bytes[i + 5] << 8) | bytes[i + 6];
        return { w, h };
      }
      i += len;
    }
  }
  return null;
}

/** Bildformat som nano-banana-2 accepterar. Exakt enum ur Replicates 422-svar,
 *  verifierad 2026-09-03. Allt annat ger HTTP 422 vid start. */
const NANO_ASPECT_RATIOS: Array<{ label: string; value: number }> = [
  { label: "1:8", value: 1 / 8 },
  { label: "1:4", value: 1 / 4 },
  { label: "9:16", value: 9 / 16 },
  { label: "2:3", value: 2 / 3 },
  { label: "3:4", value: 3 / 4 },
  { label: "4:5", value: 4 / 5 },
  { label: "1:1", value: 1 },
  { label: "5:4", value: 5 / 4 },
  { label: "4:3", value: 4 / 3 },
  { label: "3:2", value: 3 / 2 },
  { label: "16:9", value: 16 / 9 },
  { label: "21:9", value: 21 / 9 },
  { label: "4:1", value: 4 },
  { label: "8:1", value: 8 },
];

/** Närmaste tillåtna nano-banana-format för ett givet bredd/höjd-förhållande. */
export function nearestNanoAspect(ratio: number): string | null {
  if (!isFinite(ratio) || ratio <= 0) return null;
  let best = NANO_ASPECT_RATIOS[0];
  let bestDiff = Infinity;
  for (const c of NANO_ASPECT_RATIOS) {
    // Jämför i log-rymden så avvikelsen mäts relativt, inte absolut.
    const d = Math.abs(Math.log(ratio / c.value));
    if (d < bestDiff) {
      best = c;
      bestDiff = d;
    }
  }
  return best.label;
}

/** Hämta bara headern (64 kB) och läs ut bildens bredd/höjd-förhållande.
 *  Används när vi bara har en URL till ankarbilden. Servrar som ignorerar
 *  Range skickar hela bilden — då läser vi ändå bara headern. */
export async function probeImageAspect(url: string): Promise<number | null> {
  try {
    const r = await fetch(url, { headers: { Range: "bytes=0-65535" } });
    if (!r.ok && r.status !== 206) return null;
    const size = readImageSize(new Uint8Array(await r.arrayBuffer()));
    return size && size.h > 0 ? size.w / size.h : null;
  } catch (e) {
    console.warn("[probeImageAspect] misslyckades:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Nano Banana 2 (Gemini 3.1 Flash Image) via Replicate — exakt samma modell
 *  som tidigare anropades via Lovable AI Gateway, så alla förhandlade prompter
 *  fungerar oförändrat. 2K-upplösning för tryckkvalitet; PNG ut = förlustfri
 *  källa för print-files-uppladdningen.
 *
 *  FORMATFÄLLAN (rotorsak till kundklagomålet på order #1325, 2026-09-03):
 *  `aspect_ratio: "match_input_image"` med FLERA input-bilder matchar INTE
 *  referensen — i produktion följde outputen kundens telefonfoto (9:16) i
 *  stället för konstverket (4:5). Editorns aiPhoto-lager renderar `cover`, så
 *  den för höga bilden beskars ~40 % på höjden och kronan/händerna försvann i
 *  tryckfilen. Skicka därför ALLTID `aspectRatio` (via nearestNanoAspect på
 *  ankarbilden = bild #1) när anropet har mer än en input-bild. */
export const NANO_BANANA_MODEL = "google/nano-banana-2";

export function runNanoBanana(params: {
  promptText: string;
  imageUrls: string[];
  /** "2K" (default) eller "4K". 4K (~3700×4600 px) används för slutbilder
   *  sedan 2026-08-09 — tryckkvalitet för stora format + digitalförsäljning.
   *  Kostnad: ~$0.10 (2K) vs ~$0.15 (4K) per bild; 4K tar ~15 s längre.
   *  VIKTIGT: 4K levereras som JPEG från Replicate — en 4K-PNG är ~21 MB
   *  (över print-files-bucketens 15 MB-gräns, Akrams beslut att behålla) och
   *  lokal omkodning i edge-funktionen spränger CPU-taket (HTTP 546). */
  resolution?: "2K" | "4K";
  /** Explicit bildformat, t.ex. "4:5" (se nearestNanoAspect). Utelämnas →
   *  "match_input_image", vilket bara är säkert med EN input-bild. */
  aspectRatio?: string | null;
}): Promise<ReplicateResult> {
  const resolution = params.resolution ?? "2K";
  return runReplicateModel({
    model: NANO_BANANA_MODEL,
    input: {
      prompt: params.promptText,
      image_input: params.imageUrls,
      resolution,
      aspect_ratio: params.aspectRatio ?? "match_input_image",
      output_format: resolution === "4K" ? "jpg" : "png",
    },
    timeoutMs: 180_000,
  });
}
