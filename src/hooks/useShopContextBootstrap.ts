// Reads the Shopify theme's locale/currency/rate/country once at app mount via
// URL query-params, then keeps listening for `SHOP_CONTEXT` postMessages so
// the customer can change language/currency on the parent page without a reload.
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { normalizeLocale, useShopContextStore } from "@/stores/shopContextStore";

/** Härled marknadsland från valutakoden när Shopify-temat inte skickar `country`.
 *  Storefront API kräver en CountryCode för att returnera marknadsanpassade
 *  priser — utan detta får vi alltid SEK tillbaka. */
function countryFromCurrency(currency: string | null | undefined): string {
  if (!currency) return "SE";
  const map: Record<string, string> = {
    SEK: "SE", NOK: "NO", DKK: "DK", EUR: "DE", USD: "US", GBP: "GB",
    CHF: "CH", PLN: "PL", CZK: "CZ", HUF: "HU", RON: "RO", BGN: "BG",
    CAD: "CA", AUD: "AU", NZD: "NZ", JPY: "JP", ISK: "IS",
  };
  return map[currency.toUpperCase()] ?? "SE";
}

/** Skriv tillbaka shop-kontext i URL:en (utan reload) så att allt — inklusive
 *  tredjepartsverktyg och konsoltester som `URLSearchParams(location.search)` —
 *  ser samma `locale/currency/country/rate` som appen använder internt. */
function syncContextToUrl(ctx: { locale: string; currency: string; rate: number; country: string }) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.set("locale", ctx.locale);
  url.searchParams.set("currency", ctx.currency);
  url.searchParams.set("country", ctx.country);
  if (ctx.rate && ctx.rate !== 1) url.searchParams.set("rate", String(ctx.rate));
  window.history.replaceState(window.history.state, "", url.toString());
}

export function useShopContextBootstrap() {
  const setContext = useShopContextStore((s) => s.setContext);
  const { i18n } = useTranslation();

  useEffect(() => {
    // 1) URL query-params (set by the theme snippet on iframe src).
    const params = new URLSearchParams(window.location.search);
    const queryLocale = params.get("locale");
    const queryCurrency = params.get("currency");
    const queryRate = parseFloat(params.get("rate") ?? "");
    const queryCountry = params.get("country");
    const queryRating = parseFloat(params.get("rating") ?? "");
    const queryReviews = parseInt(params.get("reviews") ?? "", 10);

    // Fallback to navigator.language outside the iframe.
    const fallbackLocale = window.self === window.top ? navigator.language : null;

    const initialLocale = normalizeLocale(queryLocale ?? fallbackLocale);
    const initialCurrency = queryCurrency || "SEK";
    const initialRate = Number.isFinite(queryRate) && queryRate > 0 ? queryRate : 1;

    const initialCountry = queryCountry || countryFromCurrency(initialCurrency);
    setContext({
      locale: initialLocale,
      currency: initialCurrency,
      rate: initialRate,
      country: initialCountry,
      reviewRating: Number.isFinite(queryRating) && queryRating > 0 ? queryRating : null,
      reviewCount: Number.isFinite(queryReviews) && queryReviews > 0 ? queryReviews : null,
    });
    void i18n.changeLanguage(initialLocale);
    syncContextToUrl({
      locale: initialLocale,
      currency: initialCurrency,
      rate: initialRate,
      country: initialCountry,
    });

    // 2) Live updates from the parent theme.
    const onMessage = (e: MessageEvent) => {
      const d = e.data;
      if (!d || typeof d !== "object" || d.type !== "SHOP_CONTEXT") return;
      const currency = typeof d.currency === "string" ? d.currency : "SEK";
      const next = {
        locale: normalizeLocale(d.locale),
        currency,
        rate: typeof d.rate === "number" && d.rate > 0 ? d.rate : 1,
        country: typeof d.country === "string" && d.country
          ? d.country
          : countryFromCurrency(currency),
      };
      setContext(next);
      void i18n.changeLanguage(next.locale);
      syncContextToUrl(next);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [setContext, i18n]);
}
