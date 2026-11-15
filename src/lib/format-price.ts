// Centralized price formatter. SEK is our internal source of truth (pricing.ts);
// we convert with Shopify's own multi-currency rate so what the editor shows
// matches what the storefront shows the same customer in their currency.
import type { ShopContext } from "@/stores/shopContextStore";

// Currencies that customarily display without decimals on Shopify storefronts.
// Everything else gets the locale-default (typically 2 decimals).
const ZERO_DECIMAL_CURRENCIES = new Set(["SEK", "NOK", "DKK", "ISK", "JPY", "HUF"]);

/**
 * True när editorn kan räkna om ett SEK-belopp till kundens valuta.
 * Marknader med egen basvaluta (Danmark i DKK, Finland i EUR, med fasta
 * prislistor) får `cart.currency.rate` = 1 från temat, alltså ingen riktig
 * växelkurs. Där visar vi bara belopp som kommer direkt från Shopify.
 */
export function hasKnownRate(ctx: Pick<ShopContext, "currency" | "rate">): boolean {
  const currency = ctx.currency || "SEK";
  if (currency === "SEK") return true;
  return typeof ctx.rate === "number" && ctx.rate > 0 && ctx.rate !== 1;
}

/**
 * Format a SEK amount into the customer's currency + locale.
 * Mirrors Shopify's own conversion: amount * rate, rounded to currency norms.
 */
export function formatPrice(sekAmount: number, ctx: ShopContext): string {
  const currency = ctx.currency || "SEK";
  const locale = ctx.locale || "sv";
  const decimals = ZERO_DECIMAL_CURRENCIES.has(currency) ? 0 : 2;
  // Konvertera SEK → kundens valuta med Shopify-rate när den finns.
  // Om rate saknas (=1) visar vi ändå rätt valutasymbol — det är bättre att
  // visa ett ungefärligt belopp i rätt valuta tills Storefront-priser hinner
  // laddas, än att fastna på "kr" för alla utländska kunder.
  const converted = currency === "SEK" ? sekAmount : sekAmount * (ctx.rate || 1);
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(converted);
  } catch {
    return `${converted.toFixed(decimals)} ${currency}`;
  }
}

/**
 * Format a price difference (e.g. "+99 kr", "−50 €") shown next to size/frame
 * options. Sign-prefixed; uses the customer's currency.
 */
export function formatPriceDelta(sekDiff: number, ctx: ShopContext): string {
  if (Math.abs(sekDiff * (ctx.rate || 1)) < 0.005) {
    // Treat near-zero as zero to avoid "+0,00 kr" noise.
    const zero = formatPrice(0, ctx);
    return `+${zero}`;
  }
  const abs = formatPrice(Math.abs(sekDiff), ctx);
  return sekDiff > 0 ? `+${abs}` : `−${abs}`;
}

/**
 * Format an arbitrary money amount (already in the target currency, e.g. from
 * Shopify's cart response). Used in CartDrawer where we don't convert.
 */
export function formatMoney(amount: number, currency: string, locale: string): string {
  const decimals = ZERO_DECIMAL_CURRENCIES.has(currency) ? 0 : 2;
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(amount);
  } catch {
    return `${amount.toFixed(decimals)} ${currency}`;
  }
}

/**
 * Format a delta between two amounts already in the same currency
 * (e.g. both from Shopify). Sign-prefixed.
 */
export function formatMoneyDelta(diff: number, currency: string, locale: string): string {
  if (Math.abs(diff) < 0.005) {
    return `+${formatMoney(0, currency, locale)}`;
  }
  const abs = formatMoney(Math.abs(diff), currency, locale);
  return diff > 0 ? `+${abs}` : `−${abs}`;
}

/**
 * Format a SEK amount using a derived FX (currency + rate) sourced from a
 * real Shopify price. Use this in fallbacks when a specific (size,variant)
 * price wasn't returned by Shopify but we still want the customer to see a
 * correct amount in their market currency.
 */
export function formatMoneyFromSEK(
  sekAmount: number,
  fx: { currencyCode: string; rate: number },
  locale: string,
): string {
  return formatMoney(sekAmount * fx.rate, fx.currencyCode, locale);
}

export function formatMoneyDeltaFromSEK(
  sekDiff: number,
  fx: { currencyCode: string; rate: number },
  locale: string,
): string {
  return formatMoneyDelta(sekDiff * fx.rate, fx.currencyCode, locale);
}
