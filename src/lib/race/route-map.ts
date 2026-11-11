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

  const ring = Math.max(1, w * 0.5);
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
  circle(L_START, "start", w * 1.35, "#FFFFFF", opts.color);
  circle(L_FINISH, "finish", w * 1.35, opts.color, "#FFFFFF");
}

/** Synligt utsnitt som [[väst, syd], [öst, nord]] — sparas för tryck. */
export function viewBoundsOf(map: mapboxgl.Map): Bounds {
  const b = map.getBounds();
  return [
    [b.getWest(), b.getSouth()],
    [b.getEast(), b.getNorth()],
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
