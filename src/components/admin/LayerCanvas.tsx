// Drag & drop canvas for the admin designer.
//
// Coordinates: every layer stores xPct/yPct/wPct/hPct in % of THIS canvas
// (which represents the FRONT zone of the print). react-rnd works in pixels,
// so we convert via the canvas' measured size on every drag/resize tick.
//
// Snap: 5% grid is always on. Alignment guides appear under drag when an edge
// or centre lines up with another layer / canvas centre / canvas edge.
//
// Each layer renders a TYPE-SPECIFIC mini preview (real Mapbox tile, real
// text with chosen font, etc.) so the admin sees what the customer will see.
import { useEffect, useMemo, useRef, useState } from "react";
import { Rnd } from "react-rnd";
import type { Aspect, TemplateLayer } from "@/lib/template-schema";
import {
  clampLayerBounds,
  snapPct,
  snapLineToOtherLines,
  extendLineToMeetCorners,
  lineThicknessPxFromCanvas,
} from "@/lib/layer-utils";
import AlignmentGuides from "./AlignmentGuides";
import MapLayerPreview from "./MapLayerPreview";
import TextLayerPreview from "./TextLayerPreview";
import { LineLayerView, MarginLayerView } from "@/components/editor/layers/StaticLayers";
import { ShapeLayerView } from "@/components/editor/layers/ShapeLayerView";
import StarmapLayerView from "@/components/editor/layers/StarmapLayerView";
import { AcrylicCornerOverlay } from "@/components/editor/AcrylicCornerOverlay";

const SNAP_PCT = 1.25;
const GUIDE_TOLERANCE_PCT = 1.5;

interface Props {
  aspect: Aspect;
  background: string;
  layers: TemplateLayer[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChange: (next: TemplateLayer) => void;
  /** Canvas wrap depth as a fraction of the editor surface short side
   *  (e.g. 2 cm wrap on a 30 cm short side → 0.0667). When > 0, the
   *  designer renders the front-zone marker and shaded wrap bands. */
  wrapInsetPctX?: number;
  wrapInsetPctY?: number;
  /** Active product type — used to overlay product-specific decoration
   *  (e.g. acrylic corner screws) on top of the design surface. */
  productType?: string | null;
}

const aspectToRatio: Record<Aspect, string> = {
  "3:4": "3 / 4",
  "4:3": "4 / 3",
  "1:1": "1 / 1",
};

export default function LayerCanvas({
  aspect,
  background,
  layers,
  selectedId,
  onSelect,
  onChange,
  wrapInsetPctX = 0,
  wrapInsetPctY = 0,
  productType = null,
}: Props) {
  const isAcrylic = productType === "acrylic";
  // Derive an approximate front size in cm from the aspect so the overlay's
  // 1.4 cm inset / 1.5 cm disc translate to reasonable %-positions in admin.
  const acrylicFrontCm =
    aspect === "1:1"
      ? { w: 30, h: 30 }
      : aspect === "4:3"
      ? { w: 40, h: 30 }
      : { w: 30, h: 40 };
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [guides, setGuides] = useState<{ v: number[]; h: number[] }>({ v: [], h: [] });
  const [hoverId, setHoverId] = useState<string | null>(null);

  useEffect(() => {
    if (!wrapRef.current) return;
    const obs = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setSize({ w: r.width, h: r.height });
    });
    obs.observe(wrapRef.current);
    return () => obs.disconnect();
  }, []);

  const sortedLayers = useMemo(
    () => [...layers].sort((a, b) => a.zIndex - b.zIndex),
    [layers],
  );

  function pxToPct(px: number, axis: "x" | "y"): number {
    const total = axis === "x" ? size.w : size.h;
    return total === 0 ? 0 : (px / total) * 100;
  }

  function computeGuides(moving: TemplateLayer): { v: number[]; h: number[] } {
    const v: number[] = [];
    const h: number[] = [];
    const movingCenters = {
      x: [moving.xPct, moving.xPct + moving.wPct / 2, moving.xPct + moving.wPct],
      y: [moving.yPct, moving.yPct + moving.hPct / 2, moving.yPct + moving.hPct],
    };
    [0, 50, 100].forEach((cx) => {
      if (movingCenters.x.some((mx) => Math.abs(mx - cx) <= GUIDE_TOLERANCE_PCT)) v.push(cx);
    });
    [0, 50, 100].forEach((cy) => {
      if (movingCenters.y.some((my) => Math.abs(my - cy) <= GUIDE_TOLERANCE_PCT)) h.push(cy);
    });
    layers
      .filter((l) => l.id !== moving.id)
      .forEach((other) => {
        const xs = [other.xPct, other.xPct + other.wPct / 2, other.xPct + other.wPct];
        const ys = [other.yPct, other.yPct + other.hPct / 2, other.yPct + other.hPct];
        xs.forEach((x) => {
          if (movingCenters.x.some((mx) => Math.abs(mx - x) <= GUIDE_TOLERANCE_PCT)) v.push(x);
        });
        ys.forEach((y) => {
          if (movingCenters.y.some((my) => Math.abs(my - y) <= GUIDE_TOLERANCE_PCT)) h.push(y);
        });
      });
    return {
      v: Array.from(new Set(v.map((n) => Math.round(n * 10) / 10))),
      h: Array.from(new Set(h.map((n) => Math.round(n * 10) / 10))),
    };
  }

  function renderLayerContent(layer: TemplateLayer) {
    const wPx = (layer.wPct / 100) * size.w;
    const hPx = (layer.hPct / 100) * size.h;
    switch (layer.type) {
      case "map":
        return <MapLayerPreview defaults={layer.defaults} width={wPx} height={hPx} />;
      case "text":
        return <TextLayerPreview layer={layer} allLayers={layers} height={hPx} width={wPx} canvasShortPx={Math.min(size.w, size.h)} />;
      case "image":
        return layer.defaults.url ? (
          <img
            src={layer.defaults.url}
            alt=""
            className="w-full h-full object-cover"
            draggable={false}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground bg-muted">
            🖼 Bild
          </div>
        );
      case "starmap":
        return (
          <StarmapLayerView
            layer={layer}
            center={layer.defaults.center}
            dateISO={layer.defaults.dateISO}
            timeHHMM={layer.defaults.timeHHMM}
            showConstellations={layer.defaults.showConstellations}
            showGrid={layer.defaults.showGrid}
          />
        );
      case "line":
        return <LineLayerView layer={layer} thicknessPx={lineThicknessPxFromCanvas(layer, Math.min(size.w, size.h))} />;
      case "margin":
        return <MarginLayerView layer={layer} />;
      case "shape":
        return <ShapeLayerView layer={layer} canvasShortPx={Math.min(size.w, size.h)} />;
      case "photo": {
        const clipPath =
          layer.defaults.shape === "circle" ? "circle(50% at 50% 50%)" : undefined;
        const src = layer.defaults.placeholderUrl;
        return (
          <div className="absolute inset-0 overflow-hidden" style={{ clipPath }}>
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
              <div className="w-full h-full flex items-center justify-center text-[10px] text-muted-foreground bg-muted/60 border border-dashed border-foreground/30 text-center px-1">
                📷 Bildplats
              </div>
            )}
          </div>
        );
      }
      case "aiPhoto": {
        const clipPath =
          layer.defaults.shape === "circle" ? "circle(50% at 50% 50%)" : undefined;
        const src = layer.defaults.referenceImageUrl;
        const isRemoveBg = layer.defaults.subjectKind === "removeBackground";
        const placeholderText = isRemoveBg
          ? "✨ AI-bild (bakgrund tas bort)"
          : "✨ AI-bildplats";
        return (
          <div className="absolute inset-0 overflow-hidden" style={{ clipPath }}>
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
              <div className="w-full h-full flex items-center justify-center text-[10px] text-muted-foreground bg-accent/60 border border-dashed border-primary/40 text-center px-1">
                {placeholderText}
              </div>
            )}
          </div>
        );
      }
      default:
        return null;
    }
  }

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div
        ref={wrapRef}
        className="relative w-full overflow-hidden rounded-md border shadow-sm"
        style={{ aspectRatio: aspectToRatio[aspect], background }}
        onClick={(e) => {
          if (e.target === e.currentTarget) onSelect(null);
        }}
      >
        {/* 5% grid */}
        <div
          className="pointer-events-none absolute inset-0 opacity-20"
          style={{
            backgroundImage:
              "linear-gradient(to right, hsl(var(--border)) 1px, transparent 1px), linear-gradient(to bottom, hsl(var(--border)) 1px, transparent 1px)",
            backgroundSize: `${SNAP_PCT}% ${SNAP_PCT}%`,
          }}
        />

        {/* Canvas wrap-zone visualisation: shaded bands + dashed front marker.
            Rendered with very high z-index so the dashed front-edge is ALWAYS
            visible above any layer (map, image, margin) the admin places. */}
        {(wrapInsetPctX > 0 || wrapInsetPctY > 0) && (
          <>
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                zIndex: 40,
                background: `linear-gradient(hsl(var(--muted) / 0.55), hsl(var(--muted) / 0.55))`,
                clipPath: `polygon(
                  0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%,
                  ${wrapInsetPctX * 100}% ${wrapInsetPctY * 100}%,
                  ${wrapInsetPctX * 100}% ${(1 - wrapInsetPctY) * 100}%,
                  ${(1 - wrapInsetPctX) * 100}% ${(1 - wrapInsetPctY) * 100}%,
                  ${(1 - wrapInsetPctX) * 100}% ${wrapInsetPctY * 100}%,
                  ${wrapInsetPctX * 100}% ${wrapInsetPctY * 100}%
                )`,
              }}
            />
            <div
              className="pointer-events-none absolute border-2 border-dashed"
              style={{
                left: `${wrapInsetPctX * 100}%`,
                top: `${wrapInsetPctY * 100}%`,
                right: `${wrapInsetPctX * 100}%`,
                bottom: `${wrapInsetPctY * 100}%`,
                borderColor: "hsl(var(--primary))",
                boxShadow: "0 0 0 1px hsl(var(--background) / 0.9), inset 0 0 0 1px hsl(var(--background) / 0.9)",
                zIndex: 41,
              }}
            />
            <div
              className="pointer-events-none absolute text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded shadow"
              style={{
                left: `${wrapInsetPctX * 100}%`,
                top: `calc(${wrapInsetPctY * 100}% + 4px)`,
                transform: "translateX(4px)",
                background: "hsl(var(--primary))",
                color: "hsl(var(--primary-foreground))",
                zIndex: 42,
              }}
            >
              Synlig framsida
            </div>
          </>
        )}
        {sortedLayers.map((layer) => {
          const isSelected = selectedId === layer.id;
          const showName = isSelected || hoverId === layer.id;

          // Per-type interaction tweaks:
          // - margin: Rnd itself is pointer-events:none so the transparent
          //   middle never blocks clicks on layers underneath. The four
          //   visible edge strips inside MarginLayerView re-enable events,
          //   so admins can still click an edge to select the margin.
          // - line: give the Rnd box a minimum hit-area (24px on the thin
          //   axis) so there's a draggable middle, and only allow resizing
          //   along the LENGTH axis (thickness is set via Inspector).
          const isMargin = layer.type === "margin";
          const isLine = layer.type === "line";
          const isShape = layer.type === "shape";
          const shapeKind = isShape
            ? (layer as Extract<TemplateLayer, { type: "shape" }>).defaults.kind
            : null;
          const shapeIsLineH = shapeKind === "line-horizontal";
          const shapeIsLineV = shapeKind === "line-vertical";
          // A "frame" shape (rect/oval/rounded/double/corners) has a hollow
          // middle. Treat it like `margin`: the Rnd box becomes pointer-
          // events:none so clicks in the empty centre fall through to layers
          // underneath. Only the actual stroke pixels (set to pointer-events:
          // auto inside ShapeLayerView) catch clicks. Line-shapes are NOT
          // frames and keep normal hit behaviour.
          const isShapeFrame =
            isShape && !shapeIsLineH && !shapeIsLineV;
          const lineHorizontal =
            (isLine && (layer as Extract<TemplateLayer, { type: "line" }>).defaults.orientation === "horizontal") ||
            shapeIsLineH;
          const lineVertical =
            (isLine && !((layer as Extract<TemplateLayer, { type: "line" }>).defaults.orientation === "horizontal")) ||
            shapeIsLineV;
          const isThinLine = isLine || shapeIsLineH || shapeIsLineV;

          const enableResizing = isThinLine
            ? {
                top: lineVertical,
                bottom: lineVertical,
                left: lineHorizontal,
                right: lineHorizontal,
                topLeft: false,
                topRight: false,
                bottomLeft: false,
                bottomRight: false,
              }
            : undefined; // default = all enabled

          const rndStyle: React.CSSProperties = {
            zIndex: layer.zIndex + 1,
            ...(isMargin || isShapeFrame ? { pointerEvents: "none" as const } : {}),
            ...(isThinLine && lineHorizontal ? { minHeight: 24 } : {}),
            ...(isThinLine && lineVertical ? { minWidth: 24 } : {}),
          };

          return (
            <Rnd
              key={layer.id}
              bounds="parent"
              size={{ width: `${layer.wPct}%`, height: `${layer.hPct}%` }}
              position={{
                x: (layer.xPct / 100) * size.w,
                y: (layer.yPct / 100) * size.h,
              }}
              enableResizing={enableResizing}
              onDragStart={() => onSelect(layer.id)}
              onDrag={(_e, d) => {
                let next = clampLayerBounds({
                  ...layer,
                  xPct: snapPct(pxToPct(d.x, "x")),
                  yPct: snapPct(pxToPct(d.y, "y")),
                });
                if (isLine) {
                  next = snapLineToOtherLines(next as Extract<TemplateLayer, { type: "line" }>, layers);
                }
                setGuides(computeGuides(next));
              }}
              onDragStop={(_e, d) => {
                let next = clampLayerBounds({
                  ...layer,
                  xPct: snapPct(pxToPct(d.x, "x")),
                  yPct: snapPct(pxToPct(d.y, "y")),
                });
                if (isLine) {
                  next = snapLineToOtherLines(next as Extract<TemplateLayer, { type: "line" }>, layers);
                  next = extendLineToMeetCorners(next as Extract<TemplateLayer, { type: "line" }>, layers);
                }
                setGuides({ v: [], h: [] });
                onChange(next);
              }}
              onResizeStart={() => onSelect(layer.id)}
              onResize={(_e, _dir, ref, _delta, position) => {
                let next = clampLayerBounds({
                  ...layer,
                  wPct: snapPct(pxToPct(ref.offsetWidth, "x")),
                  hPct: snapPct(pxToPct(ref.offsetHeight, "y")),
                  xPct: snapPct(pxToPct(position.x, "x")),
                  yPct: snapPct(pxToPct(position.y, "y")),
                });
                if (isLine) {
                  next = snapLineToOtherLines(next as Extract<TemplateLayer, { type: "line" }>, layers);
                }
                setGuides(computeGuides(next));
              }}
              onResizeStop={(_e, _dir, ref, _delta, position) => {
                let next = clampLayerBounds({
                  ...layer,
                  wPct: snapPct(pxToPct(ref.offsetWidth, "x")),
                  hPct: snapPct(pxToPct(ref.offsetHeight, "y")),
                  xPct: snapPct(pxToPct(position.x, "x")),
                  yPct: snapPct(pxToPct(position.y, "y")),
                });
                if (isLine) {
                  next = snapLineToOtherLines(next as Extract<TemplateLayer, { type: "line" }>, layers);
                  next = extendLineToMeetCorners(next as Extract<TemplateLayer, { type: "line" }>, layers);
                }
                setGuides({ v: [], h: [] });
                onChange(next);
              }}
              style={rndStyle}
              className={
                isSelected
                  ? "ring-2 ring-primary ring-offset-1"
                  : isMargin || isShapeFrame
                  ? "" // no ring for margin / frame shapes — Rnd is pointer-events:none so :hover never fires; selection is shown via the stroke itself + name tag
                  : "ring-1 ring-border/60 hover:ring-primary/50"
              }
            >
              <div
                className="relative w-full h-full overflow-hidden cursor-move"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(layer.id);
                  // Re-snap on click for lines opened from a saved template
                  // — fixes sub-% drift. We deliberately do NOT run
                  // extendLineToMeetCorners here: extend should only fire on
                  // an explicit drag/resize-stop, otherwise repeated clicks
                  // could grow the line by one thickness each time.
                  if (isLine) {
                    let next = clampLayerBounds(layer);
                    next = snapLineToOtherLines(next as Extract<TemplateLayer, { type: "line" }>, layers);
                    if (
                      next.xPct !== layer.xPct ||
                      next.yPct !== layer.yPct ||
                      next.wPct !== layer.wPct ||
                      next.hPct !== layer.hPct
                    ) {
                      onChange(next);
                    }
                  }
                }}
                onMouseEnter={() => setHoverId(layer.id)}
                onMouseLeave={() => setHoverId((h) => (h === layer.id ? null : h))}
              >
                {renderLayerContent(layer)}
                {showName && (
                  <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-background/90 text-[10px] font-medium text-foreground shadow-sm pointer-events-none">
                    {layer.type === "map" && "🗺 "}
                    {layer.type === "text" && "T "}
                    {layer.type === "image" && "🖼 "}
                    {layer.type === "photo" && "📷 "}
                    {layer.type === "aiPhoto" && "✨ "}
                    {layer.type === "line" && "▬ "}
                    {layer.type === "margin" && "▢ "}
                    {layer.type === "shape" && "◇ "}
                    {layer.name}
                  </span>
                )}
              </div>
            </Rnd>
          );
        })}

        <AlignmentGuides vertical={guides.v} horizontal={guides.h} />

        {isAcrylic && (
          <AcrylicCornerOverlay
            frontWcm={acrylicFrontCm.w}
            frontHcm={acrylicFrontCm.h}
            zIndex={45}
          />
        )}
      </div>
    </div>
  );
}
