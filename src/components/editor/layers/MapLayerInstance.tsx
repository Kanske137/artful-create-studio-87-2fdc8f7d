// Renders a single Mapbox GL instance bound to one template layer's value.
// All pan/zoom/style updates write back into editorStore.layerValues[layerId]
// — the concept of a single "live" map is gone; every map is independently
// interactive (subject to its locks).
import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useEditorStore } from "@/stores/editorStore";
import { getMapboxToken, reverseGeocode, styleUrl } from "@/lib/mapbox";
import {
  applyRouteToMap,
  isRouteLayerId,
  paddedBounds,
  routeFitPaddingPx,
  routeViewLimits,
  viewBoundsOf,
  type RouteRenderOptions,
} from "@/lib/race/route-map";
import type { RouteStyle } from "@/lib/template-schema";
import type { RaceRoute } from "@/lib/race/types";

/** Lopptavla: rutten som ska ritas i kartan + när den ska anpassas. */
export interface MapRouteProp {
  route: RaceRoute | null;
  opts: RouteRenderOptions | null;
  /** Ökar när en ny bana valts → kartan anpassas till banan. */
  fitNonce: number;
}

/** Luft runt banan: andel av banans spann + px-marginal i kartrutan. */
export const ROUTE_FIT_FRAC = 0.06;

function fitToRoute(map: mapboxgl.Map, route: RaceRoute, opts: RouteRenderOptions | null): void {
  const c = map.getContainer();
  const padding = routeFitPaddingPx(opts?.style as RouteStyle | undefined, c.clientWidth, c.clientHeight, opts?.avoidPct);
  // Släpp förra banans zoomgränser innan vi anpassar till den här.
  map.setMinZoom(0);
  map.setMaxZoom(22);
  map.fitBounds(paddedBounds(route.bbox, ROUTE_FIT_FRAC), { padding, duration: 0 });
  constrainToRoute(map, route);
}

/**
 * Kunden får zooma och panorera ruttkartan, men rutten ska alltid ligga helt
 * inom kartrutan: högsta zoom = där rutten precis ryms, och panorering
 * stoppas vid kanten.
 */
function constrainToRoute(map: mapboxgl.Map, route: RaceRoute): void {
  const c = map.getContainer();
  const W = c.clientWidth;
  const H = c.clientHeight;
  if (!(W > 0 && H > 0)) return;
  const [[w, s], [e, n]] = route.bbox;
  const a = map.project([w, n]);
  const b = map.project([e, s]);
  const lim = routeViewLimits({
    box: { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) },
    width: W,
    height: H,
    zoom: map.getZoom(),
    marginPx: Math.max(4, Math.min(W, H) * 0.02),
  });
  if (Math.abs(map.getMaxZoom() - lim.maxZoom) > 0.01) map.setMaxZoom(lim.maxZoom);
  if (Math.abs(map.getMinZoom() - lim.minZoom) > 0.01) map.setMinZoom(lim.minZoom);
  const [dx, dy] = lim.pan;
  if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) map.panBy([dx, dy], { duration: 0, animate: false });
}

const avoidKeyOf = (o: RouteRenderOptions | null | undefined) =>
  o?.avoidPct
    ? [o.avoidPct.top, o.avoidPct.bottom, o.avoidPct.left ?? 0, o.avoidPct.right ?? 0].map((v) => v.toFixed(1)).join("/")
    : "";

interface Props {
  layerId: string;
  shape: "circle" | "heart" | "star";
  styleId: string;
  center: [number, number];
  zoom: number;
  showLabels: boolean;
  interactive: boolean;
  clipPath?: string;
  onMapReady?: (map: mapboxgl.Map | null) => void;
  /** Bara för ruttkartor (mallens map-lager har routeStyle). */
  route?: MapRouteProp;
}

function applyLabelVisibility(map: mapboxgl.Map, show: boolean) {
  const apply = () => {
    try {
      const style = map.getStyle();
      if (!style?.layers) return;
      for (const layer of style.layers) {
        if (isRouteLayerId(layer.id)) continue;
        if (layer.type === "symbol" || layer.id.startsWith("label-")) {
          map.setLayoutProperty(layer.id, "visibility", show ? "visible" : "none");
        }
      }
    } catch (e) {
      console.warn("[MapLayerInstance] applyLabelVisibility failed", e);
    }
  };
  if (map.isStyleLoaded()) apply();
  else map.once("idle", apply);
}

export function MapLayerInstance({
  layerId,
  shape,
  styleId,
  center,
  zoom,
  showLabels,
  interactive,
  clipPath,
  onMapReady,
  route,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const programmaticRef = useRef(false);
  const reverseTimerRef = useRef<number | null>(null);
  // Ruttkarta: senaste props i ref (eventhandlers registreras en gång),
  // vilken bana vi senast anpassat kartan till, och om kunden själv panorerat.
  const routeRef = useRef<MapRouteProp | undefined>(route);
  routeRef.current = route;
  const fittedNonceRef = useRef<number | null>(null);
  const fittedAvoidRef = useRef<string>("");
  const userMovedRef = useRef(false);

  const syncRoute = (map: mapboxgl.Map) => {
    const r = routeRef.current;
    if (!r) return;
    if (!applyRouteToMap(map, r.route, r.opts)) {
      map.once("idle", () => {
        const latest = routeRef.current;
        if (latest) applyRouteToMap(map, latest.route, latest.opts);
      });
    }
    const avoidKey = avoidKeyOf(r.opts);
    if (!r.route) {
      // Ingen bana vald: inga gränser.
      map.setMinZoom(0);
      map.setMaxZoom(22);
    }
    if (r.route && fittedNonceRef.current !== r.fitNonce) {
      // Ny bana: anpassa alltid, och glöm kundens tidigare panorering.
      fittedNonceRef.current = r.fitNonce;
      fittedAvoidRef.current = avoidKey;
      userMovedRef.current = false;
      fitToRoute(map, r.route, r.opts);
    } else if (r.route && fittedAvoidRef.current !== avoidKey && !userMovedRef.current) {
      // Fält slogs av/på (t.ex. foto) — håll banan fri från det som ligger ovanpå.
      fittedAvoidRef.current = avoidKey;
      fitToRoute(map, r.route, r.opts);
    }
  };

  // Init
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = await getMapboxToken();
      if (cancelled || !containerRef.current || mapRef.current) return;
      if (!token) return;
      mapboxgl.accessToken = token;
      const map = new mapboxgl.Map({
        container: containerRef.current,
        style: styleUrl(styleId),
        center,
        zoom,
        attributionControl: false,
        interactive,
        scrollZoom: interactive,
        dragPan: interactive,
        doubleClickZoom: interactive,
        touchZoomRotate: interactive,
        boxZoom: false,
        pitchWithRotate: false,
      });

      map.on("load", () => {
        map.resize();
        if (!isHidden()) {
          useEditorStore.getState().setLayerMapViewWidth(layerId, map.getContainer().clientWidth);
        }
        applyLabelVisibility(map, showLabels);
        syncRoute(map);
      });
      map.on("style.load", () => {
        applyLabelVisibility(map, showLabels);
        // Stilbyte rensar egna lager — rita rutten igen.
        const r = routeRef.current;
        if (r) applyRouteToMap(map, r.route, r.opts);
      });
      // Editorn kan ha en dold kopia av förhandsvisningen (0×0 px, t.ex.
      // mobil-/desktoplayouten som inte syns). Den får aldrig skriva till
      // butiken: dess utsnitt är en punkt och skrev över det synliga, så att
      // löpartavlans tryckfil blev utan rutt.
      const isHidden = () => {
        const c = map.getContainer();
        return c.clientWidth <= 0 || c.clientHeight <= 0;
      };

      map.on("resize", () => {
        if (isHidden()) return;
        // Kartan ändrar storlek när fält slås av/på (flödeslayout). Har
        // kunden inte själv panorerat följer utsnittet med banan.
        const r = routeRef.current;
        if (r?.route && !userMovedRef.current) fitToRoute(map, r.route, r.opts);
        else if (r?.route) constrainToRoute(map, r.route);
        // center/zoom visar olika mycket beroende på rutans bredd — spara den
        // så att kundvagnsbild och tryckfil visar exakt samma område.
        useEditorStore.getState().setLayerMapViewWidth(layerId, map.getContainer().clientWidth);
      });

      // Håll rutten inom bild medan kunden zoomar/panorerar.
      let constraining = false;
      map.on("move", () => {
        const r = routeRef.current;
        if (constraining || !r?.route || isHidden()) return;
        constraining = true;
        try {
          constrainToRoute(map, r.route);
        } finally {
          constraining = false;
        }
      });

      map.on("moveend", (e: { originalEvent?: unknown }) => {
        if (isHidden()) {
          programmaticRef.current = false;
          return;
        }
        useEditorStore.getState().setLayerMapViewWidth(layerId, map.getContainer().clientWidth);
        if (routeRef.current) {
          // Tryckfilen återskapar exakt detta utsnitt.
          const vb = viewBoundsOf(map);
          if (vb) useEditorStore.getState().setLayerMapViewBounds(layerId, vb);
          if (e?.originalEvent) userMovedRef.current = true;
        }
        if (programmaticRef.current) {
          programmaticRef.current = false;
          return;
        }
        const c = map.getCenter();
        const z = map.getZoom();
        const store = useEditorStore.getState();
        store.setLayerMapCenter(layerId, [c.lng, c.lat]);
        store.setLayerMapZoom(layerId, z);

        if (reverseTimerRef.current) window.clearTimeout(reverseTimerRef.current);
        reverseTimerRef.current = window.setTimeout(async () => {
          const r = await reverseGeocode(c.lng, c.lat);
          if (r) {
            useEditorStore.getState().updateMapLayerFromPan(layerId, {
              placeName: r.place_name,
              center: [c.lng, c.lat],
              city: r.city,
              country: r.country,
            });
          }
        }, 400);
      });

      mapRef.current = map;
      onMapReady?.(map);
      setTimeout(() => map.resize(), 50);
      setTimeout(() => map.resize(), 250);
      setTimeout(() => map.resize(), 600);
    })();
    return () => {
      cancelled = true;
      if (reverseTimerRef.current) window.clearTimeout(reverseTimerRef.current);
      onMapReady?.(null);
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layerId]);

  // Toggle interactivity dynamically
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const handlers: Array<keyof mapboxgl.Map> = [
      "scrollZoom",
      "dragPan",
      "doubleClickZoom",
      "touchZoomRotate",
    ];
    for (const h of handlers) {
      const inst = (map as unknown as Record<string, { enable: () => void; disable: () => void }>)[h as string];
      if (inst && typeof inst.enable === "function" && typeof inst.disable === "function") {
        if (interactive) inst.enable();
        else inst.disable();
      }
    }
  }, [interactive]);

  // resize observer
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => mapRef.current?.resize());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // style change
  useEffect(() => {
    if (mapRef.current) mapRef.current.setStyle(styleUrl(styleId));
  }, [styleId]);

  // labels
  useEffect(() => {
    if (mapRef.current) applyLabelVisibility(mapRef.current, showLabels);
  }, [showLabels]);

  // programmatic flyTo when external center/zoom change
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const cur = map.getCenter();
    const curZoom = map.getZoom();
    const lngDiff = Math.abs(cur.lng - center[0]);
    const latDiff = Math.abs(cur.lat - center[1]);
    const zoomDiff = Math.abs(curZoom - zoom);
    if (lngDiff > 1e-4 || latDiff > 1e-4 || zoomDiff > 0.05) {
      programmaticRef.current = true;
      map.flyTo({ center, zoom, duration: 800 });
    }
  }, [center, zoom]);

  // Ruttkarta: rita om när banan eller stilen ändras, anpassa vid ny bana.
  const routeKey = route
    ? [
        route.fitNonce,
        route.route?.coords.length ?? 0,
        route.route?.distanceKm ?? 0,
        route.opts?.color,
        route.opts?.style.thicknessMm,
        route.opts?.style.casing,
        route.opts?.style.casingColor,
        route.opts?.showStartFinish,
        route.opts?.showKmMarkers,
        Math.round(route.opts?.canvasShortPx ?? 0),
        avoidKeyOf(route.opts),
      ].join("|")
    : "";
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !routeRef.current) return;
    syncRoute(map);
  }, [routeKey, route?.route]);

  // resize when shape changes (square/circle re-layout)
  useEffect(() => {
    setTimeout(() => mapRef.current?.resize(), 80);
    setTimeout(() => mapRef.current?.resize(), 320);
  }, [shape]);

  return (
    <div className="absolute inset-0 overflow-hidden" style={{ clipPath }}>
      <div ref={containerRef} className="absolute inset-0" />
    </div>
  );
}
