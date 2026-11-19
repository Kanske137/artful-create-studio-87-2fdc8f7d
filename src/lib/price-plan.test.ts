import { describe, expect, it } from "vitest";
import {
  PLAN,
  chunk,
  isPosterOrHanger,
  parseVariantTitle,
  targetPrice,
} from "../../supabase/functions/_shared/price-plan";

describe("prisplanen 19 november", () => {
  it("läser varianttitlar", () => {
    expect(parseVariantTitle("Poster / 30x40 / Hängare Ek")).toEqual({
      type: "Poster",
      size: "30x40",
      variant: "Hängare Ek",
    });
    expect(parseVariantTitle("Default Title")).toBeNull();
  });

  it("sätter förslag B på ramar i Sverige", () => {
    expect(targetPrice("SE", "Poster / 30x40 / Vit")).toBe(649);
    expect(targetPrice("SE", "Poster / 50x70 / Valnöt")).toBe(1099);
    expect(targetPrice("SE", "Poster / 70x100 / Svart")).toBe(1599);
  });

  it("rör inte posters, hängare, metall eller akryl i Sverige", () => {
    expect(targetPrice("SE", "Poster / 30x40 / Ingen")).toBeNull();
    expect(targetPrice("SE", "Poster / 30x40 / Hängare Vit")).toBeNull();
    expect(targetPrice("SE", "Metallposter / 30x40 / Standard")).toBeNull();
    expect(targetPrice("SE", "Plexiglas / 70x100 / Standard")).toBeNull();
  });

  it("sätter nya canvaspriser i alla marknader", () => {
    expect(targetPrice("SE", "Canvas / 30x40 / 2cm")).toBe(379);
    expect(targetPrice("DK", "Canvas / 50x70 / 2cm")).toBe(529);
    expect(targetPrice("FI", "Canvas / 70x100 / 4cm")).toBe(169);
  });

  it("rör inte posters och hängare i Danmark och Finland", () => {
    expect(targetPrice("DK", "Poster / 50x70 / Ingen")).toBeNull();
    expect(targetPrice("FI", "Poster / 50x70 / Hängare Ek")).toBeNull();
  });

  it("ek och valnöt kostar aldrig mindre än vit och svart", () => {
    for (const market of ["SE", "DK", "FI"] as const) {
      for (const [size, row] of Object.entries(PLAN[market].frame)) {
        expect(row.Ek, `${market} ${size}`).toBeGreaterThanOrEqual(row.Vit);
      }
    }
  });

  it("4 cm canvas kostar mer än 2 cm", () => {
    for (const market of ["SE", "DK", "FI"] as const) {
      for (const [size, row] of Object.entries(PLAN[market].canvas)) {
        expect(row["4cm"], `${market} ${size}`).toBeGreaterThan(row["2cm"]);
      }
    }
  });

  it("rabatterna gäller bara poster utan ram och poster med hängare", () => {
    expect(isPosterOrHanger("Poster / 13x18 / Ingen")).toBe(true);
    expect(isPosterOrHanger("Poster / 70x100 / Hängare Valnöt")).toBe(true);
    expect(isPosterOrHanger("Poster / 30x40 / Vit")).toBe(false);
    expect(isPosterOrHanger("Canvas / 30x40 / 2cm")).toBe(false);
    expect(isPosterOrHanger("Plexiglas / 30x40 / Standard")).toBe(false);
  });

  it("delar listor i bitar", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});
