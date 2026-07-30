// Holds the per-customer shop context (locale, currency, exchange rate, country)
// pushed in by the Shopify theme via URL query-params + postMessage.
//
// The editor never offers a language/currency picker — everything is read from
// the shop. SEK is the source-of-truth in pricing.ts; we convert with Shopify's
// own multi-currency rate so the displayed amount matches what the rest of the
// store shows the same customer.
import { create } from "zustand";

export type Locale =
  | "sv" | "en" | "de" | "no" | "da" | "fi"
  | "fr" | "es" | "it" | "nl" | "pl";

export const SUPPORTED_LOCALES: Locale[] = [
  "sv", "en", "de", "no", "da", "fi", "fr", "es", "it", "nl", "pl",
];

export interface ShopContext {
  /** UI language. */
  locale: Locale;
  /** ISO 4217 currency, e.g. "SEK", "EUR", "USD". */
  currency: string;
  /** Multiplier from SEK → currency (Shopify's `cart.currency.rate`). */
  rate: number;
  /** ISO country code, e.g. "SE", "DE". Used for tax hints if needed. */
  country: string | null;
  /** Judge.me-snittbetyg (Shopify reviews.rating), null om inga omdömen. */
  reviewRating: number | null;
  /** Antal omdömen (reviews.rating_count), null/0 om inga. */
  reviewCount: number | null;
}

interface ShopContextStore extends ShopContext {
  setContext: (next: Partial<ShopContext>) => void;
}

const DEFAULT_CONTEXT: ShopContext = {
  locale: "sv",
  currency: "SEK",
  rate: 1,
  country: "SE",
  reviewRating: null,
  reviewCount: null,
};

export const useShopContextStore = create<ShopContextStore>((set) => ({
  ...DEFAULT_CONTEXT,
  setContext: (next) => set((s) => ({ ...s, ...next })),
}));

/** Map a raw locale string ("en-GB", "de-AT") to one of our supported bases. */
export function normalizeLocale(raw: string | null | undefined): Locale {
  if (!raw) return "sv";
  const base = raw.toLowerCase().split(/[-_]/)[0];
  if ((SUPPORTED_LOCALES as string[]).includes(base)) return base as Locale;
  return "sv";
}
