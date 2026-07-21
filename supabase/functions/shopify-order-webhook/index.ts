// Receives Shopify orders/paid webhooks. Verifies HMAC, then asynchronously
// generates print files and submits a Gelato order.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import GELATO_SKU_MAP_JSON from "../_shared/gelato-sku-map.json" with { type: "json" };

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-shopify-hmac-sha256, x-shopify-topic, x-shopify-shop-domain",
};

const SHOPIFY_API_VERSION = "2025-07";

// ============================================================================
// Gelato SKU map — single source of truth shared with shopify-sync-template.
// ============================================================================
const GELATO_SKU_MAP = GELATO_SKU_MAP_JSON as Record<
  string,
  Record<string, { portrait: string; landscape: string }>
>;

type ProductType = "posters" | "canvas" | "aluminum" | "acrylic";

function normalizeProductType(raw: string | null | undefined): ProductType | null {
  if (!raw) return null;
  const v = raw.toLowerCase().trim();
  if (v === "poster" || v === "posters") return "posters";
  if (v === "canvas") return "canvas";
  if (v === "aluminum" || v === "aluminium" || v === "metallic" || v === "metallposter") return "aluminum";
  if (v === "acrylic" || v === "akryl" || v === "plexiglas") return "acrylic";
  return null;
}

function productTypeFromHandle(handle: string): ProductType | null {
  const h = (handle || "").toLowerCase();
  if (h.endsWith("-acrylic") || h.includes("acrylic") || h.includes("akryl")) return "acrylic";
  if (h.endsWith("-aluminum") || h.includes("aluminum") || h.includes("aluminium") || h.includes("metallic")) return "aluminum";
  if (h.includes("canvas")) return "canvas";
  if (h.includes("poster") || h.includes("karta")) return "posters";
  return null;
}

interface ResolveResult {
  productUid: string | null;
  source: "db" | "local-exact" | "local-size-fallback" | "missing";
  detail: string;
}

function resolveProductUid(args: {
  handle: string;
  size: string;
  variant?: string | null;
  orientation: "portrait" | "landscape";
  productType?: ProductType | null;
  dbMap?: Record<string, Record<string, string>> | null;
}): ResolveResult {
  const { handle, size, variant, orientation, productType, dbMap } = args;

  // 1) DB-mapping (per-handle override). Konsoliderade mallar har nycklar som
  //    "<type>|<size>|<variant>" — prova den först, annars legacy "size|variant".
  if (variant && dbMap) {
    if (productType && dbMap[`${productType}|${size}`]?.[variant]) {
      return { productUid: dbMap[`${productType}|${size}`][variant], source: "db", detail: `${productType}|${size}|${variant}` };
    }
    if (dbMap[size]?.[variant]) {
      return { productUid: dbMap[size][variant], source: "db", detail: `${size}|${variant}` };
    }
  }

  const ptype = productType ?? productTypeFromHandle(handle);
  if (!ptype) {
    return { productUid: null, source: "missing", detail: `unknown product type for handle="${handle}"` };
  }
  const localForType = GELATO_SKU_MAP[ptype] ?? {};

  // 2) Local exact size|variant
  if (variant && localForType[`${size}|${variant}`]?.[orientation]) {
    return {
      productUid: localForType[`${size}|${variant}`][orientation],
      source: "local-exact",
      detail: `${ptype} ${size}|${variant} ${orientation}`,
    };
  }

  // 3) Size-only fallback ONLY if variant is missing entirely.
  // If a variant was specified but didn't match exactly, we MUST fail loudly
  // instead of silently shipping the wrong product (e.g. "Hängare Ek" → flat poster).
  if (!variant) {
    const sizeMatch = Object.entries(localForType).find(([k]) => k.startsWith(`${size}|`));
    if (sizeMatch && sizeMatch[1]?.[orientation]) {
      return {
        productUid: sizeMatch[1][orientation],
        source: "local-size-fallback",
        detail: `${ptype} ${sizeMatch[0]} ${orientation} (no variant supplied)`,
      };
    }
  }

  return {
    productUid: null,
    source: "missing",
    detail: `no exact SKU for ${ptype} size=${size} variant=${variant ?? "(none)"} orientation=${orientation}`,
  };
}

async function verifyHmac(rawBody: string, hmacHeader: string | null, secret: string): Promise<boolean> {
  if (!hmacHeader) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const digest = btoa(String.fromCharCode(...new Uint8Array(sig)));
  if (digest.length !== hmacHeader.length) return false;
  let mismatch = 0;
  for (let i = 0; i < digest.length; i++) mismatch |= digest.charCodeAt(i) ^ hmacHeader.charCodeAt(i);
  return mismatch === 0;
}

function getProp(props: Array<{ name: string; value: string }> | undefined, name: string): string | null {
  if (!Array.isArray(props)) return null;
  const p = props.find((x) => x.name === name);
  return p ? String(p.value) : null;
}

async function processOrder(supabase: any, order: any) {
  const shopifyOrderId = String(order.id);
  const shopifyOrderName = String(order.name ?? "");
  const projectUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const gelatoKey = Deno.env.get("GELATO_API_KEY");
  const shopifyDomain = Deno.env.get("SHOPIFY_STORE_PERMANENT_DOMAIN")
    ?? Deno.env.get("SHOPIFY_STORE_DOMAIN")
    ?? "wdxugd-yq.myshopify.com";
  const shopifyToken = Deno.env.get("SHOPIFY_ACCESS_TOKEN");

  if (!gelatoKey) {
    await supabase.from("gelato_orders").update({ status: "gelato_failed", error: "GELATO_API_KEY missing" })
      .eq("shopify_order_id", shopifyOrderId);
    return;
  }

  // Load DB overrides per handle
  const { data: configs } = await supabase.from("product_configs").select("shopify_handle, gelato_sku_map");
  const configByHandle: Record<string, any> = {};
  (configs ?? []).forEach((c: any) => { configByHandle[c.shopify_handle] = c; });

  const items: any[] = [];
  const printErrors: string[] = [];
  const skuErrors: string[] = [];

  for (const li of order.line_items ?? []) {
    const props = li.properties as Array<{ name: string; value: string }> | undefined;

    // Observability: log every property name + value-length received per line
    // item. Critical for diagnosing missing _print_file_url after a checkout.
    if (Array.isArray(props) && props.length) {
      const summary = props.map((p) => `${p.name}(${String(p.value ?? "").length})`).join(", ");
      console.log(`[shopify-webhook] line ${li.id}: properties received: ${summary}`);
    } else {
      console.log(`[shopify-webhook] line ${li.id}: NO properties received`);
    }

    const size = getProp(props, "_size");
    const variant = getProp(props, "_variant");
    const orientation = (getProp(props, "_orientation") ?? "portrait") as "portrait" | "landscape";
    const handle = getProp(props, "_product_handle") ?? li.product_handle ?? "";
    const clientPrintFileUrl = getProp(props, "_print_file_url");
    const designSource = getProp(props, "_design_source") ?? "map";
    // Konsoliderade produkter skickar _product_type explicit. Fallback för
    // gamla beställningar: utled från handle-suffix.
    const productType =
      normalizeProductType(getProp(props, "_product_type"))
      ?? productTypeFromHandle(handle);

    if (!size) continue; // not an editor item

    // ---- analytics (Fas 2): knyt köpet till editor-sessionen. Körs FÖRE
    // print-fil-kontrollen — ett köp är ett köp även om tryckfilen saknas.
    // Får aldrig störa orderflödet; alla fel sväljs och loggas bara.
    try {
      const sessionKey = getProp(props, "_session_id");
      const designId = getProp(props, "_design_id");
      if (sessionKey) {
        await supabase.from("editor_events").insert({
          session_key: sessionKey,
          type: "order_placed",
          design_id: designId,
          handle: handle || null,
          product_type: productType,
          payload: {
            shopifyOrderId,
            orderName: shopifyOrderName,
            lineItemId: String(li.id),
            quantity: li.quantity ?? 1,
            size,
            variant,
          },
        });
        // Koppla e-post → session (endast om sessionen saknar e-post) så
        // Analytics-sidan kan visa individ, inte bara anonymt sessions-id.
        const email = order.email ?? order.contact_email ?? null;
        if (email) {
          await supabase
            .from("editor_sessions")
            .update({ email, email_linked_at: new Date().toISOString() })
            .eq("session_key", sessionKey)
            .is("email", null);
        }
      }
    } catch (e) {
      console.warn(
        "[shopify-webhook] analytics log failed:",
        e instanceof Error ? e.message : e,
      );
    }

    console.log(
      `[shopify-webhook] line ${li.id}: clientPrintFileUrl=${clientPrintFileUrl ?? "MISSING"} source=${designSource}`
    );

    // 1) Print file: REQUIRED to come from the client (single pipeline). No
    //    legacy server-side fallback — that path renders text incorrectly and
    //    cannot disable map labels, which produced broken Gelato orders.
    if (!clientPrintFileUrl) {
      printErrors.push(`line ${li.id}: missing _print_file_url (source=${designSource})`);
      continue;
    }
    const printUrl = clientPrintFileUrl;
    console.log(`[shopify-webhook] line ${li.id}: using client print file ${printUrl}`);


    // 2) Resolve productUid
    const cfg = configByHandle[handle];
    const resolved = resolveProductUid({
      handle,
      size: size!,
      variant,
      orientation,
      productType,
      dbMap: cfg?.gelato_sku_map ?? null,
    });

    console.log(
      `[shopify-webhook] line ${li.id}: handle="${handle}" size=${size} variant=${variant} orient=${orientation} → source=${resolved.source} uid=${resolved.productUid ?? "NONE"} (${resolved.detail})`
    );

    if (!resolved.productUid) {
      skuErrors.push(`line ${li.id}: ${resolved.detail}`);
      continue;
    }

    items.push({
      itemReferenceId: String(li.id),
      productUid: resolved.productUid,
      files: [{ type: "default", url: printUrl }],
      quantity: li.quantity ?? 1,
    });
  }

  if (items.length === 0) {
    const status = printErrors.length ? "pending_manual"
      : skuErrors.length ? "sku_not_found"
      : "skipped";
    const error = printErrors.length
      ? `missing_print_file_url — ${printErrors.join(" | ")}`
      : [...skuErrors].join(" | ") || "no editor items in order";
    console.warn(`[shopify-webhook] order ${shopifyOrderId} → ${status}: ${error}`);
    await supabase.from("gelato_orders").update({ status, error })
      .eq("shopify_order_id", shopifyOrderId);
    return;
  }

  // 3) Build Gelato order
  const ship = order.shipping_address ?? order.billing_address ?? {};
  const gelatoBody = {
    orderType: "order",
    orderReferenceId: shopifyOrderName || shopifyOrderId,
    customerReferenceId: shopifyOrderId,
    currency: order.currency ?? "SEK",
    items,
    shippingAddress: {
      firstName: ship.first_name ?? "",
      lastName: ship.last_name ?? "",
      addressLine1: ship.address1 ?? "",
      addressLine2: ship.address2 ?? "",
      city: ship.city ?? "",
      postCode: ship.zip ?? "",
      country: ship.country_code ?? "SE",
      state: ship.province_code ?? "",
      email: order.email ?? order.contact_email ?? "",
      phone: ship.phone ?? order.phone ?? "",
    },
  };

  const partialErrors = [...printErrors, ...skuErrors];

  try {
    const res = await fetch("https://order.gelatoapis.com/v4/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-KEY": gelatoKey },
      body: JSON.stringify(gelatoBody),
    });
    const json = await res.json();
    if (!res.ok) {
      console.error(`[shopify-webhook] Gelato API failed ${res.status}:`, JSON.stringify(json).slice(0, 800));
      await supabase.from("gelato_orders").update({
        status: "gelato_failed",
        error: `${res.status}: ${JSON.stringify(json).slice(0, 800)}`,
        payload: gelatoBody,
      }).eq("shopify_order_id", shopifyOrderId);

      if (shopifyDomain && shopifyToken) {
        await fetch(`https://${shopifyDomain}/admin/api/${SHOPIFY_API_VERSION}/orders/${shopifyOrderId}.json`, {
          method: "PUT",
          headers: { "X-Shopify-Access-Token": shopifyToken, "Content-Type": "application/json" },
          body: JSON.stringify({ order: { id: shopifyOrderId, note: `Gelato fail: ${res.status}` } }),
        }).catch(() => {});
      }
      return;
    }
    console.log(`[shopify-webhook] Gelato order submitted: ${json.id ?? json.orderId}`);
    await supabase.from("gelato_orders").update({
      status: "submitted",
      gelato_order_id: json.id ?? json.orderId ?? null,
      payload: gelatoBody,
      error: partialErrors.length ? partialErrors.join(" | ") : null,
    }).eq("shopify_order_id", shopifyOrderId);
  } catch (e) {
    await supabase.from("gelato_orders").update({
      status: "gelato_failed", error: String(e), payload: gelatoBody,
    }).eq("shopify_order_id", shopifyOrderId);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const rawBody = await req.text();
  const hmac = req.headers.get("X-Shopify-Hmac-Sha256");

  const secret = Deno.env.get("SHOPIFY_API_SECRET") ?? Deno.env.get("SHOPIFY_WEBHOOK_SECRET");
  if (secret) {
    const ok = await verifyHmac(rawBody, hmac, secret);
    if (!ok) {
      console.warn("HMAC verification failed");
      return new Response("invalid hmac", { status: 401, headers: corsHeaders });
    }
  } else {
    console.warn("No SHOPIFY_API_SECRET configured — accepting webhook unverified (DEV)");
  }

  let order: any;
  try { order = JSON.parse(rawBody); } catch {
    return new Response("bad json", { status: 400, headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const shopifyOrderId = String(order.id);
  const { error: insertErr } = await supabase.from("gelato_orders").insert({
    shopify_order_id: shopifyOrderId,
    shopify_order_name: order.name ?? null,
    status: "received",
  });

  if (insertErr) {
    if (String(insertErr.code) === "23505" || String(insertErr.message).includes("duplicate")) {
      return new Response("already processed", { status: 200, headers: corsHeaders });
    }
    console.error("insert error", insertErr);
    return new Response("db error", { status: 500, headers: corsHeaders });
  }

  // @ts-ignore — EdgeRuntime is available in Supabase Edge Functions
  EdgeRuntime.waitUntil(processOrder(supabase, order));

  return new Response("ok", { status: 200, headers: corsHeaders });
});
