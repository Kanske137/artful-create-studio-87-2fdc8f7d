// Lopptavlans kundtillstånd: valt lopp eller uppladdad GPX, kundens fält
// och vad som visas. Hålls separat från editorStore — loppet är inte knutet
// till ett enskilt lager och ska överleva byte av stil/orientering/material.
//
// Hela lager (foto, höjdprofil, statistikrad, namn …) slås av/på via
// editorStore.setLayerVisible så att flödeslayouten flyttar om tavlan.
import { create } from "zustand";
import { track } from "@/lib/analytics";
import type { RaceDef } from "@/lib/race/catalog";
import type { GpxRouteResult } from "@/lib/race/gpx";
import { formatDuration } from "@/lib/race/format";
import {
  DEFAULT_RACE_SHOW,
  EMPTY_RACE_FIELDS,
  type RaceFields,
  type RaceRenderInput,
  type RaceRoute,
  type RaceShow,
  type RaceSource,
  type RaceSplit,
} from "@/lib/race/types";

interface RaceStoreState {
  source: RaceSource | null;
  raceId: string | null;
  courseYear: number | null;
  route: RaceRoute | null;
  /** Kilometertider (bara från GPX med tidsstämplar). */
  splits: RaceSplit[] | null;
  fields: RaceFields;
  show: RaceShow;
  /** Kundens ruttfärg; null ⇒ mallens standard. */
  routeColor: string | null;
  /** Ökar varje gång kartan ska anpassas till en ny bana. */
  fitNonce: number;
  loading: boolean;
  error: string | null;

  setFromCatalog: (race: RaceDef, route: RaceRoute, year: number | null) => void;
  setFromGpx: (result: GpxRouteResult, fileName: string) => void;
  setField: <K extends keyof RaceFields>(key: K, value: RaceFields[K]) => void;
  setShow: <K extends keyof RaceShow>(key: K, value: boolean) => void;
  setRouteColor: (color: string | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

const initial = {
  source: null,
  raceId: null,
  courseYear: null,
  route: null,
  splits: null,
  fields: EMPTY_RACE_FIELDS,
  show: DEFAULT_RACE_SHOW,
  routeColor: null,
  fitNonce: 0,
  loading: false,
  error: null,
} satisfies Partial<RaceStoreState>;

export const useRaceStore = create<RaceStoreState>((set, get) => ({
  ...initial,

  setFromCatalog: (race, route, year) => {
    const prev = get();
    // Kundens egna uppgifter (namn, tid, startnr …) behålls vid loppbyte;
    // loppets egna (titel, ort) ersätts.
    set({
      source: "catalog",
      raceId: race.id,
      courseYear: year,
      route,
      splits: null,
      // Egen distans gäller GPX-mätningar — nollställ vid katalogval.
      fields: { ...prev.fields, title: race.name, city: race.city, distanceKm: "" },
      fitNonce: prev.fitNonce + 1,
      loading: false,
      error: null,
    });
    track("race_selected", { raceId: race.id });
  },

  setFromGpx: (result, fileName) => {
    const prev = get();
    const f = prev.fields;
    set({
      source: "gpx",
      raceId: null,
      courseYear: null,
      route: result.route,
      splits: result.splits,
      fields: {
        ...f,
        // Byt bara ut titel/ort om de kom från ett katalogval — kundens egna
        // inskrivna värden ska inte skrivas över av en ny fil.
        title: prev.source === "gpx" && f.title ? f.title : "",
        city: prev.source === "gpx" ? f.city : "",
        dateISO: result.dateISO ?? f.dateISO,
        finishTime: result.elapsedSec ? formatDuration(result.elapsedSec) : f.finishTime,
      },
      fitNonce: prev.fitNonce + 1,
      loading: false,
      error: null,
    });
    track("race_gpx_uploaded", { points: result.route.coords.length, fileName });
  },

  setField: (key, value) => set((s) => ({ fields: { ...s.fields, [key]: value } })),
  setShow: (key, value) => set((s) => ({ show: { ...s.show, [key]: value } })),
  setRouteColor: (routeColor) => set({ routeColor }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error, loading: false }),
  reset: () => set({ ...initial }),
}));

/** Ögonblicksbild för rendering (editor, mockup, kundvagn, tryck). */
export function raceRenderInput(locale: "sv" | "en"): RaceRenderInput {
  const s = useRaceStore.getState();
  return { route: s.route, fields: s.fields, show: s.show, routeColor: s.routeColor, locale, splits: s.splits };
}

/** Loppetiketternas språk utifrån editorns språk. */
export function raceLocaleFor(lang: string | undefined): "sv" | "en" {
  return (lang ?? "sv").toLowerCase().startsWith("sv") ? "sv" : "en";
}
