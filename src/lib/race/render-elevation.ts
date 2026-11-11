// Höjdprofil ritad på canvas. Samma funktion används i editorn (egen
// <canvas>) och i tryckfilen (template-snapshot) — identiskt resultat.
import { mmToPx } from "@/lib/text-typography";
import type { ElevationDefaults } from "@/lib/template-schema";

/** Minsta höjdspann som visas — platta banor ska se platta ut. */
const MIN_RANGE_M = 30;

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function drawElevationProfile(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; w: number; h: number },
  series: number[],
  d: ElevationDefaults,
  routeColor: string,
  canvasShortPx: number,
): void {
  if (series.length < 2 || rect.w <= 0 || rect.h <= 0) return;
  const color = d.color ?? routeColor;
  const fill = d.fillColor ?? color;
  const strokePx = Math.max(1, mmToPx(d.thicknessMm ?? 0.6, canvasShortPx));

  let min = Infinity, max = -Infinity;
  for (const v of series) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (max - min < MIN_RANGE_M) {
    const mid = (max + min) / 2;
    min = mid - MIN_RANGE_M / 2;
    max = mid + MIN_RANGE_M / 2;
  }
  const top = rect.y + strokePx;
  const bottom = rect.y + rect.h;
  const usableH = Math.max(1, bottom - top);
  const xAt = (i: number) => rect.x + (rect.w * i) / (series.length - 1);
  const yAt = (v: number) => bottom - ((v - min) / (max - min)) * usableH;

  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.clip();

  // Yta
  ctx.beginPath();
  ctx.moveTo(xAt(0), bottom);
  for (let i = 0; i < series.length; i++) ctx.lineTo(xAt(i), yAt(series[i]!));
  ctx.lineTo(xAt(series.length - 1), bottom);
  ctx.closePath();
  ctx.fillStyle = hexToRgba(fill, d.fillOpacity ?? 0.18);
  ctx.fill();

  // Linje
  ctx.beginPath();
  for (let i = 0; i < series.length; i++) {
    const x = xAt(i), y = yAt(series[i]!);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = strokePx;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke();
  ctx.restore();
}
