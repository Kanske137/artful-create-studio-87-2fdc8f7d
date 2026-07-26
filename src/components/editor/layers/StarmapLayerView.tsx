// Kundeditorns vy för starmap-lagret: en <canvas> som ritas om av samma
// deterministiska renderare som tryck-snapshotten (src/lib/starmap-render.ts)
// — paritet editor↔tryck per konstruktion. ResizeObserver håller canvasens
// backing store i synk med layoutstorleken × devicePixelRatio.
import { useEffect, useRef } from "react";
import { renderStarmap } from "@/lib/starmap-render";
import type { TemplateLayer } from "@/lib/template-schema";

interface StarmapLayerViewProps {
  layer: Extract<TemplateLayer, { type: "starmap" }>;
  center: [number, number];
  dateISO: string;
  timeHHMM?: string;
  showConstellations: boolean;
  showGrid: boolean;
}

export default function StarmapLayerView({
  layer,
  center,
  dateISO,
  timeHHMM,
  showConstellations,
  showGrid,
}: StarmapLayerViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const draw = () => {
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
      if (!ctx) return;
      ctx.clearRect(0, 0, w, h);
      renderStarmap(
        ctx,
        { x: 0, y: 0, w, h },
        { dateISO, timeHHMM, lat: center[1], lon: center[0] },
        {
          bgColor: layer.defaults.bgColor,
          starColor: layer.defaults.starColor,
          lineColor: layer.defaults.lineColor,
          gridColor: layer.defaults.gridColor,
          showConstellations,
          showGrid,
          magLimit: layer.defaults.magLimit,
        },
      );
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(el);
    return () => ro.disconnect();
  }, [layer, center, dateISO, timeHHMM, showConstellations, showGrid]);

  return <canvas ref={canvasRef} className="w-full h-full block" />;
}
