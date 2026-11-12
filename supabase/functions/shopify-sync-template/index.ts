// Creates or updates a Shopify product to match a template stored in
// product_configs. Uses the Shopify Admin GraphQL API.
//
// Behaviour:
// - One Shopify product per (template, product_type). Handles get a -poster
//   or -canvas suffix when both kinds are enabled (so they remain separate
//   products with their own variants — Shopify's 3-option-axis limit makes
//   merging poster+canvas under one product impractical anyway).
// - Variants are the cartesian product of allowedSizes × (allowedFrames|allowedDepths).
//   SKU = Gelato UID (portrait orientation).
// - Status: DRAFT. Vendor: empty. Tags: [template_slug, product_type, "personalized", "print-on-demand"].
// - Online Store sales channel: published via publishablePublish.
// - On update we sync productOptions (so newly-added sizes/frames actually
//   become valid option-values BEFORE we try to bulk-create variants for them).
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import skuMap from "../_shared/gelato-sku-map.json" with { type: "json" };
import {
  ensureShopifyAuth,
  shopifyAdmin,
  type ShopifyAuthError,
} from "../_shared/shopify-admin.ts";

// Mirrors src/lib/pricing.ts — used by the live "Personlig Karta" products.
// Speglar src/lib/pricing.ts. Hängare ingår som extra ramvärden under
// samma "Ram"-option. 13x18 har inga hängare (Gelato saknar SKU).
const POSTER_PRICES: Record<string, Record<string, number>> = {
  "13x18": { Ingen: 199, Vit: 349, Svart: 349, Ek: 369, "Valnöt": 369 },
  "21x30": { Ingen: 239, Vit: 399, Svart: 399, Ek: 429, "Valnöt": 429, "Hängare Vit": 339, "Hängare Svart": 339, "Hängare Ek": 349, "Hängare Valnöt": 349 },
  "30x40": { Ingen: 259, Vit: 559, Svart: 559, Ek: 589, "Valnöt": 589, "Hängare Vit": 439, "Hängare Svart": 439, "Hängare Ek": 449, "Hängare Valnöt": 449 },
  "40x50": { Ingen: 289, Vit: 749, Svart: 749, Ek: 789, "Valnöt": 789, "Hängare Vit": 489, "Hängare Svart": 489, "Hängare Ek": 499, "Hängare Valnöt": 499 },
  "50x70": { Ingen: 329, Vit: 919, Svart: 919, Ek: 969, "Valnöt": 969, "Hängare Vit": 589, "Hängare Svart": 589, "Hängare Ek": 599, "Hängare Valnöt": 599 },
  "70x100": { Ingen: 429, Vit: 1249, Svart: 1249, Ek: 1299, "Valnöt": 1299, "Hängare Vit": 729, "Hängare Svart": 729, "Hängare Ek": 749, "Hängare Valnöt": 749 },
};

const CANVAS_PRICES: Record<string, Record<string, number>> = {
  "20x25": { "2cm": 299, "4cm": 319 },
  "20x30": { "2cm": 349, "4cm": 379 },
  "30x40": { "2cm": 449, "4cm": 489 },
  "40x50": { "2cm": 599, "4cm": 649 },
  "40x60": { "2cm": 699, "4cm": 759 },
  "50x70": { "2cm": 799, "4cm": 869 },
  "60x80": { "2cm": 999, "4cm": 1099 },
  "70x100": { "2cm": 1299, "4cm": 1399 },
};

const ALUMINUM_PRICES: Record<string, Record<string, number>> = {
  "20x30": { Standard: 399 },
  "30x40": { Standard: 499 },
  "40x50": { Standard: 649 },
  "50x70": { Standard: 849 },
  "70x100": { Standard: 1199 },
};

const ACRYLIC_PRICES: Record<string, Record<string, number>> = {
  "20x30": { Standard: 499 },
  "30x40": { Standard: 699 },
  "40x50": { Standard: 899 },
  "50x70": { Standard: 1099 },
  "70x100": { Standard: 1599 },
};

type Kind = "poster" | "canvas" | "aluminum" | "acrylic";
const KIND_TO_SKU_KEY: Record<Kind, string> = {
  poster: "posters",
  canvas: "canvas",
  aluminum: "aluminum",
  acrylic: "acrylic",
};

type SkuMap = Record<string, Record<string, { portrait: string; landscape: string }>>;
const SKUS = skuMap as SkuMap;

function getUid(kind: Kind, size: string, variant: string): string | null {
  const block = SKUS[KIND_TO_SKU_KEY[kind]] ?? {};
  return block[`${size}|${variant}`]?.portrait ?? null;
}

// Butikens kampanjpriser — samma på alla produkter i Shopify (kontrollerat
// 2026-11-12 mot alla 46 editorprodukter). Där ett kampanjpris finns blir
// tabellpriset ovan jämförpris; övriga varianter har inget jämförpris.
const SALE_PRICES: Record<string, number> = {
  "poster|13x18|Ingen": 149, "poster|21x30|Ingen": 179, "poster|30x40|Ingen": 189,
  "poster|40x50|Ingen": 209, "poster|50x70|Ingen": 239, "poster|70x100|Ingen": 319,
  "canvas|20x25|2cm": 219, "canvas|20x25|4cm": 239, "canvas|20x30|2cm": 259, "canvas|20x30|4cm": 279,
  "canvas|30x40|2cm": 329, "canvas|30x40|4cm": 359, "canvas|40x50|2cm": 449, "canvas|40x50|4cm": 479,
  "canvas|40x60|2cm": 519, "canvas|40x60|4cm": 569, "canvas|50x70|2cm": 599, "canvas|50x70|4cm": 649,
  "canvas|60x80|2cm": 749, "canvas|60x80|4cm": 819, "canvas|70x100|2cm": 969, "canvas|70x100|4cm": 1049,
};

function listPrice(kind: Kind, size: string, variant: string): number {
  const table =
    kind === "poster" ? POSTER_PRICES
    : kind === "canvas" ? CANVAS_PRICES
    : kind === "aluminum" ? ALUMINUM_PRICES
    : ACRYLIC_PRICES;
  return table[size]?.[variant] ?? 0;
}

/** Pris som kunden betalar. */
function getPrice(kind: Kind, size: string, variant: string): number {
  return SALE_PRICES[`${kind}|${size}|${variant}`] ?? listPrice(kind, size, variant);
}

/** Jämförpris (ordinarie pris) när varianten har kampanjpris, annars null. */
function getCompareAt(kind: Kind, size: string, variant: string): number | null {
  const sale = SALE_PRICES[`${kind}|${size}|${variant}`];
  const list = listPrice(kind, size, variant);
  return sale && list > sale ? list : null;
}

interface SyncBody {
  handle: string;
}

interface VariantInput {
  optionValues: { optionName: string; name: string }[];
  price: string;
  compareAtPrice: string | null;
  inventoryItem: { sku: string; tracked: boolean };
  inventoryPolicy: "CONTINUE";
}

interface PlannedVariant {
  size: string;
  variant: string;
  sku: string;
  price: number;
  compareAt: number | null;
  /** Konsoliderad: visar Produkttyp-värdet ("Poster", "Canvas", ...). */
  productTypeLabel?: string;
}

interface OptionAxis {
  name: string;
  values: string[];
}

interface PlannedGroup {
  kind: Kind | "multi";
  productType: string;
  variantOptionName: string; // "Ram" / "Djup" / "Material" / "Finish" / "Utförande"
  /** Alla axlar i ordning (2 för legacy, 3 för konsoliderad). */
  optionAxes: OptionAxis[];
  /** True = konsoliderad multi-typ-produkt med Produkttyp-axel. */
  isConsolidated?: boolean;
  variants: PlannedVariant[];
  skipped: { size: string; variant: string; reason: string }[];
}

const CANONICAL_POSTER_FRAMES = [
  "Ingen", "Vit", "Svart", "Ek", "Valnöt",
  "Hängare Vit", "Hängare Svart", "Hängare Ek", "Hängare Valnöt",
];

function mergedPosterFrames(saved: string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const f of [...(saved ?? []), ...CANONICAL_POSTER_FRAMES]) {
    if (!seen.has(f)) { seen.add(f); out.push(f); }
  }
  return out;
}

function plan(template: any): PlannedGroup[] {
  const groups: PlannedGroup[] = [];
  const opts = template?.productOptions ?? {};

  const buildGroup = (
    kind: Kind,
    productType: string,
    variantOptionName: string,
    sizes: string[],
    variants: string[],
  ): PlannedGroup => {
    const g: PlannedGroup = {
      kind,
      productType,
      variantOptionName,
      optionAxes: [
        { name: "Storlek", values: sizes },
        { name: variantOptionName, values: variants },
      ],
      variants: [],
      skipped: [],
    };
    for (const size of sizes) {
      for (const v of variants) {
        const sku = getUid(kind, size, v);
        const price = getPrice(kind, size, v);
        if (!sku) { g.skipped.push({ size, variant: v, reason: "no Gelato SKU" }); continue; }
        if (!price) { g.skipped.push({ size, variant: v, reason: "no price" }); continue; }
        g.variants.push({ size, variant: v, sku, price, compareAt: getCompareAt(kind, size, v) });
      }
    }
    return g;
  };

  if (opts.poster?.enabled) {
    // Kanonisk ram-lista: säkerställer att alla hängar-värden alltid syncas
    // till Shopify, även för äldre mallar som sparades innan hängarna lades
    // till i defaults. plan() hoppar ändå över storlek/variant utan SKU/pris.
    groups.push(buildGroup("poster", "Poster", "Ram",
      opts.poster.allowedSizes ?? [], mergedPosterFrames(opts.poster.allowedFrames)));
  }
  if (opts.canvas?.enabled) {
    groups.push(buildGroup("canvas", "Canvas", "Djup",
      opts.canvas.allowedSizes ?? [], opts.canvas.allowedDepths ?? []));
  }
  if (opts.aluminum?.enabled) {
    groups.push(buildGroup("aluminum", "Aluminium", "Material",
      opts.aluminum.allowedSizes ?? [], opts.aluminum.allowedMaterials ?? []));
  }
  if (opts.acrylic?.enabled) {
    groups.push(buildGroup("acrylic", "Akryl", "Finish",
      opts.acrylic.allowedSizes ?? [], opts.acrylic.allowedFinishes ?? []));
  }
  return groups;
}

const PRODUCT_TYPE_LABELS: Record<Kind, string> = {
  poster: "Poster",
  canvas: "Canvas",
  aluminum: "Metallposter",
  acrylic: "Plexiglas",
};

const PRODUCT_TYPE_FROM_INTERNAL: Record<string, Kind> = {
  posters: "poster",
  poster: "poster",
  canvas: "canvas",
  aluminum: "aluminum",
  acrylic: "acrylic",
};

/** Konsoliderad: bygg EN PlannedGroup med 3 axlar (Produkttyp/Storlek/Utförande). */
function planConsolidated(template: any, enabledTypes: string[]): PlannedGroup {
  const opts = template?.productOptions ?? {};
  const variants: PlannedVariant[] = [];
  const skipped: PlannedGroup["skipped"] = [];
  const productTypeValues: string[] = [];
  const sizesUnion = new Set<string>();
  const variantsUnion = new Set<string>();

  const planFor = (kind: Kind): { sizes: string[]; names: string[] } | null => {
    if (kind === "poster" && opts.poster?.enabled) return { sizes: opts.poster.allowedSizes ?? [], names: mergedPosterFrames(opts.poster.allowedFrames) };
    if (kind === "canvas" && opts.canvas?.enabled) return { sizes: opts.canvas.allowedSizes ?? [], names: opts.canvas.allowedDepths ?? [] };
    if (kind === "aluminum" && opts.aluminum?.enabled) return { sizes: opts.aluminum.allowedSizes ?? [], names: opts.aluminum.allowedMaterials ?? [] };
    if (kind === "acrylic" && opts.acrylic?.enabled) return { sizes: opts.acrylic.allowedSizes ?? [], names: opts.acrylic.allowedFinishes ?? [] };
    return null;
  };

  for (const t of enabledTypes) {
    const kind = PRODUCT_TYPE_FROM_INTERNAL[t];
    if (!kind) continue;
    const block = planFor(kind);
    if (!block) continue;
    const label = PRODUCT_TYPE_LABELS[kind];
    if (!productTypeValues.includes(label)) productTypeValues.push(label);
    for (const size of block.sizes) {
      sizesUnion.add(size);
      for (const v of block.names) {
        const sku = getUid(kind, size, v);
        const price = getPrice(kind, size, v);
        if (!sku) { skipped.push({ size: `${label}/${size}`, variant: v, reason: "no Gelato SKU" }); continue; }
        if (!price) { skipped.push({ size: `${label}/${size}`, variant: v, reason: "no price" }); continue; }
        variantsUnion.add(v);
        variants.push({ size, variant: v, sku, price, compareAt: getCompareAt(kind, size, v), productTypeLabel: label });
      }
    }
  }

  return {
    kind: "multi",
    productType: "Personlig poster",
    variantOptionName: "Utförande",
    optionAxes: [
      { name: "Produkttyp", values: productTypeValues },
      { name: "Storlek", values: [...sizesUnion] },
      { name: "Utförande", values: [...variantsUnion] },
    ],
    isConsolidated: true,
    variants,
    skipped,
  };
}

const GET_PRODUCT_BY_HANDLE = `
  query getProductByHandle($handle: String!) {
    productByHandle(handle: $handle) {
      id
      handle
      title
      options { id name position values optionValues { id name } }
      variants(first: 250) {
        nodes { id sku title selectedOptions { name value } }
      }
    }
  }`;

const PRODUCT_CREATE = `
  mutation productCreate($input: ProductInput!) {
    productCreate(input: $input) {
      product { id handle title options { id name } }
      userErrors { field message }
    }
  }`;

const PRODUCT_UPDATE = `
  mutation productUpdate($input: ProductInput!) {
    productUpdate(input: $input) {
      product { id handle }
      userErrors { field message }
    }
  }`;

const PRODUCT_OPTION_UPDATE = `
  mutation productOptionUpdate(
    $productId: ID!
    $option: OptionUpdateInput!
    $optionValuesToAdd: [OptionValueCreateInput!]
    $optionValuesToDelete: [ID!]
    $variantStrategy: ProductOptionUpdateVariantStrategy
  ) {
    productOptionUpdate(
      productId: $productId
      option: $option
      optionValuesToAdd: $optionValuesToAdd
      optionValuesToDelete: $optionValuesToDelete
      variantStrategy: $variantStrategy
    ) {
      userErrors { field message code }
    }
  }`;

const PRODUCT_VARIANTS_BULK_CREATE = `
  mutation productVariantsBulkCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkCreate(productId: $productId, variants: $variants) {
      productVariants { id sku title }
      userErrors { field message }
    }
  }`;

const PRODUCT_VARIANTS_BULK_UPDATE = `
  mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants { id sku title }
      userErrors { field message }
    }
  }`;

const PRODUCT_VARIANTS_BULK_DELETE = `
  mutation productVariantsBulkDelete($productId: ID!, $variantsIds: [ID!]!) {
    productVariantsBulkDelete(productId: $productId, variantsIds: $variantsIds) {
      product { id }
      userErrors { field message }
    }
  }`;

const METAFIELDS_SET = `
  mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      userErrors { field message code }
    }
  }`;


const PUBLICATIONS_QUERY = `
  query publications {
    publications(first: 50) {
      nodes { id name }
    }
  }`;

const PUBLISHABLE_PUBLISH = `
  mutation publishablePublish($id: ID!, $input: [PublicationInput!]!) {
    publishablePublish(id: $id, input: $input) {
      userErrors { field message }
    }
  }`;

const GET_PRODUCT_FULL = `
  query getProductFull($id: ID!) {
    product(id: $id) {
      id
      title
      descriptionHtml
      tags
      status
      seo { title description }
      category { id }
    }
  }`;

// Shopify Standard Product Taxonomy GIDs.
// Branch: Home & Garden > Decor > Artwork > Posters, Prints, & Visual Artwork
//   hg-3-4-2-1  Posters
//   hg-3-4-2-2  Prints
//   hg-3-4-2-4  Paintings
const DEFAULT_CATEGORY_GID: Record<Kind, string> = {
  poster:   "gid://shopify/TaxonomyCategory/hg-3-4-2-1",
  canvas:   "gid://shopify/TaxonomyCategory/hg-3-4-2-4",
  aluminum: "gid://shopify/TaxonomyCategory/hg-3-4-2-1",
  acrylic:  "gid://shopify/TaxonomyCategory/hg-3-4-2-2",
};

function buildVariantInput(
  group: PlannedGroup,
  v: PlannedVariant,
): VariantInput {
  const optionValues: { optionName: string; name: string }[] = [];
  if (group.isConsolidated && v.productTypeLabel) {
    optionValues.push({ optionName: "Produkttyp", name: v.productTypeLabel });
  }
  optionValues.push({ optionName: "Storlek", name: v.size });
  optionValues.push({ optionName: group.variantOptionName, name: v.variant });
  // Shopify Admin API 2025-07: sku/barcode/tracked all live inside inventoryItem.
  return {
    optionValues,
    price: v.price.toFixed(2),
    compareAtPrice: v.compareAt ? v.compareAt.toFixed(2) : null,
    inventoryItem: {
      sku: v.sku,
      tracked: false,
    },
    inventoryPolicy: "CONTINUE",
  };
}

let cachedPublications: { id: string; name: string }[] | null = null;

async function getAllPublications(): Promise<{ id: string; name: string }[]> {
  if (cachedPublications) return cachedPublications;
  try {
    const r = await shopifyAdmin<{
      publications: { nodes: { id: string; name: string }[] };
    }>(PUBLICATIONS_QUERY);
    cachedPublications = r.publications.nodes ?? [];
    console.log(
      `[publications] found ${cachedPublications.length}: ${cachedPublications.map((p) => p.name).join(", ")}`,
    );
    return cachedPublications;
  } catch (e) {
    console.warn("publications query failed", e);
    cachedPublications = [];
    return [];
  }
}

/**
 * Publishes the product to ALL available publications (Online Store +
 * Headless/Storefront app channel + any extra sales channels). The
 * Storefront API token is bound to its own publication, so a product is
 * only readable via Storefront if it's published there — `status: ACTIVE`
 * alone is NOT enough. The previous implementation only published to the
 * first/Online-Store publication, which is why every template except the
 * legacy "personlig-karta" returned null from Storefront.
 */
async function publishToAllChannels(
  productId: string,
): Promise<{ published: string[]; failed: string[] }> {
  const pubs = await getAllPublications();
  if (!pubs.length) return { published: [], failed: [] };
  const published: string[] = [];
  const failed: string[] = [];
  for (const p of pubs) {
    try {
      const r = await shopifyAdmin<{
        publishablePublish: { userErrors: { message: string }[] };
      }>(PUBLISHABLE_PUBLISH, { id: productId, input: [{ publicationId: p.id }] });
      if (r.publishablePublish.userErrors.length) {
        console.warn(`publishablePublish errors for ${p.name}:`, r.publishablePublish.userErrors);
        failed.push(p.name);
      } else {
        published.push(p.name);
      }
    } catch (e) {
      console.warn(`publishablePublish failed for ${p.name}`, e);
      failed.push(p.name);
    }
  }
  return { published, failed };
}

/** Sync existing product's options so all desired sizes/frames exist as
 *  option-values BEFORE we try to bulk-create variants that reference them.
 *  Without this, productVariantsBulkCreate fails with "Option value 'Vit'
 *  is not allowed". */
async function syncProductOptions(
  productId: string,
  existing: {
    options: {
      id: string;
      name: string;
      values: string[];
      optionValues?: { id: string; name: string }[];
    }[];
  },
  group: PlannedGroup,
) {
  const desiredByOption: Record<string, string[]> = {};
  for (const axis of group.optionAxes) {
    if (axis.name === "Storlek") {
      desiredByOption["Storlek"] = [...new Set(group.variants.map((v) => v.size))];
    } else if (axis.name === "Produkttyp") {
      desiredByOption["Produkttyp"] = [...new Set(group.variants.map((v) => v.productTypeLabel ?? "").filter(Boolean))];
    } else {
      desiredByOption[axis.name] = [...new Set(group.variants.map((v) => v.variant))];
    }
  }

  for (const optionName of Object.keys(desiredByOption)) {
    const existingOpt = existing.options.find((o) => o.name === optionName);
    if (!existingOpt) continue; // brand-new options would need productOptionsCreate; skip for now
    const desired = desiredByOption[optionName];
    const existingValues = existingOpt.values ?? [];
    const missing = desired.filter((v) => !existingValues.includes(v));
    // Only add — never auto-delete option-values here. Removing values
    // would orphan variants and is a destructive action better left to
    // the explicit variant-delete step below.
    if (missing.length === 0) continue;
    try {
      const r = await shopifyAdmin<{
        productOptionUpdate: { userErrors: { message: string; code?: string }[] };
      }>(PRODUCT_OPTION_UPDATE, {
        productId,
        option: { id: existingOpt.id },
        optionValuesToAdd: missing.map((name) => ({ name })),
        variantStrategy: "LEAVE_AS_IS",
      });
      const errs = r.productOptionUpdate.userErrors.filter(
        (e) => e.code !== "OPTION_VALUE_ALREADY_EXISTS",
      );
      if (errs.length) {
        console.warn(`productOptionUpdate(${optionName}) userErrors`, errs);
      }
    } catch (e) {
      console.warn(`productOptionUpdate(${optionName}) failed`, e);
    }
  }
}

/** Build a stable key from a variant's selectedOptions (Storlek + Ram/Djup),
 *  independent of order. */
function normalizeOptionValue(s: string): string {
  return s.toLowerCase().replace(/\s*cm\s*$/i, "").replace(/\s+/g, " ").trim();
}

function optionKeyFromSelected(
  selected: { name: string; value: string }[],
  variantOptionName: string,
  isConsolidated = false,
): string | null {
  const size = selected.find((s) => s.name === "Storlek")?.value;
  const variant = selected.find((s) => s.name === variantOptionName)?.value;
  if (!size || !variant) return null;
  if (isConsolidated) {
    const ptype = selected.find((s) => s.name === "Produkttyp")?.value;
    if (!ptype) return null;
    return `${normalizeOptionValue(ptype)}|${normalizeOptionValue(size)}|${normalizeOptionValue(variant)}`;
  }
  return `${normalizeOptionValue(size)}|${normalizeOptionValue(variant)}`;
}

/** Fingerprint of an entire variant's selectedOptions, regardless of option
 *  names — used as a defensive duplicate-detector when option-name matching
 *  drifts between Lovable and Shopify. */
function fullComboFingerprint(selected: { name: string; value: string }[]): string {
  return selected
    .map((s) => normalizeOptionValue(s.value))
    .sort()
    .join("|");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = (await req.json()) as SyncBody;
    if (!body?.handle) {
      return new Response(JSON.stringify({ error: "handle required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await ensureShopifyAuth();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: cfg, error } = await supabase
      .from("product_configs")
      .select(
        "id,title,shopify_handle,template_slug,template,tags,category_gid,status,sales_channels,description_html,seo_title,seo_description,is_consolidated,enabled_product_types",
      )
      .eq("shopify_handle", body.handle)
      .maybeSingle();
    if (error || !cfg) {
      return new Response(JSON.stringify({ error: "config not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // template_slug = mall-id som binder ihop poster+canvas-varianter
    const templateSlug: string =
      (cfg as { template_slug?: string }).template_slug ??
      cfg.shopify_handle.replace(/-(poster|posters|canvas|aluminum|acrylic)$/i, "");

    const isConsolidated = !!(cfg as { is_consolidated?: boolean }).is_consolidated;
    const enabledTypes = ((cfg as { enabled_product_types?: string[] }).enabled_product_types ?? []);
    const groups: PlannedGroup[] = isConsolidated
      ? [planConsolidated(cfg.template, enabledTypes)]
      : plan(cfg.template);
    const totalVariants = groups.reduce((n, g) => n + g.variants.length, 0);
    const allSkipped = groups.flatMap((g) =>
      g.skipped.map((s) => ({ kind: g.kind, ...s })),
    );
    for (const g of groups) {
      console.log(
        `[plan] ${g.kind} planned=${g.variants.length} skipped=${g.skipped.length}` +
        (g.skipped.length ? ` (${g.skipped.map((s) => `${s.size}/${s.variant}:${s.reason}`).join(", ")})` : ""),
      );
    }

    if (totalVariants === 0) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "Inga giltiga varianter — kontrollera SKU-mappning och priser",
          skipped: allSkipped,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const cfgMeta = cfg as {
      id: string;
      tags?: string[];
      category_gid?: string | null;
      status?: string;
      sales_channels?: string[];
      description_html?: string | null;
      seo_title?: string | null;
      seo_description?: string | null;
    };

    // Load sync state (one row per product_config). Used for diff-protection
    // so we don't overwrite fields the merchant changed manually in Shopify.
    const { data: syncStateRow } = await supabase
      .from("shopify_sync_state")
      .select("id,last_synced_payload")
      .eq("product_config_id", cfgMeta.id)
      .maybeSingle();
    const lastSynced = (syncStateRow?.last_synced_payload ?? {}) as Record<
      string,
      Record<string, unknown>
    >;

    const results: any[] = [];
    const nextSyncedPayload: Record<string, Record<string, unknown>> = {};

    for (const group of groups) {
      const baseHandleHasNoSuffix = !/-(poster|posters|canvas|aluminum|acrylic)$/i.test(cfg.shopify_handle);
      // Konsoliderad: ALLTID base-handle och base-titel (mallnamn).
      const handleForKind = group.isConsolidated
        ? cfg.shopify_handle
        : (groups.length === 1 && baseHandleHasNoSuffix
          ? cfg.shopify_handle
          : `${templateSlug}-${group.kind}`);
      const titleForKind = group.isConsolidated
        ? cfg.title
        : (groups.length === 1 ? cfg.title : `${cfg.title} – ${group.productType}`);

      // Effective metadata (config values + sensible defaults).
      const tags = [
        ...new Set([
          templateSlug,
          group.isConsolidated ? "multi" : group.kind,
          "personalized",
          "print-on-demand",
          ...(cfgMeta.tags ?? []),
        ]),
      ];
      const categoryGid = cfgMeta.category_gid
        ?? (group.isConsolidated ? DEFAULT_CATEGORY_GID.poster : DEFAULT_CATEGORY_GID[group.kind as Kind]);
      const status = (cfgMeta.status ?? "DRAFT").toUpperCase();
      const descriptionHtml =
        cfgMeta.description_html ?? "<p>Personlig design — skapas i editorn.</p>";
      const seoTitle = cfgMeta.seo_title ?? titleForKind;
      const seoDescription = cfgMeta.seo_description ?? null;

      const existing = (await shopifyAdmin<{
        productByHandle: null | {
          id: string;
          options: { id: string; name: string; values: string[] }[];
          variants: { nodes: { id: string; sku: string; selectedOptions: { name: string; value: string }[] }[] };
        };
      }>(GET_PRODUCT_BY_HANDLE, { handle: handleForKind })).productByHandle;

      let productId: string;
      let mode: "create" | "update" = "update";
      let variantsCreated = 0;
      let variantsUpdated = 0;
      let variantsDeleted = 0;
      const skippedFields: { field: string; reason: string }[] = [];

      let effectiveExisting = existing;

      if (!existing) {
        // CREATE — write product shell with options. Shopify auto-creates one
        // variant per option combination; we then refetch and fall through to
        // the update branch so price/SKU/etc. get set via bulkUpdate.
        const created = await shopifyAdmin<{
          productCreate: { product: { id: string }; userErrors: { message: string }[] };
        }>(PRODUCT_CREATE, {
          input: {
            title: titleForKind,
            handle: handleForKind,
            productType: group.productType,
            status,
            tags,
            descriptionHtml,
            category: categoryGid,
            seo: { title: seoTitle, description: seoDescription },
            productOptions: group.optionAxes.map((axis) => ({
              name: axis.name,
              values: axis.values.map((name) => ({ name })),
            })),
          },
        });
        if (created.productCreate.userErrors.length) {
          throw new Error(
            `productCreate userErrors: ${created.productCreate.userErrors
              .map((e) => e.message)
              .join("; ")}`,
          );
        }
        mode = "create";

        // Refetch to get option IDs + auto-created variant IDs.
        const refetched = (await shopifyAdmin<{
          productByHandle: null | {
            id: string;
            options: { id: string; name: string; values: string[] }[];
            variants: { nodes: { id: string; sku: string; selectedOptions: { name: string; value: string }[] }[] };
          };
        }>(GET_PRODUCT_BY_HANDLE, { handle: handleForKind })).productByHandle;
        if (!refetched) throw new Error("productCreate succeeded but refetch returned null");
        effectiveExisting = refetched;
      }

      {
        const existing = effectiveExisting!;
        productId = existing.id;

        // Diff-protect text fields. Pull current Shopify state and compare to
        // last_synced_payload; if Shopify diverged, the merchant edited the
        // field in Shopify Admin and we must not overwrite it.
        const currentResp = await shopifyAdmin<{
          product: {
            title: string;
            descriptionHtml: string;
            tags: string[];
            status: string;
            seo: { title: string | null; description: string | null };
            category: { id: string } | null;
          } | null;
        }>(GET_PRODUCT_FULL, { id: productId });
        const current = currentResp.product;
        const last = (lastSynced[group.kind] ?? {}) as Record<string, unknown>;
        const isFirstSync = Object.keys(last).length === 0;

        function protectedValue<T>(field: string, desired: T, currentVal: T): T {
          if (isFirstSync) {
            // Seed: keep whatever Shopify currently has, don't overwrite.
            skippedFields.push({ field, reason: "first sync — seeded from Shopify" });
            return currentVal;
          }
          const lastVal = last[field];
          // If Shopify's current value differs from what we last sent, merchant edited it.
          if (
            lastVal !== undefined &&
            JSON.stringify(currentVal) !== JSON.stringify(lastVal)
          ) {
            skippedFields.push({ field, reason: "modified in Shopify" });
            return currentVal;
          }
          return desired;
        }

        const safeTitle = protectedValue("title", titleForKind, current?.title ?? titleForKind);
        const safeDescription = protectedValue(
          "descriptionHtml",
          descriptionHtml,
          current?.descriptionHtml ?? descriptionHtml,
        );
        const safeTags = protectedValue("tags", tags, current?.tags ?? tags);
        const safeStatus = protectedValue("status", status, current?.status ?? status);
        const safeSeoTitle = protectedValue(
          "seo.title",
          seoTitle,
          current?.seo?.title ?? seoTitle,
        );
        const safeSeoDescription = protectedValue(
          "seo.description",
          seoDescription,
          current?.seo?.description ?? seoDescription,
        );
        const safeCategory = protectedValue(
          "category",
          categoryGid,
          current?.category?.id ?? categoryGid,
        );

        await shopifyAdmin(PRODUCT_UPDATE, {
          input: {
            id: productId,
            title: safeTitle,
            productType: group.productType,
            tags: safeTags,
            status: safeStatus,
            descriptionHtml: safeDescription,
            category: safeCategory,
            seo: { title: safeSeoTitle, description: safeSeoDescription },
          },
        });

        // Skriv custom.template_slug-metafält så theme-snippeten kan koppla
        // Shopify-produkten till rätt mall även om handle/titel byts manuellt
        // i Shopify Admin. Tyst miss-failed (loggas) — sync ska inte falla.
        try {
          const metaRes = await shopifyAdmin<{
            metafieldsSet: { userErrors: { message: string; field?: string[] }[] };
          }>(METAFIELDS_SET, {
            metafields: [
              {
                ownerId: productId,
                namespace: "custom",
                key: "template_slug",
                type: "single_line_text_field",
                value: cfg.shopify_handle,
              },
            ],
          });
          if (metaRes.metafieldsSet.userErrors.length) {
            console.warn(
              "[sync] metafieldsSet warnings:",
              metaRes.metafieldsSet.userErrors.map((e) => e.message).join("; "),
            );
          }
        } catch (e) {
          console.warn("[sync] metafieldsSet failed:", (e as Error).message);
        }

        // Variants/options/SKU are ALWAYS source-of-truth from Lovable.
        await syncProductOptions(productId, existing, group);

        const existingByKey = new Map<string, typeof existing.variants.nodes[number]>();
        const existingByCombo = new Map<string, typeof existing.variants.nodes[number]>();
        for (const n of existing.variants.nodes) {
          const k = optionKeyFromSelected(n.selectedOptions, group.variantOptionName, group.isConsolidated);
          if (k) existingByKey.set(k, n);
          existingByCombo.set(fullComboFingerprint(n.selectedOptions), n);
        }
        const desiredKey = (v: PlannedVariant) =>
          group.isConsolidated && v.productTypeLabel
            ? `${normalizeOptionValue(v.productTypeLabel)}|${normalizeOptionValue(v.size)}|${normalizeOptionValue(v.variant)}`
            : `${normalizeOptionValue(v.size)}|${normalizeOptionValue(v.variant)}`;
        const desiredKeys = new Set(group.variants.map(desiredKey));

        const toCreate: VariantInput[] = [];
        const toUpdate: (VariantInput & { id: string })[] = [];
        const skippedDuplicates: string[] = [];
        for (const v of group.variants) {
          const key = desiredKey(v);
          const input = buildVariantInput(group, v);
          const ex = existingByKey.get(key);
          if (ex) {
            toUpdate.push({ ...input, id: ex.id });
            continue;
          }
          // Defensive fallback: maybe option-name matching drifted. Look up by
          // the unordered fingerprint of all option values.
          const fp = fullComboFingerprint(
            input.optionValues.map((o) => ({ name: o.optionName, value: o.name })),
          );
          const exByCombo = existingByCombo.get(fp);
          if (exByCombo) {
            toUpdate.push({ ...input, id: exByCombo.id });
            skippedDuplicates.push(`${v.size}/${v.variant} (matched by combo fingerprint)`);
            continue;
          }
          toCreate.push(input);
        }
        const toDelete = existing.variants.nodes
          .filter((n) => {
            const k = optionKeyFromSelected(n.selectedOptions, group.variantOptionName, group.isConsolidated);
            return k !== null && !desiredKeys.has(k);
          })
          .map((n) => n.id);

        console.log(
          `[sync] ${group.kind} existing=${existing.variants.nodes.length} ` +
            `toCreate=${toCreate.length} toUpdate=${toUpdate.length} toDelete=${toDelete.length} ` +
            `dupRescued=${skippedDuplicates.length}`,
        );
        if (toCreate.length) {
          console.log(
            `[sync] ${group.kind} toCreate keys:`,
            toCreate.map((i) => i.optionValues.map((o) => o.name).join("/")).join(", "),
          );
        }
        if (skippedDuplicates.length) {
          console.log(`[sync] ${group.kind} duplicate-rescued:`, skippedDuplicates.join(", "));
        }


        if (toCreate.length) {
          const r = await shopifyAdmin<{
            productVariantsBulkCreate: {
              productVariants: { id: string }[];
              userErrors: { message: string; field?: string[] }[];
            };
          }>(PRODUCT_VARIANTS_BULK_CREATE, { productId, variants: toCreate });
          if (r.productVariantsBulkCreate.userErrors.length) {
            throw new Error(
              `bulkCreate(update) userErrors: ${r.productVariantsBulkCreate.userErrors
                .map((e) => `${(e.field ?? []).join(".")} ${e.message}`)
                .join("; ")}`,
            );
          }
          variantsCreated = r.productVariantsBulkCreate.productVariants.length;
        }
        if (toUpdate.length) {
          const r = await shopifyAdmin<{
            productVariantsBulkUpdate: {
              productVariants: { id: string }[];
              userErrors: { message: string; field?: string[] }[];
            };
          }>(PRODUCT_VARIANTS_BULK_UPDATE, { productId, variants: toUpdate });
          if (r.productVariantsBulkUpdate.userErrors.length) {
            console.error("bulkUpdate errors", r.productVariantsBulkUpdate.userErrors);
          }
          variantsUpdated = r.productVariantsBulkUpdate.productVariants.length;
        }
        if (toDelete.length) {
          const remaining = existing.variants.nodes.length - toDelete.length + toCreate.length;
          if (remaining >= 1) {
            await shopifyAdmin(PRODUCT_VARIANTS_BULK_DELETE, {
              productId,
              variantsIds: toDelete,
            });
            variantsDeleted = toDelete.length;
          }
        }
      }

      // Publish to ALL Shopify publications (Online Store + Storefront/Headless
      // app channel + any extras). Required so Storefront API can read the
      // product — `status: ACTIVE` alone does NOT make it visible.
      const wantsOnlineStore = (cfgMeta.sales_channels ?? ["online_store"]).includes(
        "online_store",
      );
      const publishResult = wantsOnlineStore
        ? await publishToAllChannels(productId)
        : { published: [], failed: [] };

      // Snapshot what we just sent — this is what next sync will compare against.
      nextSyncedPayload[group.kind] = {
        title: titleForKind,
        descriptionHtml,
        tags,
        status,
        "seo.title": seoTitle,
        "seo.description": seoDescription,
        category: categoryGid,
      };

      results.push({
        kind: group.kind,
        handle: handleForKind,
        productId,
        mode,
        plannedVariants: group.variants.length,
        variantsCreated,
        variantsUpdated,
        variantsDeleted,
        publishedToOnlineStore: publishResult.published.length > 0,
        publishedTo: publishResult.published,
        publishFailed: publishResult.failed,
        skipped: group.skipped,
        skippedFields,
      });
    }

    // Persist sync state (upsert).
    if (syncStateRow) {
      await supabase
        .from("shopify_sync_state")
        .update({
          last_synced_at: new Date().toISOString(),
          last_synced_payload: nextSyncedPayload,
        })
        .eq("id", syncStateRow.id);
    } else {
      await supabase.from("shopify_sync_state").insert({
        product_config_id: cfgMeta.id,
        last_synced_at: new Date().toISOString(),
        last_synced_payload: nextSyncedPayload,
      });
    }

    return new Response(
      JSON.stringify({ ok: true, templateSlug, results, skipped: allSkipped }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    const code = (e as ShopifyAuthError | undefined)?.code;
    const source = (e as ShopifyAuthError | undefined)?.source;
    console.error("shopify-sync-template error:", code ?? "generic", msg);
    const status = code === "invalid_token" || code === "no_token" || code === "missing_scope"
      ? 401
      : 500;
    return new Response(
      JSON.stringify({ ok: false, error: msg, code, source }),
      { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
