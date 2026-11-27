// Tiny non-interactive preview of a template's layout.
// Renders inside admin config cards AND inside the "Stilar"-picker (admin +
// kundvy). Reuses MapLayerPreview / TextLayerPreview so the visual matches
// the editable canvas. Two sizing modes:
//
//   • Default: pass `width` + `height` (px). Component is fixed-size.
//   • `fill`: component takes the full size of its parent (use with a
//     wrapper that sets `aspect-ratio`). `width`/`height` then act only as
//     resolution hints for Mapbox/text scaling (default 240×320).
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { studBackgroundCss } from "@/lib/acrylic-stud";
import type { Orientation, Template } from "@/lib/template-schema";
import MapLayerPreview from "./MapLayerPreview";
import TextLayerPreview from "./TextLayerPreview";
import { ShapeLayerView } from "@/components/editor/layers/ShapeLayerView";
import StarmapLayerView from "@/components/editor/layers/StarmapLayerView";
import { RaceElevationView, RaceSplitsView, RaceStatsView } from "@/components/editor/layers/RaceLayerViews";
import { SAMPLE_ELEVATION, SAMPLE_SPLITS, SAMPLE_STATS } from "@/lib/race/sample";

type LayoutOverride = {
  defaultLayout: Template["defaultLayout"];
  canvasLayout?: Template["canvasLayout"];
};

interface Props {
  template: Template | null;
  width?: number;
  height?: number;
  /** When true, the outer container fills its parent (use a wrapper with
   *  `aspect-ratio` set). `width`/`height` are only used as resolution hints. */
  fill?: boolean;
  /** Which orientation block to render. Defaults to "portrait". */
  orientation?: Orientation;
  /** Render this layout block instead of `template.defaultLayout/canvasLayout`.
   *  Useful for previewing one of `template.extraLayouts` without rebuilding
   *  a full Template object. */
  layoutOverride?: LayoutOverride;
  /** "poster" | "canvas" | "aluminum" | "acrylic" */
  productType?: string | null;
}

export default function TemplateThumbnail({
  template,
  width: hintWidth = 120,
  height: hintHeight = 160,
  fill = false,
  orientation = "portrait",
  layoutOverride,
  productType,
}: Props) {
  // I fill-läget styrs storleken av föräldern: mät den, så att text och
  // linjer skalas mot miniatyrens verkliga bredd (annars blev texten för
  // stor i små miniatyrer, t.ex. stilväljaren).
  const boxRef = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    if (!fill) return;
    const el = boxRef.current;
    if (!el) return;
    const read = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setMeasured({ w: r.width, h: r.height });
    };
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fill]);
  const width = fill && measured ? measured.w : hintWidth;
  const height = fill && measured ? measured.h : hintHeight;
  const isCanvas = productType === "canvas";
  const isAcrylic = productType === "acrylic";

  const source = layoutOverride ?? (template
    ? { defaultLayout: template.defaultLayout, canvasLayout: template.canvasLayout }
    : null);

  const useCanvasLayout = isCanvas && !!source?.canvasLayout;
  const layoutBlock = useCanvasLayout ? source?.canvasLayout : source?.defaultLayout;
  const layout = layoutBlock ? layoutBlock[orientation] : null;
  const layers = useMemo(
    () => (layout ? [...layout.layers].sort((a, b) => a.zIndex - b.zIndex) : []),
    [layout],
  );

  const containerStyle: React.CSSProperties = fill
    ? { background: layout?.background.color }
    : { width, height, background: layout?.background.color };
  const containerClass = fill
    ? "relative w-full h-full overflow-hidden shrink-0"
    : "relative rounded border overflow-hidden shadow-sm shrink-0";

  if (!layout) {
    return (
      <div
        className={
          fill
            ? "w-full h-full bg-muted flex items-center justify-center text-[10px] text-muted-foreground"
            : "rounded border border-dashed bg-muted flex items-center justify-center text-[10px] text-muted-foreground"
        }
        style={fill ? undefined : { width, height }}
      >
        Tom
      </div>
    );
  }

  return (
    <div ref={boxRef} className={containerClass} style={containerStyle}>
      {layers.map((layer) => {
        const style: React.CSSProperties = {
          position: "absolute",
          left: `${layer.xPct}%`,
          top: `${layer.yPct}%`,
          width: `${layer.wPct}%`,
          height: `${layer.hPct}%`,
          zIndex: layer.zIndex,
        };
        const w = (layer.wPct / 100) * width;
        const h = (layer.hPct / 100) * height;
        if (layer.type === "map") {
          return (
            <div key={layer.id} style={style}>
              <MapLayerPreview defaults={layer.defaults} width={w} height={h} />
            </div>
          );
        }
        if (layer.type === "text") {
          return (
            <div key={layer.id} style={style}>
              <TextLayerPreview
                layer={layer}
                allLayers={layers}
                height={h}
                width={w}
                canvasShortPx={Math.min(width, height)}
              />
            </div>
          );
        }
        if (layer.type === "elevation") {
          return (
            <div key={layer.id} style={style}>
              <RaceElevationView layer={layer} series={SAMPLE_ELEVATION} routeColor="#FC4C02" canvasShortPx={Math.min(width, height)} />
            </div>
          );
        }
        if (layer.type === "splits") {
          return (
            <div key={layer.id} style={style}>
              <RaceSplitsView layer={layer} splits={SAMPLE_SPLITS} routeColor="#FC4C02" canvasShortPx={Math.min(width, height)} />
            </div>
          );
        }
        if (layer.type === "raceStats") {
          return (
            <div key={layer.id} style={style}>
              <RaceStatsView
                layer={layer}
                items={SAMPLE_STATS.filter((it) => layer.defaults.items.includes(it.key)).slice(0, 3)}
                canvasShortPx={Math.min(width, height)}
              />
            </div>
          );
        }
        if (layer.type === "starmap") {
          return (
            <div key={layer.id} style={style}>
              <StarmapLayerView
                layer={layer}
                center={layer.defaults.center}
                dateISO={layer.defaults.dateISO}
                timeHHMM={layer.defaults.timeHHMM}
                showConstellations={layer.defaults.showConstellations}
                showGrid={layer.defaults.showGrid}
              />
            </div>
          );
        }
        if (layer.type === "line") {
          return (
            <div
              key={layer.id}
              style={{ ...style, background: layer.defaults.color }}
            />
          );
        }
        if (layer.type === "margin") {
          const pct = layer.defaults.thicknessPct;
          return (
            <div
              key={layer.id}
              style={{
                ...style,
                border: `${Math.max(1, pct / 4)}px solid ${layer.defaults.color}`,
                background: "transparent",
              }}
            />
          );
        }
        if (layer.type === "shape") {
          return (
            <div key={layer.id} style={style}>
              <ShapeLayerView layer={layer} canvasShortPx={Math.min(width, height)} />
            </div>
          );
        }
        if (layer.type === "image") {
          return (
            <div key={layer.id} style={style}>
              {layer.defaults.url ? (
                <img
                  src={layer.defaults.url}
                  alt=""
                  className="w-full h-full"
                  style={{ objectFit: layer.defaults.fit }}
                  draggable={false}
                />
              ) : (
                <div className="w-full h-full bg-muted/40" />
              )}
            </div>
          );
        }
        if (layer.type === "photo") {
          const clipPath =
            layer.defaults.shape === "circle" ? "circle(50% at 50% 50%)" : undefined;
          const src = layer.defaults.placeholderUrl;
          return (
            <div key={layer.id} style={{ ...style, overflow: "hidden", clipPath }}>
              {src ? (
                <img
                  src={src}
                  alt=""
                  className={`w-full h-full ${
                    layer.defaults.fit === "contain" ? "object-contain" : "object-cover"
                  }`}
                  draggable={false}
                />
              ) : (
                <div className="w-full h-full bg-muted/40 border border-dashed border-foreground/20" />
              )}
            </div>
          );
        }
        if (layer.type === "aiPhoto") {
          const clipPath =
            layer.defaults.shape === "circle" ? "circle(50% at 50% 50%)" : undefined;
          // Prefer an orientation-matching reference when available so the
          // thumbnail mirrors what the customer will see in that orientation.
          const refs = layer.defaults.referenceImages ?? [];
          const orientMatch =
            refs.find((r) => (r.orientation ?? "any") === orientation) ??
            refs.find((r) => (r.orientation ?? "any") === "any") ??
            refs[0];
          const src = orientMatch?.url ?? layer.defaults.referenceImageUrl;
          return (
            <div key={layer.id} style={{ ...style, overflow: "hidden", clipPath }}>
              {src ? (
                <img
                  src={src}
                  alt=""
                  className={`w-full h-full ${
                    layer.defaults.fit === "contain" ? "object-contain" : "object-cover"
                  }`}
                  draggable={false}
                />
              ) : (
                <div className="w-full h-full bg-accent/40 border border-dashed border-primary/30" />
              )}
            </div>
          );
        }
        return null;
      })}
      {isAcrylic && (
        <>
          {[
            { top: "6%", left: "6%" },
            { top: "6%", right: "6%" },
            { bottom: "6%", left: "6%" },
            { bottom: "6%", right: "6%" },
          ].map((pos, i) => (
            <div
              key={i}
              className="absolute rounded-full pointer-events-none"
              style={{
                width: "8%",
                height: "6%",
                ...pos,
                background: studBackgroundCss(),
                boxShadow: "0 0.5px 1px rgba(0,0,0,0.4), inset 0 0 0 0.5px rgba(28,31,34,0.7)",
              }}
              aria-hidden
            />
          ))}
        </>
      )}
    </div>
  );
}
