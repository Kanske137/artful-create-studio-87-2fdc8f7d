// Härledda värden: det som faktiskt skrivs på tavlan, givet kundens fält.
// Delas av editorStore (texter), statistikraden och tryckfilen.
import type { RaceStatKey, TextDefaults } from "@/lib/template-schema";
import {
  RACE_STAT_LABELS,
  formatDistance,
  formatDuration,
  formatPace,
  formatRaceDate,
  parseDuration,
  yearOf,
  type RaceLocale,
} from "./format";
import type { RaceRenderInput } from "./types";

export type RaceTextField = NonNullable<TextDefaults["raceField"]>;

/** Texten för ett text-lager med `raceField`. Tom sträng ⇒ visa mallens placeholder. */
export function raceFieldText(field: RaceTextField, race: RaceRenderInput): string {
  const f = race.fields;
  switch (field) {
    case "title":
      return f.title.trim();
    case "subtitle": {
      // "Stockholm · 30 maj 2026" — ort och hela datumet (eller bara året
      // om datumet inte går att tolka).
      const date = formatRaceDate(f.dateISO, race.locale) || yearOf(f.dateISO);
      return [f.city.trim(), date].filter(Boolean).join(" · ");
    }
    case "finishTime": {
      const sec = parseDuration(f.finishTime);
      return sec ? formatDuration(sec) : "";
    }
    case "runnerName":
      return f.runnerName.trim();
    case "date":
      return formatRaceDate(f.dateISO, race.locale);
    case "customLine":
      return f.customLine.trim();
  }
}

export interface RaceStatItem {
  key: RaceStatKey;
  label: string;
  value: string;
}

/**
 * Statistikradens synliga värden i mallens ordning. Ett värde visas bara om
 * kunden har det påslaget OCH det finns något att visa (t.ex. tempo kräver
 * både tid och distans).
 */
export function raceStatItems(order: RaceStatKey[], race: RaceRenderInput): RaceStatItem[] {
  const labels = RACE_STAT_LABELS[race.locale as RaceLocale] ?? RACE_STAT_LABELS.sv;
  const seconds = parseDuration(race.fields.finishTime);
  const distance = race.route?.distanceKm ?? null;
  const out: RaceStatItem[] = [];
  for (const key of order) {
    if (!race.show[key]) continue;
    let value: string | null = null;
    if (key === "distance") value = distance ? formatDistance(distance, race.locale) : null;
    else if (key === "time") value = seconds ? formatDuration(seconds) : null;
    else if (key === "pace") value = formatPace(seconds, distance);
    else if (key === "bib") value = race.fields.bib.trim() || null;
    else if (key === "placement") value = race.fields.placement.trim() || null;
    if (value) out.push({ key, label: labels[key], value });
  }
  return out;
}
