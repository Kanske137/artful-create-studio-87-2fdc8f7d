// Kilometertider som liggande staplar, uppifrån och ned km för km. Samma
// funktion i editorn och tryckfilen. Längre stapel = snabbare kilometer;
// en tunn streckad linje markerar snittempot.
import { resolveFontPx } from "@/lib/text-typography";
import type { SplitsDefaults } from "@/lib/template-schema";
import { formatPaceShort } from "./format";
import type { RaceSplit } from "./types";

type Rect = { x: number; y: number; w: number; h: number };

/** Slå ihop per 5 km när det blir många rader (auto) eller om mallen vill. */
export function groupSplits(splits: RaceSplit[], group: SplitsDefaults["group"]): RaceSplit[] {
  const step = group === "5" || (group === "auto" && splits.length > 25) ? 5 : 1;
  if (step === 1) return splits;
  const out: RaceSplit[] = [];
  for (let i = 0; i < splits.length; i += step) {
    const chunk = splits.slice(i, i + step);
    const last = chunk[chunk.length - 1]!;
    out.push({
      km: last.km,
      distKm: chunk.reduce((a, s) => a + s.distKm, 0),
      seconds: chunk.reduce((a, s) => a + s.seconds, 0),
    });
  }
  return out;
}

function hexA(hex: string, a: number): string {
  const h = hex.replace("#", "");
  return `rgba(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)}, ${a})`;
}

export function drawSplits(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  splitsIn: RaceSplit[],
  d: SplitsDefaults,
  routeColor: string,
  canvasShortPx: number,
): void {
  const splits = groupSplits(splitsIn, d.group);
  if (splits.length === 0 || rect.w <= 0 || rect.h <= 0) return;
  const color = d.color ?? routeColor;
  const paces = splits.map((s) => s.seconds / s.distKm);
  const speeds = paces.map((p) => 1 / p);
  const minS = Math.min(...speeds), maxS = Math.max(...speeds);
  const avgPace = splits.reduce((a, s) => a + s.seconds, 0) / splits.reduce((a, s) => a + s.distKm, 0);

  const rowH = rect.h / splits.length;
  const fontPx = Math.min(resolveFontPx({ fontSizePt: d.labelSizePt }, canvasShortPx), rowH * 0.8);
  const font = (w: number) => `${w} ${fontPx}px "${d.font}"`;
  ctx.save();
  ctx.textBaseline = "middle";
  ctx.font = font(500);
  const kmLabel = (s: RaceSplit) => (Number.isInteger(s.km) ? String(s.km) : s.km.toFixed(1).replace(".", ","));
  const labelW = Math.max(...splits.map((s) => ctx.measureText(kmLabel(s)).width));
  const paceW = d.showPace ? Math.max(...paces.map((p) => ctx.measureText(formatPaceShort(p)).width)) : 0;
  const gap = fontPx * 0.7;
  const x0 = rect.x + labelW + gap;
  const x1 = rect.x + rect.w - (d.showPace ? paceW + gap : 0);
  const span = Math.max(1, x1 - x0);
  const minFrac = 0.3;
  const lenOf = (sp: number) => span * (minFrac + (1 - minFrac) * (maxS > minS ? (sp - minS) / (maxS - minS) : 1));
  // Etiketter på varje rad när det får plats, annars var 5:e km + sista.
  const everyRow = rowH >= fontPx * 1.15;
  const barH = Math.max(1, rowH * d.barFill);

  splits.forEach((s, i) => {
    const cy = rect.y + rowH * (i + 0.5);
    const len = lenOf(speeds[i]!);
    // Stapel: rundade ändar, full färg för snabbare än snitt, dämpad annars.
    ctx.fillStyle = paces[i]! <= avgPace ? color : hexA(color, 0.55);
    const r = Math.min(barH / 2, len / 2);
    ctx.beginPath();
    ctx.moveTo(x0 + r, cy - barH / 2);
    ctx.lineTo(x0 + len - r, cy - barH / 2);
    ctx.arc(x0 + len - r, cy, r, -Math.PI / 2, Math.PI / 2);
    ctx.lineTo(x0 + r, cy + barH / 2);
    ctx.arc(x0 + r, cy, r, Math.PI / 2, (3 * Math.PI) / 2);
    ctx.closePath();
    ctx.fill();
    const showLabel = everyRow || (Number.isInteger(s.km) && s.km % 5 === 0) || i === splits.length - 1;
    if (showLabel) {
      ctx.fillStyle = d.labelColor;
      ctx.font = font(500);
      ctx.textAlign = "right";
      ctx.fillText(kmLabel(s), rect.x + labelW, cy);
      if (d.showPace) {
        ctx.textAlign = "left";
        ctx.fillText(formatPaceShort(paces[i]!), x1 + gap, cy);
      }
    }
  });

  if (d.showAverage) {
    const ax = x0 + lenOf(1 / avgPace);
    ctx.strokeStyle = hexA(d.labelColor, 0.7);
    ctx.lineWidth = Math.max(1, fontPx * 0.08);
    ctx.setLineDash([fontPx * 0.3, fontPx * 0.3]);
    ctx.beginPath();
    ctx.moveTo(ax, rect.y);
    ctx.lineTo(ax, rect.y + rect.h);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
}
