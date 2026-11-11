// GPX-läsning för lopptavlan. Körs helt i kundens webbläsare — filen laddas
// aldrig upp. Stödjer spår (trkpt) och rutter (rtept); export från Strava,
// Garmin Connect m.fl. är GPX 1.1 med spår.
import { boundsOf, cumulativeKm, fillGaps, simplifyToMax } from "./geo";
import type { LngLat, RaceRoute } from "./types";

export type GpxErrorCode = "not-xml" | "not-gpx" | "no-points" | "too-few-points";

export class GpxError extends Error {
  constructor(public code: GpxErrorCode) {
    super(GPX_ERROR_MESSAGES.sv[code]);
    this.name = "GpxError";
  }
}

export const GPX_ERROR_MESSAGES: Record<"sv" | "en", Record<GpxErrorCode, string>> = {
  sv: {
    "not-xml": "Filen kunde inte läsas. Välj en GPX-fil exporterad från t.ex. Strava eller Garmin.",
    "not-gpx": "Det här verkar inte vara en GPX-fil. Exportera loppet som GPX och försök igen.",
    "no-points": "Filen innehåller ingen rutt. Kontrollera att du exporterat själva aktiviteten.",
    "too-few-points": "Rutten i filen är för kort för att kunna ritas upp.",
  },
  en: {
    "not-xml": "The file could not be read. Choose a GPX file exported from e.g. Strava or Garmin.",
    "not-gpx": "This doesn't look like a GPX file. Export the race as GPX and try again.",
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

function localDateISO(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export interface GpxRouteResult {
  route: RaceRoute;
  name: string | null;
  /** Datum för första tidsstämpeln (lokal tid), annars null. */
  dateISO: string | null;
  /** Total tid första → sista tidsstämpel, sekunder, annars null. */
  elapsedSec: number | null;
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
  };
}

/** Läs en File (från <input type=file>) hela vägen till en ritbar bana. */
export async function readGpxFile(file: File): Promise<GpxRouteResult> {
  const text = await file.text();
  return routeFromGpx(parseGpx(text));
}
