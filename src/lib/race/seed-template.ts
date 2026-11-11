// Färdig startmall för lopptavlan ("Skapa mall" → Startmall: Lopptavla).
//
// Stående: en flödesgrupp uppifrån och ned — titel, ort · år, foto (av),
// karta med rutt (växer), höjdprofil, statistikrad, namn, datum, egen rad
// (av). Liggande: kartan till vänster, samma element i en kolumn till höger.
// Samma lager-id i båda orienteringarna, så kundens av/på-val följer med.
import { applyFlowLayout } from "@/lib/flow-layout";
import { defaultLocks, type FlowGroup, type OrientationLayout, type Template, type TemplateLayer } from "@/lib/template-schema";

export const RACE_LAYER_IDS = {
  title: "race-title",
  subtitle: "race-subtitle",
  photo: "race-photo",
  map: "race-map",
  elevation: "race-elevation",
  stats: "race-stats",
  name: "race-name",
  date: "race-date",
  custom: "race-custom",
} as const;

const INK = "#111111";
const MUTED = "#5C5C5C";
const BG = "#F7F5F0";

/** Låst för kunden; bara av/på via loppanelen. */
const toggleOnly = () => defaultLocks({ content: true, visibility: false });

type Rect = { xPct: number; yPct: number; wPct: number; hPct: number };

function raceText(
  id: string,
  name: string,
  rect: Rect,
  z: number,
  opts: {
    raceField: "title" | "subtitle" | "runnerName" | "date" | "customLine";
    placeholder: string;
    font: string;
    sizePt: number;
    color?: string;
    spacing?: number;
    align?: "left" | "center" | "right";
    toggle?: boolean;
    hidden?: boolean;
  },
): TemplateLayer {
  return {
    id,
    name,
    type: "text",
    ...rect,
    rotation: 0,
    zIndex: z,
    locks: opts.toggle === false ? defaultLocks({ content: true }) : toggleOnly(),
    ...(opts.hidden ? { hiddenByDefault: true } : {}),
    defaults: {
      text: opts.placeholder,
      font: opts.font,
      fontSizePt: opts.sizePt,
      align: opts.align ?? "center",
      color: opts.color ?? INK,
      letterSpacingEm: opts.spacing ?? 0,
      raceField: opts.raceField,
      raceFieldUppercase: true,
    },
  };
}

function layers(o: "portrait" | "landscape"): TemplateLayer[] {
  const P = o === "portrait";
  // Rect här är bara startvärden — flödesgrupperna räknar om y/h.
  // 8 % säkerhetsmarginal runt om (canvas-kravet) — samma för alla material.
  const col: Rect = P ? { xPct: 8, yPct: 0, wPct: 84, hPct: 0 } : { xPct: 63, yPct: 0, wPct: 29, hPct: 0 };
  const align = P ? "center" : "left";
  return [
    // Liggande: smalare kolumn — plats för två rader vid långa loppnamn.
    raceText(RACE_LAYER_IDS.title, "Titel", { ...col, hPct: P ? 8 : 13 }, 10, {
      raceField: "title", placeholder: "Ditt lopp", font: "Bebas Neue", sizePt: P ? 40 : 30, spacing: 0.03, align, toggle: false,
    }),
    raceText(RACE_LAYER_IDS.subtitle, "Ort och år", { ...col, hPct: P ? 3 : 4 }, 11, {
      raceField: "subtitle", placeholder: "Stad · År", font: "Montserrat", sizePt: 10, color: MUTED, spacing: 0.25, align,
    }),
    {
      id: RACE_LAYER_IDS.photo,
      name: "Foto",
      type: "photo",
      ...col,
      hPct: 18,
      rotation: 0,
      zIndex: 5,
      hiddenByDefault: true,
      locks: defaultLocks({ content: false, visibility: false }),
      defaults: { shape: "rect", fit: "cover" },
    },
    {
      id: RACE_LAYER_IDS.map,
      name: "Karta med rutt",
      type: "map",
      ...(P ? { xPct: 8, yPct: 20, wPct: 84, hPct: 50 } : { xPct: 8, yPct: 8, wPct: 51, hPct: 84 }),
      rotation: 0,
      zIndex: 1,
      // Kunden får panorera/zooma och byta kartstil; formen är låst.
      locks: defaultLocks({ position: false, style: false }),
      defaults: {
        shape: "rect",
        styleId: "skandinavisk",
        center: [18.0686, 59.3293],
        zoom: 11,
        showLabels: false,
        routeStyle: { color: "#FC4C02", thicknessMm: 1.6, casing: false, casingColor: "#FFFFFF" },
      },
    },
    {
      id: RACE_LAYER_IDS.elevation,
      name: "Höjdprofil",
      type: "elevation",
      ...col,
      hPct: P ? 7 : 9,
      rotation: 0,
      zIndex: 6,
      locks: toggleOnly(),
      defaults: { fillOpacity: 0.18, thicknessMm: 0.6 },
    },
    {
      id: RACE_LAYER_IDS.stats,
      name: "Loppstatistik",
      type: "raceStats",
      ...col,
      hPct: P ? 6 : 18,
      rotation: 0,
      zIndex: 7,
      locks: toggleOnly(),
      defaults: {
        items: ["distance", "time", "pace", "bib", "placement"],
        valueFont: "Montserrat",
        labelFont: "Montserrat",
        valueSizePt: P ? 15 : 13,
        labelSizePt: 6,
        color: INK,
        labelColor: MUTED,
        letterSpacingEm: 0.14,
        dividers: true,
        arrange: P ? "row" : "column",
      },
    },
    raceText(RACE_LAYER_IDS.name, "Namn", { ...col, hPct: P ? 4 : 5 }, 12, {
      raceField: "runnerName", placeholder: "Ditt namn", font: "Montserrat", sizePt: P ? 16 : 14, spacing: 0.12, align,
    }),
    raceText(RACE_LAYER_IDS.date, "Datum", { ...col, hPct: P ? 2.6 : 3.5 }, 13, {
      raceField: "date", placeholder: "Datum", font: "Montserrat", sizePt: 9, color: MUTED, spacing: 0.2, align,
    }),
    raceText(RACE_LAYER_IDS.custom, "Egen rad", { ...col, hPct: P ? 2.6 : 3.5 }, 14, {
      raceField: "customLine", placeholder: "Mitt första maraton", font: "Montserrat", sizePt: 9, color: MUTED, spacing: 0.2, align, hidden: true,
    }),
  ];
}

const ids = RACE_LAYER_IDS;

function flow(o: "portrait" | "landscape"): FlowGroup[] {
  if (o === "portrait") {
    return [
      {
        id: "race-main",
        xPct: 8, yPct: 8, wPct: 84, hPct: 84,
        gapPct: 1.4,
        align: "start",
        items: [
          { layerId: ids.title },
          { layerId: ids.subtitle },
          { layerId: ids.photo },
          { layerId: ids.map, grow: true },
          { layerId: ids.elevation },
          { layerId: ids.stats },
          { layerId: ids.name },
          { layerId: ids.date },
          { layerId: ids.custom },
        ],
      },
    ];
  }
  return [
    {
      id: "race-side",
      xPct: 63, yPct: 8, wPct: 29, hPct: 84,
      gapPct: 1.8,
      align: "center",
      items: [
        { layerId: ids.title },
        { layerId: ids.subtitle },
        { layerId: ids.photo },
        { layerId: ids.elevation },
        { layerId: ids.stats },
        { layerId: ids.name },
        { layerId: ids.date },
        { layerId: ids.custom },
      ],
    },
  ];
}

function layout(o: "portrait" | "landscape"): OrientationLayout {
  const f = flow(o);
  return {
    aspect: o === "portrait" ? "3:4" : "4:3",
    background: { color: BG },
    // Spara lagren där flödet placerar dem (alla påslagna), så att varje lager
    // har en rimlig ruta även där flödet inte räknas om.
    layers: applyFlowLayout(layers(o), f),
    flow: f,
  };
}

/** Lägg lopptavlans layout och inställningar på en mall med valda produkttyper. */
export function applyRaceSeed(base: Template): Template {
  return {
    ...base,
    productOptions: {
      ...base.productOptions,
      raceOptions: {
        enabled: true,
        allowGpx: true,
        routeColors: ["#FC4C02", "#111111", "#1F5EFF", "#E0245E"],
      },
      mapStyles: ["skandinavisk", "midnatt", "noir", "blatryck", "outdoors-v12"].map((id) => ({ id, enabled: true })),
      allowedFonts: undefined,
    },
    orientations: ["portrait", "landscape"],
    defaultOrientation: "portrait",
    defaultLayout: { portrait: layout("portrait"), landscape: layout("landscape") },
    contentVariants: [],
  };
}
