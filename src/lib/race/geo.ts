// Geometri för banor: distans, förenkling, km-markeringar, höjdprofil.
// Rena funktioner utan beroenden — testas i geo.test.ts.
import type { Bounds, LngLat } from "./types";

const EARTH_R_KM = 6371.0088;
const toRad = (d: number) => (d * Math.PI) / 180;

export function haversineKm(a: LngLat, b: LngLat): number {
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Kumulativ distans (km) per punkt; första = 0. */
export function cumulativeKm(coords: LngLat[]): number[] {
  const out = new Array<number>(coords.length);
  let acc = 0;
  for (let i = 0; i < coords.length; i++) {
    if (i > 0) acc += haversineKm(coords[i - 1]!, coords[i]!);
    out[i] = acc;
  }
  return out;
}

export function totalKm(coords: LngLat[]): number {
  const c = cumulativeKm(coords);
  return c.length ? c[c.length - 1]! : 0;
}

export function boundsOf(coords: LngLat[]): Bounds {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [lng, lat] of coords) {
    if (lng < w) w = lng;
    if (lng > e) e = lng;
    if (lat < s) s = lat;
    if (lat > n) n = lat;
  }
  return [[w, s], [e, n]];
}

/**
 * Douglas–Peucker i lokala meter (ekvirektangulär projektion runt banans
 * mitt — fullt tillräckligt för en bana på några mil). Returnerar index
 * för punkterna som behålls, så att höjd/tid kan följa med.
 */
export function simplifyIndices(coords: LngLat[], toleranceM: number): number[] {
  const n = coords.length;
  if (n <= 2) return coords.map((_, i) => i);
  const [[, south], [, north]] = boundsOf(coords);
  const midLat = toRad((south + north) / 2);
  const kx = 111_320 * Math.cos(midLat);
  const ky = 110_540;
  const xs = coords.map((c) => c[0] * kx);
  const ys = coords.map((c) => c[1] * ky);
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const tol2 = toleranceM * toleranceM;
  const stack: Array<[number, number]> = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const ax = xs[a]!, ay = ys[a]!, bx = xs[b]!, by = ys[b]!;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let maxD = -1, idx = -1;
    for (let i = a + 1; i < b; i++) {
      let px = xs[i]! - ax, py = ys[i]! - ay;
      if (len2 > 0) {
        const t = Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
        px -= t * dx;
        py -= t * dy;
      }
      const d2 = px * px + py * py;
      if (d2 > maxD) {
        maxD = d2;
        idx = i;
      }
    }
    if (idx !== -1 && maxD > tol2) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(i);
  return out;
}

/** Förenkla tills punktantalet är högst `maxPoints` (ökar toleransen stegvis). */
export function simplifyToMax(coords: LngLat[], maxPoints = 800): number[] {
  let tol = 2;
  let idx = simplifyIndices(coords, tol);
  while (idx.length > maxPoints && tol < 500) {
    tol *= 1.6;
    idx = simplifyIndices(coords, tol);
  }
  return idx;
}

/** Punkt längs linjen vid given distans (km, i linjens egen skala). */
export function pointAtKm(coords: LngLat[], cum: number[], km: number): LngLat {
  if (coords.length === 0) return [0, 0];
  if (km <= 0) return coords[0]!;
  const last = cum[cum.length - 1]!;
  if (km >= last) return coords[coords.length - 1]!;
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid]! <= km) lo = mid;
    else hi = mid;
  }
  const seg = cum[hi]! - cum[lo]!;
  const t = seg > 0 ? (km - cum[lo]!) / seg : 0;
  const a = coords[lo]!, b = coords[hi]!;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** Steglängd för km-markeringar: varje km upp till 10 km, annars var 5:e. */
export function kmMarkerStep(distanceKm: number): number {
  if (distanceKm <= 10.5) return 1;
  if (distanceKm <= 60) return 5;
  return 10;
}

/**
 * Km-markeringar längs banan. `distanceKm` är banans verkliga längd — den
 * förenklade linjen är något kortare, så positionerna skalas om.
 */
export function kmMarkers(
  coords: LngLat[],
  distanceKm: number,
  step = kmMarkerStep(distanceKm),
): Array<{ km: number; at: LngLat }> {
  if (coords.length < 2 || distanceKm <= 0) return [];
  const cum = cumulativeKm(coords);
  const lineLen = cum[cum.length - 1]!;
  if (lineLen <= 0) return [];
  const scale = lineLen / distanceKm;
  const out: Array<{ km: number; at: LngLat }> = [];
  for (let km = step; km < distanceKm - step * 0.25; km += step) {
    out.push({ km, at: pointAtKm(coords, cum, km * scale) });
  }
  return out;
}

/**
 * Höjdprofil omsamplad till `samples` jämnt fördelade punkter längs
 * distansen, med lätt utjämning (GPS-höjd brusar).
 */
export function elevationSeries(coords: LngLat[], ele: number[], samples = 160): number[] {
  if (coords.length < 2 || ele.length !== coords.length) return [];
  const cum = cumulativeKm(coords);
  const len = cum[cum.length - 1]!;
  if (len <= 0) return [];
  const raw: number[] = [];
  let j = 0;
  for (let i = 0; i < samples; i++) {
    const d = (len * i) / (samples - 1);
    while (j < cum.length - 2 && cum[j + 1]! < d) j++;
    const seg = cum[j + 1]! - cum[j]!;
    const t = seg > 0 ? Math.min(1, Math.max(0, (d - cum[j]!) / seg)) : 0;
    raw.push(ele[j]! + (ele[j + 1]! - ele[j]!) * t);
  }
  // Glidande medelvärde, fönster ±2.
  return raw.map((_, i) => {
    let s = 0, c = 0;
    for (let k = Math.max(0, i - 2); k <= Math.min(raw.length - 1, i + 2); k++) {
      s += raw[k]!;
      c++;
    }
    return s / c;
  });
}

/** Total stigning (m) med tröskel för att inte räkna GPS-brus. */
export function elevationGainM(series: number[], thresholdM = 2): number {
  if (series.length < 2) return 0;
  let gain = 0;
  let ref = series[0]!;
  for (const v of series) {
    if (v > ref + thresholdM) {
      gain += v - ref;
      ref = v;
    } else if (v < ref - thresholdM) {
      ref = v;
    }
  }
  return gain;
}

/** Fyll luckor (null) i en serie med linjär interpolation. Null om <50 % data. */
export function fillGaps(values: Array<number | null>): number[] | null {
  const known = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (values.length === 0 || known.length < values.length * 0.5) return null;
  const out = values.slice() as Array<number | null>;
  let lastIdx = -1;
  for (let i = 0; i < out.length; i++) {
    if (typeof out[i] === "number") {
      if (lastIdx === -1) {
        for (let k = 0; k < i; k++) out[k] = out[i];
      } else if (i - lastIdx > 1) {
        const a = out[lastIdx]!, b = out[i]!;
        for (let k = lastIdx + 1; k < i; k++) out[k] = a + ((b - a) * (k - lastIdx)) / (i - lastIdx);
      }
      lastIdx = i;
    }
  }
  for (let k = lastIdx + 1; k < out.length; k++) out[k] = out[lastIdx]!;
  return out as number[];
}
