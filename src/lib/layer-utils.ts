// Pure helpers for working with template layers in the admin designer.
//   - factories that produce sane defaults per layer type
//   - zIndex normalisation when reordering
//   - bounds clamping in % of the front zone
//
// Keeping these here means LayerCanvas / LayerList / LayerInspector stay free
// of business logic.
import {
  defaultLocks,
  type LayerType,
  type TemplateLayer,
} from "@/lib/template-schema";

const SNAP_PCT = 1.25;

export function snapPct(value: number, snap = SNAP_PCT): number {
  return Math.round(value / snap) * snap;
}

export function clampPct(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, value));
}

export function clampLayerBounds<T extends TemplateLayer>(layer: T): T {
  const w = clampPct(layer.wPct, 1, 100);
  const h = clampPct(layer.hPct, 1, 100);
  const x = clampPct(layer.xPct, 0, 100 - w);
  const y = clampPct(layer.yPct, 0, 100 - h);
  return { ...layer, xPct: x, yPct: y, wPct: w, hPct: h };
}

/** Clamp arbitrary rect (in % of editor) so it stays fully inside [0..100]. */
export function clampLayerRect(rect: { xPct: number; yPct: number; wPct: number; hPct: number }) {
  const wPct = Math.max(1, Math.min(100, rect.wPct));
  const hPct = Math.max(1, Math.min(100, rect.hPct));
  const xPct = Math.max(0, Math.min(100 - wPct, rect.xPct));
  const yPct = Math.max(0, Math.min(100 - hPct, rect.yPct));
  return { xPct, yPct, wPct, hPct };
}

export interface MarginInsetsPct {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * Compute per-axis margin insets (in % of canvas) for the first margin layer.
 * thicknessPct is admin-defined as % of the canvas SHORT side, so for non-
 * square canvases the left/right inset% differs from the top/bottom inset%.
 */
export function getActiveMarginInsetsPct(
  layers: TemplateLayer[],
  frontWcm: number,
  frontHcm: number,
): MarginInsetsPct {
  const margin = layers.find((l) => l.type === "margin") as
    | Extract<TemplateLayer, { type: "margin" }>
    | undefined;
  if (!margin) return { left: 0, right: 0, top: 0, bottom: 0 };
  const shortCm = Math.min(frontWcm, frontHcm);
  const marginCm = (margin.defaults.thicknessPct / 100) * shortCm;
  const leftRight = (marginCm / frontWcm) * 100;
  const topBottom = (marginCm / frontHcm) * 100;
  return { left: leftRight, right: leftRight, top: topBottom, bottom: topBottom };
}

/**
 * When the customer hides the white margin, every other layer's rect is
 * remapped from "% of full canvas" to "% of full canvas" where the previous
 * inner area now spans 0..100. This expands all layers proportionally so they
 * fill the freed-up space while preserving each layer's own aspect ratio.
 */
export function expandRectForRemovedMargin(
  rect: { xPct: number; yPct: number; wPct: number; hPct: number },
  insets: MarginInsetsPct,
): { xPct: number; yPct: number; wPct: number; hPct: number } {
  const innerW = Math.max(0.0001, 100 - insets.left - insets.right);
  const innerH = Math.max(0.0001, 100 - insets.top - insets.bottom);
  const expanded = {
    xPct: ((rect.xPct - insets.left) / innerW) * 100,
    yPct: ((rect.yPct - insets.top) / innerH) * 100,
    wPct: (rect.wPct / innerW) * 100,
    hPct: (rect.hPct / innerH) * 100,
  };
  return clampLayerRect(expanded);
}

/** Effective rect for a layer = template defaults overridden by any per-layer
 *  customer transform (size slider / drag), then optionally expanded if the
 *  white margin has been removed by the customer. */
export function effectiveLayerRect(
  layer: TemplateLayer,
  transforms?: Record<string, { xPct?: number; yPct?: number; wPct?: number; hPct?: number }>,
  opts?: { marginRemovedInsets?: MarginInsetsPct },
): { xPct: number; yPct: number; wPct: number; hPct: number } {
  const t = transforms?.[layer.id];
  const base = {
    xPct: t?.xPct ?? layer.xPct,
    yPct: t?.yPct ?? layer.yPct,
    wPct: t?.wPct ?? layer.wPct,
    hPct: t?.hPct ?? layer.hPct,
  };
  if (opts?.marginRemovedInsets && layer.type !== "margin") {
    return expandRectForRemovedMargin(base, opts.marginRemovedInsets);
  }
  return base;
}

// ---------- line snap & corner-fill helpers ----------
//
// Lines are admin primitives often used to build frames/grids. Two adjacent
// lines must meet seamlessly: no sub-pixel gap, no overlap, and where a
// horizontal meets a vertical the corner must be filled (no L notch).
//
// 1. While dragging/resizing, snap the line's edges to other lines' edges
//    within EDGE_SNAP_TOLERANCE_PCT (falls back to grid snap when none).
// 2. After commit, extend ends that meet a perpendicular line's body by
//    that line's thickness so the corner is flush.

export const EDGE_SNAP_TOLERANCE_PCT = 2;
// % of the canvas SHORT side that 1mm of line thickness represents in the
// editor + customer preview. Chosen so a typical poster (≈300mm short side)
// gets a 1mm line at ~0.33% of the canvas — readable but accurate-ish; the
// print pipeline always uses the EXACT mm. This single constant keeps
// LineLayerView's pixel size in lockstep with snapLineToOtherLines so corner
// snapping actually meets the visible edge.
export const LINE_THICKNESS_MM_TO_SHORT_SIDE_PCT = 0.5;

type LineLayer = Extract<TemplateLayer, { type: "line" }>;

function isLine(l: TemplateLayer): l is LineLayer {
  return l.type === "line";
}

/** Thickness as a % of the canvas short side, matching what's rendered. */
export function lineThicknessPct(line: LineLayer): number {
  return Math.max(0.1, line.defaults.thicknessMm * LINE_THICKNESS_MM_TO_SHORT_SIDE_PCT);
}

/** Pixel thickness for a given canvas short-side (in px). Used by editor +
 *  customer preview to render lines flush against snap targets. */
export function lineThicknessPxFromCanvas(line: LineLayer, canvasShortPx: number): number {
  return Math.max(1, (line.defaults.thicknessMm * LINE_THICKNESS_MM_TO_SHORT_SIDE_PCT / 100) * canvasShortPx);
}

export function snapLineToOtherLines(
  line: LineLayer,
  others: TemplateLayer[],
  tolerance = EDGE_SNAP_TOLERANCE_PCT,
): LineLayer {
  const otherLines = others.filter(isLine).filter((l) => l.id !== line.id);
  if (otherLines.length === 0) return line;

  const horizontal = line.defaults.orientation === "horizontal";
  const lengthCandidates: number[] = [];
  const crossCandidates: number[] = [];

  for (const o of otherLines) {
    const oHorizontal = o.defaults.orientation === "horizontal";
    const oThick = lineThicknessPct(o);
    if (oHorizontal === horizontal) {
      if (horizontal) {
        lengthCandidates.push(o.xPct, o.xPct + o.wPct);
        crossCandidates.push(o.yPct, o.yPct + oThick);
      } else {
        lengthCandidates.push(o.yPct, o.yPct + o.hPct);
        crossCandidates.push(o.xPct, o.xPct + oThick);
      }
    } else {
      if (horizontal) {
        lengthCandidates.push(o.xPct, o.xPct + lineThicknessPct(o));
      } else {
        lengthCandidates.push(o.yPct, o.yPct + lineThicknessPct(o));
      }
    }
  }

  function nearest(value: number, candidates: number[]): number | null {
    let best: number | null = null;
    let bestDist = tolerance;
    for (const c of candidates) {
      const d = Math.abs(value - c);
      if (d <= bestDist) {
        best = c;
        bestDist = d;
      }
    }
    return best;
  }

  const next = { ...line };

  if (horizontal) {
    const leftSnap = nearest(line.xPct, lengthCandidates);
    const rightSnap = nearest(line.xPct + line.wPct, lengthCandidates);
    const topSnap = nearest(line.yPct, crossCandidates);
    if (leftSnap !== null && rightSnap !== null) {
      next.xPct = leftSnap;
      next.wPct = Math.max(1, rightSnap - leftSnap);
    } else if (leftSnap !== null) {
      const right = line.xPct + line.wPct;
      next.xPct = leftSnap;
      next.wPct = Math.max(1, right - leftSnap);
    } else if (rightSnap !== null) {
      next.wPct = Math.max(1, rightSnap - line.xPct);
    }
    if (topSnap !== null) next.yPct = topSnap;
  } else {
    const topSnap = nearest(line.yPct, lengthCandidates);
    const botSnap = nearest(line.yPct + line.hPct, lengthCandidates);
    const leftSnap = nearest(line.xPct, crossCandidates);
    if (topSnap !== null && botSnap !== null) {
      next.yPct = topSnap;
      next.hPct = Math.max(1, botSnap - topSnap);
    } else if (topSnap !== null) {
      const bottom = line.yPct + line.hPct;
      next.yPct = topSnap;
      next.hPct = Math.max(1, bottom - topSnap);
    } else if (botSnap !== null) {
      next.hPct = Math.max(1, botSnap - line.yPct);
    }
    if (leftSnap !== null) next.xPct = leftSnap;
  }

  return clampLayerBounds(next);
}

// Strict tolerance — snap has already placed ends near the kant; here we
// only need to absorb float drift. Using the wider snap tolerance caused
// repeat-clicks to keep extending the line by one thickness each time.
export const EXTEND_TOLERANCE_PCT = 0.3;

function touchesBand(pos: number, start: number, end: number, tolerance: number): boolean {
  return pos >= start - tolerance && pos <= end + tolerance;
}

export function extendLineToMeetCorners(
  line: LineLayer,
  allLayers: TemplateLayer[],
  tolerance = EXTEND_TOLERANCE_PCT,
): LineLayer {
  const perp = allLayers
    .filter(isLine)
    .filter((l) => l.id !== line.id)
    .filter((l) => l.defaults.orientation !== line.defaults.orientation);
  if (perp.length === 0) return line;

  const next = { ...line };
  const horizontal = line.defaults.orientation === "horizontal";
  const thisCrossPos = horizontal ? next.yPct : next.xPct;
  const thisThick = lineThicknessPct(next);

  if (horizontal) {
    let left = next.xPct;
    let right = next.xPct + next.wPct;

    for (const p of perp) {
      const pThick = lineThicknessPct(p);
      const pLeft = p.xPct;
      const pRight = p.xPct + pThick;
      const overlapsY =
        thisCrossPos + thisThick >= p.yPct - tolerance &&
        thisCrossPos <= p.yPct + p.hPct + tolerance;
      if (!overlapsY) continue;

      // Idempotent corner-fill: set exact outer edges instead of adding
      // thickness. This prevents the bottom/right corner from accumulating
      // a tiny protruding overlap when snap chooses the inner edge first.
      if (touchesBand(left, pLeft, pRight, tolerance)) left = pLeft;
      if (touchesBand(right, pLeft, pRight, tolerance)) right = pRight;
    }

    next.xPct = left;
    next.wPct = Math.max(1, right - left);
  } else {
    let top = next.yPct;
    let bottom = next.yPct + next.hPct;

    for (const p of perp) {
      const pThick = lineThicknessPct(p);
      const pTop = p.yPct;
      const pBottom = p.yPct + pThick;
      const overlapsX =
        thisCrossPos + thisThick >= p.xPct - tolerance &&
        thisCrossPos <= p.xPct + p.wPct + tolerance;
      if (!overlapsX) continue;

      if (touchesBand(top, pTop, pBottom, tolerance)) top = pTop;
      if (touchesBand(bottom, pTop, pBottom, tolerance)) bottom = pBottom;
    }

    next.yPct = top;
    next.hPct = Math.max(1, bottom - top);
  }

  return clampLayerBounds(next);
}


let nextIdCounter = 0;
export function newLayerId(): string {
  // Stable enough for in-memory work — Mall persisteras med dessa ID och de
  // matchas senare mot kund-`layerValues`.
  nextIdCounter += 1;
  return `layer_${Date.now().toString(36)}_${nextIdCounter}`;
}

export function nextZIndex(layers: TemplateLayer[]): number {
  if (layers.length === 0) return 1;
  return Math.max(...layers.map((l) => l.zIndex)) + 1;
}

/** Re-pack zIndex to a contiguous 1..N range while preserving order. */
export function normaliseZIndex(layers: TemplateLayer[]): TemplateLayer[] {
  const sorted = [...layers].sort((a, b) => a.zIndex - b.zIndex);
  return sorted.map((l, i) => ({ ...l, zIndex: i + 1 }));
}

/** Move a layer's zIndex up/down by 1 step within the stack. */
export function moveLayer(
  layers: TemplateLayer[],
  id: string,
  direction: "up" | "down",
): TemplateLayer[] {
  const sorted = [...layers].sort((a, b) => a.zIndex - b.zIndex);
  const idx = sorted.findIndex((l) => l.id === id);
  if (idx === -1) return layers;
  const swapWith = direction === "up" ? idx + 1 : idx - 1;
  if (swapWith < 0 || swapWith >= sorted.length) return layers;
  const tmp = sorted[idx];
  sorted[idx] = sorted[swapWith];
  sorted[swapWith] = tmp;
  return normaliseZIndex(sorted);
}

// ---------- factories ----------
export function createLayer(type: LayerType, existing: TemplateLayer[]): TemplateLayer {
  const base = {
    id: newLayerId(),
    xPct: 10,
    yPct: 10,
    wPct: 80,
    hPct: 60,
    rotation: 0,
    zIndex: nextZIndex(existing),
    locks: defaultLocks(),
  };

  switch (type) {
    case "map":
      return {
        ...base,
        type: "map",
        name: `Karta ${countOfType(existing, "map") + 1}`,
        defaults: {
          shape: "circle",
          styleId: "light-v11",
          center: [18.0686, 59.3293],
          zoom: 12,
          showLabels: false,
        },
        locks: defaultLocks({ content: false }),
      };
    case "text":
      return {
        ...base,
        yPct: 75,
        hPct: 15,
        type: "text",
        name: `Text ${countOfType(existing, "text") + 1}`,
        defaults: {
          text: "STOCKHOLM",
          font: "Inter",
          fontSizePt: 36,
          lineHeight: 1.15,
          align: "center",
          color: "#1A1A1A",
        },
        locks: defaultLocks({ content: false, font: true }),
      };
    case "image":
      return {
        ...base,
        type: "image",
        name: `Bild ${countOfType(existing, "image") + 1}`,
        defaults: { fit: "cover", shape: "rect" },
        locks: defaultLocks({ content: false }),
      };
    case "starmap":
      return {
        ...base,
        xPct: 11,
        yPct: 6.5,
        wPct: 78,
        hPct: 55.5,
        type: "starmap",
        name: `Stjärnhimmel ${countOfType(existing, "starmap") + 1}`,
        defaults: {
          dateISO: "2000-01-01",
          timeHHMM: "22:00",
          center: [18.0686, 59.3293],
          placeName: "Stockholm",
          bgColor: "#0B1830",
          starColor: "#FFFFFF",
          lineColor: "#7E93B8",
          showConstellations: true,
          showGrid: false,
        },
        locks: defaultLocks({ content: false }),
      };
    case "line":
      return {
        ...base,
        yPct: 70,
        hPct: 1,
        type: "line",
        name: `Linje ${countOfType(existing, "line") + 1}`,
        defaults: { orientation: "horizontal", thicknessMm: 2, color: "#000000" },
        // Lines are admin-only — fully locked from customer.
        locks: defaultLocks({
          position: true,
          size: true,
          shape: true,
          content: true,
          font: true,
          visibility: true,
          style: true,
        }),
      };
    case "margin":
      return {
        ...base,
        xPct: 0,
        yPct: 0,
        wPct: 100,
        hPct: 100,
        type: "margin",
        name: `Marginal ${countOfType(existing, "margin") + 1}`,
        defaults: { thicknessPct: 5, color: "#FFFFFF" },
        // Margin is admin-only — fully locked from customer.
        locks: defaultLocks({
          position: true,
          size: true,
          shape: true,
          content: true,
          font: true,
          visibility: true,
          style: true,
        }),
      };
    case "photo":
      return {
        ...base,
        xPct: 20,
        yPct: 20,
        wPct: 60,
        hPct: 60,
        type: "photo",
        name: `Foto ${countOfType(existing, "photo") + 1}`,
        defaults: { shape: "rect", fit: "cover" },
        locks: defaultLocks({ content: false, shape: false }),
      };
    case "aiPhoto":
      return {
        ...base,
        xPct: 20,
        yPct: 20,
        wPct: 60,
        hPct: 60,
        type: "aiPhoto",
        name: `AI-bild ${countOfType(existing, "aiPhoto") + 1}`,
        defaults: {
          shape: "rect",
          fit: "cover",
          subjectKind: "human",
          referenceImages: [],
          swapPrompt:
            "Replace only the face/head onto the reference subject. Preserve the reference outfit, hair contour, lighting, pose and background.",
        },
        // Customer can change the SHAPE and upload content; everything else
        // (position/size/style) is admin-controlled like a regular photo layer.
        locks: defaultLocks({ content: false, shape: false }),
      };
    case "shape":
      return {
        ...base,
        xPct: 10,
        yPct: 10,
        wPct: 80,
        hPct: 80,
        type: "shape",
        name: `Figur ${countOfType(existing, "shape") + 1}`,
        defaults: {
          kind: "frame-rect",
          strokeMm: 2,
          color: "#1A1A1A",
        },
        // Admin-only — fully locked from the customer.
        locks: defaultLocks({
          position: true,
          size: true,
          shape: true,
          content: true,
          font: true,
          visibility: true,
          style: true,
        }),
      };
  }
}

function countOfType(layers: TemplateLayer[], type: LayerType): number {
  return layers.filter((l) => l.type === type).length;
}

/**
 * Build a sensible starter layout (centred map + text below). Mirrors the
 * default the customer editor used before the layer system existed.
 */
export function createDefaultLayout(): TemplateLayer[] {
  const map = createLayer("map", []);
  const text = createLayer("text", [map]);
  // Position map nicely at top, text below
  map.xPct = 10;
  map.yPct = 8;
  map.wPct = 80;
  map.hPct = 62;
  text.xPct = 10;
  text.yPct = 75;
  text.wPct = 80;
  text.hPct = 12;
  return normaliseZIndex([map, text]);
}

/** Build a shape layer of a specific kind. Wraps `createLayer("shape")`
 *  and overrides defaults + sane initial dimensions per shape kind. */
export function createShapeLayer(
  kind: import("@/lib/template-schema").ShapeKind,
  existing: TemplateLayer[],
): TemplateLayer {
  const base = createLayer("shape", existing) as Extract<TemplateLayer, { type: "shape" }>;
  if (kind === "line-horizontal") {
    return {
      ...base,
      xPct: 10, yPct: 50, wPct: 80, hPct: 2,
      defaults: { kind, strokeMm: 2, color: "#1A1A1A" },
    };
  }
  if (kind === "line-vertical") {
    return {
      ...base,
      xPct: 50, yPct: 10, wPct: 2, hPct: 80,
      defaults: { kind, strokeMm: 2, color: "#1A1A1A" },
    };
  }
  if (kind === "frame-rounded") {
    return {
      ...base,
      defaults: { kind, strokeMm: 2, color: "#1A1A1A", cornerRadiusPct: 6 },
    };
  }
  if (kind === "frame-double") {
    return {
      ...base,
      defaults: { kind, strokeMm: 1.5, color: "#1A1A1A", gapMm: 4 },
    };
  }
  if (kind === "frame-corners") {
    return {
      ...base,
      defaults: { kind, strokeMm: 2, color: "#1A1A1A", cornerStyle: "bracket" },
    };
  }
  return { ...base, defaults: { kind, strokeMm: 2, color: "#1A1A1A" } };
}
