import { describe, expect, it } from "vitest";
import { matchVariant, numericVariantId, productTypeLabel } from "./variant-match";

// Utdrag ur Karttavlans riktiga varianter (Produkttyp / Storlek / Utförande).
const titles = [
  "Poster / 13x18 / Ingen",
  "Poster / 30x40 / Ek",
  "Poster / 30x40 / Hängare Ek",
  "Poster / 70x100 / Valnöt",
  "Canvas / 50x70 / 2cm",
  "Metallposter / 30x40 / Standard",
  "Metallposter / 70x100 / Standard",
  "Plexiglas / 30x40 / Standard",
  "Plexiglas / 70x100 / Standard",
];
const opt = (t: string) => {
  const [a, b, c] = t.split(" / ");
  return [
    { name: "Produkttyp", value: a! },
    { name: "Storlek", value: b! },
    { name: "Utförande", value: c! },
  ];
};
const variants = titles.map((t, i) => ({ id: `gid://shopify/ProductVariant/${100 + i}`, title: t, selectedOptions: opt(t) }));
const pick = (size: string, variant: string, type?: string) => matchVariant(variants, size, variant, type)?.title ?? null;

describe("matchVariant", () => {
  it("skiljer Plexiglas från Metallposter (samma storlek och utförande)", () => {
    expect(pick("70x100", "Standard", "acrylic")).toBe("Plexiglas / 70x100 / Standard");
    expect(pick("70x100", "Standard", "aluminum")).toBe("Metallposter / 70x100 / Standard");
    expect(pick("30x40", "Standard", "acrylic")).toBe("Plexiglas / 30x40 / Standard");
  });

  it("matchar poster med ram/hängare och canvas", () => {
    expect(pick("30x40", "Ek", "posters")).toBe("Poster / 30x40 / Ek");
    expect(pick("30x40", "Hängare Ek", "posters")).toBe("Poster / 30x40 / Hängare Ek");
    expect(pick("70x100", "Valnot", "posters")).toBe("Poster / 70x100 / Valnöt");
    expect(pick("50x70", "2cm", "canvas")).toBe("Canvas / 50x70 / 2cm");
  });

  it("gissar aldrig: tvetydigt eller saknat ger null", () => {
    expect(pick("70x100", "Standard")).toBeNull();
    expect(pick("99x99", "Standard", "acrylic")).toBeNull();
    expect(pick("13x18", "Standard", "acrylic")).toBeNull();
  });

  it("fungerar för produkter utan Produkttyp-axel", () => {
    const legacy = [
      { selectedOptions: [{ name: "Storlek", value: "21x30" }, { name: "Utförande", value: "Hängare Ek" }] },
      { selectedOptions: [{ name: "Storlek", value: "30x40" }, { name: "Utförande", value: "Ingen" }] },
    ];
    expect(matchVariant(legacy, "21x30", "Hängare Ek", "posters")).toBe(legacy[0]);
  });
});

describe("hjälpare", () => {
  it("numericVariantId och productTypeLabel", () => {
    expect(numericVariantId("gid://shopify/ProductVariant/54134553870682")).toBe("54134553870682");
    expect(numericVariantId(null)).toBeNull();
    expect(productTypeLabel("acrylic")).toBe("Plexiglas");
    expect(productTypeLabel("aluminum")).toBe("Metallposter");
  });
});
