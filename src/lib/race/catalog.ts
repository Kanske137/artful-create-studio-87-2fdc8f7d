// Loppkatalogen. Metadata här; banorna ligger i public/races/<id>-<år>.json
// (kompakt format: Google encoded polyline + höjd i hela meter) och laddas
// först när kunden väljer loppet, så editorn blir inte tyngre.
//
// Lägga till ett lopp: hämta arrangörens officiella GPX/KML/KMZ med
// tools/route-extract.mjs (körs i webbläsaren på arrangörens sida), spara med
// tools/save-course.mjs och lägg till en `courses`-rad nedan.
// src/lib/race/courses.test.ts kontrollerar varje banfil.
// Ett lopp utan banor visas inte i väljaren.
import { boundsOf } from "./geo";
import type { LngLat, RaceCategory, RaceRoute } from "./types";

export interface RaceCourse {
  /** Första året banan gäller (banor ändras mellan år). */
  year: number;
  /** Filnamn i public/races/. */
  file: string;
}

export interface RaceDef {
  id: string;
  name: string;
  city: string;
  country: string;
  category: RaceCategory;
  /** Officiell distans. */
  distanceKm: number;
  /** Extra sökord i väljaren. */
  aliases?: string[];
  /** Ungefärligt antal deltagare. Används bara för att sortera väljaren
   *  (största loppen först); visas aldrig för kunden. */
  size?: number;
  courses: RaceCourse[];
}

export const RACE_CATALOG: RaceDef[] = [
  { id: "stockholm-marathon", name: "Stockholm Marathon", city: "Stockholm", country: "Sverige", category: "marathon", distanceKm: 42.195, aliases: ["maraton stockholm"], size: 20000, courses: [{ year: 2026, file: "stockholm-marathon-2026.json" }] },
  { id: "goteborgsvarvet", name: "Göteborgsvarvet", city: "Göteborg", country: "Sverige", category: "half", distanceKm: 21.0975, aliases: ["varvet"], size: 45000, courses: [{ year: 2026, file: "goteborgsvarvet-2026.json" }] },
  { id: "stockholm-halvmarathon", name: "Stockholm Halvmarathon", city: "Stockholm", country: "Sverige", category: "half", distanceKm: 21.0975, aliases: ["halvmaraton stockholm"], size: 18000, courses: [{ year: 2026, file: "stockholm-halvmarathon-2026.json" }] },
  { id: "lidingoloppet-30", name: "Lidingöloppet", city: "Lidingö", country: "Sverige", category: "trail", distanceKm: 30, aliases: ["lidingö"], size: 6000, courses: [{ year: 2026, file: "lidingoloppet-30-2026.json" }] },
  { id: "midnattsloppet-stockholm", name: "Midnattsloppet", city: "Stockholm", country: "Sverige", category: "10k", distanceKm: 10, size: 25000, courses: [{ year: 2026, file: "midnattsloppet-stockholm-2026.json" }] },
  { id: "tjejmilen", name: "Tjejmilen", city: "Stockholm", country: "Sverige", category: "10k", distanceKm: 10, size: 25000, courses: [] },
  { id: "ultravasan-90", name: "Ultravasan 90", city: "Sälen–Mora", country: "Sverige", category: "ultra", distanceKm: 92, aliases: ["vasaloppet", "ultravasan"], size: 1500, courses: [{ year: 2026, file: "ultravasan-90-2026.json" }] },
  { id: "midnattsloppet-goteborg", name: "Midnattsloppet", city: "Göteborg", country: "Sverige", category: "10k", distanceKm: 10, aliases: ["midnattsloppet göteborg"], size: 8000, courses: [{ year: 2026, file: "midnattsloppet-goteborg-2026.json" }] },
  { id: "midnattsloppet-malmo", name: "Midnattsloppet", city: "Malmö", country: "Sverige", category: "10k", distanceKm: 10, aliases: ["midnattsloppet malmö"], size: 8000, courses: [{ year: 2026, file: "midnattsloppet-malmo-2026.json" }] },
  { id: "ultravasan-45", name: "Ultravasan 45", city: "Oxberg–Mora", country: "Sverige", category: "ultra", distanceKm: 45, aliases: ["vasaloppet", "ultravasan"], size: 2000, courses: [{ year: 2026, file: "ultravasan-45-2026.json" }] },
  { id: "trailvasan-30", name: "Trailvasan 30", city: "Oxberg–Mora", country: "Sverige", category: "trail", distanceKm: 30, aliases: ["vasaloppet", "trailvasan"], size: 2000, courses: [{ year: 2026, file: "trailvasan-30-2026.json" }] },
  { id: "helsingborg-marathon", name: "Helsingborg Marathon", city: "Helsingborg", country: "Sverige", category: "marathon", distanceKm: 42.195, aliases: ["hbgm", "maraton helsingborg"], size: 2000, courses: [{ year: 2026, file: "helsingborg-marathon-2026.json" }] },
  { id: "helsingborg-halvmarathon", name: "Helsingborg Half Marathon", city: "Helsingborg", country: "Sverige", category: "half", distanceKm: 21.0975, aliases: ["hbgm", "halvmaraton helsingborg"], size: 4000, courses: [{ year: 2026, file: "helsingborg-halvmarathon-2026.json" }] },
  { id: "premiarhalvan", name: "Premiärhalvan", city: "Stockholm", country: "Sverige", category: "half", distanceKm: 21.0975, aliases: ["adidas premiärhalvan", "djurgården"], size: 5000, courses: [{ year: 2026, file: "premiarhalvan-2026.json" }] },
  { id: "premiarmilen", name: "Premiärmilen", city: "Stockholm", country: "Sverige", category: "10k", distanceKm: 10, aliases: ["adidas premiärmilen", "norra djurgården"], size: 6000, courses: [{ year: 2025, file: "premiarmilen-2025.json" }] },
  { id: "uppsala-marathon", name: "Uppsala Marathon", city: "Uppsala", country: "Sverige", category: "marathon", distanceKm: 42.195, aliases: ["maraton uppsala"], size: 2000, courses: [{ year: 2026, file: "uppsala-marathon-2026.json" }] },
  { id: "uppsala-halvmarathon", name: "Uppsala Halvmarathon", city: "Uppsala", country: "Sverige", category: "half", distanceKm: 21.0975, aliases: ["halvmaraton uppsala", "uppsala marathon"], size: 3000, courses: [{ year: 2026, file: "uppsala-halvmarathon-2026.json" }] },
  { id: "fjallmaraton-45", name: "Fjällmaraton", city: "Årefjällen", country: "Sverige", category: "trail", distanceKm: 45, aliases: ["kia fjällmaraton", "fjällmaraton 45", "åre", "vålådalen"], size: 800, courses: [{ year: 2026, file: "fjallmaraton-45-2026.json" }] },
  { id: "fjallmaraton-27", name: "Fjällmaraton 27K", city: "Årefjällen", country: "Sverige", category: "trail", distanceKm: 27, aliases: ["salomon 27k", "fjällmaraton", "ottsjö", "åre"], size: 1000, courses: [{ year: 2026, file: "fjallmaraton-27-2026.json" }] },
  { id: "malmo-marathon", name: "Malmö Marathon", city: "Malmö", country: "Sverige", category: "marathon", distanceKm: 42.195, aliases: ["maraton malmö", "ribersborg"], size: 2000, courses: [{ year: 2026, file: "malmo-marathon-2026.json" }] },
  { id: "malmo-the-half", name: "Malmö Marathon The Half", city: "Malmö", country: "Sverige", category: "half", distanceKm: 21.0975, aliases: ["halvmaraton malmö", "the half"], size: 3000, courses: [{ year: 2026, file: "malmo-the-half-2026.json" }] },
  { id: "lidingoloppet-15", name: "Lidingöloppet 15", city: "Lidingö", country: "Sverige", category: "trail", distanceKm: 15, aliases: ["lidingöloppet", "tcs lidingöloppet 15 km"], size: 3000, courses: [{ year: 2026, file: "lidingoloppet-15-2026.json" }] },
  { id: "hasselbyloppet", name: "Hässelbyloppet", city: "Stockholm", country: "Sverige", category: "10k", distanceKm: 10, aliases: ["hässelby", "vällingby"], size: 3000, courses: [{ year: 2026, file: "hasselbyloppet-2026.json" }] },
  { id: "varvetmilen-goteborg", name: "Varvetmilen", city: "Göteborg", country: "Sverige", category: "10k", distanceKm: 10, aliases: ["varvetmilen göteborg", "göteborgsvarvet"], size: 10000, courses: [{ year: 2026, file: "varvetmilen-goteborg-2026.json" }] },
  { id: "varvetmilen-malmo", name: "Varvetmilen", city: "Malmö", country: "Sverige", category: "10k", distanceKm: 10, aliases: ["varvetmilen malmö"], size: 5000, courses: [{ year: 2026, file: "varvetmilen-malmo-2026.json" }] },
  { id: "varvetmilen-jonkoping", name: "Varvetmilen", city: "Jönköping", country: "Sverige", category: "10k", distanceKm: 10, aliases: ["varvetmilen jönköping"], size: 4000, courses: [{ year: 2026, file: "varvetmilen-jonkoping-2026.json" }] },
  { id: "berlin-marathon", name: "Berlin Marathon", city: "Berlin", country: "Tyskland", category: "marathon", distanceKm: 42.195, aliases: ["bmw berlin-marathon", "generali berlin-marathon", "berlin maraton"], size: 50000, courses: [{ year: 2026, file: "berlin-marathon-2026.json" }] },
  { id: "berlin-halvmarathon", name: "Berlin Half Marathon", city: "Berlin", country: "Tyskland", category: "half", distanceKm: 21.0975, aliases: ["generali berliner halbmarathon", "berlin halvmaraton"], size: 38000, courses: [{ year: 2026, file: "berlin-halvmarathon-2026.json" }] },
  { id: "copenhagen-marathon", name: "Copenhagen Marathon", city: "Köpenhamn", country: "Danmark", category: "marathon", distanceKm: 42.195, aliases: ["københavn marathon", "köpenhamn maraton", "cph marathon"], size: 15000, courses: [{ year: 2025, file: "copenhagen-marathon-2025.json" }] },
  { id: "copenhagen-half", name: "Copenhagen Half Marathon", city: "Köpenhamn", country: "Danmark", category: "half", distanceKm: 21.0975, aliases: ["cph half", "köpenhamn halvmaraton", "københavn halvmaraton"], size: 25000, courses: [{ year: 2026, file: "copenhagen-half-2026.json" }] },
  { id: "london-marathon", name: "London Marathon", city: "London", country: "Storbritannien", category: "marathon", distanceKm: 42.195, aliases: ["tcs london marathon", "london maraton"], size: 56000, courses: [{ year: 2026, file: "london-marathon-2026.json" }] },
  { id: "new-york-city-marathon", name: "New York City Marathon", city: "New York", country: "USA", category: "marathon", distanceKm: 42.195, aliases: ["tcs new york city marathon", "nyc marathon", "new york maraton"], size: 55000, courses: [{ year: 2026, file: "new-york-city-marathon-2026.json" }] },
  { id: "oslo-maraton", name: "Oslo Maraton", city: "Oslo", country: "Norge", category: "marathon", distanceKm: 42.195, aliases: ["dnb oslo maraton", "oslo marathon"], size: 4000, courses: [{ year: 2026, file: "oslo-maraton-2026.json" }] },
  { id: "helsinki-city-marathon", name: "Helsinki City Marathon", city: "Helsingfors", country: "Finland", category: "marathon", distanceKm: 42.195, aliases: ["helsingfors maraton", "helsinki marathon", "helsingin maraton"], size: 5000, courses: [{ year: 2026, file: "helsinki-city-marathon-2026.json" }] },
  { id: "oslo-halvmaraton", name: "Oslo Halvmaraton", city: "Oslo", country: "Norge", category: "half", distanceKm: 21.0975, aliases: ["oslo half marathon", "dnb oslo maraton"], size: 10000, courses: [{ year: 2026, file: "oslo-halvmaraton-2026.json" }] },
  { id: "valencia-marathon", name: "Valencia Marathon", city: "Valencia", country: "Spanien", category: "marathon", distanceKm: 42.195, aliases: ["maratón valencia", "valencia maraton"], size: 35000, courses: [{ year: 2025, file: "valencia-marathon-2025.json" }] },
  { id: "barcelona-marathon", name: "Barcelona Marathon", city: "Barcelona", country: "Spanien", category: "marathon", distanceKm: 42.195, aliases: ["zurich marató barcelona", "barcelona maraton"], size: 20000, courses: [{ year: 2026, file: "barcelona-marathon-2026.json" }] },
  { id: "sevilla-marathon", name: "Sevilla Marathon", city: "Sevilla", country: "Spanien", category: "marathon", distanceKm: 42.195, aliases: ["zurich maratón de sevilla", "seville marathon", "sevilla maraton"], size: 13000, courses: [{ year: 2026, file: "sevilla-marathon-2026.json" }] },
];

export const RACE_CATEGORY_LABELS: Record<RaceCategory | "all", { sv: string; en: string }> = {
  all: { sv: "Alla", en: "All" },
  marathon: { sv: "Maraton", en: "Marathon" },
  half: { sv: "Halvmaraton", en: "Half marathon" },
  "10k": { sv: "10 km", en: "10K" },
  "5k": { sv: "5 km", en: "5K" },
  trail: { sv: "Terräng", en: "Trail" },
  ultra: { sv: "Ultra", en: "Ultra" },
  other: { sv: "Övrigt", en: "Other" },
};

/** Lopp som har minst en ritad bana — bara de visas för kunden. */
/** Lopp med bana, största först (lika stora: i katalogordning). */
export function availableRaces(): RaceDef[] {
  return RACE_CATALOG.filter((r) => r.courses.length > 0)
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (b.r.size ?? 0) - (a.r.size ?? 0) || a.i - b.i)
    .map(({ r }) => r);
}

/** Senaste banan som gällde ett visst år (eller den nyaste). */
export function courseFor(race: RaceDef, year?: number | null): RaceCourse | null {
  const sorted = [...race.courses].sort((a, b) => b.year - a.year);
  if (!sorted.length) return null;
  if (!year) return sorted[0]!;
  return sorted.find((c) => c.year <= year) ?? sorted[sorted.length - 1]!;
}

/** Kategori utifrån distans (används för GPX och kundvagnsprodukt). */
export function categoryForDistance(km: number): RaceCategory {
  if (km >= 41.5 && km <= 43.5) return "marathon";
  if (km >= 20.6 && km <= 21.6) return "half";
  if (km >= 9.5 && km <= 10.6) return "10k";
  if (km >= 4.7 && km <= 5.3) return "5k";
  if (km > 43.5) return "ultra";
  return "other";
}

// ---------- produkter ----------
// Tre Shopify-produkter delar EN mall (lopartavla, produkten Löpartavla). Kundvagnen får alltid den
// produkt som matchar det valda loppets kategori — samma mönster som
// drinktavlorna.

export const RACE_MASTER_HANDLE = "lopartavla";

/** Produkter som läser sin layout från huvudmallen. */
export const RACE_TEMPLATE_ALIASES: Record<string, string> = {
  maratontavla: RACE_MASTER_HANDLE,
  halvmaratontavla: RACE_MASTER_HANDLE,
};

/** Förvalt filter i loppväljaren per produkt. */
export const RACE_DEFAULT_FILTER: Record<string, RaceCategory | "all"> = {
  maratontavla: "marathon",
  halvmaratontavla: "half",
  lopartavla: "all",
};

export function productHandleForCategory(category: RaceCategory): string {
  if (category === "marathon") return "maratontavla";
  if (category === "half") return "halvmaratontavla";
  return RACE_MASTER_HANDLE;
}

// ---------- banfiler ----------
// Två format stöds: kompakt banfil (.json, se tools/route-extract.mjs) med
// Google encoded polyline (1e5) + höjd i hela meter, och GeoJSON (.geojson).

function decodeValues(str: string): number[] {
  const out: number[] = [];
  let i = 0;
  while (i < str.length) {
    let shift = 0, result = 0, b: number;
    do {
      b = str.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20 && i < str.length);
    out.push(result & 1 ? ~(result >> 1) : result >> 1);
  }
  return out;
}

export function decodePolyline(str: string): LngLat[] {
  const d = decodeValues(str);
  const out: LngLat[] = [];
  let lat = 0, lng = 0;
  for (let i = 0; i + 1 < d.length; i += 2) {
    lat += d[i]!;
    lng += d[i + 1]!;
    out.push([lng / 1e5, lat / 1e5]);
  }
  return out;
}

export function decodeElevation(str: string): number[] {
  let v = 0;
  return decodeValues(str).map((dv) => (v += dv));
}

interface CompactCourse {
  v: 1;
  poly: string;
  ele?: string | null;
}

/** Tolka en kompakt banfil. */
export function routeFromCompact(json: CompactCourse, distanceKm: number): RaceRoute {
  const coords = decodePolyline(json.poly);
  if (coords.length < 2) throw new Error("Banfilen saknar en giltig linje.");
  const ele = json.ele ? decodeElevation(json.ele) : null;
  return {
    coords,
    ele: ele && ele.length === coords.length ? ele : null,
    distanceKm,
    bbox: boundsOf(coords),
  };
}

interface CourseFeature {
  type: "Feature";
  geometry: { type: "LineString"; coordinates: Array<[number, number] | [number, number, number]> };
}

/** Tolka en banfil (GeoJSON Feature/FeatureCollection med en LineString). */
export function routeFromGeoJson(json: unknown, distanceKm: number): RaceRoute {
  const feat: CourseFeature | undefined =
    (json as { type?: string })?.type === "FeatureCollection"
      ? (json as { features: CourseFeature[] }).features?.[0]
      : (json as CourseFeature);
  const raw = feat?.geometry?.type === "LineString" ? feat.geometry.coordinates : null;
  if (!raw || raw.length < 2) throw new Error("Banfilen saknar en giltig linje.");
  const coords: LngLat[] = raw.map((c) => [c[0], c[1]]);
  const hasEle = raw.every((c) => c.length >= 3 && Number.isFinite(c[2]));
  return {
    coords,
    ele: hasEle ? raw.map((c) => c[2] as number) : null,
    distanceKm,
    bbox: boundsOf(coords),
  };
}

export async function loadCourse(race: RaceDef, year?: number | null): Promise<RaceRoute> {
  const course = courseFor(race, year);
  if (!course) throw new Error(`Ingen bana ritad för ${race.name} ännu.`);
  const res = await fetch(`/races/${course.file}`);
  if (!res.ok) throw new Error(`Kunde inte hämta banan för ${race.name}.`);
  const json = await res.json();
  return json && typeof json.poly === "string"
    ? routeFromCompact(json as CompactCourse, race.distanceKm)
    : routeFromGeoJson(json, race.distanceKm);
}
