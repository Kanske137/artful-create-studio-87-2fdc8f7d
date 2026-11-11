// Gemensamma typer för lopptavlan.

export type LngLat = [number, number];
export type Bounds = [LngLat, LngLat]; // [[väst, syd], [öst, nord]]

/** En bana redo att ritas: förenklad geometri + höjd per punkt. */
export interface RaceRoute {
  /** Förenklad linje, [lng, lat]. */
  coords: LngLat[];
  /** Höjd (m) per punkt i `coords`, eller null om höjddata saknas. */
  ele: number[] | null;
  /** Banans verkliga längd (officiell, eller uppmätt från full GPX). */
  distanceKm: number;
  bbox: Bounds;
}

export type RaceCategory = "marathon" | "half" | "10k" | "5k" | "trail" | "ultra" | "other";

export type RaceSource = "catalog" | "gpx";

/** Kundens fält i loppanelen. Tom sträng = inte ifyllt. */
export interface RaceFields {
  title: string;
  city: string;
  runnerName: string;
  /** "YYYY-MM-DD" */
  dateISO: string;
  /** Sluttid som kunden skrev den, t.ex. "3:45:12". */
  finishTime: string;
  bib: string;
  placement: string;
  customLine: string;
}

/** Vad som visas på tavlan utöver hela lager (som styrs via hiddenLayerIds). */
export interface RaceShow {
  distance: boolean;
  time: boolean;
  pace: boolean;
  bib: boolean;
  placement: boolean;
  startFinish: boolean;
  kmMarkers: boolean;
}

export const DEFAULT_RACE_SHOW: RaceShow = {
  distance: true,
  time: true,
  pace: true,
  bib: false,
  placement: false,
  startFinish: true,
  kmMarkers: false,
};

export const EMPTY_RACE_FIELDS: RaceFields = {
  title: "",
  city: "",
  runnerName: "",
  dateISO: "",
  finishTime: "",
  bib: "",
  placement: "",
  customLine: "",
};

/** Allt renderingen (editor, mockup, tryck) behöver om loppet. */
export interface RaceRenderInput {
  route: RaceRoute | null;
  fields: RaceFields;
  show: RaceShow;
  /** Kundens ruttfärg, eller null ⇒ mallens standard. */
  routeColor: string | null;
  locale: "sv" | "en";
}
