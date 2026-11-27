// Pure-presentational layer renderers (no state, no side-effects).
// Image, Line, Margin. Text is handled inline in MapPreview because it shares
// the customer's live `text`/`textFont` state.
import type { TemplateLayer } from "@/lib/template-schema";
import { cn } from "@/lib/utils";

export function ImageLayerView({
  layer,
}: {
  layer: Extract<TemplateLayer, { type: "image" }>;
}) {
  const d = layer.defaults;
  const clip =
    d.shape === "circle"
      ? "circle(50% at 50% 50%)"
      : d.shape === "square"
      ? undefined
      : undefined;
  return (
    // Grå platshållarton bara när bild saknas: tryckfilen ritar ingen bakgrund
    // bakom bilden, och genomskinlig grafik (SVG) ska se likadan ut här.
    <div className={cn("absolute inset-0 overflow-hidden", !d.url && "bg-muted/30")} style={{ clipPath: clip }}>
      {d.url ? (
        <img
          src={d.url}
          alt=""
          className="w-full h-full"
          style={{ objectFit: d.fit }}
          draggable={false}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-[10px] text-muted-foreground">
          Bild
        </div>
      )}
    </div>
  );
}

export function LineLayerView({
  layer,
  thicknessPx,
}: {
  layer: Extract<TemplateLayer, { type: "line" }>;
  /** Optional explicit pixel thickness (computed from the canvas short side
   *  in mm) — when provided the line renders at the EXACT same size as the
   *  print pipeline. Falls back to a relative cqw/cqh approximation when the
   *  caller hasn't measured the canvas. */
  thicknessPx?: number;
}) {
  const d = layer.defaults;
  // Prefer pixel thickness so editor + customer preview match the print file
  // 1:1 (which uses thicknessMm * pxPerMm). This is what makes corner snap
  // tolerances meaningful — the visual edges line up with the snap targets.
  const thick =
    typeof thicknessPx === "number" && thicknessPx > 0
      ? `${Math.max(1, thicknessPx)}px`
      : `min(${d.thicknessMm * 0.5}cqw, ${d.thicknessMm * 0.5}cqh)`;
  // Render the visible line flush against ONE edge of the layer box (no
  // translate(-50%) — eliminates subpixel rounding) so corners are pixel
  // perfect and 90° sharp. The drag hit-area is provided by Rnd's
  // minHeight/minWidth in LayerCanvas, not by this element.
  const lineStyle: React.CSSProperties =
    d.orientation === "horizontal"
      ? {
          position: "absolute",
          left: 0,
          right: 0,
          top: 0,
          height: thick,
          background: d.color,
          borderRadius: 0,
        }
      : {
          position: "absolute",
          top: 0,
          bottom: 0,
          left: 0,
          width: thick,
          background: d.color,
          borderRadius: 0,
        };
  return (
    <div className="absolute inset-0" style={{ containerType: "size" }}>
      <div style={lineStyle} />
    </div>
  );
}

export function MarginLayerView({
  layer,
}: {
  layer: Extract<TemplateLayer, { type: "margin" }>;
}) {
  const d = layer.defaults;
  // Thickness as % of the SHORT side of this layer's box (which equals the
  // canvas short side, since margin layers always span 0..100%). We use a
  // container query unit so the same number works regardless of orientation.
  const thick = `min(${d.thicknessPct}cqw, ${d.thicknessPct}cqh)`;
  const common: React.CSSProperties = {
    position: "absolute",
    background: d.color,
    pointerEvents: "auto",
  };
  return (
    // Container is pointer-events:none so the transparent middle never steals
    // clicks/drags from layers underneath (e.g. map). Only the four filled
    // edge strips opt back in via pointer-events:auto.
    <div
      className="absolute inset-0"
      style={{ containerType: "size", pointerEvents: "none" }}
    >
      <div style={{ ...common, top: 0, left: 0, right: 0, height: thick }} />
      <div style={{ ...common, bottom: 0, left: 0, right: 0, height: thick }} />
      <div style={{ ...common, top: 0, bottom: 0, left: 0, width: thick }} />
      <div style={{ ...common, top: 0, bottom: 0, right: 0, width: thick }} />
    </div>
  );
}
