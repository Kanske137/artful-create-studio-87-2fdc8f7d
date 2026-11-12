// @deprecated — Single-layer legacy renderer. Use `renderTemplateSnapshot`
// from `./template-snapshot` instead. Kept temporarily for any straggling
// callers; safe to delete once nothing imports `renderArtworkSnapshot` /
// `renderHiresSnapshotSafe`.
import mapboxgl from "mapbox-gl";
import { getMapboxToken, styleUrl } from "./mapbox";
import { isRouteLayerId } from "./race/route-map";
import type { MapShape } from "@/stores/editorStore";
import type { LayoutDef } from "./product-config";

export interface SnapshotInput {
  mapStyleId: string;
  mapCenter: [number, number];
  mapZoom: number;
  showLabels: boolean;
  mapShape: MapShape;
  posterBgColor: string;
  text: string;
  textFont: string;
  textVisible: boolean;
  size: string;            // "30x40"
  orientation: "portrait" | "landscape";
  layout: LayoutDef | null; // for text x/y placement (matches editor)
  /** Canvas wrap depth in cm. When > 0, output texture is extended with wrap+bleed
   *  zones around the visible front, so 3D preview can sample wrap-around faces
   *  exactly like Gelato's print file. */
  wrapCm?: number;
  /** Bleed in cm added outside the wrap zone (Gelato canvas = 0.3 cm). */
  bleedCm?: number;
  /** Frame color (CSS string). Empty = no frame. Drawn ON TOP of the artwork
   *  so the cart thumbnail matches the editor preview. */
  frameColor?: string;
  /** Frame width in cm (poster only). */
  frameWidthCm?: number;
  /** When true, render a canvas wrap shadow on the sides instead of a flat frame. */
  canvasWrap?: boolean;
  /** When true, render at print resolution. Resolution is adaptive based on
   *  device capability (mobile=2000px, desktop=3000px, hi-DPI desktop=3600px). */
  hires?: boolean;
  /** Override max longest side (px). Used by retry-on-WebGL-fail logic. */
  maxPxOverride?: number;
}

export interface SnapshotResult {
  dataUrl: string;
  widthPx: number;
  heightPx: number;
  sizeBytes: number;
}

/** GPU-aware max pixel budget for hi-res print snapshots. */
function pickHiresMaxPx(): number {
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(ua);
  if (isMobile) return 2000;          // ~167 DPI on 30 cm — Gelato-approved
  if (dpr >= 2) return 3600;
  return 3000;
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

/** parse "85%"/"50%" → fraction. Returns 0.5 if invalid. */
function parsePct(v: string | undefined, fallback: number): number {
  if (!v) return fallback;
  const m = v.match(/([\d.]+)\s*%/);
  if (m) return parseFloat(m[1]) / 100;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

function createOffscreenContainer(w: number, h: number): HTMLDivElement {
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

/**
 * Renders the artwork offscreen using Mapbox GL JS (same engine as the editor),
 * waits until tiles are loaded + style is idle, captures the WebGL canvas,
 * then composites bg + shape clip + text on a 2D canvas.
 */
export async function renderArtworkSnapshot(input: SnapshotInput): Promise<string> {
  const token = await getMapboxToken();
  if (!token) throw new Error("Mapbox token missing");
  mapboxgl.accessToken = token;

  const { wCm: frontWcm, hCm: frontHcm } = parseSize(input.size, input.orientation);
  const wrapCm = Math.max(0, input.wrapCm ?? 0);
  const bleedCm = Math.max(0, input.bleedCm ?? 0);
  const extraCm = wrapCm + bleedCm; // per side
  const wCm = frontWcm + 2 * extraCm;
  const hCm = frontHcm + 2 * extraCm;

  // Render at ~24px/cm baseline. Scale UNIFORMLY so longest side <= MAX_PX,
  // preserving aspect ratio. In hires mode (print files), bump both — but
  // adaptively based on device capability to avoid GPU context loss on mobile.
  const PX_PER_CM = input.hires ? 32 : 24;
  const MAX_PX = input.maxPxOverride ?? (input.hires ? pickHiresMaxPx() : 1800);
  const longestPx = Math.max(wCm, hCm) * PX_PER_CM;
  const scale = longestPx > MAX_PX ? MAX_PX / longestPx : 1;
  const w = Math.round(wCm * PX_PER_CM * scale);
  const h = Math.round(hCm * PX_PER_CM * scale);
  // Pixel offsets of the inner FRONT zone (where motif clip + text live)
  const frontPxX = Math.round(extraCm * PX_PER_CM * scale);
  const frontPxY = Math.round(extraCm * PX_PER_CM * scale);
  const frontPxW = Math.round(frontWcm * PX_PER_CM * scale);
  const frontPxH = Math.round(frontHcm * PX_PER_CM * scale);

  // Map renders in shape-aware container. With wrap, the map ALWAYS covers the
  // full extended canvas as a rect (wrap continues the map outside the front).
  const useShapeClip = extraCm === 0 && (input.mapShape as string) !== "rect";
  const sq = Math.min(frontPxW, frontPxH);
  const mapW = useShapeClip ? Math.min(w, h) : w;
  const mapH = useShapeClip ? Math.min(w, h) : h;

  const container = createOffscreenContainer(Math.max(w, mapW), Math.max(h, mapH));
  const mapDiv = document.createElement("div");
  mapDiv.style.width = `${mapW}px`;
  mapDiv.style.height = `${mapH}px`;
  container.appendChild(mapDiv);

  let map: mapboxgl.Map | null = null;
  try {
    map = new mapboxgl.Map({
      container: mapDiv,
      style: styleUrl(input.mapStyleId),
      center: input.mapCenter,
      zoom: input.mapZoom,
      interactive: false,
      attributionControl: false,
      preserveDrawingBuffer: true, // REQUIRED for canvas.toDataURL/getImageData
      fadeDuration: 0,
    });

    // Wait for style + tiles
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error("Map render timeout")), 15000);
      map!.once("error", (e) => {
        window.clearTimeout(timeout);
        reject(new Error(`Mapbox error: ${(e as any)?.error?.message ?? "unknown"}`));
      });
      map!.on("idle", () => {
        window.clearTimeout(timeout);
        resolve();
      });
    });

    // Apply label visibility
    try {
      const style = map.getStyle();
      if (style?.layers) {
        for (const layer of style.layers) {
          if (isRouteLayerId(layer.id)) continue;
          if (layer.type === "symbol" || layer.id.startsWith("label-")) {
            map.setLayoutProperty(layer.id, "visibility", input.showLabels ? "visible" : "none");
          }
        }
      }
      // Wait two idle cycles for label changes + tile redraw to settle
      for (let i = 0; i < 2; i++) {
        await new Promise<void>((resolve) => {
          const t = window.setTimeout(() => resolve(), 1500);
          map!.once("idle", () => {
            window.clearTimeout(t);
            resolve();
          });
        });
      }
    } catch (e) {
      console.warn("[snapshot] label toggle failed", e);
    }

    const mapCanvas = map.getCanvas();

    // Composite onto final 2D canvas
    const out = document.createElement("canvas");
    out.width = w;
    out.height = h;
    const ctx = out.getContext("2d");
    if (!ctx) throw new Error("2D ctx unavailable");

    // Background fills the entire extended print area (wrap+bleed inherit bg)
    ctx.fillStyle = input.posterBgColor || "#ffffff";
    ctx.fillRect(0, 0, w, h);

    if (extraCm > 0) {
      // WRAP MODE (canvas): map is drawn ONLY in the front zone. Wrap + bleed
      // zones keep the bg color so the 3D preview's sides show bg, exactly
      // matching the editor.
      ctx.save();
      const fsq = Math.min(frontPxW, frontPxH);
      const fcx = frontPxX + frontPxW / 2;
      const fcy = frontPxY + frontPxH / 2;
      if (input.mapShape === "circle") {
        ctx.beginPath();
        ctx.arc(fcx, fcy, fsq / 2, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(mapCanvas, fcx - fsq / 2, fcy - fsq / 2, fsq, fsq);
      } else if ((input.mapShape as string) === "square") {
        ctx.beginPath();
        ctx.rect(fcx - fsq / 2, fcy - fsq / 2, fsq, fsq);
        ctx.clip();
        ctx.drawImage(mapCanvas, fcx - fsq / 2, fcy - fsq / 2, fsq, fsq);
      } else {
        ctx.beginPath();
        ctx.rect(frontPxX, frontPxY, frontPxW, frontPxH);
        ctx.clip();
        ctx.drawImage(mapCanvas, frontPxX, frontPxY, frontPxW, frontPxH);
      }
      ctx.restore();
    } else {
      // POSTER MODE (no wrap): existing shape-aware clipping
      ctx.save();
      if (input.mapShape === "circle") {
        const r = sq / 2;
        ctx.beginPath();
        ctx.arc(w / 2, h / 2, r, 0, Math.PI * 2);
        ctx.clip();
      } else if ((input.mapShape as string) === "square") {
        const sx = (w - sq) / 2;
        const sy = (h - sq) / 2;
        ctx.beginPath();
        ctx.rect(sx, sy, sq, sq);
        ctx.clip();
      }
      if ((input.mapShape as string) === "rect") {
        ctx.drawImage(mapCanvas, 0, 0, w, h);
      } else {
        const dx = (w - sq) / 2;
        const dy = (h - sq) / 2;
        ctx.drawImage(mapCanvas, dx, dy, sq, sq);
      }
      ctx.restore();
    }

    // Text overlay — always positioned within the FRONT zone so the visible
    // front matches the editor exactly (wrap mode just offsets the front).
    if (input.textVisible && input.text.trim()) {
      const lines = input.text.split("\n");
      const layer = input.layout?.layers?.find((l) => l.type === "text");
      const tx = frontPxX + frontPxW * parsePct(layer?.x, 0.5);
      const yFrac = parsePct(layer?.y, 0.86);

      // Match editor: ~2.8% of FRONT width
      const fontSize = Math.round(frontPxW * 0.028);
      const lineHeight = Math.round(fontSize * 1.15);
      const totalH = lineHeight * lines.length;
      const centerY = frontPxY + frontPxH * yFrac;
      const firstLineCenter = centerY - totalH / 2 + lineHeight / 2;

      ctx.save();
      ctx.fillStyle = "#1a1a1a";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `500 ${fontSize}px ${input.textFont}, Inter, sans-serif`;
      lines.forEach((line, i) => {
        ctx.fillText(line, tx, firstLineCenter + i * lineHeight);
      });
      ctx.restore();
    }

    // Frame / canvas wrap overlay — drawn last so it appears on top.
    // Only applies in poster (no wrap) mode; canvas wrap mode already extends the
    // texture and the 3D preview handles the depth, so we add a soft side shadow.
    const hasFrame = !!input.frameColor && input.frameColor.trim() !== "";
    if (!input.hires && extraCm === 0 && hasFrame && (input.frameWidthCm ?? 0) > 0) {
      const fw = Math.max(1, Math.round((input.frameWidthCm ?? 1.2) * PX_PER_CM * scale));
      ctx.save();
      ctx.fillStyle = input.frameColor!;
      // top, bottom, left, right
      ctx.fillRect(0, 0, w, fw);
      ctx.fillRect(0, h - fw, w, fw);
      ctx.fillRect(0, 0, fw, h);
      ctx.fillRect(w - fw, 0, fw, h);
      // subtle inner shadow line for depth
      ctx.strokeStyle = "rgba(0,0,0,0.18)";
      ctx.lineWidth = Math.max(1, Math.round(fw * 0.06));
      ctx.strokeRect(fw, fw, w - 2 * fw, h - 2 * fw);
      ctx.restore();
    } else if (!input.hires && input.canvasWrap && extraCm === 0) {
      // Canvas wrap (no extended texture): paint a soft inner shadow on edges so
      // the cart thumbnail reads as a stretched canvas, not a flat poster.
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

    const dataUrl = out.toDataURL("image/jpeg", 0.92);
    if (!dataUrl || dataUrl.length < 1000) {
      throw new Error("Empty snapshot — canvas.toDataURL returned no data");
    }
    return dataUrl;
  } finally {
    try {
      map?.remove();
    } catch {
      /* noop */
    }
    if (container.parentNode) container.parentNode.removeChild(container);
  }
}

/**
 * Hires snapshot with one retry at 70 % size if the first attempt fails
 * (typically WebGL context loss on weaker GPUs / very large posters).
 * Throws on final failure — caller MUST handle and abort the user action.
 */
export async function renderHiresSnapshotSafe(input: SnapshotInput): Promise<SnapshotResult> {
  const t0 = performance.now();
  let lastErr: unknown = null;
  const initialMax = pickHiresMaxPx();
  const attempts = [initialMax, Math.round(initialMax * 0.7)];
  for (const maxPx of attempts) {
    try {
      const dataUrl = await renderArtworkSnapshot({ ...input, hires: true, maxPxOverride: maxPx });
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
        `[print-pipeline] map snapshot ok: ${dims.w}×${dims.h}px, ${(sizeBytes / 1024 / 1024).toFixed(2)}MB, ${ms}ms (maxPx=${maxPx})`
      );
      return { dataUrl, widthPx: dims.w, heightPx: dims.h, sizeBytes };
    } catch (e) {
      console.warn(`[print-pipeline] snapshot failed at maxPx=${maxPx}, retrying smaller…`, e);
      lastErr = e;
    }
  }
  throw new Error(
    `Hi-res snapshot failed after retries: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`
  );
}
