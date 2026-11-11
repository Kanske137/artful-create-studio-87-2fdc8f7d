// Kundeditorns vyer för lopptavlans canvas-lager (höjdprofil, statistikrad).
// Ritas av SAMMA funktioner som tryckfilen (src/lib/race/render-*.ts) —
// paritet editor↔tryck per konstruktion, som StarmapLayerView.
import { useEffect, useRef } from "react";
import type { TemplateLayer } from "@/lib/template-schema";
import type { RaceStatItem } from "@/lib/race/derive";
import { drawElevationProfile } from "@/lib/race/render-elevation";
import { drawRaceStats, ensureRaceStatsFonts } from "@/lib/race/render-stats";

/** Gemensam canvas som följer layoutstorleken × devicePixelRatio. */
function useLayerCanvas(
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number, scale: number) => void | Promise<void>,
  deps: unknown[],
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    let cancelled = false;
    const run = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(rect.width * dpr));
      const h = Math.max(1, Math.round(rect.height * dpr));
      if (el.width !== w || el.height !== h) {
        el.width = w;
        el.height = h;
      }
      const ctx = el.getContext("2d");
      if (!ctx || cancelled) return;
      ctx.clearRect(0, 0, w, h);
      void draw(ctx, w, h, w / rect.width);
    };
    run();
    const ro = new ResizeObserver(run);
    ro.observe(el);
    return () => {
      cancelled = true;
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return canvasRef;
}

interface ElevationProps {
  layer: Extract<TemplateLayer, { type: "elevation" }>;
  series: number[];
  routeColor: string;
  /** Framsidans kortsida i CSS-px (samma som text-lagren får). */
  canvasShortPx: number;
}

export function RaceElevationView({ layer, series, routeColor, canvasShortPx }: ElevationProps) {
  const ref = useLayerCanvas(
    (ctx, w, h, scale) => {
      drawElevationProfile(ctx, { x: 0, y: 0, w, h }, series, layer.defaults, routeColor, canvasShortPx * scale);
    },
    [layer, series, routeColor, canvasShortPx],
  );
  return <canvas ref={ref} className="w-full h-full block" aria-label="Höjdprofil" />;
}

interface StatsProps {
  layer: Extract<TemplateLayer, { type: "raceStats" }>;
  items: RaceStatItem[];
  canvasShortPx: number;
}

export function RaceStatsView({ layer, items, canvasShortPx }: StatsProps) {
  const itemsKey = items.map((i) => `${i.key}=${i.label}:${i.value}`).join("|");
  const ref = useLayerCanvas(
    async (ctx, w, h, scale) => {
      await ensureRaceStatsFonts(layer.defaults);
      ctx.clearRect(0, 0, w, h);
      drawRaceStats(ctx, { x: 0, y: 0, w, h }, items, layer.defaults, canvasShortPx * scale);
    },
    [layer, itemsKey, canvasShortPx],
  );
  return <canvas ref={ref} className="w-full h-full block" aria-label="Loppstatistik" />;
}
