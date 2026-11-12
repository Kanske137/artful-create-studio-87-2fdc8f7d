// Resolves a Shopify variant ID for a product handle + size/variant/material
// selection via the Storefront API (proxied through the `shopify-storefront` edge fn).
// Used in the editor to ensure "Add to cart" pushes a REAL variant ID rather
// than a synthetic placeholder string. Caches by (handle,size,variant).
import { supabase } from "@/integrations/supabase/client";
import { matchVariant } from "@/lib/variant-match";

interface ProductOptionInput {
  name: string;
  value: string;
}

interface VariantNode {
  id: string;
  selectedOptions: ProductOptionInput[];
}

interface ProductByHandleResponse {
  data?: {
    productByHandle: {
      variants: { edges: Array<{ node: VariantNode }> };
    } | null;
  };
}

const PRODUCT_VARIANTS_QUERY = /* GraphQL */ `
  query ProductVariants($handle: String!) {
    productByHandle(handle: $handle) {
      variants(first: 100) {
        edges {
          node {
            id
            selectedOptions { name value }
          }
        }
      }
    }
  }
`;

const cache = new Map<string, { id: string | null; ts: number }>();
const TTL_MS = 5 * 60 * 1000;

function cacheKey(handle: string, size: string, variant: string, productType?: string) {
  return `${handle}|${size}|${variant}|${productType ?? ""}`;
}

export function clearVariantResolverCache() {
  cache.clear();
}

/** Resolve a real Shopify variant ID. Returns null if not found / unavailable.
 *  `productType` (intern slug: posters/canvas/aluminum/acrylic) bör skickas för
 *  konsoliderade produkter så vi matchar rätt Produkttyp-axel. */
export async function resolveShopifyVariantId(
  handle: string,
  size: string,
  variant: string,
  productType?: string,
): Promise<string | null> {
  const key = cacheKey(handle, size, variant, productType);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < TTL_MS) return cached.id;

  try {
    const { data, error } = await supabase.functions.invoke("shopify-storefront", {
      body: {
        query: PRODUCT_VARIANTS_QUERY,
        variables: { handle },
      },
    });
    if (error) {
      console.warn("[variant-resolver] proxy error", error.message);
      cache.set(key, { id: null, ts: Date.now() });
      return null;
    }

    const payload = data as ProductByHandleResponse;
    const variants = payload?.data?.productByHandle?.variants?.edges?.map((e) => e.node) ?? [];
    if (variants.length === 0) {
      cache.set(key, { id: null, ts: Date.now() });
      return null;
    }

    // Material ingår i matchningen (Produkttyp-axeln); produkter utan axeln
    // matchas på storlek + utförande. Ingen gissning vid tvetydighet.
    const id = matchVariant(variants, size, variant, productType)?.id ?? null;
    cache.set(key, { id, ts: Date.now() });
    return id;
  } catch (e) {
    console.warn("[variant-resolver] failed", e);
    return null;
  }
}
