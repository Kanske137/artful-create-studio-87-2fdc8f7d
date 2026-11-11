// Färdig startmall för lopptavlan ("Skapa mall" → Startmall: Lopptavla).
//
// Formspråk (efter Akrams referens): kartan täcker hela tavlan och texten
// ligger ovanpå. Stor, fet, vänsterställd rubrik uppe till vänster med
// sluttiden till höger, diskret statistik under rubriken och löparens namn
// nere till höger. Valfritt: foto nere till vänster, höjdprofil under
// statistiken, egen rad under namnet.
//
// Åtta bakgrunder (Midnatt är standard), var och en en egen stil med låst
// kartstil så att texten alltid har rätt kontrast. Text-/statistik-
// lagren delar id mellan stilarna (kundens av/på-val följer med), kartan har
// eget id per stil (så att stilbyte även byter karta).
import { applyFlowLayout } from "@/lib/flow-layout";
import {
  defaultLocks,
  type FlowGroup,
  type OrientationLayout,
  type Template,
  type TemplateLayer,
} from "@/lib/template-schema";

export const RACE_LAYER_IDS = {
  title: "race-title",
  time: "race-time",
  stats: "race-stats",
  elevation: "race-elevation",
  photo: "race-photo",
  name: "race-name",
  subtitle: "race-subtitle",
  custom: "race-custom",
} as const;

export const raceMapLayerId = (styleKey: string) => `race-map-${styleKey}`;

interface Palette {
  key: string;
  name: string;
  styleId: string;
  bg: string;
  ink: string;
  muted: string;
}

// Bakgrunder kunden väljer mellan (loppanelen → Utseende → Bakgrund). Varje
// bakgrund är en egen stil: Arthenas kartstil + textfärger med rätt kontrast.
export const RACE_PALETTES: Palette[] = [
  { key: "midnatt", name: "Midnatt", styleId: "midnatt", bg: "#16213E", ink: "#FFFFFF", muted: "#9AA6C0" },
  { key: "noir", name: "Noir", styleId: "noir", bg: "#0E0E0E", ink: "#FFFFFF", muted: "#9C9C9C" },
  { key: "blatryck", name: "Blåtryck", styleId: "blatryck", bg: "#16395E", ink: "#FFFFFF", muted: "#A9BCD6" },
  { key: "skog", name: "Skog", styleId: "navigation-night-v1", bg: "#0A1F0A", ink: "#FFFFFF", muted: "#9DB5A0" },
  { key: "guld", name: "Guld", styleId: "guldlinje", bg: "#141210", ink: "#F5EBD7", muted: "#B9A98A" },
  { key: "ljus", name: "Ljus", styleId: "skandinavisk", bg: "#F4F2EC", ink: "#141414", muted: "#6B6B6B" },
  { key: "sand", name: "Sand", styleId: "streets-v12", bg: "#F3ECDD", ink: "#2A2118", muted: "#7A6B57" },
  { key: "salvia", name: "Salvia", styleId: "outdoors-v12", bg: "#DCEBD9", ink: "#1D2B1F", muted: "#5E7262" },
];

const FONT = "Inter";
/** Fet stil sätts via spans (mallsystemets konvention). Täcker hela texten. */
const BOLD = [{ start: 0, end: 200, bold: true }];

/** Kunden når bara av/på (via loppanelen). */
const toggleOnly = () => defaultLocks({ content: true, visibility: false });

type Rect = { xPct: number; yPct: number; wPct: number; hPct: number };
type RaceField = "title" | "subtitle" | "runnerName" | "date" | "customLine" | "finishTime";

function raceText(
  id: string,
  name: string,
  rect: Rect,
  z: number,
  o: {
    field: RaceField;
    placeholder: string;
    sizePt: number;
    color: string;
    align: "left" | "right";
    valign?: "top" | "middle" | "bottom";
    bold?: boolean;
    spacing?: number;
    lineHeight?: number;
    upper?: boolean;
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
    locks: o.toggle === false ? defaultLocks({ content: true }) : toggleOnly(),
    ...(o.hidden ? { hiddenByDefault: true } : {}),
    defaults: {
      text: o.placeholder,
      font: FONT,
      fontSizePt: o.sizePt,
      align: o.align,
      valign: o.valign ?? "middle",
      color: o.color,
      letterSpacingEm: o.spacing ?? 0,
      ...(o.lineHeight ? { lineHeight: o.lineHeight } : {}),
      ...(o.bold ? { spans: BOLD } : {}),
      raceField: o.field,
      raceFieldUppercase: !!o.upper,
    },
  };
}

interface Geometry {
  title: Rect;
  titlePt: number;
  time: Rect;
  stats: Rect;
  elevation: Rect;
  photo: Rect;
  topFlow: Rect;
  bottomFlow: Rect;
  name: Rect;
  subtitle: Rect;
  custom: Rect;
  fitPaddingPct: { top: number; right: number; bottom: number; left: number };
}

// Allt inom 8 % säkerhetsmarginal (canvas-kravet) utom själva kartan, som
// går kant i kant (och vidare ut i canvasens kant/bleed).
const GEOMETRY: Record<"portrait" | "landscape", Geometry> = {
  portrait: {
    title: { xPct: 8, yPct: 0, wPct: 64, hPct: 11 },
    titlePt: 40,
    time: { xPct: 72, yPct: 8.4, wPct: 20, hPct: 4 },
    stats: { xPct: 8, yPct: 0, wPct: 64, hPct: 4.2 },
    elevation: { xPct: 8, yPct: 0, wPct: 40, hPct: 4.5 },
    photo: { xPct: 8, yPct: 70, wPct: 26, hPct: 22 },
    topFlow: { xPct: 8, yPct: 8, wPct: 64, hPct: 30 },
    bottomFlow: { xPct: 38, yPct: 76, wPct: 54, hPct: 16 },
    name: { xPct: 38, yPct: 0, wPct: 54, hPct: 4.6 },
    subtitle: { xPct: 38, yPct: 0, wPct: 54, hPct: 2.4 },
    custom: { xPct: 38, yPct: 0, wPct: 54, hPct: 2.4 },
    fitPaddingPct: { top: 8, right: 9, bottom: 8, left: 9 },
  },
  landscape: {
    title: { xPct: 8, yPct: 0, wPct: 52, hPct: 14 },
    titlePt: 38,
    time: { xPct: 72, yPct: 9.2, wPct: 20, hPct: 6 },
    stats: { xPct: 8, yPct: 0, wPct: 52, hPct: 6 },
    elevation: { xPct: 8, yPct: 0, wPct: 30, hPct: 6 },
    photo: { xPct: 8, yPct: 64, wPct: 20, hPct: 28 },
    topFlow: { xPct: 8, yPct: 9, wPct: 52, hPct: 36 },
    bottomFlow: { xPct: 44, yPct: 70, wPct: 48, hPct: 22 },
    name: { xPct: 44, yPct: 0, wPct: 48, hPct: 6.4 },
    subtitle: { xPct: 44, yPct: 0, wPct: 48, hPct: 3.2 },
    custom: { xPct: 44, yPct: 0, wPct: 48, hPct: 3.2 },
    fitPaddingPct: { top: 8, right: 8, bottom: 8, left: 8 },
  },
};

const ids = RACE_LAYER_IDS;

function layers(o: "portrait" | "landscape", p: Palette): TemplateLayer[] {
  const g = GEOMETRY[o];
  const P = o === "portrait";
  return [
    {
      id: raceMapLayerId(p.key),
      name: "Karta med rutt",
      type: "map",
      xPct: 0,
      yPct: 0,
      wPct: 100,
      hPct: 100,
      rotation: 0,
      zIndex: 1,
      // Kunden får panorera/zooma; kartstilen följer vald stil.
      locks: defaultLocks({ position: false }),
      defaults: {
        shape: "rect",
        styleId: p.styleId,
        center: [18.0686, 59.3293],
        zoom: 11,
        showLabels: false,
        routeStyle: {
          color: "#FC4C02",
          thicknessMm: 1.2,
          casing: false,
          casingColor: "#FFFFFF",
          fitPaddingPct: g.fitPaddingPct,
        },
      },
    },
    {
      id: ids.photo,
      name: "Foto",
      type: "photo",
      ...g.photo,
      rotation: 0,
      zIndex: 5,
      hiddenByDefault: true,
      locks: defaultLocks({ content: false, visibility: false }),
      defaults: { shape: "rect", fit: "cover" },
    },
    raceText(ids.title, "Titel", g.title, 10, {
      field: "title", placeholder: "Ditt lopp", sizePt: g.titlePt, color: p.ink, align: "left",
      valign: "top", bold: true, spacing: -0.02, lineHeight: 1.0, toggle: false,
    }),
    raceText(ids.time, "Sluttid", g.time, 11, {
      field: "finishTime", placeholder: "", sizePt: P ? 14 : 15, color: p.ink, align: "right", valign: "top",
    }),
    {
      id: ids.stats,
      name: "Loppstatistik",
      type: "raceStats",
      ...g.stats,
      rotation: 0,
      zIndex: 12,
      locks: toggleOnly(),
      defaults: {
        // Sluttiden har eget, större textlager — här bara de diskreta värdena.
        items: ["distance", "pace", "bib", "placement"],
        valueFont: FONT,
        labelFont: FONT,
        valueSizePt: 10,
        labelSizePt: 5.5,
        color: p.ink,
        labelColor: p.muted,
        letterSpacingEm: 0.16,
        dividers: false,
        arrange: "row",
        align: "start",
      },
    },
    {
      id: ids.elevation,
      name: "Höjdprofil",
      type: "elevation",
      ...g.elevation,
      rotation: 0,
      zIndex: 13,
      hiddenByDefault: true,
      locks: toggleOnly(),
      // Staplar — eget formspråk (inte en fylld kurva).
      defaults: { style: "bars", fillOpacity: 0.22, thicknessMm: 0.5 },
    },
    raceText(ids.name, "Namn", g.name, 14, {
      field: "runnerName", placeholder: "Ditt namn", sizePt: P ? 20 : 22, color: p.ink, align: "right",
      valign: "bottom", bold: true, spacing: -0.01,
    }),
    raceText(ids.subtitle, "Ort och datum", g.subtitle, 15, {
      field: "subtitle", placeholder: "Stad · Datum", sizePt: 7.5, color: p.muted, align: "right",
      spacing: 0.18, upper: true,
    }),
    raceText(ids.custom, "Egen rad", g.custom, 16, {
      field: "customLine", placeholder: "Mitt första maraton", sizePt: 7.5, color: p.muted, align: "right",
      spacing: 0.18, upper: true, hidden: true,
    }),
  ];
}

function flow(o: "portrait" | "landscape"): FlowGroup[] {
  const g = GEOMETRY[o];
  return [
    {
      id: "race-top",
      ...g.topFlow,
      gapPct: o === "portrait" ? 1.4 : 2,
      align: "start",
      items: [{ layerId: ids.title }, { layerId: ids.stats }, { layerId: ids.elevation }],
    },
    {
      id: "race-bottom",
      ...g.bottomFlow,
      gapPct: o === "portrait" ? 0.7 : 1,
      align: "end",
      items: [{ layerId: ids.name }, { layerId: ids.subtitle }, { layerId: ids.custom }],
    },
  ];
}

function layout(o: "portrait" | "landscape", p: Palette): OrientationLayout {
  const f = flow(o);
  return {
    aspect: o === "portrait" ? "3:4" : "4:3",
    background: { color: p.bg },
    // Spara lagren där flödet placerar dem (alla påslagna), så att varje
    // lager har en rimlig ruta även där flödet inte räknas om (admin).
    layers: applyFlowLayout(layers(o, p), f),
    flow: f,
  };
}

const block = (p: Palette) => ({ portrait: layout("portrait", p), landscape: layout("landscape", p) });

/** Lägg lopptavlans layouter och inställningar på en mall med valda produkttyper. */
export function applyRaceSeed(base: Template): Template {
  const [standard, ...extra] = RACE_PALETTES;
  return {
    ...base,
    productOptions: {
      ...base.productOptions,
      raceOptions: {
        enabled: true,
        allowGpx: true,
        routeColors: ["#FC4C02", "#FFC233", "#3DDC97", "#4DA3FF", "#FF4D8D", "#FFFFFF", "#111111"],
      },
      mapStyles: RACE_PALETTES.map((p) => ({ id: p.styleId, enabled: true })),
      allowedFonts: undefined,
    },
    orientations: ["portrait", "landscape"],
    defaultOrientation: "portrait",
    defaultLayoutName: standard!.name,
    defaultLayout: block(standard!),
    extraLayouts: extra.map((p) => ({
      id: `race-${p.key}`,
      name: p.name,
      defaultLayout: block(p),
    })),
    contentVariants: [],
  };
}
