// Multi-layer snapshot renderer. Loops template layers in zIndex order and
// composites them onto a single 2D canvas at the requested print resolution.
//
// Each layer type has its own draw step:
//   - map     → spin up a headless Mapbox GL instance, await idle, drawImage
//   - text    → ctx.fillText with the layer's font/colour/align/sizePct
//   - image   → load + drawImage with shape clipping
//   - line    → strokeRect / strokeLine
//   - margin  → strokeRect inset
//
// Map layers are rendered SEQUENTIALLY (one Mapbox instance at a time) to
// avoid GPU context exhaustion on weaker devices. The customer's live values
// (mapCenter/mapZoom/mapStyleId/etc.) override the LIVE layer's defaults; all
// other map layers stay locked to their template defaults.
import mapboxgl from "mapbox-gl";
import { drawAcrylicStud, STUD_DIAMETER_CM, STUD_INSET_CM } from "./acrylic-stud";
import { textureForHex, preloadTexture } from "./frame-textures";
import { drawShapeOnCanvas, type ClipShape } from "./shape-clip";
import { getMapboxToken, styleUrl } from "./mapbox";
import type { Template, TemplateLayer, TextSpan } from "./template-schema";
import { getActiveLayoutBlock } from "./template-schema";
import type { LayerValue, MapIcon } from "@/stores/editorStore";
import { getActiveMarginInsetsPct, expandRectForRemovedMargin } from "./layer-utils";
import { buildEffectiveTextWithSpans, type LinkedPlace } from "./text-typography";
import { iconSvgString } from "./map-icon-catalog";

export interface TemplateSnapshotInput {
  template: Template;
  orientation: "portrait" | "landscape";
  size: string; // "30x40"
  /** "poster" | "canvas" — determines whether the canvasLayout (if any) is
   *  used instead of defaultLayout. */
  productType?: string | null;
  /** Active named-layout id ("Stil"). Defaults to the implicit Standard. */
  layoutId?: string | null;

  // Per-layer values keyed by layer id. When provided, these override the
  // legacy live* fields. Falls back to layer.defaults when missing.
  layerValues?: Record<string, LayerValue>;

  /** Customer-driven rect overrides (size slider / drag) keyed by layer id. */
  layerTransforms?: Record<string, { xPct?: number; yPct?: number; wPct?: number; hPct?: number }>;

  // Legacy live customer state — overrides defaults on the FIRST map/text
  // layer when `layerValues` is not supplied.
  liveMapCenter: [number, number];
  liveMapZoom: number;
  liveMapStyleId: string;
  liveMapShape: "rect" | "circle" | "heart" | "star";
  liveShowLabels: boolean;
  liveText: string;
  liveTextFont: string;
  liveTextVisible: boolean;
  livePosterBgColor: string;

  // Output sizing
  wrapCm?: number;
  bleedCm?: number;
  hires?: boolean;
  maxPxOverride?: number;

  // Optional frame / canvas-wrap overlay (drawn ON TOP of layers — preview/cart only).
  frameColor?: string;
  frameWidthCm?: number;
  /** Posterhängare (trälist topp+botten + snöre). Endast preview/cart. */
  hangerColor?: string;
  canvasWrap?: boolean;
  /** Akryl-skruvar i hörnen (preview/cart only — aldrig i tryckfil). */
  acrylicCorners?: boolean;

  /** Legacy single-photo overlay applied to every `photo` layer. Used as a
   *  fallback when `photoOverlays` does not have an entry for a given layer. */
  photoOverlayUrl?: string;
  /** Per-photo-layer overlay URLs (customer upload or AI result), keyed by
   *  layer id. Lets multi-photo templates render different images per
   *  behållare. */
  photoOverlays?: Record<string, string>;

  /** Per-aiPhoto-layer face-swap result URLs. Falls back to the layer's
   *  admin-set referenceImageUrl when no result is present. */
  aiPhotoResults?: Record<string, string>;
  /** Per-aiPhoto-layer customer selection of which admin reference image
   *  is active. Used to look up the admin-set focal point so the printed
   *  swap result is cropped the same way as the editor preview. */
  aiPhotoSelectedRefUrl?: Record<string, string>;

  /** Customer toggle: when false, the white margin layer is omitted and all
   *  other layers are expanded proportionally to fill the freed area. */
  whiteMarginEnabled?: boolean;

  /** Diagonalt upprepat "Arthena"-vattenmärke på varje BILDLAGER (photo /
   *  aiPhoto / image — inte kartor, text eller bakgrund). Endast kundvända
   *  previews (kundvagnsbild, mockups, 3D). ALDRIG tryckfil — hires-vägen
   *  nollar flaggan i renderHiresTemplateSnapshotSafe och ritsteget
   *  dubbelgardar med `!input.hires`. */
  watermark?: boolean;
}

export interface TemplateSnapshotResult {
  dataUrl: string;
  widthPx: number;
  heightPx: number;
  sizeBytes: number;
}

function pickHiresMaxPx(): number {
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(ua);
  if (isMobile) return 2800;
  if (dpr >= 2) return 4800;
  return 4200;
}

function parseSize(size: string, orientation: "portrait" | "landscape") {
  const m = size.match(/(\d+)\s*x\s*(\d+)/i);
  if (!m) return { wCm: 30, hCm: 40 };
  const a = parseInt(m[1], 10);
  const b = parseInt(m[2], 10);
  const wCm = orientation === "portrait" ? Math.min(a, b) : Math.max(a, b);
  const hCm = orientation === "portrait" ? Math.max(a, b) : Math.min(a, b);
  return { wCm, hCm };
}

function createOffscreen(w: number, h: number): HTMLDivElement {
  const el = document.createElement("div");
  el.style.position = "fixed";
  el.style.left = "-99999px";
  el.style.top = "0";
  el.style.width = `${w}px`;
  el.style.height = `${h}px`;
  el.style.pointerEvents = "none";
  el.setAttribute("aria-hidden", "true");
  document.body.appendChild(el);
  return el;
}

/** Apply shape clip via the shared shape-clip util (matches editor exactly). */
function clipForShape(
  ctx: CanvasRenderingContext2D,
  shape: string,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  drawShapeOnCanvas(ctx, shape as ClipShape, x, y, w, h);
}

/** Render a single map layer onto the output canvas at the given pixel rect. */
async function drawMapLayer(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; w: number; h: number },
  opts: {
    center: [number, number];
    zoom: number;
    styleId: string;
    showLabels: boolean;
    shape: string;
  },
): Promise<void> {
  const container = createOffscreen(rect.w, rect.h);
  const mapDiv = document.createElement("div");
  mapDiv.style.width = `${rect.w}px`;
  mapDiv.style.height = `${rect.h}px`;
  container.appendChild(mapDiv);

  let map: mapboxgl.Map | null = null;
  try {
    map = new mapboxgl.Map({
      container: mapDiv,
      style: styleUrl(opts.styleId),
      center: opts.center,
      zoom: opts.zoom,
      interactive: false,
      attributionControl: false,
      preserveDrawingBuffer: true,
      fadeDuration: 0,
    });

    await new Promise<void>((resolve, reject) => {
      const t = window.setTimeout(() => reject(new Error("Map render timeout")), 15000);
      map!.once("error", (e) => {
        window.clearTimeout(t);
        reject(new Error(`Mapbox error: ${(e as any)?.error?.message ?? "unknown"}`));
      });
      map!.on("idle", () => {
        window.clearTimeout(t);
        resolve();
      });
    });

    try {
      const style = map.getStyle();
      if (style?.layers) {
        for (const sl of style.layers) {
          if (sl.type === "symbol" || sl.id.startsWith("label-")) {
            map.setLayoutProperty(sl.id, "visibility", opts.showLabels ? "visible" : "none");
          }
        }
      }
      // Wait an extra idle cycle for tiles to redraw after toggling labels.
      await new Promise<void>((resolve) => {
        const t = window.setTimeout(() => resolve(), 1500);
        map!.once("idle", () => {
          window.clearTimeout(t);
          resolve();
        });
      });
    } catch (e) {
      console.warn("[template-snapshot] label toggle failed", e);
    }

    const mapCanvas = map.getCanvas();
    ctx.save();
    clipForShape(ctx, opts.shape, rect.x, rect.y, rect.w, rect.h);
    ctx.drawImage(mapCanvas, rect.x, rect.y, rect.w, rect.h);
    ctx.restore();
  } finally {
    try {
      map?.remove();
    } catch {
      /* noop */
    }
    if (container.parentNode) container.parentNode.removeChild(container);
  }
}

/** Rasterise an SVG string into an HTMLImageElement at the requested size. */
function loadSvgAsImage(svg: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  });
}

/** Project a geographic point to a pixel inside the given rect using the same
 *  Web Mercator projection Mapbox uses at pitch=0/bearing=0 (always our
 *  case). Mirrors what `map.project` would return in the editor. */
function projectLngLatToRectPx(
  lng: number,
  lat: number,
  center: [number, number],
  zoom: number,
  w: number,
  h: number,
): { x: number; y: number } {
  const scale = 256 * Math.pow(2, zoom);
  const merc = (lon: number, la: number) => {
    const x = ((lon + 180) / 360) * scale;
    const s = Math.sin((la * Math.PI) / 180);
    const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale;
    return { x, y };
  };
  const c = merc(center[0], center[1]);
  const p = merc(lng, lat);
  return { x: w / 2 + (p.x - c.x), y: h / 2 + (p.y - c.y) };
}

/** Draw customer-placed icons on top of a map layer, clipped to its shape. */
async function drawMapIcons(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; w: number; h: number },
  shape: string,
  icons: MapIcon[],
  center: [number, number],
  zoom: number,
): Promise<void> {
  if (!icons || icons.length === 0) return;
  // Same proportion as editor preview — 6% of the layer's short side.
  const sizePx = Math.max(8, Math.min(rect.w, rect.h) * 0.06);
  ctx.save();
  clipForShape(ctx, shape, rect.x, rect.y, rect.w, rect.h);
  for (const ic of icons) {
    const svg = iconSvgString(ic.iconId, "#111");
    if (!svg) continue;
    try {
      const img = await loadSvgAsImage(svg);
      let cx: number;
      let cy: number;
      if (typeof ic.lng === "number" && typeof ic.lat === "number") {
        const p = projectLngLatToRectPx(ic.lng, ic.lat, center, zoom, rect.w, rect.h);
        cx = rect.x + p.x;
        cy = rect.y + p.y;
      } else if (typeof ic.xPct === "number" && typeof ic.yPct === "number") {
        cx = rect.x + (ic.xPct / 100) * rect.w;
        cy = rect.y + (ic.yPct / 100) * rect.h;
      } else {
        continue;
      }
      ctx.drawImage(img, cx - sizePx / 2, cy - sizePx / 2, sizePx, sizePx);
    } catch (e) {
      console.warn("[template-snapshot] icon draw failed", ic.iconId, e);
    }
  }
  ctx.restore();
}

function drawTextLayer(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; w: number; h: number },
  layer: Extract<TemplateLayer, { type: "text" }>,
  liveText: string,
  liveFont: string,
  canvasShortPx: number,
  liveFontSizePt: number | null = null,
): void {
  const d = layer.defaults;
  // Caller resolverar effektiv text via buildEffectiveTextWithSpans, så
  // overrideText === "" (medvetet tomt) MÅSTE respekteras. Använd INTE
  // `liveText || d.text` här — det skulle falla tillbaka på placeholder.
  const text = liveText;
  if (!text.trim()) return;
  const hasBg = !!d.backgroundColor && d.backgroundColor !== "transparent";
  if (hasBg) {
    ctx.save();
    ctx.fillStyle = d.backgroundColor!;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.restore();
  }

  const lines = text.split("\n");
  // pt-based size when present (A4 reference); else legacy %-of-height.
  // A4 short = 595.276pt. Customer override (liveFontSizePt) wins.
  const effectivePt =
    typeof liveFontSizePt === "number" && liveFontSizePt > 0
      ? liveFontSizePt
      : typeof d.fontSizePt === "number" && d.fontSizePt > 0
      ? d.fontSizePt
      : null;
  const fontPx =
    effectivePt !== null
      ? Math.max(6, Math.round((effectivePt / 595.276) * canvasShortPx))
      : Math.max(8, Math.round(rect.h * ((d.fontSizePct ?? 8) / 100)));
  const lineMul = typeof d.lineHeight === "number" && d.lineHeight > 0 ? d.lineHeight : 1.15;
  const lineH = Math.round(fontPx * lineMul);
  ctx.save();
  ctx.fillStyle = d.color;
  ctx.font = `500 ${fontPx}px ${liveFont || d.font}, Inter, sans-serif`;
  ctx.textBaseline = "middle";
  ctx.textAlign = d.align === "left" ? "left" : d.align === "right" ? "right" : "center";
  const tx = d.align === "left" ? rect.x : d.align === "right" ? rect.x + rect.w : rect.x + rect.w / 2;
  const totalH = lineH * lines.length;
  const firstY = rect.y + rect.h / 2 - totalH / 2 + lineH / 2;

  // ---- Decoration (box / side-rules) ----
  const dec = d.decoration && d.decoration.kind !== "none" ? d.decoration : null;
  if (dec) {
    const mmToPx = (mm: number) => (mm / 210) * canvasShortPx;
    const padPx = mmToPx(dec.paddingMm ?? 2);
    const thickPx = Math.max(1, mmToPx(dec.thicknessMm));
    // Measure widest line.
    let widest = 0;
    for (const line of lines) {
      const w = ctx.measureText(line).width;
      if (w > widest) widest = w;
    }
    const textBoxW = widest;
    const textBoxH = totalH;
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;

    if (dec.kind === "box") {
      ctx.save();
      ctx.strokeStyle = dec.color;
      ctx.lineWidth = thickPx;
      const bx = cx - textBoxW / 2 - padPx;
      const by = cy - textBoxH / 2 - padPx;
      ctx.strokeRect(bx, by, textBoxW + 2 * padPx, textBoxH + 2 * padPx);
      ctx.restore();
    } else if (dec.kind === "side-rules") {
      ctx.save();
      ctx.fillStyle = dec.color;
      const ruleLenPx = dec.ruleLengthMm ? mmToPx(dec.ruleLengthMm) : null;
      const textLeft = cx - textBoxW / 2;
      const textRight = cx + textBoxW / 2;
      const yMid = cy - thickPx / 2;
      if (ruleLenPx) {
        ctx.fillRect(textLeft - padPx - ruleLenPx, yMid, ruleLenPx, thickPx);
        ctx.fillRect(textRight + padPx, yMid, ruleLenPx, thickPx);
      } else {
        const leftEnd = textLeft - padPx;
        const rightStart = textRight + padPx;
        if (leftEnd > rect.x) ctx.fillRect(rect.x, yMid, leftEnd - rect.x, thickPx);
        if (rect.x + rect.w > rightStart) ctx.fillRect(rightStart, yMid, rect.x + rect.w - rightStart, thickPx);
      }
      ctx.restore();
    }
  }

  lines.forEach((line, i) => {
    ctx.fillText(line, tx, firstY + i * lineH);
  });
  ctx.restore();
}

async function drawImageLayer(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; w: number; h: number },
  layer: Extract<TemplateLayer, { type: "image" }>,
): Promise<void> {
  const url = layer.defaults.url;
  if (!url) return;
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.crossOrigin = "anonymous";
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("Image layer load failed"));
    i.src = url;
  });
  ctx.save();
  clipForShape(ctx, layer.defaults.shape, rect.x, rect.y, rect.w, rect.h);
  if (layer.defaults.fit === "contain") {
    const ar = img.width / img.height;
    const rar = rect.w / rect.h;
    let dw = rect.w;
    let dh = rect.h;
    if (ar > rar) {
      dh = rect.w / ar;
    } else {
      dw = rect.h * ar;
    }
    const dx = rect.x + (rect.w - dw) / 2;
    const dy = rect.y + (rect.h - dh) / 2;
    ctx.drawImage(img, dx, dy, dw, dh);
  } else {
    // cover
    const ar = img.width / img.height;
    const rar = rect.w / rect.h;
    let sw = img.width;
    let sh = img.height;
    if (ar > rar) {
      sw = img.height * rar;
    } else {
      sh = img.width / rar;
    }
    const sx = (img.width - sw) / 2;
    const sy = (img.height - sh) / 2;
    ctx.drawImage(img, sx, sy, sw, sh, rect.x, rect.y, rect.w, rect.h);
  }
  ctx.restore();
}

async function drawPhotoLayer(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; w: number; h: number },
  url: string,
  shape: "rect" | "circle" | "heart" | "star",
  fit: "cover" | "contain",
  offsetX: number,
  offsetY: number,
  zoom: number = 1,
): Promise<void> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.crossOrigin = "anonymous";
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("Photo layer load failed"));
    i.src = url;
  });
  ctx.save();
  clipForShape(ctx, shape, rect.x, rect.y, rect.w, rect.h);
  if (fit === "contain") {
    const ar = img.width / img.height;
    const rar = rect.w / rect.h;
    let dw = rect.w;
    let dh = rect.h;
    if (ar > rar) dh = rect.w / ar;
    else dw = rect.h * ar;
    ctx.drawImage(img, rect.x + (rect.w - dw) / 2, rect.y + (rect.h - dh) / 2, dw, dh);
  } else {
    // Cover + zoom: scale = cover-fit * zoom. sw/sh become smaller as we zoom in.
    const safeZoom = Math.max(1, zoom || 1);
    const scale = Math.max(rect.w / img.width, rect.h / img.height) * safeZoom;
    const sw = rect.w / scale;
    const sh = rect.h / scale;
    const overflowXPx = img.width - sw; // source pixels of horizontal overflow
    const overflowYPx = img.height - sh;
    const maxOffsetXPct = (overflowXPx / sw) * 50; // matches editor clamp
    const maxOffsetYPct = (overflowYPx / sh) * 50;
    const clampedX = Math.max(-maxOffsetXPct, Math.min(maxOffsetXPct, offsetX));
    const clampedY = Math.max(-maxOffsetYPct, Math.min(maxOffsetYPct, offsetY));
    // Editor: positive offsetX shifts the image to the right → source crop
    // moves left → subtract from sx.
    const srcOffsetX = (clampedX / 100) * sw;
    const srcOffsetY = (clampedY / 100) * sh;
    const sx = overflowXPx / 2 - srcOffsetX;
    const sy = overflowYPx / 2 - srcOffsetY;
    ctx.drawImage(img, sx, sy, sw, sh, rect.x, rect.y, rect.w, rect.h);
  }
  ctx.restore();
}

function drawLineLayer(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; w: number; h: number },
  layer: Extract<TemplateLayer, { type: "line" }>,
  _pxPerMm: number,
  frontShortPx: number,
): void {
  const d = layer.defaults;
  // Same formula as editor + customer preview (LINE_THICKNESS_MM_TO_SHORT_SIDE_PCT
  // = 0.5 → thickness = thicknessMm * 0.5% of front short side). Renders the
  // line FLUSH against one edge of its bounding rect so corners meet pixel-
  // perfectly when extendLineToMeetCorners has run in the admin.
  const thick = Math.max(1, (d.thicknessMm * 0.5 / 100) * frontShortPx);
  ctx.save();
  ctx.fillStyle = d.color;
  if (d.orientation === "horizontal") {
    ctx.fillRect(rect.x, rect.y, rect.w, thick);
  } else {
    ctx.fillRect(rect.x, rect.y, thick, rect.h);
  }
  ctx.restore();
}

function drawMarginLayer(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; w: number; h: number },
  layer: Extract<TemplateLayer, { type: "margin" }>,
  _pxPerMm: number,
  canvasShortPx: number,
): void {
  const d = layer.defaults;
  // thicknessPct is % of the canvas SHORT side → symmetric on all 4 sides.
  const thick = Math.max(1, Math.round((d.thicknessPct / 100) * canvasShortPx));
  ctx.save();
  ctx.fillStyle = d.color;
  // Top
  ctx.fillRect(rect.x, rect.y, rect.w, thick);
  // Bottom
  ctx.fillRect(rect.x, rect.y + rect.h - thick, rect.w, thick);
  // Left
  ctx.fillRect(rect.x, rect.y, thick, rect.h);
  // Right
  ctx.fillRect(rect.x + rect.w - thick, rect.y, thick, rect.h);
  ctx.restore();
}

function drawShapeLayer(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; w: number; h: number },
  layer: Extract<TemplateLayer, { type: "shape" }>,
  frontShortPx: number,
): void {
  const d = layer.defaults;
  // Same mm-to-px formula as line/Shape view.
  const sw = Math.max(1, (d.strokeMm * 0.5 / 100) * frontShortPx);
  ctx.save();
  ctx.strokeStyle = d.color;
  ctx.fillStyle = d.color;
  ctx.lineWidth = sw;
  ctx.lineCap = "square";
  ctx.lineJoin = "miter";

  if (d.kind === "line-horizontal") {
    ctx.fillRect(rect.x, rect.y, rect.w, sw);
  } else if (d.kind === "line-vertical") {
    ctx.fillRect(rect.x, rect.y, sw, rect.h);
  } else if (d.kind === "frame-rect") {
    ctx.strokeRect(rect.x + sw / 2, rect.y + sw / 2, rect.w - sw, rect.h - sw);
  } else if (d.kind === "frame-oval") {
    ctx.beginPath();
    ctx.ellipse(
      rect.x + rect.w / 2, rect.y + rect.h / 2,
      Math.max(0, (rect.w - sw) / 2), Math.max(0, (rect.h - sw) / 2),
      0, 0, Math.PI * 2,
    );
    ctx.stroke();
  } else if (d.kind === "frame-rounded") {
    const r = ((d.cornerRadiusPct ?? 5) / 100) * Math.min(rect.w, rect.h);
    const x = rect.x + sw / 2;
    const y = rect.y + sw / 2;
    const w = rect.w - sw;
    const h = rect.h - sw;
    ctx.beginPath();
    if (typeof (ctx as unknown as { roundRect?: unknown }).roundRect === "function") {
      (ctx as unknown as { roundRect: (x: number, y: number, w: number, h: number, r: number) => void })
        .roundRect(x, y, w, h, r);
    } else {
      // Manual fallback
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r);
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
    }
    ctx.stroke();
  } else if (d.kind === "frame-double") {
    const gap = Math.max(1, ((d.gapMm ?? 4) * 0.5 / 100) * frontShortPx);
    ctx.strokeRect(rect.x + sw / 2, rect.y + sw / 2, rect.w - sw, rect.h - sw);
    const inset = sw + gap + sw / 2;
    const innerW = Math.max(0, rect.w - inset * 2);
    const innerH = Math.max(0, rect.h - inset * 2);
    if (innerW > 0 && innerH > 0) ctx.strokeRect(rect.x + inset, rect.y + inset, innerW, innerH);
  } else if (d.kind === "frame-corners") {
    const len = Math.min(rect.w, rect.h) * 0.15;
    const o = sw / 2;
    const x1 = rect.x + o, y1 = rect.y + o;
    const x2 = rect.x + rect.w - o, y2 = rect.y + rect.h - o;
    ctx.beginPath();
    // TL
    ctx.moveTo(x1, y1); ctx.lineTo(x1 + len, y1);
    ctx.moveTo(x1, y1); ctx.lineTo(x1, y1 + len);
    // TR
    ctx.moveTo(x2, y1); ctx.lineTo(x2 - len, y1);
    ctx.moveTo(x2, y1); ctx.lineTo(x2, y1 + len);
    // BL
    ctx.moveTo(x1, y2); ctx.lineTo(x1 + len, y2);
    ctx.moveTo(x1, y2); ctx.lineTo(x1, y2 - len);
    // BR
    ctx.moveTo(x2, y2); ctx.lineTo(x2 - len, y2);
    ctx.moveTo(x2, y2); ctx.lineTo(x2, y2 - len);
    ctx.stroke();
  }
  ctx.restore();
}

/** Diagonalt kaklat "Arthena"-vattenmärke över ETT bildlagers rect, klippt
 *  till lagrets form. Anropas direkt efter att lagrets bild ritats så att
 *  senare lager (marginal, text, ram) hamnar ovanpå — exakt som i editorn
 *  där overlayen ligger inuti lagrets wrapper. Vit fyllning + mörk kantlinje
 *  syns på både ljusa och mörka motiv; storlek/täthet skalar med lagrets
 *  kortsida så previews och mockuper får samma visuella täthet. */
function drawLayerWatermark(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; w: number; h: number },
  shape: string,
): void {
  const base = Math.min(rect.w, rect.h);
  if (base < 24) return; // för litet för läsbar text
  const fontPx = Math.max(10, Math.round(base * 0.09));
  ctx.save();
  clipForShape(ctx, shape, rect.x, rect.y, rect.w, rect.h);
  ctx.font = `600 ${fontPx}px Inter, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.translate(rect.x + rect.w / 2, rect.y + rect.h / 2);
  ctx.rotate((-30 * Math.PI) / 180);
  const stepX = ctx.measureText("Arthena").width + fontPx * 2;
  const stepY = fontPx * 2.8;
  // Täck hela den roterade lagerytan — halva diagonalen räcker åt alla håll.
  const half = Math.hypot(rect.w, rect.h) / 2;
  ctx.lineWidth = Math.max(1, fontPx * 0.06);
  ctx.strokeStyle = "rgba(0, 0, 0, 0.18)";
  ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
  let row = 0;
  for (let y = -half; y <= half; y += stepY, row++) {
    const offset = row % 2 === 0 ? 0 : stepX / 2;
    for (let x = -half - stepX; x <= half + stepX; x += stepX) {
      ctx.strokeText("Arthena", x + offset, y);
      ctx.fillText("Arthena", x + offset, y);
    }
  }
  ctx.restore();
}

/**
 * Render the full template (all layers, in zIndex order) to a PNG/JPEG dataURL.
 * Map layers are rendered sequentially to avoid WebGL context exhaustion.
 */
export async function renderTemplateSnapshot(input: TemplateSnapshotInput): Promise<string> {
  const token = await getMapboxToken();
  if (!token) throw new Error("Mapbox token missing");
  mapboxgl.accessToken = token;

  const { wCm: frontWcm, hCm: frontHcm } = parseSize(input.size, input.orientation);
  const wrapCm = Math.max(0, input.wrapCm ?? 0);
  const bleedCm = Math.max(0, input.bleedCm ?? 0);
  const extraCm = wrapCm + bleedCm;
  const wCm = frontWcm + 2 * extraCm;
  const hCm = frontHcm + 2 * extraCm;

  const PX_PER_CM = input.hires ? 48 : 24;
  const MAX_PX = input.maxPxOverride ?? (input.hires ? pickHiresMaxPx() : 1800);
  const longestPx = Math.max(wCm, hCm) * PX_PER_CM;
  const scale = longestPx > MAX_PX ? MAX_PX / longestPx : 1;
  const w = Math.round(wCm * PX_PER_CM * scale);
  const h = Math.round(hCm * PX_PER_CM * scale);
  const pxPerMm = (PX_PER_CM * scale) / 10;

  // Front-zone rect (where layer % coords live). Canvas templates with the
  // legacy fullArea coord-space still anchor layers to the FULL surface;
  // post-migration canvas layouts are front-relative just like posters.
  const namedLayoutForCoord = (() => {
    // Resolve the active named layout to inspect its canvasLayout coordSpace.
    const all = (input.template.extraLayouts ?? []);
    const hit = input.layoutId && input.layoutId !== "default"
      ? all.find((l) => l.id === input.layoutId) : null;
    return hit ?? { canvasLayout: input.template.canvasLayout };
  })();
  const layersIncludeWrap =
    input.productType === "canvas" &&
    !!namedLayoutForCoord.canvasLayout &&
    namedLayoutForCoord.canvasLayout.coordSpace === "fullArea";
  const frontPxX = layersIncludeWrap ? 0 : Math.round(extraCm * PX_PER_CM * scale);
  const frontPxY = layersIncludeWrap ? 0 : Math.round(extraCm * PX_PER_CM * scale);
  const frontPxW = layersIncludeWrap ? w : Math.round(frontWcm * PX_PER_CM * scale);
  const frontPxH = layersIncludeWrap ? h : Math.round(frontHcm * PX_PER_CM * scale);
  const wrapPxExtra = layersIncludeWrap ? 0 : Math.round(extraCm * PX_PER_CM * scale);

  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("2D ctx unavailable");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  // Hänger-padding beräknas här för att matcha det som hängar-blocket nedan
  // använder. Resulterande padding tillämpas EFTER att motivet är ritat (se
  // efter hängar-blocket) genom att blitta hela `out` till en större canvas
  // och rita listerna + snöret i paddingytan. Påverkar bara cart-preview
  // för posters med vald hängare — ramvarianter och canvas/aluminium/akryl
  // är helt orörda.
  const hangerActive =
    !input.hires &&
    !!input.hangerColor &&
    (input.productType ?? "posters") === "posters" &&
    (wrapCm + bleedCm) === 0;

  // Background — full extended area (wrap inherits bg)
  ctx.fillStyle = input.livePosterBgColor || "#ffffff";
  ctx.fillRect(0, 0, w, h);

  // Sort layers by zIndex
  const layout = getActiveLayoutBlock(input.template, input.productType, input.layoutId)[input.orientation];
  const sortedByZ = [...layout.layers].sort((a, b) => a.zIndex - b.zIndex);
  // Margin must always render visually on top of all other layers, regardless
  // of its zIndex. Reorder so margin layers are drawn last.
  const allLayers = [
    ...sortedByZ.filter((l) => l.type !== "margin"),
    ...sortedByZ.filter((l) => l.type === "margin"),
  ];
  const marginEnabled = input.whiteMarginEnabled !== false;
  const marginInsets = getActiveMarginInsetsPct(allLayers, frontWcm, frontHcm);
  const marginRemovedInsets = !marginEnabled ? marginInsets : null;
  const layers = marginEnabled ? allLayers : allLayers.filter((l) => l.type !== "margin");

  // First map / text layer — used when no `layerValues` is provided so legacy
  // callers (cart pipeline) still produce the same output.
  const liveMapId = layers.find((l) => l.type === "map")?.id ?? null;
  const liveTextId = layers.find((l) => l.type === "text")?.id ?? null;

  // Vattenmärke per BILDLAGER — endast preview. Tryckfiler är alltid hires →
  // dubbelgarden gör flaggan verkningslös där (utöver force-off i
  // renderHiresTemplateSnapshotSafe).
  const layerWatermark = !!input.watermark && !input.hires;

  for (const layer of layers) {
    const t = input.layerTransforms?.[layer.id];
    const baseRect = {
      xPct: t?.xPct ?? layer.xPct,
      yPct: t?.yPct ?? layer.yPct,
      wPct: t?.wPct ?? layer.wPct,
      hPct: t?.hPct ?? layer.hPct,
    };
    const eff = marginRemovedInsets && layer.type !== "margin"
      ? expandRectForRemovedMargin(baseRect, marginRemovedInsets)
      : baseRect;
    const rect = {
      x: frontPxX + (eff.xPct / 100) * frontPxW,
      y: frontPxY + (eff.yPct / 100) * frontPxH,
      w: (eff.wPct / 100) * frontPxW,
      h: (eff.hPct / 100) * frontPxH,
    };
    // Bleed/wrap extension: front-relative full-bleed media (map / image /
    // photo / aiPhoto) that touches a front edge gets extended into the
    // wrap+bleed band so canvas edges never look empty regardless of size.
    const BLEED_EPS = 0.5;
    const bleedEligible =
      layer.type === "map" || layer.type === "image" ||
      layer.type === "photo" || layer.type === "aiPhoto";
    if (wrapPxExtra > 0 && bleedEligible) {
      if (eff.xPct <= BLEED_EPS) { rect.x -= wrapPxExtra; rect.w += wrapPxExtra; }
      if (eff.yPct <= BLEED_EPS) { rect.y -= wrapPxExtra; rect.h += wrapPxExtra; }
      if (eff.xPct + eff.wPct >= 100 - BLEED_EPS) { rect.w += wrapPxExtra; }
      if (eff.yPct + eff.hPct >= 100 - BLEED_EPS) { rect.h += wrapPxExtra; }
    }

    if (layer.type === "map") {
      const lv = input.layerValues?.[layer.id];
      const mv = lv && lv.kind === "map" ? lv : null;
      const isLive = layer.id === liveMapId;
      const center: [number, number] = mv
        ? mv.center
        : isLive
        ? input.liveMapCenter
        : [layer.defaults.center[0]!, layer.defaults.center[1]!];
      const zoom = mv ? mv.zoom : isLive ? input.liveMapZoom : layer.defaults.zoom;
      const styleId = mv ? mv.styleId : isLive ? input.liveMapStyleId : layer.defaults.styleId;
      const showLabels = mv ? mv.showLabels : isLive ? input.liveShowLabels : layer.defaults.showLabels;
      const shape = mv ? mv.shape : isLive ? input.liveMapShape : layer.defaults.shape;
      await drawMapLayer(ctx, rect, { center, zoom, styleId, showLabels, shape });
      const icons = (mv?.icons ?? []) as MapIcon[];
      await drawMapIcons(ctx, rect, shape, icons, center, zoom);
    } else if (layer.type === "text") {
      const lv = input.layerValues?.[layer.id];
      const tv = lv && lv.kind === "text" ? lv : null;
      const isLive = layer.id === liveTextId;
      const visible = tv ? tv.visible : isLive ? input.liveTextVisible : true;
      if (!visible) continue;
      const font = tv ? tv.font : isLive ? input.liveTextFont : layer.defaults.font;
      // Resolve effective text via the override-aware helper so customer
      // overrides win, but kartan vinner alltid (overrideText cleared by
      // applyPlaceInternal whenever the linked map updates).
      const mapId = layer.defaults.linkedMapLayerId;
      const mLv = mapId ? input.layerValues?.[mapId] : null;
      const mv2 = mLv && mLv.kind === "map" ? mLv : null;
      const place: LinkedPlace | null = mv2
        ? { placeName: mv2.placeName, city: mv2.city ?? null, country: mv2.country ?? null, center: mv2.center }
        : null;
      const overrideText = tv?.overrideText ?? (isLive ? input.liveText ?? null : null);
      const { text } = buildEffectiveTextWithSpans(layer.defaults, place, overrideText);
      drawTextLayer(ctx, rect, layer, text, font, Math.min(frontPxW, frontPxH), tv?.fontSizePt ?? null);
    } else if (layer.type === "image") {
      try {
        await drawImageLayer(ctx, rect, layer);
        if (layerWatermark && layer.defaults.url) {
          drawLayerWatermark(ctx, rect, layer.defaults.shape);
        }
      } catch (e) {
        console.warn("[template-snapshot] image layer failed", e);
      }
    } else if (layer.type === "photo") {
      const url =
        input.photoOverlays?.[layer.id] ??
        input.photoOverlayUrl ??
        layer.defaults.placeholderUrl;
      if (url) {
        const lv = input.layerValues?.[layer.id];
        const pv = lv && lv.kind === "photo" ? lv : null;
        const shape = pv?.shape ?? layer.defaults.shape;
        const offsetX = pv?.offsetX ?? 0;
        const offsetY = pv?.offsetY ?? 0;
        const zoom = pv?.zoom ?? 1;
        try {
          await drawPhotoLayer(ctx, rect, url, shape, layer.defaults.fit, offsetX, offsetY, zoom);
          if (layerWatermark) drawLayerWatermark(ctx, rect, shape);
        } catch (e) {
          console.warn("[template-snapshot] photo layer failed", e);
        }
      }
    } else if (layer.type === "aiPhoto") {
      const aiResultUrl = input.aiPhotoResults?.[layer.id] ?? null;
      const url = aiResultUrl ?? layer.defaults.referenceImageUrl;
      if (url) {
        const lv = input.layerValues?.[layer.id];
        const av = lv && lv.kind === "aiPhoto" ? lv : null;
        const shape = (av?.shape ?? layer.defaults.shape) as "rect" | "circle" | "heart" | "star";
        // Resolve admin focal for the active reference (face-swap result has
        // identical dimensions, so the focal applies cleanly). Falls back
        // to per-layer offset for placeholders / removeBg.
        const refList = layer.defaults.referenceImages ?? [];
        const activeRefUrl =
          input.aiPhotoSelectedRefUrl?.[layer.id] ?? layer.defaults.referenceImageUrl ?? null;
        const activeRef = activeRefUrl
          ? refList.find((r) => r.url === activeRefUrl) ?? null
          : null;
        const usingRefOrSwap = !!(aiResultUrl || activeRefUrl);
        const offsetX = usingRefOrSwap ? activeRef?.focalX ?? 0 : av?.offsetX ?? 0;
        const offsetY = usingRefOrSwap ? activeRef?.focalY ?? 0 : av?.offsetY ?? 0;
        const zoom = av?.zoom ?? 1;
        // Only force `contain` for removeBackground results (Nano Banana 2
        // may not perfectly match target aspect; its white padding blends in).
        // For human face-swap (Replicate preserves reference dimensions) and
        // pet swap (prompt enforces same aspect as reference), use the
        // layer's default fit so the print fills the layer exactly like the
        // reference image — matches the editor preview, no empty edges.
        const aiSubjectKind = layer.defaults.subjectKind ?? "human";
        const fit =
          aiResultUrl && aiSubjectKind === "removeBackground"
            ? "contain"
            : layer.defaults.fit;
        // removeBackground only: composite the per-layer backdropColor BEHIND
        // the (potentially transparent) AI result so alpha pixels reveal the
        // exact configured hex — not the global poster bg. Respects the
        // layer's shape clip so e.g. circle layers don't paint outside.
        const backdropColor = (layer.defaults as { backdropColor?: string })
          .backdropColor;
        if (aiResultUrl && aiSubjectKind === "removeBackground" && backdropColor) {
          ctx.save();
          clipForShape(ctx, shape, rect.x, rect.y, rect.w, rect.h);
          ctx.fillStyle = backdropColor;
          ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
          ctx.restore();
        }
        try {
          await drawPhotoLayer(ctx, rect, url, shape, fit, offsetX, offsetY, zoom);
          if (layerWatermark) drawLayerWatermark(ctx, rect, shape);
        } catch (e) {
          console.warn("[template-snapshot] aiPhoto layer failed", e);
        }
      }
    } else if (layer.type === "line") {
      drawLineLayer(ctx, rect, layer, pxPerMm, Math.min(frontPxW, frontPxH));
    } else if (layer.type === "shape") {
      drawShapeLayer(ctx, rect, layer, Math.min(frontPxW, frontPxH));
    } else if (layer.type === "margin") {
      // Margin frames the FRONT zone only — never the wrap/bleed band. This
      // matches the editor's dashed "Synlig framsida" rectangle and keeps the
      // 3D canvas wrap symmetric (motif extends out into the wrap unchanged).
      const frontRect = { x: frontPxX, y: frontPxY, w: frontPxW, h: frontPxH };
      const shortPx = Math.min(frontPxW, frontPxH);
      drawMarginLayer(ctx, frontRect, layer, pxPerMm, shortPx);
    }
  }

  // Frame / canvas-wrap overlay (preview/cart only — never on hires print).
  // Trätextur + geringar så cart-bilden matchar editorns FrameBorder.
  const hasFrame = !!input.frameColor && input.frameColor.trim() !== "";
  if (!input.hires && extraCm === 0 && hasFrame && (input.frameWidthCm ?? 0) > 0) {
    const fw = Math.max(1, Math.round((input.frameWidthCm ?? 1.2) * PX_PER_CM * scale));
    const texUrl = textureForHex(input.frameColor);
    let tex: HTMLImageElement | null = null;
    if (texUrl) {
      try { tex = await preloadTexture(texUrl); } catch { tex = null; }
    }
    ctx.save();
    const paintSide = (poly: Array<[number, number]>, rotate: boolean, sx: number, sy: number, sw: number, sh: number) => {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(poly[0][0], poly[0][1]);
      for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0], poly[i][1]);
      ctx.closePath();
      ctx.clip();
      if (tex) {
        if (rotate) {
          ctx.translate(sx + sw, sy);
          ctx.rotate(Math.PI / 2);
          ctx.drawImage(tex, 0, 0, sh, sw);
        } else {
          ctx.drawImage(tex, sx, sy, sw, sh);
        }
      } else {
        ctx.fillStyle = input.frameColor!;
        ctx.fillRect(sx, sy, sw, sh);
      }
      ctx.restore();
    };
    paintSide([[0, 0], [w, 0], [w - fw, fw], [fw, fw]], false, 0, 0, w, fw);
    paintSide([[fw, h - fw], [w - fw, h - fw], [w, h], [0, h]], false, 0, h - fw, w, fw);
    paintSide([[0, 0], [fw, fw], [fw, h - fw], [0, h]], true, 0, 0, fw, h);
    paintSide([[w - fw, fw], [w, 0], [w, h], [w - fw, h - fw]], true, w - fw, 0, fw, h);
    // 45°-ljusgradient över ramen för djup
    const fgrad = ctx.createLinearGradient(0, 0, w, h);
    fgrad.addColorStop(0, "rgba(255,255,255,0.20)");
    fgrad.addColorStop(0.5, "rgba(0,0,0,0)");
    fgrad.addColorStop(1, "rgba(0,0,0,0.24)");
    ctx.fillStyle = fgrad;
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.rect(fw + (w - 2 * fw), fw, -(w - 2 * fw), h - 2 * fw); // inre urklipp
    ctx.fill("evenodd");
    // Mitre-sömmar + ytterkant + innerläpp (matchar mockup-composite)
    ctx.strokeStyle = "rgba(0,0,0,0.16)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(fw, fw);
    ctx.moveTo(w, 0); ctx.lineTo(w - fw, fw);
    ctx.moveTo(0, h); ctx.lineTo(fw, h - fw);
    ctx.moveTo(w, h); ctx.lineTo(w - fw, h - fw);
    ctx.stroke();
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = Math.max(1, fw * 0.05);
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
    const lip = Math.max(1, fw * 0.14);
    ctx.strokeStyle = "rgba(255,255,255,0.28)";
    ctx.lineWidth = Math.max(1, lip * 0.6);
    ctx.strokeRect(fw - lip * 0.7, fw - lip * 0.7, w - 2 * fw + lip * 1.4, h - 2 * fw + lip * 1.4);
    ctx.strokeStyle = "rgba(0,0,0,0.45)";
    ctx.lineWidth = Math.max(1, fw * 0.08);
    ctx.strokeRect(fw - 0.5, fw - 0.5, w - 2 * fw + 1, h - 2 * fw + 1);
    ctx.restore();
  } else if (!input.hires && input.canvasWrap && extraCm === 0) {
    const edge = Math.max(2, Math.round(0.25 * PX_PER_CM * scale));
    ctx.save();
    const grad = (x0: number, y0: number, x1: number, y1: number) => {
      const g = ctx.createLinearGradient(x0, y0, x1, y1);
      g.addColorStop(0, "rgba(0,0,0,0.22)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      return g;
    };
    ctx.fillStyle = grad(0, 0, 0, edge);
    ctx.fillRect(0, 0, w, edge);
    ctx.fillStyle = grad(0, h, 0, h - edge);
    ctx.fillRect(0, h - edge, w, edge);
    ctx.fillStyle = grad(0, 0, edge, 0);
    ctx.fillRect(0, 0, edge, h);
    ctx.fillStyle = grad(w, 0, w - edge, 0);
    ctx.fillRect(w - edge, 0, edge, h);
    ctx.restore();
  }

  // Akryl-distanser i hörnen (preview/cart only) — spunnen metall, Gelato-mått.
  if (!input.hires && input.acrylicCorners && extraCm === 0) {
    const insetX = STUD_INSET_CM * PX_PER_CM * scale;
    const insetY = STUD_INSET_CM * PX_PER_CM * scale;
    const r = (STUD_DIAMETER_CM / 2) * PX_PER_CM * scale;
    const centers: [number, number][] = [
      [insetX, insetY],
      [w - insetX, insetY],
      [insetX, h - insetY],
      [w - insetX, h - insetY],
    ];
    for (const [cx, cy] of centers) {
      drawAcrylicStud(ctx, cx, cy, r);
    }
  }

  // Posterhängare — trälist topp+botten + snöre (preview/cart only).
  // Listerna ritas OVANPÅ motivets översta och nedersta ~21 mm (matchar
  // Gelatos faktiska produkt: 21mm trälist monterad på posterns front).
  // Endast snöret ritas utanför, så vi padar bara uppåt för det.
  if (hangerActive && extraCm === 0) {
    const color = input.hangerColor!;
    const slatH = Math.max(4, Math.round(2.1 * PX_PER_CM * scale));
    const slatOverhang = Math.round(slatH * 0.12);
    const cordRise = Math.max(slatH * 1.6, Math.round(1.4 * PX_PER_CM * scale));
    const padTop = Math.round(cordRise + slatH * 0.3);
    const padBottom = 0;
    const padX = slatOverhang;

    const finalW = w + padX * 2;
    const finalH = h + padTop + padBottom;
    const final = document.createElement("canvas");
    final.width = finalW;
    final.height = finalH;
    const fctx = final.getContext("2d");
    if (!fctx) throw new Error("2D ctx unavailable (hanger pad)");
    fctx.imageSmoothingEnabled = true;
    fctx.imageSmoothingQuality = "high";
    // Padding-bakgrund — vit för att matcha JPEG-utgång och Shopifys cart.
    fctx.fillStyle = "#ffffff";
    fctx.fillRect(0, 0, finalW, finalH);
    // Blitta motivet (oförändrat) på sin nya position.
    fctx.drawImage(out, padX, padTop);

    // Hängar-koordinater i `final` — relativt motivets topp/botten.
    const motifX = padX;
    const motifY = padTop;
    const motifW = w;
    const motifH = h;

    const drawSlat = (yTop: number) => {
      fctx.save();
      fctx.shadowColor = "rgba(0,0,0,0.28)";
      fctx.shadowBlur = Math.max(2, slatH * 0.4);
      fctx.shadowOffsetY = Math.max(1, slatH * 0.15);
      fctx.fillStyle = color;
      fctx.fillRect(motifX - slatOverhang, yTop, motifW + 2 * slatOverhang, slatH);
      fctx.restore();
      const grad = fctx.createLinearGradient(0, yTop, 0, yTop + slatH);
      grad.addColorStop(0, "rgba(255,255,255,0.22)");
      grad.addColorStop(0.5, "rgba(255,255,255,0)");
      grad.addColorStop(1, "rgba(0,0,0,0.28)");
      fctx.fillStyle = grad;
      fctx.fillRect(motifX - slatOverhang, yTop, motifW + 2 * slatOverhang, slatH);
      if (color.toLowerCase() === "#f5f5f2") {
        fctx.strokeStyle = "rgba(0,0,0,0.2)";
        fctx.lineWidth = 1;
        fctx.strokeRect(
          motifX - slatOverhang + 0.5,
          yTop + 0.5,
          motifW + 2 * slatOverhang - 1,
          slatH - 1,
        );
      }
    };
    // Topp-list INNANFÖR motivets överkant, botten-list INNANFÖR underkanten.
    const topSlatY = motifY;
    const botSlatY = motifY + motifH - slatH;
    drawSlat(topSlatY);
    drawSlat(botSlatY);

    // Snöre — triangulär båge från topp-listens överkant (= motivets överkant)
    // upp till `cordRise`. Ritas i padding-zonen ovanför motivet.
    fctx.save();
    fctx.beginPath();
    const cordLeftX = motifX - slatOverhang + slatH * 0.5;
    const cordRightX = motifX + motifW + slatOverhang - slatH * 0.5;
    fctx.moveTo(cordLeftX, topSlatY);
    fctx.quadraticCurveTo(motifX + motifW / 2, topSlatY - cordRise, cordRightX, topSlatY);
    fctx.lineWidth = Math.max(1.5, slatH * 0.18);
    fctx.strokeStyle = "rgba(40,30,20,0.78)";
    fctx.lineCap = "round";
    fctx.stroke();
    fctx.restore();

    const dataUrl = final.toDataURL("image/jpeg", 0.95);
    if (!dataUrl || dataUrl.length < 1000) {
      throw new Error("Empty template snapshot (hanger)");
    }
    return dataUrl;
  }

  const dataUrl = out.toDataURL("image/jpeg", 0.95);
  if (!dataUrl || dataUrl.length < 1000) {
    throw new Error("Empty template snapshot");
  }
  return dataUrl;
}

/**
 * Hires snapshot with one retry at 70 % size if the first attempt fails
 * (typically WebGL context loss on weaker GPUs / very large posters).
 */
export async function renderHiresTemplateSnapshotSafe(
  input: TemplateSnapshotInput,
): Promise<TemplateSnapshotResult> {
  const t0 = performance.now();
  let lastErr: unknown = null;
  const initialMax = pickHiresMaxPx();
  const attempts = [initialMax, Math.round(initialMax * 0.7)];
  for (const maxPx of attempts) {
    try {
      const dataUrl = await renderTemplateSnapshot({
        ...input,
        hires: true,
        maxPxOverride: maxPx,
        // Never bake frame/wrap/acrylic-corners into print files.
        frameColor: undefined,
        hangerColor: undefined,
        frameWidthCm: undefined,
        canvasWrap: false,
        acrylicCorners: false,
        // Vattenmärket får ALDRIG följa med i tryckfilen — nolla oavsett caller.
        watermark: false,
      });
      const base64 = dataUrl.split(",")[1] ?? "";
      const sizeBytes = Math.round((base64.length * 3) / 4);
      const dims = await new Promise<{ w: number; h: number }>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve({ w: img.width, h: img.height });
        img.onerror = () => reject(new Error("dim probe failed"));
        img.src = dataUrl;
      });
      const ms = Math.round(performance.now() - t0);
      console.info(
        `[print-pipeline] template snapshot ok: ${dims.w}×${dims.h}px, ${(sizeBytes / 1024 / 1024).toFixed(2)}MB, ${ms}ms (maxPx=${maxPx})`,
      );
      return { dataUrl, widthPx: dims.w, heightPx: dims.h, sizeBytes };
    } catch (e) {
      console.warn(`[print-pipeline] template snapshot failed at maxPx=${maxPx}, retrying…`, e);
      lastErr = e;
    }
  }
  throw new Error(
    `Hi-res template snapshot failed: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
  );
}
