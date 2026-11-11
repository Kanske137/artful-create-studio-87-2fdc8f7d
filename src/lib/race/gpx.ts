// Läsning av kundens aktivitetsfil för lopptavlan. Körs helt i kundens
// webbläsare — filen laddas aldrig upp. Stödjer GPX (spår/rutter; Strava,
// Garmin, Apple-exportappar m.fl.), TCX (Garmin/Polar m.fl.) och FIT
// (Garmins originalformat; läses med Garmins officiella SDK, laddas först
// när en FIT-fil väljs).
import { boundsOf, cumulativeKm, fillGaps, simplifyToMax } from "./geo";
import type { LngLat, RaceRoute, RaceSplit } from "./types";

export type GpxErrorCode = "not-xml" | "not-gpx" | "no-points" | "too-few-points";

export class GpxError extends Error {
  constructor(public code: GpxErrorCode) {
    super(GPX_ERROR_MESSAGES.sv[code]);
    this.name = "GpxError";
  }
}

export const GPX_ERROR_MESSAGES: Record<"sv" | "en", Record<GpxErrorCode, string>> = {
  sv: {
    "not-xml": "Filen kunde inte läsas. Välj en GPX-, TCX- eller FIT-fil exporterad från t.ex. Strava, Garmin eller Apple Watch.",
    "not-gpx": "Det här verkar inte vara en GPX-, TCX- eller FIT-fil. Exportera aktiviteten och försök igen.",
    "no-points": "Filen innehåller ingen rutt. Kontrollera att du exporterat själva aktiviteten.",
    "too-few-points": "Rutten i filen är för kort för att kunna ritas upp.",
  },
  en: {
    "not-xml": "The file could not be read. Choose a GPX, TCX or FIT file exported from e.g. Strava, Garmin or Apple Watch.",
    "not-gpx": "This doesn't look like a GPX, TCX or FIT file. Export the activity and try again.",
    "no-points": "The file contains no route. Make sure you exported the activity itself.",
    "too-few-points": "The route in the file is too short to draw.",
  },
};

export interface ParsedGpx {
  name: string | null;
  coords: LngLat[];
  ele: Array<number | null>;
  /** Epoch-ms per punkt, eller null. */
  times: Array<number | null>;
}

const MIN_POINTS = 10;

function textOf(el: Element, local: string): string | null {
  const hit = el.getElementsByTagNameNS("*", local)[0] ?? el.getElementsByTagName(local)[0];
  const t = hit?.textContent?.trim();
  return t ? t : null;
}

export function parseGpx(xml: string): ParsedGpx {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xml, "application/xml");
  } catch {
    throw new GpxError("not-xml");
  }
  if (doc.getElementsByTagName("parsererror").length > 0) throw new GpxError("not-xml");
  const root = doc.documentElement;
  if (root?.localName === "TrainingCenterDatabase") return parseTcxDocument(root);
  if (!root || root.localName !== "gpx") throw new GpxError("not-gpx");

  let pts = Array.from(root.getElementsByTagNameNS("*", "trkpt"));
  if (pts.length === 0) pts = Array.from(root.getElementsByTagNameNS("*", "rtept"));
  if (pts.length === 0) throw new GpxError("no-points");

  const coords: LngLat[] = [];
  const ele: Array<number | null> = [];
  const times: Array<number | null> = [];
  for (const p of pts) {
    const lat = parseFloat(p.getAttribute("lat") ?? "");
    const lon = parseFloat(p.getAttribute("lon") ?? "");
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    coords.push([lon, lat]);
    const e = parseFloat(textOf(p, "ele") ?? "");
    ele.push(Number.isFinite(e) ? e : null);
    const t = textOf(p, "time");
    const ms = t ? Date.parse(t) : NaN;
    times.push(Number.isFinite(ms) ? ms : null);
  }
  if (coords.length === 0) throw new GpxError("no-points");
  if (coords.length < MIN_POINTS) throw new GpxError("too-few-points");

  // Namn: spårets namn i första hand, annars metadata.
  const trk = root.getElementsByTagNameNS("*", "trk")[0] ?? root.getElementsByTagNameNS("*", "rte")[0];
  const name = (trk && textOf(trk, "name")) || null;
  return { name, coords, ele, times };
}

/** TCX: Trackpoint med Time, Position (Latitude/LongitudeDegrees) och AltitudeMeters. */
function parseTcxDocument(root: Element): ParsedGpx {
  const coords: LngLat[] = [];
  const ele: Array<number | null> = [];
  const times: Array<number | null> = [];
  for (const tp of Array.from(root.getElementsByTagNameNS("*", "Trackpoint"))) {
    const lat = parseFloat(textOf(tp, "LatitudeDegrees") ?? "");
    const lon = parseFloat(textOf(tp, "LongitudeDegrees") ?? "");
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue; // punkter utan GPS (t.ex. paus)
    coords.push([lon, lat]);
    const e = parseFloat(textOf(tp, "AltitudeMeters") ?? "");
    ele.push(Number.isFinite(e) ? e : null);
    const t = textOf(tp, "Time");
    const ms = t ? Date.parse(t) : NaN;
    times.push(Number.isFinite(ms) ? ms : null);
  }
  if (coords.length === 0) throw new GpxError("no-points");
  if (coords.length < MIN_POINTS) throw new GpxError("too-few-points");
  const name = textOf(root, "Notes") ?? null;
  return { name, coords, ele, times };
}

const SEMICIRCLE_TO_DEG = 180 / 2 ** 31;

/** FIT (binär). Garmins SDK laddas först här, så editorn blir inte tyngre. */
export async function parseFit(bytes: Uint8Array): Promise<ParsedGpx> {
  const { Decoder, Stream } = await import("@garmin/fitsdk");
  const decoder = new Decoder(Stream.fromByteArray(Array.from(bytes)));
  if (!decoder.isFIT()) throw new GpxError("not-gpx");
  const { messages } = decoder.read({ convertDateTimesToDates: true });
  const records = ((messages as Record<string, unknown[]>).recordMesgs ?? []) as Array<{
    positionLat?: number;
    positionLong?: number;
    enhancedAltitude?: number;
    altitude?: number;
    timestamp?: Date;
  }>;
  const coords: LngLat[] = [];
  const ele: Array<number | null> = [];
  const times: Array<number | null> = [];
  for (const r of records) {
    if (typeof r.positionLat !== "number" || typeof r.positionLong !== "number") continue;
    coords.push([r.positionLong * SEMICIRCLE_TO_DEG, r.positionLat * SEMICIRCLE_TO_DEG]);
    const e = r.enhancedAltitude ?? r.altitude;
    ele.push(typeof e === "number" && Number.isFinite(e) ? e : null);
    times.push(r.timestamp instanceof Date ? r.timestamp.getTime() : null);
  }
  if (coords.length === 0) throw new GpxError("no-points");
  if (coords.length < MIN_POINTS) throw new GpxError("too-few-points");
  return { name: null, coords, ele, times };
}

/** FIT-filer har ".FIT" på byte 8–11. */
export function isFitBytes(b: Uint8Array): boolean {
  return b.length > 12 && b[8] === 0x2e && b[9] === 0x46 && b[10] === 0x49 && b[11] === 0x54;
}

function localDateISO(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Kilometertider ur tidsstämplarna (förfluten tid mellan varje hel kilometer,
 * linjärt interpolerat). Sista, ofullständiga kilometern tas med om den är
 * minst 100 m. Null om filen saknar tider (t.ex. en planerad rutt).
 */
export function computeSplits(coords: LngLat[], times: Array<number | null>): RaceSplit[] | null {
  const idx: number[] = [];
  for (let i = 0; i < coords.length; i++) if (typeof times[i] === "number") idx.push(i);
  if (idx.length < 10 || idx.length < coords.length * 0.8) return null;
  const pts = idx.map((i) => coords[i]!);
  const ts = idx.map((i) => times[i] as number);
  const cum = cumulativeKm(pts);
  const total = cum[cum.length - 1]!;
  if (total < 1 || ts[ts.length - 1]! <= ts[0]!) return null;
  const timeAt = (km: number): number => {
    let j = 1;
    while (j < cum.length - 1 && cum[j]! < km) j++;
    const seg = cum[j]! - cum[j - 1]!;
    const t = seg > 0 ? (km - cum[j - 1]!) / seg : 0;
    return ts[j - 1]! + (ts[j]! - ts[j - 1]!) * Math.min(1, Math.max(0, t));
  };
  const out: RaceSplit[] = [];
  let prevT = ts[0]!;
  for (let k = 1; k <= Math.floor(total); k++) {
    const t = timeAt(k);
    out.push({ km: k, distKm: 1, seconds: Math.max(1, (t - prevT) / 1000) });
    prevT = t;
  }
  const rest = total - Math.floor(total);
  if (rest >= 0.1) {
    out.push({ km: Math.round(total * 10) / 10, distKm: rest, seconds: Math.max(1, (ts[ts.length - 1]! - prevT) / 1000) });
  }
  return out.length ? out : null;
}

export interface GpxRouteResult {
  route: RaceRoute;
  name: string | null;
  /** Datum för första tidsstämpeln (lokal tid), annars null. */
  dateISO: string | null;
  /** Total tid första → sista tidsstämpel, sekunder, annars null. */
  elapsedSec: number | null;
  /** Kilometertider, eller null om filen saknar tider. */
  splits: RaceSplit[] | null;
}

/** Bygg en ritbar bana av en tolkad GPX: full distans + förenklad geometri. */
export function routeFromGpx(parsed: ParsedGpx, maxPoints = 800): GpxRouteResult {
  // Ta bort dubbletter (samma punkt i följd) — vanligt vid pauser.
  const keepIdx: number[] = [];
  for (let i = 0; i < parsed.coords.length; i++) {
    const prev = keepIdx.length ? parsed.coords[keepIdx[keepIdx.length - 1]!]! : null;
    const c = parsed.coords[i]!;
    if (!prev || prev[0] !== c[0] || prev[1] !== c[1]) keepIdx.push(i);
  }
  if (keepIdx.length < MIN_POINTS) throw new GpxError("too-few-points");
  const coords = keepIdx.map((i) => parsed.coords[i]!);
  const eleAll = fillGaps(keepIdx.map((i) => parsed.ele[i] ?? null));
  const cum = cumulativeKm(coords);
  const distanceKm = cum[cum.length - 1]!;
  if (distanceKm < 0.2) throw new GpxError("too-few-points");

  const simple = simplifyToMax(coords, maxPoints);
  const route: RaceRoute = {
    coords: simple.map((i) => coords[i]!),
    ele: eleAll ? simple.map((i) => eleAll[i]!) : null,
    distanceKm,
    bbox: boundsOf(coords),
  };

  const timed = keepIdx.map((i) => parsed.times[i]).filter((t): t is number => typeof t === "number");
  const first = timed.length ? Math.min(...timed) : null;
  const last = timed.length ? Math.max(...timed) : null;
  return {
    route,
    name: parsed.name,
    dateISO: first !== null ? localDateISO(first) : null,
    elapsedSec: first !== null && last !== null && last > first ? Math.round((last - first) / 1000) : null,
    splits: computeSplits(coords, keepIdx.map((i) => parsed.times[i] ?? null)),
  };
}

/** Läs en File (från <input type=file>) hela vägen till en ritbar bana. */
export async function readGpxFile(file: File): Promise<GpxRouteResult> {
  const head = new Uint8Array(await readAsBuffer(file.slice(0, 16)));
  if (isFitBytes(head) || /\.fit$/i.test(file.name)) {
    return routeFromGpx(await parseFit(new Uint8Array(await readAsBuffer(file))));
  }
  return routeFromGpx(parseGpx(await readAsText(file)));
}

function readAsBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === "function") return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as ArrayBuffer);
    r.onerror = () => reject(r.error ?? new Error("read failed"));
    r.readAsArrayBuffer(blob);
  });
}

/** Blob.text() saknas i äldre webbläsare — fall tillbaka på FileReader. */
function readAsText(file: Blob): Promise<string> {
  if (typeof file.text === "function") return file.text();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ""));
    r.onerror = () => reject(r.error ?? new Error("read failed"));
    r.readAsText(file);
  });
}
