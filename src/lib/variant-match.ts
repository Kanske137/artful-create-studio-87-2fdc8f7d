// Matchar editorns val (storlek + utförande + material) mot en Shopify-variant.
//
// Konsoliderade produkter har axeln "Produkttyp" (Poster/Canvas/Metallposter/
// Plexiglas). Metallposter och Plexiglas har samma storlekar och samma
// utförande ("Standard"), så materialet MÅSTE ingå i matchningen — annars
// vinner den variant som råkar ligga först (Metallposter) och kunden ser och
// betalar fel pris för fel produkt (order #1324 och #1352).
//
// Används av prisvisningen (shopify-prices) och variant-uppslaget till
// varukorgen (shopify-variant-resolver). Hittas ingen entydig variant blir
// svaret null — hellre inget pris/ingen variant än fel.

/** Intern produkttyp → Produkttyp-värdet i Shopify. */
export const PRODUCT_TYPE_LABEL: Record<string, string> = {
  posters: "Poster",
  poster: "Poster",
  canvas: "Canvas",
  aluminum: "Metallposter",
  acrylic: "Plexiglas",
};

export function productTypeLabel(productType: string | null | undefined): string | null {
  return productType ? PRODUCT_TYPE_LABEL[productType] ?? null : null;
}

/** Jämförbar form av ett option-värde ("Valnöt" = "valnot", "70×100 cm" = "70x100"). */
export function normalizeOptionValue(s: string): string {
  return s
    .toLowerCase()
    // Strip diacritics so "valnöt" matches "valnot", "hängare" matches "hangare".
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    // Drop common ram-prefix the merchant might add in Shopify, but NEVER
    // strip "Hängare" — hängar-varianterna har egna priser i Shopify och måste
    // matchas distinkt från ram-varianterna med samma färg (Ek/Valnöt/...).
    .replace(/^ram\s+(i\s+)?/i, "")
    .replace(/^ramad\s+/i, "")
    // Unify "x", "X" and the real multiplication sign "×" so size strings match.
    .replace(/[×x]/g, "x")
    .replace(/\s*cm\s*$/i, "")
    .replace(/\s+/g, "")
    .trim();
}

const KNOWN_TYPE_VALUES = new Set(Object.values(PRODUCT_TYPE_LABEL).map(normalizeOptionValue));

export interface VariantWithOptions {
  selectedOptions: Array<{ name: string; value: string }>;
}

/**
 * Den enda variant som matchar storlek + utförande (+ material när produkten
 * har en Produkttyp-axel). Null om ingen eller flera matchar.
 */
export function matchVariant<T extends VariantWithOptions>(
  variants: T[],
  size: string,
  variant: string,
  productType?: string | null,
): T | null {
  const values = (v: T) => (v.selectedOptions ?? []).map((o) => normalizeOptionValue(o.value));
  const sizeN = normalizeOptionValue(size);
  const variantN = normalizeOptionValue(variant);
  let cands = variants.filter((v) => {
    const o = values(v);
    return o.includes(sizeN) && o.includes(variantN);
  });
  const typeLabel = productTypeLabel(productType);
  const hasTypeAxis = variants.some((v) => values(v).some((x) => KNOWN_TYPE_VALUES.has(x)));
  if (hasTypeAxis && typeLabel) {
    const typeN = normalizeOptionValue(typeLabel);
    cands = cands.filter((v) => values(v).includes(typeN));
  }
  return cands.length === 1 ? cands[0]! : null;
}

/** Numeriskt variant-id ur ett GID ("gid://shopify/ProductVariant/123" → "123"). */
export function numericVariantId(gid: string | null | undefined): string | null {
  if (!gid) return null;
  const m = /(\d+)\s*$/.exec(gid);
  return m ? m[1]! : null;
}
