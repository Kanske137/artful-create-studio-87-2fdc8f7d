// Rutten som lager i en Mapbox-karta — används av både editorns
// MapLayerInstance och tryckfilens offscreen-karta, så projektion, utsnitt och
// linje blir identiska i editor och tryck. Kartan själv är tom (routeMapStyleId):
// på tavlan syns bara rutten mot mallens bakgrundsfärg.
//
// Mapbox rensar egna lager vid stilbyte (setStyle) — anropa
// applyRouteToMap igen på "style.load".
import { BLANK_MAP_STYLE_ID } from "@/lib/map-style-catalog";
import type mapboxgl from "mapbox-gl";
import type { Feature, FeatureCollection } from "geojson";
import { mmToPx } from "@/lib/text-typography";
import type { RouteStyle } from "@/lib/template-schema";
import { kmMarkers } from "./geo";
import type { Bounds, RaceRoute } from "./types";

const SRC_LINE = "arthena-route";
const SRC_POINTS = "arthena-route-points";
const L_CASING = "arthena-route-casing";
const L_LINE = "arthena-route-line";
const L_KM = "arthena-route-km";
const L_START = "arthena-route-start";
const L_FINISH = "arthena-route-finish";
const ALL_LAYERS = [L_FINISH, L_START, L_KM, L_LINE, L_CASING];
const FLAG_IMAGE_PREFIX = "arthena-route-flag-";

/** Ruttens egna lager. Etikettreglaget (dölj symbollager) får aldrig röra dem. */
export function isRouteLayerId(id: string): boolean {
  return id.startsWith("arthena-route");
}

/** Start- och målmarkeringarnas storlek, i px, utifrån linjens tjocklek. */
function markerRadiusPx(w: number): number {
  return w * 1.35;
}
function markerRingPx(w: number): number {
  return Math.max(1, w * 0.5);
}

/**
 * Målflaggans mått i px: lika hög som startcirkeln är bred (diameter inklusive
 * ringen), så att start och mål väger lika mycket på tavlan.
 */
export function finishFlagSizePx(w: number): { width: number; height: number; pole: number } {
  const height = 2 * (markerRadiusPx(w) + markerRingPx(w));
  return { width: height, height, pole: Math.max(1, height * 0.13) };
}

/**
 * Rita målflaggan i en canvas på (0,0)–(width,height): stång till vänster och
 * en rutig duk (ruttfärg/vitt) upptill med kant i ruttfärgen. Samma två färger
 * som startcirkeln, så den syns på både ljus och mörk bakgrund.
 */
export function drawFinishFlag(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  color: string,
): void {
  const pole = Math.max(1, height * 0.13);
  const lw = Math.max(1, height * 0.07);
  const clothX = pole;
  const clothY = lw / 2;
  const clothW = Math.max(1, width - pole - lw / 2);
  const clothH = height * 0.66;
  ctx.clearRect(0, 0, width, height);
  // Stång
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, pole, height);
  // Rutig duk 3 × 2
  const cols = 3;
  const rows = 2;
  const cw = clothW / cols;
  const ch = clothH / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      ctx.fillStyle = (r + c) % 2 === 0 ? color : "#FFFFFF";
      ctx.fillRect(clothX + c * cw, clothY + r * ch, cw, ch);
    }
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.strokeRect(clothX, clothY, clothW, clothH);
}

/** Lägg till flaggbilden i kartan (en bild per färg och storlek). */
function ensureFinishFlagImage(map: mapboxgl.Map, color: string, w: number): { id: string; pole: number } {
  const { width, height, pole } = finishFlagSizePx(w);
  const mapRatio = (map as unknown as { getPixelRatio?: () => number }).getPixelRatio?.() ?? 1;
  const pr = Math.max(2, mapRatio);
  const pw = Math.max(2, Math.ceil(width * pr));
  const ph = Math.max(2, Math.ceil(height * pr));
  const id = `${FLAG_IMAGE_PREFIX}${color.replace(/[^0-9a-z]/gi, "")}-${pw}x${ph}`;
  if (!map.hasImage(id)) {
    const canvas = document.createElement("canvas");
    canvas.width = pw;
    canvas.height = ph;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 2d saknas");
    drawFinishFlag(ctx, pw, ph, color);
    map.addImage(id, ctx.getImageData(0, 0, pw, ph), { pixelRatio: pr });
  }
  return { id, pole };
}

export interface RouteRenderOptions {
  style: RouteStyle;
  /** Kundens färg, annars mallens. */
  color: string;
  showStartFinish: boolean;
  showKmMarkers: boolean;
  /** Framsidans kortsida i px för den här renderingen (skalar tjocklek). */
  canvasShortPx: number;
  /** Ytor upptagna av text/foto ovanpå kartan — banan anpassas runt dem. */
  avoidPct?: AvoidPct;
}

export function routeThicknessPx(style: RouteStyle, canvasShortPx: number): number {
  return Math.max(1, mmToPx(style.thicknessMm ?? 1.6, canvasShortPx));
}

function pointsGeoJson(route: RaceRoute, opts: RouteRenderOptions): FeatureCollection {
  const features: Feature[] = [];
  if (opts.showStartFinish && route.coords.length > 1) {
    features.push(
      { type: "Feature", properties: { kind: "start" }, geometry: { type: "Point", coordinates: route.coords[0]! } },
      { type: "Feature", properties: { kind: "finish" }, geometry: { type: "Point", coordinates: route.coords[route.coords.length - 1]! } },
    );
  }
  if (opts.showKmMarkers) {
    for (const m of kmMarkers(route.coords, route.distanceKm)) {
      features.push({ type: "Feature", properties: { kind: "km", km: m.km }, geometry: { type: "Point", coordinates: m.at } });
    }
  }
  return { type: "FeatureCollection", features };
}

function removeRoute(map: mapboxgl.Map): void {
  for (const id of ALL_LAYERS) if (map.getLayer(id)) map.removeLayer(id);
  for (const id of [SRC_POINTS, SRC_LINE]) if (map.getSource(id)) map.removeSource(id);
}

/**
 * Lägg till / uppdatera / ta bort rutten. Säker att anropa upprepat.
 * Returnerar false om stilen inte var redo (anroparen försöker igen på
 * "style.load"/"idle").
 */
export function applyRouteToMap(
  map: mapboxgl.Map,
  route: RaceRoute | null,
  opts: RouteRenderOptions | null,
): boolean {
  try {
    applyRouteUnsafe(map, route, opts);
    return true;
  } catch (e) {
    console.warn("[route-map] kunde inte rita rutten än", e);
    return false;
  }
}

function applyRouteUnsafe(
  map: mapboxgl.Map,
  route: RaceRoute | null,
  opts: RouteRenderOptions | null,
): void {
  if (!route || !opts || route.coords.length < 2) {
    removeRoute(map);
    return;
  }
  const w = routeThicknessPx(opts.style, opts.canvasShortPx);
  const line: Feature = {
    type: "Feature",
    properties: {},
    geometry: { type: "LineString", coordinates: route.coords },
  };
  const points = pointsGeoJson(route, opts);

  const lineSrc = map.getSource(SRC_LINE) as mapboxgl.GeoJSONSource | undefined;
  if (lineSrc) lineSrc.setData(line);
  else map.addSource(SRC_LINE, { type: "geojson", data: line });
  const ptSrc = map.getSource(SRC_POINTS) as mapboxgl.GeoJSONSource | undefined;
  if (ptSrc) ptSrc.setData(points);
  else map.addSource(SRC_POINTS, { type: "geojson", data: points });

  const casingW = opts.style.casing ? w * 2.2 : 0;
  if (!map.getLayer(L_CASING)) {
    map.addLayer({
      id: L_CASING,
      type: "line",
      source: SRC_LINE,
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": opts.style.casingColor ?? "#FFFFFF", "line-width": casingW },
    });
  } else {
    map.setPaintProperty(L_CASING, "line-color", opts.style.casingColor ?? "#FFFFFF");
    map.setPaintProperty(L_CASING, "line-width", casingW);
  }
  map.setLayoutProperty(L_CASING, "visibility", opts.style.casing ? "visible" : "none");

  if (!map.getLayer(L_LINE)) {
    map.addLayer({
      id: L_LINE,
      type: "line",
      source: SRC_LINE,
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": opts.color, "line-width": w },
    });
  } else {
    map.setPaintProperty(L_LINE, "line-color", opts.color);
    map.setPaintProperty(L_LINE, "line-width", w);
  }

  const ring = markerRingPx(w);
  const circle = (
    id: string,
    kind: string,
    radius: number,
    fill: string,
    stroke: string,
  ) => {
    const paint = {
      "circle-radius": radius,
      "circle-color": fill,
      "circle-stroke-color": stroke,
      "circle-stroke-width": ring,
      "circle-pitch-alignment": "map" as const,
    };
    if (!map.getLayer(id)) {
      map.addLayer({ id, type: "circle", source: SRC_POINTS, filter: ["==", ["get", "kind"], kind], paint });
    } else {
      for (const [k, v] of Object.entries(paint)) map.setPaintProperty(id, k as never, v as never);
    }
  };
  circle(L_KM, "km", w * 0.8, "#FFFFFF", opts.color);
  circle(L_START, "start", markerRadiusPx(w), "#FFFFFF", opts.color);

  // Mål: liten flagga, lika stor som startcirkeln. Stångens fot står på
  // målpunkten, duken vajar uppåt till höger (syns även när start och mål
  // ligger på samma plats).
  const flag = ensureFinishFlagImage(map, opts.color, w);
  const existing = map.getLayer(L_FINISH);
  if (existing && existing.type !== "symbol") map.removeLayer(L_FINISH);
  const flagLayout = {
    "icon-image": flag.id,
    "icon-anchor": "bottom-left" as const,
    "icon-offset": [-flag.pole / 2, 0] as [number, number],
    "icon-allow-overlap": true,
    "icon-ignore-placement": true,
  };
  if (!map.getLayer(L_FINISH)) {
    map.addLayer({
      id: L_FINISH,
      type: "symbol",
      source: SRC_POINTS,
      filter: ["==", ["get", "kind"], "finish"],
      layout: flagLayout,
    });
  } else {
    for (const [k, v] of Object.entries(flagLayout)) map.setLayoutProperty(L_FINISH, k as never, v as never);
  }
  map.setLayoutProperty(L_FINISH, "visibility", "visible");
}

/**
 * Synligt utsnitt som [[väst, syd], [öst, nord]] — sparas för tryck.
 *
 * Räknas från kartrutans hörn, inte med map.getBounds(): fitBounds med
 * padding lämnar kvar padding på kartan (Mapbox GL v3), och då ger
 * getBounds() bara den inre ytan. Tryckfilen zoomade därför in rutten
 * större än förhandsvisningen, närmare rubrik och höjdprofil.
 */
export function viewBoundsOf(
  map: Pick<mapboxgl.Map, "getContainer" | "unproject">,
): Bounds | null {
  const c = map.getContainer();
  const w = c.clientWidth;
  const h = c.clientHeight;
  // Dold karta (0×0 px): inget utsnitt att spara.
  if (!(w > 0 && h > 0)) return null;
  const sw = map.unproject([0, h]);
  const ne = map.unproject([w, 0]);
  return [
    [sw.lng, sw.lat],
    [ne.lng, ne.lat],
  ];
}

/** Banans ram med luft runt om (andel av spannet på varje sida). */
export function paddedBounds(bbox: Bounds, frac = 0.08): Bounds {
  const [[w, s], [e, n]] = bbox;
  const dx = Math.max(1e-4, (e - w) * frac);
  const dy = Math.max(1e-4, (n - s) * frac);
  return [
    [w - dx, s - dy],
    [e + dx, n + dy],
  ];
}

export interface AvoidPct {
  top: number;
  bottom: number;
  left?: number;
  right?: number;
}

/** Luft mellan banan och text/foto som ligger ovanpå kartan (% av kartans höjd). */
const AVOID_GAP_PCT = 4;

/**
 * Hur mycket av kartans kanter som täcks av synliga lager ovanpå den
 * (rubrik, statistik, namn, foto, kilometertider …), i % av kartan. Höga,
 * smala lager (sidokolumner) räknas till vänster/höger kant, övriga till
 * topp/botten. Banan anpassas sedan till den fria ytan däremellan.
 */
export function overlayAvoidPct(
  layers: Array<{ id: string; type: string; xPct: number; yPct: number; wPct: number; hPct: number; zIndex: number }>,
  map: { id: string; xPct: number; yPct: number; wPct: number; hPct: number; zIndex: number },
): AvoidPct {
  let top = 0, bottom = 0, left = 0, right = 0;
  for (const l of layers) {
    if (l.id === map.id || l.type === "margin" || l.zIndex <= map.zIndex) continue;
    const overlapX = Math.min(l.xPct + l.wPct, map.xPct + map.wPct) - Math.max(l.xPct, map.xPct);
    const overlapY = Math.min(l.yPct + l.hPct, map.yPct + map.hPct) - Math.max(l.yPct, map.yPct);
    if (overlapX <= 0 || overlapY <= 0) continue;
    const relY = (y: number) => ((y - map.yPct) / map.hPct) * 100;
    const relX = (x: number) => ((x - map.xPct) / map.wPct) * 100;
    const isColumn = (l.hPct / map.hPct) * 100 > 25 && (l.wPct / map.wPct) * 100 < 40;
    if (isColumn) {
      const cx = relX(l.xPct + l.wPct / 2);
      if (cx < 50) left = Math.max(left, relX(l.xPct + l.wPct));
      else right = Math.max(right, 100 - relX(l.xPct));
      continue;
    }
    const centre = relY(l.yPct + l.hPct / 2);
    if (centre < 50) top = Math.max(top, relY(l.yPct + l.hPct));
    else bottom = Math.max(bottom, 100 - relY(l.yPct));
  }
  return { top: Math.max(0, top), bottom: Math.max(0, bottom), left: Math.max(0, left), right: Math.max(0, right) };
}

/** Fit-padding i px för en kartruta: ruttstilens minimum + fri yta kring överliggande lager. */
export function routeFitPaddingPx(
  style: RouteStyle | undefined,
  w: number,
  h: number,
  avoid?: AvoidPct | null,
): { top: number; right: number; bottom: number; left: number } {
  const base = style?.fitPaddingPct ?? { top: 4, right: 4, bottom: 4, left: 4 };
  const top = Math.max(base.top, avoid && avoid.top > 0 ? avoid.top + AVOID_GAP_PCT : 0);
  const bottom = Math.max(base.bottom, avoid && avoid.bottom > 0 ? avoid.bottom + AVOID_GAP_PCT : 0);
  const left = Math.max(base.left, avoid?.left ? avoid.left + AVOID_GAP_PCT : 0);
  const right = Math.max(base.right, avoid?.right ? avoid.right + AVOID_GAP_PCT : 0);
  // Lämna alltid minst 20 % av höjden och bredden åt banan.
  const sv = top + bottom > 80 ? 80 / (top + bottom) : 1;
  const sh = left + right > 80 ? 80 / (left + right) : 1;
  return {
    top: Math.round(((top * sv) / 100) * h),
    right: Math.round(((right * sh) / 100) * w),
    bottom: Math.round(((bottom * sv) / 100) * h),
    left: Math.round(((left * sh) / 100) * w),
  };
}

/**
 * Lopptavlans ruttkarta visar bara rutten — ingen karta under (mallens
 * bakgrundsfärg syns igenom). Gäller även mallar som skapats med en kartstil.
 */
export function routeMapStyleId(): string {
  return BLANK_MAP_STYLE_ID;
}

/** Ett sparat utsnitt duger bara om det har yta (inte en punkt eller linje). */
export function usableBounds(b: Bounds | null | undefined): Bounds | null {
  if (!b) return null;
  const [[w, s], [e, n]] = b;
  const ok = [w, s, e, n].every(Number.isFinite) && e - w > 1e-6 && n - s > 1e-6;
  return ok ? b : null;
}

/**
 * Gränser för kundens zoom/panorering på en ruttkarta: rutten ska alltid
 * ligga helt inom kartrutan (med en liten marginal).
 *
 * `box` är ruttens rektangel i skärm-px vid nuvarande `zoom`. Svaret ger
 * högsta tillåtna zoom (där rutten precis ryms), lägsta zoom (några steg
 * utzoomat) och hur mycket kartan ska panoreras (Mapbox `panBy`) för att
 * dra tillbaka rutten in i rutan. pan = [0, 0] när allt redan ryms.
 */
export function routeViewLimits(args: {
  box: { x0: number; y0: number; x1: number; y1: number };
  width: number;
  height: number;
  zoom: number;
  marginPx: number;
}): { maxZoom: number; minZoom: number; pan: [number, number] } {
  const { box, width: W, height: H, zoom, marginPx: m } = args;
  const bw = Math.max(1e-6, box.x1 - box.x0);
  const bh = Math.max(1e-6, box.y1 - box.y0);
  const fit = Math.min((W - 2 * m) / bw, (H - 2 * m) / bh);
  const maxZoom = zoom + Math.log2(Math.max(1e-6, fit));
  const minZoom = Math.max(0, maxZoom - 3);

  // Panorering per axel: ryms rutten → tryck in den kant som sticker ut;
  // ryms den inte (mitt i en zoom) → centrera.
  const axis = (lo: number, hi: number, size: number): number => {
    if (hi - lo > size - 2 * m) return (lo + hi) / 2 - size / 2;
    if (lo < m) return lo - m; // innehållet ska åt höger/ned → panorera negativt
    if (hi > size - m) return hi - (size - m);
    return 0;
  };
  return { maxZoom, minZoom, pan: [axis(box.x0, box.x1, W), axis(box.y0, box.y1, H)] };
}
