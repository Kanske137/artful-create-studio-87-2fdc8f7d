import { describe, expect, it } from "vitest";
import { mapPrintView, mapReferencePxPerCm } from "./map-print-view";

// Synlig bredd i "världsenheter" ∝ CSS-bredd / 2^zoom.
const span = (cssW: number, zoom: number) => cssW / Math.pow(2, zoom);

describe("mapReferencePxPerCm", () => {
  it("följer kundvagnsbilden: 24 px/cm, högst 1800 px långsida", () => {
    expect(mapReferencePxPerCm(30, 40)).toBe(24);
    expect(mapReferencePxPerCm(100, 70)).toBeCloseTo(18);
  });
});

describe("mapPrintView", () => {
  const rect = { x: 0, y: 0, w: 4800, h: 3360 };

  it("tryckfil 70×100: samma område som editorns 800 px breda ruta", () => {
    const k = 48 / mapReferencePxPerCm(100, 70); // ≈ 2,67
    const v = mapPrintView({ rect, front: rect, zoom: 12.69, viewWidthPx: 800, pixelRatio: k });
    expect(v.cssW).toBeCloseTo(1800);
    expect(v.cssW * v.pixelRatio).toBeCloseTo(4800);
    expect(span(v.cssW, v.zoom)).toBeCloseTo(span(800, 12.69));
  });

  it("äldre design utan rutbredd: samma område som kundvagnsbilden", () => {
    const k = 48 / 18;
    const v = mapPrintView({ rect, front: rect, zoom: 12.69, pixelRatio: k });
    expect(v.zoom).toBe(12.69);
    expect(v.cssW).toBeCloseTo(1800);
  });

  it("utfall på ena sidan flyttar inte kundens mittpunkt", () => {
    const front = { x: 100, y: 0, w: 1000, h: 800 };
    const ext = { x: 0, y: 0, w: 1100, h: 800 }; // förlängd åt vänster
    const v = mapPrintView({ rect: ext, front, zoom: 10, viewWidthPx: 500, pixelRatio: 2 });
    // Lagrets mitt (600) ligger 50 px höger om ytans mitt (550) → 25 CSS-px.
    expect(v.frontCenterOffsetCss).toEqual({ x: 25, y: 0 });
    expect(span(front.w / 2, v.zoom)).toBeCloseTo(span(500, 10));
  });
});
