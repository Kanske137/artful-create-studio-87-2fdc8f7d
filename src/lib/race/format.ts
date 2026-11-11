// Formatering av loppdata: tid, tempo, distans, datum, etiketter.
import type { RaceStatKey } from "@/lib/template-schema";

export type RaceLocale = "sv" | "en";

/** "3:45:12", "45:12", "3.45.12", "03:45" (mm:ss) → sekunder. Null om ogiltigt. */
export function parseDuration(input: string): number | null {
  const s = input.trim();
  if (!s) return null;
  const parts = s.split(/[:.]/).map((p) => p.trim());
  if (parts.some((p) => !/^\d{1,3}$/.test(p))) return null;
  const nums = parts.map((p) => parseInt(p, 10));
  let h = 0, m = 0, sec = 0;
  if (nums.length === 3) [h, m, sec] = nums as [number, number, number];
  else if (nums.length === 2) [m, sec] = nums as [number, number];
  else return null;
  if (m > 59 && nums.length === 3) return null;
  if (sec > 59) return null;
  const total = h * 3600 + m * 60 + sec;
  return total > 0 ? total : null;
}

/** Sekunder → "3:45:12" (eller "45:12" under en timme). */
export function formatDuration(totalSec: number): string {
  const t = Math.max(0, Math.round(totalSec));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** Tempo min/km, t.ex. "5:20 /km". Null om tid eller distans saknas. */
export function formatPace(totalSec: number | null, distanceKm: number | null): string | null {
  if (!totalSec || !distanceKm || distanceKm <= 0) return null;
  const perKm = Math.round(totalSec / distanceKm);
  const m = Math.floor(perKm / 60);
  const s = perKm % 60;
  return `${m}:${String(s).padStart(2, "0")} /km`;
}

const MARATHON = 42.195;
const HALF = 21.0975;

/** "42,195 km", "21,1 km", "10 km", "30,2 km". */
export function formatDistance(km: number, locale: RaceLocale = "sv"): string {
  const dec = locale === "sv" ? "," : ".";
  if (Math.abs(km - MARATHON) < 0.0005) return `42${dec}195 km`;
  if (Math.abs(km - HALF) < 0.0005) return `21${dec}1 km`;
  const rounded = Math.round(km * 10) / 10;
  const str = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1).replace(".", dec);
  return `${str} km`;
}

const MONTHS: Record<RaceLocale, string[]> = {
  sv: ["januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september", "oktober", "november", "december"],
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
};

/** "2026-05-30" → "30 maj 2026" / "30 May 2026". Ogiltigt ⇒ "". */
export function formatRaceDate(dateISO: string, locale: RaceLocale = "sv"): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateISO.trim());
  if (!m) return "";
  const month = MONTHS[locale][parseInt(m[2]!, 10) - 1];
  if (!month) return "";
  return `${parseInt(m[3]!, 10)} ${month} ${m[1]}`;
}

export function yearOf(dateISO: string): string {
  const m = /^(\d{4})-/.exec(dateISO.trim());
  return m ? m[1]! : "";
}

export const RACE_STAT_LABELS: Record<RaceLocale, Record<RaceStatKey, string>> = {
  sv: { distance: "DISTANS", time: "TID", pace: "TEMPO", bib: "STARTNR", placement: "PLACERING" },
  en: { distance: "DISTANCE", time: "TIME", pace: "PACE", bib: "BIB", placement: "PLACE" },
};

/** "42,195", "42.2", "21,1 km" → km. Null om ogiltigt. */
export function parseDistanceKm(input: string): number | null {
  const m = /^\s*(\d{1,3}(?:[.,]\d{1,3})?)\s*(km)?\s*$/i.exec(input);
  if (!m) return null;
  const v = parseFloat(m[1]!.replace(",", "."));
  return v > 0 ? v : null;
}

/** Sekunder per km → "5:20". */
export function formatPaceShort(secPerKm: number): string {
  const s = Math.round(secPerKm);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
