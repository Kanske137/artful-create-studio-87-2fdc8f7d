// Spärr mot att fel produkt trycks.
//
// Kunden designar i editorn (material, storlek och utförande skickas som
// _product_type, _size och _variant) men betalar för en Shopify-variant
// ("Produkttyp / Storlek / Utförande"). Order #1352 visade att de kan skilja
// sig åt: designad plexiglas, betald metallposter. Då ska ordern stoppas för
// manuell kontroll i stället för att skickas till tryck.
//
// Ren funktion utan Deno-beroenden så att den kan testas med vitest.

type ProductType = "posters" | "canvas" | "aluminum" | "acrylic";

function normalizeType(raw: string | null | undefined): ProductType | null {
  if (!raw) return null;
  const v = raw.toLowerCase().trim();
  if (v === "poster" || v === "posters") return "posters";
  if (v === "canvas") return "canvas";
  if (v === "aluminum" || v === "aluminium" || v === "metallic" || v === "metallposter" || v === "metall") return "aluminum";
  if (v === "acrylic" || v === "akryl" || v === "plexiglas" || v === "plexiglas/akryl") return "acrylic";
  return null;
}

function normalizeValue(raw: string | null | undefined): string {
  return (raw ?? "").toLowerCase().replace(/×/g, "x").replace(/\s+/g, "").trim();
}

export interface PaidVariantCheck {
  /** Shopify-radens variant_title, t.ex. "Plexiglas / 70x100 / Standard". */
  variantTitle: string | null | undefined;
  /** _product_type från editorn. */
  productType: string | null | undefined;
  /** _size från editorn. */
  size: string | null | undefined;
  /** _variant från editorn (ram, djup eller finish). */
  variant: string | null | undefined;
}

/**
 * Returnerar en beskrivning av skillnaden mellan det designade och det betalda,
 * eller null när de stämmer (eller när produkten saknar Produkttyp-axel och
 * därför inte kan kontrolleras).
 */
export function paidVariantMismatch(c: PaidVariantCheck): string | null {
  const parts = (c.variantTitle ?? "").split(" / ").map((s) => s.trim());
  if (parts.length !== 3) return null;
  const [paidTypeLabel, paidSize, paidVariant] = parts;
  const problems: string[] = [];

  const paidType = normalizeType(paidTypeLabel);
  const designType = normalizeType(c.productType);
  if (paidType && designType && paidType !== designType) {
    problems.push(`material designat=${c.productType} betalt=${paidTypeLabel}`);
  }
  if (c.size && normalizeValue(c.size) !== normalizeValue(paidSize)) {
    problems.push(`storlek designad=${c.size} betald=${paidSize}`);
  }
  if (c.variant && normalizeValue(c.variant) !== normalizeValue(paidVariant)) {
    problems.push(`utförande designat=${c.variant} betalt=${paidVariant}`);
  }
  return problems.length ? problems.join(", ") : null;
}
