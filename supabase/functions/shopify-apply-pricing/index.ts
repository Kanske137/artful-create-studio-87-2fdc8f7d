// Tillämpar prisplanen i _shared/price-plan.ts på alla aktiva produkter.
//
// POST { dryRun?: boolean }   (dryRun är standard; skicka dryRun:false för att skriva)
//
// 1. Grundpriser (Sverige): ramar och canvas enligt planen, jämförpris tas bort.
// 2. Fasta prislistor för Danmark (DKK) och Finland (EUR): ramar, canvas,
//    metall och akryl enligt planen, utan jämförpris.
// 3. Rabatter: automatisk "Köp 2"-rabatt (15 %, minst 2 posters/hängare,
//    kan inte kombineras med andra rabatter) och ARTHENA15 begränsad till
//    posters och hängare.
//
// Bara admin (akram@arthena.se) får köra funktionen.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { ensureShopifyAuth, shopifyAdmin as rawAdmin } from "../_shared/shopify-admin.ts";
import {
  type Market,
  chunk,
  isPosterOrHanger,
  targetPrice,
} from "../_shared/price-plan.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ADMIN_EMAILS = ["akram@arthena.se"];

const PRICE_LISTS: Record<Exclude<Market, "SE">, { id: string; currency: string }> = {
  DK: { id: "gid://shopify/PriceList/31981502810", currency: "DKK" },
  FI: { id: "gid://shopify/PriceList/31981535578", currency: "EUR" },
};

const BUY2_TITLE = "Köp 2 posters/hängare – 15 %";
const ARTHENA15_ID = "gid://shopify/DiscountCodeNode/1848156291418";

interface Variant {
  id: string;
  title: string;
  price: string;
  compareAtPrice: string | null;
}
interface Product {
  id: string;
  handle: string;
  variants: { nodes: Variant[] };
}

const PRODUCTS_QUERY = `
  query($after: String) {
    products(first: 10, after: $after, query: "status:active") {
      pageInfo { hasNextPage endCursor }
      nodes {
        id handle
        variants(first: 100) { nodes { id title price compareAtPrice } }
      }
    }
  }`;

const VARIANTS_UPDATE = `
  mutation($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      userErrors { field message }
    }
  }`;

const FIXED_PRICES_ADD = `
  mutation($priceListId: ID!, $prices: [PriceListPriceInput!]!) {
    priceListFixedPricesAdd(priceListId: $priceListId, prices: $prices) {
      userErrors { field message code }
    }
  }`;

const FIND_AUTOMATIC = `
  query($q: String!) {
    automaticDiscountNodes(first: 5, query: $q) {
      nodes { id automaticDiscount { __typename ... on DiscountAutomaticBasic { title status } } }
    }
  }`;

const AUTOMATIC_CREATE = `
  mutation($d: DiscountAutomaticBasicInput!) {
    discountAutomaticBasicCreate(automaticBasicDiscount: $d) {
      automaticDiscountNode { id }
      userErrors { field message code }
    }
  }`;

const AUTOMATIC_UPDATE = `
  mutation($id: ID!, $d: DiscountAutomaticBasicInput!) {
    discountAutomaticBasicUpdate(id: $id, automaticBasicDiscount: $d) {
      userErrors { field message code }
    }
  }`;

const CODE_UPDATE = `
  mutation($id: ID!, $d: DiscountCodeBasicInput!) {
    discountCodeBasicUpdate(id: $id, basicCodeDiscount: $d) {
      userErrors { field message code }
    }
  }`;

/** Shopify Admin med omförsök när anropstakten begränsas (THROTTLED). */
async function shopifyAdmin<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await rawAdmin<T>(query, variables);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (attempt < 6 && /thrott/i.test(msg)) {
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        continue;
      }
      throw e;
    }
  }
}

function money(n: number): string {
  return n.toFixed(2);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function requireAdmin(req: Request): Promise<string | null> {
  const auth = req.headers.get("Authorization") ?? "";
  const jwt = auth.replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data } = await supabase.auth.getUser(jwt);
  const email = data?.user?.email?.toLowerCase() ?? "";
  return ADMIN_EMAILS.includes(email) ? email : null;
}

async function loadProducts(): Promise<Product[]> {
  const all: Product[] = [];
  let after: string | null = null;
  for (;;) {
    const r: {
      products: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: Product[] };
    } = await shopifyAdmin(PRODUCTS_QUERY, { after });
    all.push(...r.products.nodes);
    if (!r.products.pageInfo.hasNextPage) break;
    after = r.products.pageInfo.endCursor;
  }
  return all;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = await requireAdmin(req);
  if (!admin) return json({ ok: false, error: "Endast admin" }, 403);

  let body: { dryRun?: boolean } = {};
  try { body = await req.json(); } catch { /* tom kropp = provkörning */ }
  const dryRun = body.dryRun !== false;

  try {
    await ensureShopifyAuth();
    const products = await loadProducts();

    // ---- 1. Grundpriser (Sverige) ----
    const baseUpdates: { productId: string; handle: string; variants: { id: string; price: string; compareAtPrice: null }[] }[] = [];
    // ---- 2. Fasta priser (DK, FI) ----
    const fixed: Record<string, { variantId: string; price: { amount: string; currencyCode: string } }[]> = { DK: [], FI: [] };
    // ---- 3. Rabattvarianter ----
    const discountVariantIds: string[] = [];
    const examples: string[] = [];

    for (const p of products) {
      const variants: { id: string; price: string; compareAtPrice: null }[] = [];
      for (const v of p.variants.nodes) {
        const se = targetPrice("SE", v.title);
        if (se !== null) {
          const changed = Number(v.price) !== se || v.compareAtPrice !== null;
          if (changed) {
            variants.push({ id: v.id, price: money(se), compareAtPrice: null });
            if (examples.length < 8) examples.push(`${p.handle} · ${v.title}: ${v.price}${v.compareAtPrice ? ` (jmf ${v.compareAtPrice})` : ""} → ${se}`);
          }
        }
        for (const m of ["DK", "FI"] as const) {
          const t = targetPrice(m, v.title);
          if (t !== null) {
            fixed[m].push({ variantId: v.id, price: { amount: money(t), currencyCode: PRICE_LISTS[m].currency } });
          }
        }
        if (isPosterOrHanger(v.title)) discountVariantIds.push(v.id);
      }
      if (variants.length) baseUpdates.push({ productId: p.id, handle: p.handle, variants });
    }

    const summary = {
      products: products.length,
      seVariantsToUpdate: baseUpdates.reduce((n, u) => n + u.variants.length, 0),
      dkFixedPrices: fixed.DK.length,
      fiFixedPrices: fixed.FI.length,
      discountVariants: discountVariantIds.length,
      examples,
    };

    if (dryRun) return json({ ok: true, dryRun: true, summary });

    const errors: string[] = [];

    for (const u of baseUpdates) {
      const r: { productVariantsBulkUpdate: { userErrors: { message: string }[] } } =
        await shopifyAdmin(VARIANTS_UPDATE, { productId: u.productId, variants: u.variants });
      for (const e of r.productVariantsBulkUpdate.userErrors) errors.push(`SE ${u.handle}: ${e.message}`);
    }

    for (const m of ["DK", "FI"] as const) {
      for (const part of chunk(fixed[m], 100)) {
        const r: { priceListFixedPricesAdd: { userErrors: { message: string }[] } } =
          await shopifyAdmin(FIXED_PRICES_ADD, { priceListId: PRICE_LISTS[m].id, prices: part });
        for (const e of r.priceListFixedPricesAdd.userErrors) errors.push(`${m}: ${e.message}`);
      }
    }

    // "Köp 2"-rabatten: skapa om den saknas, lägg sedan till varianterna i bitar.
    const found: { automaticDiscountNodes: { nodes: { id: string; automaticDiscount: { title?: string } }[] } } =
      await shopifyAdmin(FIND_AUTOMATIC, { q: `title:'${BUY2_TITLE}'` });
    let buy2Id = found.automaticDiscountNodes.nodes.find((n) => n.automaticDiscount?.title === BUY2_TITLE)?.id ?? null;
    const parts = chunk(discountVariantIds, 100);
    const value = { percentage: 0.15 };
    if (!buy2Id) {
      const r: { discountAutomaticBasicCreate: { automaticDiscountNode: { id: string } | null; userErrors: { message: string }[] } } =
        await shopifyAdmin(AUTOMATIC_CREATE, {
          d: {
            title: BUY2_TITLE,
            startsAt: new Date().toISOString(),
            combinesWith: { orderDiscounts: false, productDiscounts: false, shippingDiscounts: true },
            minimumRequirement: { quantity: { greaterThanOrEqualToQuantity: "2" } },
            customerGets: { value, items: { products: { productVariantsToAdd: parts[0] ?? [] } } },
          },
        });
      for (const e of r.discountAutomaticBasicCreate.userErrors) errors.push(`Köp 2: ${e.message}`);
      buy2Id = r.discountAutomaticBasicCreate.automaticDiscountNode?.id ?? null;
    }
    if (buy2Id) {
      for (const part of parts) {
        const r: { discountAutomaticBasicUpdate: { userErrors: { message: string }[] } } =
          await shopifyAdmin(AUTOMATIC_UPDATE, {
            id: buy2Id,
            d: { customerGets: { value, items: { products: { productVariantsToAdd: part } } } },
          });
        for (const e of r.discountAutomaticBasicUpdate.userErrors) errors.push(`Köp 2: ${e.message}`);
      }
    }

    // ARTHENA15: från "alla produkter" till posters och hängare.
    for (const part of parts) {
      const r: { discountCodeBasicUpdate: { userErrors: { message: string }[] } } =
        await shopifyAdmin(CODE_UPDATE, {
          id: ARTHENA15_ID,
          d: { customerGets: { value, items: { products: { productVariantsToAdd: part } } } },
        });
      for (const e of r.discountCodeBasicUpdate.userErrors) errors.push(`ARTHENA15: ${e.message}`);
    }

    return json({ ok: errors.length === 0, dryRun: false, summary, buy2Id, errors: errors.slice(0, 50) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[apply-pricing]", msg);
    return json({ ok: false, error: msg }, 500);
  }
});
