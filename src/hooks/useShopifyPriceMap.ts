// React hook around src/lib/shopify-prices.ts. Returns the current variant's
// price (in customer's market currency) plus a map of all (size,variant) →
// price for the active product, so deltas in the size/frame pickers also
// match Shopify exactly. Falls back to internal SEK pricing when Shopify
// hasn't responded yet (or fails).
import { useEffect, useMemo, useState } from "react";
import { useEditorStore } from "@/stores/editorStore";
import { useShopContextStore } from "@/stores/shopContextStore";
import { getEffectiveSizes } from "@/lib/product-config";
import {
  getShopifyPrices,
  type ShopifyMoney,
} from "@/lib/shopify-prices";

export interface DerivedFx {
  currencyCode: string;
  /** Multiplier from SEK → market currency, derived from a real Shopify price
   *  pair so it matches what checkout will show even if the theme didn't send
   *  a usable `cart.currency.rate`. */
  rate: number;
}

export interface ShopifyPriceMapResult {
  map: Map<string, ShopifyMoney>;
  derivedFx: DerivedFx | null;
}

export function useShopifyPriceMap(): ShopifyPriceMapResult {
  const { config, template, productOptions } = useEditorStore();
  const country = useShopContextStore((s) => s.country) ?? "SE";
  const [map, setMap] = useState<Map<string, ShopifyMoney>>(new Map());
  const [derivedFx, setDerivedFx] = useState<DerivedFx | null>(null);

  // Build the (size,variant) combos to fetch from current product/template.
  const combos = useMemo(() => {
    if (!config) return [] as Array<{ size: string; variant: string; sek: number }>;
    const sizes = getEffectiveSizes(config, productOptions);
    const out: Array<{ size: string; variant: string; sek: number }> = [];
    for (const s of sizes) {
      for (const v of s.variants ?? []) {
        out.push({ size: s.size, variant: v.name, sek: v.price });
      }
    }
    return out;
  }, [config, productOptions]);

  useEffect(() => {
    if (!config || combos.length === 0) {
      setMap(new Map());
      setDerivedFx(null);
      return;
    }
    let cancelled = false;
    getShopifyPrices(
      config.shopify_handle,
      country,
      combos.map((c) => ({ size: c.size, variant: c.variant })),
      config.product_type,
    ).then((m) => {
      if (cancelled) return;
      setMap(m);
      // Derive FX from any matched combo so the SEK-fallback in the UI can
      // convert correctly even when a specific (size,variant) was missing.
      let fx: DerivedFx | null = null;
      for (const c of combos) {
        const live = m.get(`${c.size}|${c.variant}`);
        if (live && c.sek > 0) {
          fx = { currencyCode: live.currencyCode, rate: live.amount / c.sek };
          break;
        }
      }
      setDerivedFx(fx);
    });
    return () => {
      cancelled = true;
    };
  }, [config, country, combos, productOptions, template]);

  return { map, derivedFx };
}

/** Look up one specific (size,variant) price from a fetched map. */
export function priceFromMap(
  map: Map<string, ShopifyMoney>,
  size: string | null,
  variant: string | null,
): ShopifyMoney | null {
  if (!size || !variant) return null;
  return map.get(`${size}|${variant}`) ?? null;
}
