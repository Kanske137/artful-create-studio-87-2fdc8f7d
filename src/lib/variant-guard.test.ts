import { describe, expect, it } from "vitest";
import { paidVariantMismatch } from "../../supabase/functions/_shared/variant-guard";

describe("paidVariantMismatch (spärr i orderwebhooken)", () => {
  it("stoppar order #1352: designad plexiglas, betald metallposter", () => {
    const m = paidVariantMismatch({
      variantTitle: "Metallposter / 70x100 / Standard",
      productType: "acrylic",
      size: "70x100",
      variant: "Standard",
    });
    expect(m).toMatch(/material/);
  });

  it("stoppar fel storlek och fel ram", () => {
    expect(paidVariantMismatch({ variantTitle: "Poster / 30x40 / Ingen", productType: "posters", size: "50x70", variant: "Ingen" })).toMatch(/storlek/);
    expect(paidVariantMismatch({ variantTitle: "Poster / 30x40 / Ingen", productType: "posters", size: "30x40", variant: "Ek" })).toMatch(/utförande/);
  });

  it("släpper igenom matchande rader, även med andra skrivsätt", () => {
    expect(paidVariantMismatch({ variantTitle: "Plexiglas / 70x100 / Standard", productType: "acrylic", size: "70x100", variant: "Standard" })).toBeNull();
    expect(paidVariantMismatch({ variantTitle: "Metallposter / 30x40 / Standard", productType: "Metallposter", size: "30×40", variant: "standard" })).toBeNull();
    expect(paidVariantMismatch({ variantTitle: "Poster / 21x30 / Hängare Ek", productType: "poster", size: "21x30", variant: "Hängare Ek" })).toBeNull();
    expect(paidVariantMismatch({ variantTitle: "Canvas / 40x60 / 4cm", productType: "canvas", size: "40x60", variant: "4cm" })).toBeNull();
  });

  it("hoppar över äldre produkter utan Produkttyp-axel", () => {
    expect(paidVariantMismatch({ variantTitle: "30x40 / Ingen", productType: null, size: "50x70", variant: "Ek" })).toBeNull();
    expect(paidVariantMismatch({ variantTitle: null, productType: "posters", size: "30x40", variant: "Ingen" })).toBeNull();
  });
});
