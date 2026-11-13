import { describe, expect, it } from "vitest";
import { mapPrintView, mapReferencePxPerCm } from "./map-print-view";

describe("mapReferencePxPerCm", () => {
  it("följer kundvagnsbilden: 24 px/cm, högst 1800 px långsida", () => {
    expect(mapReferencePxPerCm(30, 40)).toBe(24);
    expect(mapReferencePxPerCm(100, 70)).toBeCloseTo(18);
  });
});

describe("mapPrintView", () => {
  const rect = { x: 0, y: 0, w: 4800, h: 3360 };

  it("tryckfil: kartan ritas i editorns rutbredd med kundens zoom, uppskalad", () => {
    const v = mapPrintView({ rect, front: rect, zoom: 12.69, viewWidthPx: 800, referencePxPerCssPx: 48 / 18 });
    expect(v.cssW).toBeCloseTo(800);
    expect(v.zoom).toBe(12.69);
    expect(v.devicePixelRatio).toBeCloseTo(6);
    expect(v.cssW * v.devicePixelRatio).toBeCloseTo(4800);
  });

  it("liten bild (kundvagn): ritas i editorns bredd med DPR 1 och skalas ned", () => {
    const small = { x: 0, y: 0, w: 312, h: 432 };
    const v = mapPrintView({ rect: small, front: small, zoom: 14.2, viewWidthPx: 474, referencePxPerCssPx: 1 });
    expect(v.cssW).toBeCloseTo(474);
    expect(v.devicePixelRatio).toBe(1);
    expect(v.zoom).toBe(14.2);
  });

  it("äldre design utan rutbredd: kundvagnsbildens täthet", () => {
    const v = mapPrintView({ rect, front: rect, zoom: 12.69, referencePxPerCssPx: 48 / 18 });
    expect(v.zoom).toBe(12.69);
    expect(v.cssW).toBeCloseTo(1800);
    expect(v.devicePixelRatio).toBeCloseTo(48 / 18);
  });

  it("utfall på ena sidan flyttar inte kundens mittpunkt", () => {
    const front = { x: 100, y: 0, w: 1000, h: 800 };
    const ext = { x: 0, y: 0, w: 1100, h: 800 }; // förlängd åt vänster
    const v = mapPrintView({ rect: ext, front, zoom: 10, viewWidthPx: 500, referencePxPerCssPx: 1 });
    // Lagrets mitt (600) ligger 50 px höger om ytans mitt (550) → 25 CSS-px.
    expect(v.frontCenterOffsetCss).toEqual({ x: 25, y: 0 });
    expect(v.cssW).toBeCloseTo(550);
  });
});
