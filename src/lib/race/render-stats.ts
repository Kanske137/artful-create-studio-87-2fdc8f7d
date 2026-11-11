// Statistikraden (distans, tid, tempo, startnr, placering) ritad på canvas.
// Samma funktion i editorn och tryckfilen. Avstängda värden finns inte i
// `items`, så de kvarvarande fördelas jämnt.
import { mmToPx, resolveFontPx } from "@/lib/text-typography";
import type { RaceStatsDefaults } from "@/lib/template-schema";
import type { RaceStatItem } from "./derive";

type Rect = { x: number; y: number; w: number; h: number };

function fontCss(px: number, family: string, weight: number): string {
  return `${weight} ${px}px "${family}"`;
}

/** Ladda typsnitten innan ritning (annars ritar canvas med fallback-font). */
export async function ensureRaceStatsFonts(d: RaceStatsDefaults): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return;
  try {
    await Promise.all([
      document.fonts.load(fontCss(20, d.valueFont, 600)),
      document.fonts.load(fontCss(20, d.labelFont, 500)),
    ]);
  } catch {
    /* fallback-font duger hellre än att krascha */
  }
}

function spacedWidth(ctx: CanvasRenderingContext2D, text: string, spacingPx: number): number {
  if (!text) return 0;
  return ctx.measureText(text).width + spacingPx * Math.max(0, text.length - 1);
}

/** Rita text med manuell bokstavsavstånd (canvas letterSpacing stöds ojämnt). */
function fillSpaced(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  spacingPx: number,
  align: "left" | "center" | "right",
): void {
  const total = spacedWidth(ctx, text, spacingPx);
  let cx = align === "center" ? x - total / 2 : align === "right" ? x - total : x;
  const prevAlign = ctx.textAlign;
  ctx.textAlign = "left";
  if (spacingPx === 0) {
    ctx.fillText(text, cx, y);
  } else {
    for (const ch of text) {
      ctx.fillText(ch, cx, y);
      cx += ctx.measureText(ch).width + spacingPx;
    }
  }
  ctx.textAlign = prevAlign;
}

/** Krymp fontstorleken tills texten får plats i `maxW`. */
function fitPx(
  ctx: CanvasRenderingContext2D,
  text: string,
  basePx: number,
  family: string,
  weight: number,
  spacingEm: number,
  maxW: number,
): number {
  let px = basePx;
  for (let i = 0; i < 12; i++) {
    ctx.font = fontCss(px, family, weight);
    if (spacedWidth(ctx, text, spacingEm * px) <= maxW) return px;
    px *= 0.9;
  }
  return px;
}

export function resolveArrange(d: RaceStatsDefaults, rect: Rect): "row" | "column" {
  if (d.arrange === "row" || d.arrange === "column") return d.arrange;
  return rect.w >= rect.h ? "row" : "column";
}

export function drawRaceStats(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  items: RaceStatItem[],
  d: RaceStatsDefaults,
  canvasShortPx: number,
): void {
  if (items.length === 0 || rect.w <= 0 || rect.h <= 0) return;
  const valuePx0 = resolveFontPx({ fontSizePt: d.valueSizePt }, canvasShortPx);
  const labelPx0 = resolveFontPx({ fontSizePt: d.labelSizePt }, canvasShortPx);
  const spacing = d.letterSpacingEm ?? 0.08;
  const labelColor = d.labelColor ?? d.color;
  const dividerColor = d.dividerColor ?? labelColor;
  const dividerPx = Math.max(1, mmToPx(0.25, canvasShortPx));
  const arrange = resolveArrange(d, rect);

  ctx.save();
  ctx.textBaseline = "alphabetic";

  if (arrange === "row") {
    const colW = rect.w / items.length;
    const pad = colW * 0.06;
    // Gemensam storlek för alla värden (den minsta som får plats) → jämn rad.
    let valuePx = valuePx0;
    for (const it of items) {
      valuePx = Math.min(valuePx, fitPx(ctx, it.value, valuePx0, d.valueFont, 600, 0, colW - 2 * pad));
    }
    const labelPx = Math.min(labelPx0, valuePx * 0.6);
    const gap = labelPx * 0.7;
    const blockH = labelPx + gap + valuePx;
    const top = rect.y + Math.max(0, (rect.h - blockH) / 2);
    items.forEach((it, i) => {
      const cx = rect.x + colW * (i + 0.5);
      ctx.fillStyle = labelColor;
      ctx.font = fontCss(labelPx, d.labelFont, 500);
      fillSpaced(ctx, it.label, cx, top + labelPx, spacing * labelPx, "center");
      ctx.fillStyle = d.color;
      ctx.font = fontCss(valuePx, d.valueFont, 600);
      fillSpaced(ctx, it.value, cx, top + labelPx + gap + valuePx * 0.92, 0, "center");
      if (d.dividers && i > 0) {
        ctx.fillStyle = dividerColor;
        ctx.globalAlpha = 0.35;
        const x = rect.x + colW * i - dividerPx / 2;
        ctx.fillRect(x, top, dividerPx, blockH);
        ctx.globalAlpha = 1;
      }
    });
  } else {
    const rowH = rect.h / items.length;
    let valuePx = Math.min(valuePx0, rowH * 0.6);
    for (const it of items) {
      valuePx = Math.min(valuePx, fitPx(ctx, it.value, valuePx, d.valueFont, 600, 0, rect.w * 0.6));
    }
    const labelPx = Math.min(labelPx0, valuePx * 0.6);
    items.forEach((it, i) => {
      const baseline = rect.y + rowH * i + rowH / 2 + valuePx * 0.35;
      ctx.fillStyle = labelColor;
      ctx.font = fontCss(labelPx, d.labelFont, 500);
      fillSpaced(ctx, it.label, rect.x, baseline, spacing * labelPx, "left");
      ctx.fillStyle = d.color;
      ctx.font = fontCss(valuePx, d.valueFont, 600);
      fillSpaced(ctx, it.value, rect.x + rect.w, baseline, 0, "right");
      if (d.dividers && i > 0) {
        ctx.fillStyle = dividerColor;
        ctx.globalAlpha = 0.35;
        ctx.fillRect(rect.x, rect.y + rowH * i - dividerPx / 2, rect.w, dividerPx);
        ctx.globalAlpha = 1;
      }
    });
  }
  ctx.restore();
}
