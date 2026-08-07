// Fetches real, customer-facing prices from Shopify Storefront API using
// `@inContext(country: …)`. This is the only way to guarantee the editor
// displays the same amount the customer will pay in checkout — Shopify does
// the FX + rounding internally per market.
import { supabase } from "@/integrations/supabase/client";

export interface ShopifyMoney {
  amount: number;
  currencyCode: string;
  /** Ordinarie (överstruket) pris när varianten är på rea — annars null.
   *  Kommer från Shopifys compareAtPrice och är alltid i samma valuta som
   *  amount. */
  compareAt: number | null;
}

// Shopify @inContext lokaliserar BÅDE pris och option-värden ("Utförande"→"Design",
// "Ingen"→"None" osv) — en marknad med engelsk översättning returnerar engelska
// option-värden även om vi ber om language:SV. För att kunna matcha varianter mot
// våra svenska källvärden hämtar vi DEM via en icke-kontextuell query, och priserna
// separat via @inContext. Variant-id är detsamma i båda — vi joinar på id.
// Shopify @inContext lokaliserar BÅDE pris och option-värden ("Utförande"→"Design",
// "Ingen"→"None" osv) — och kan bara appliceras på top-level query, inte på fält.
// Vi gör därför TVÅ separata queries: en utan kontext för källspråkets options
// (matchning), en med @inContext för priser. Variant-id är detsamma → join på id.
const SOURCE_QUERY = /* GraphQL */ `
  query ProductSource($handle: String!) {
    productByHandle(handle: $handle) {
      variants(first: 100) {
        edges { node { id selectedOptions { name value } } }
      }
    }
  }
`;

const CONTEXTUAL_QUERY = /* GraphQL */ `
  query ProductPrices($handle: String!, $country: CountryCode!)
  @inContext(country: $country) {
    productByHandle(handle: $handle) {
      variants(first: 100) {
        edges { node { id price { amount currencyCode } compareAtPrice { amount } } }
      }
    }
  }
`;

interface VariantNode {
  id: string;
  selectedOptions: Array<{ name: string; value: string }>;
  price: { amount: string; currencyCode: string };
  compareAtPrice: { amount: string } | null;
}

interface CacheEntry {
  ts: number;
  variants: VariantNode[];
}

const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<VariantNode[] | null>>();

function key(handle: string, country: string) {
  return `${handle}|${country.toUpperCase()}`;
}

export function clearShopifyPriceCache() {
  cache.clear();
  inflight.clear();
}

async function fetchVariants(handle: string, country: string): Promise<VariantNode[] | null> {
  const k = key(handle, country);
  const cached = cache.get(k);
  if (cached && Date.now() - cached.ts < TTL_MS) return cached.variants;
  const existing = inflight.get(k);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const [sourceRes, contextRes] = await Promise.all([
        supabase.functions.invoke("shopify-storefront", {
          body: { query: SOURCE_QUERY, variables: { handle } },
        }),
        supabase.functions.invoke("shopify-storefront", {
          body: {
            query: CONTEXTUAL_QUERY,
            variables: { handle, country: country.toUpperCase() },
          },
        }),
      ]);
      if (sourceRes.error || contextRes.error) {
        console.warn("[shopify-prices] proxy error", sourceRes.error?.message || contextRes.error?.message);
        return null;
      }
      const source = (sourceRes.data as any)?.data?.productByHandle;
      const contextual = (contextRes.data as any)?.data?.productByHandle;
      if (!source || !contextual) {
        console.info(
          `[shopify-prices] no Shopify product for handle="${handle}" (country=${country}). ` +
          `Live prices will fall back to internal SEK pricing.`,
        );
        cache.set(k, { ts: Date.now(), variants: [] });
        return [] as VariantNode[];
      }
      const priceById = new Map<
        string,
        { price: { amount: string; currencyCode: string }; compareAtPrice: { amount: string } | null }
      >();
      for (const e of contextual.variants?.edges ?? []) {
        if (e?.node?.id && e.node.price) {
          priceById.set(e.node.id, { price: e.node.price, compareAtPrice: e.node.compareAtPrice ?? null });
        }
      }
      const variants: VariantNode[] = [];
      for (const e of source.variants?.edges ?? []) {
        const node = e?.node;
        const entry = node?.id ? priceById.get(node.id) : null;
        if (node && entry) {
          variants.push({
            id: node.id,
            selectedOptions: node.selectedOptions ?? [],
            price: entry.price,
            compareAtPrice: entry.compareAtPrice,
          });
        }
      }
      cache.set(k, { ts: Date.now(), variants });
      return variants;
    } catch (e) {
      console.warn("[shopify-prices] failed", e);
      return null;
    } finally {
      inflight.delete(k);
    }
  })();
  inflight.set(k, promise);
  return promise;
}

function normalize(s: string) {
  return s
    .toLowerCase()
    // Strip diacritics so "valnöt" matches "valnot", "hängare" matches "hangare".
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
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

function findVariant(
  variants: VariantNode[],
  size: string,
  variantName: string,
): VariantNode | null {
  const sizeN = normalize(size);
  const variantN = normalize(variantName);
  for (const v of variants) {
    const opts = v.selectedOptions ?? [];
    const sizeMatch = opts.some((o) => normalize(o.value) === sizeN);
    const variantMatch = opts.some((o) => normalize(o.value) === variantN);
    if (sizeMatch && variantMatch) return v;
  }
  return null;
}

/** Get price for a single (size, variant) in the customer's market. */
export async function getShopifyPrice(
  handle: string,
  country: string,
  size: string,
  variantName: string,
): Promise<ShopifyMoney | null> {
  const variants = await fetchVariants(handle, country);
  if (!variants) return null;
  const v = findVariant(variants, size, variantName);
  if (!v) return null;
  return {
    amount: parseFloat(v.price.amount),
    currencyCode: v.price.currencyCode,
    compareAt: saleCompareAt(v),
  };
}

/** Jämförpris endast när det är ett äkta rea-läge (compareAt > pris). */
function saleCompareAt(v: VariantNode): number | null {
  if (!v.compareAtPrice) return null;
  const c = parseFloat(v.compareAtPrice.amount);
  const p = parseFloat(v.price.amount);
  return isFinite(c) && c > p ? c : null;
}

/** Get prices for many (size, variant) pairs in one call. Map keys = "size|variant". */
export async function getShopifyPrices(
  handle: string,
  country: string,
  combos: Array<{ size: string; variant: string }>,
): Promise<Map<string, ShopifyMoney>> {
  const variants = await fetchVariants(handle, country);
  const out = new Map<string, ShopifyMoney>();
  if (!variants) return out;
  for (const c of combos) {
    const v = findVariant(variants, c.size, c.variant);
    if (v) {
      out.set(`${c.size}|${c.variant}`, {
        amount: parseFloat(v.price.amount),
        currencyCode: v.price.currencyCode,
        compareAt: saleCompareAt(v),
      });
    }
  }
  return out;
}
