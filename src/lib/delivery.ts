// Leverans- och fraktvillkor enligt Arthenas fraktpolicy (Shopify SHIPPING_POLICY).
// Källa (2026-07): "Alla våra produkter tillverkas personligt på beställning,
// ofta nära dig inom EU." Leveranstiden = tillverkning + frakt, varierar med
// material och land:
//   Poster:                3–6 arbetsdagar i Sverige, 4–7 i övriga EU.
//   Canvas, metall, akryl: 4–7 arbetsdagar i Sverige, 5–8 i övriga EU.
// Frakt: Sverige 49 kr (fri över 499 kr), övriga EU 59 kr (fri över 599 kr).
// Vi levererar inom EU. Håll detta i synk med policyn om den ändras.

export interface DeliveryEstimate {
  minDays: number;
  maxDays: number;
}

/** True för svensk marknad. Okänt land → anta Sverige (svensk butik, säkrast). */
function isSweden(country: string | null | undefined): boolean {
  return (country ?? "SE").toUpperCase() === "SE";
}

/** True för poster (snabbare grupp); canvas/metall/akryl är den långsammare. */
function isPoster(productType: string | null | undefined): boolean {
  return productType === "posters" || productType === "poster";
}

/** Uppskattad leveranstid (arbetsdagar) per produkttyp + marknad, per fraktpolicyn. */
export function deliveryEstimate(
  productType: string | null | undefined,
  country: string | null | undefined,
): DeliveryEstimate {
  const se = isSweden(country);
  if (isPoster(productType)) return se ? { minDays: 3, maxDays: 6 } : { minDays: 4, maxDays: 7 };
  return se ? { minDays: 4, maxDays: 7 } : { minDays: 5, maxDays: 8 };
}

/** Gräns för fri frakt i SEK per marknad (policyns värden). */
export function freeShippingThresholdSek(country: string | null | undefined): number {
  return isSweden(country) ? 499 : 599;
}

/** Fraktkostnad i SEK per marknad (policyns värden). */
export function shippingCostSek(country: string | null | undefined): number {
  return isSweden(country) ? 49 : 59;
}
