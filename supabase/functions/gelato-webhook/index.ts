// Gelato → Shopify fulfillment & leveranssync.
//
// Verifierad mot Gelatos webhook-docs:
// https://dashboard.gelato.com/docs/webhooks/
//
// Event-typer vi hanterar:
//   * order_status_updated              → huvudflödet; skapar Shopify-fulfillment
//                                         + tracking + kund-mejl när status=shipped.
//                                         Postar även fulfillment-event för
//                                         in_transit/out_for_delivery/delivered.
//   * order_item_tracking_code_updated  → tracking-info på root; uppdaterar
//                                         tracking-kolumner och postar event
//                                         om vi redan har en fulfillment.
//   * order_item_status_updated         → för granulärt för fulfillment;
//                                         loggas bara i gelato_orders.
//   * order_delivery_estimate_updated   → loggas bara.
//
// Auth: shared secret via ?secret=... eller header x-gelato-secret.
// JWT-verifiering är AVSTÄNGD (publik webhook, se supabase/config.toml).
//
// Idempotens:
//   - Samma Gelato-event id (raw.id) ⇒ no-op.
//   - Samma last_status som redan är satt ⇒ no-op för status-transitions.
//   - shopify_fulfillment_gid återanvänds när det redan finns.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { shopifyAdmin } from "../_shared/shopify-admin.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-gelato-secret",
};

// Gelato-statuses som vi behandlar som "skickad" och därmed triggar fulfillment.
// Se https://dashboard.gelato.com/docs/orders/order_details/#order-statuses
const SHIP_STATUSES = new Set(["shipped", "shipped_to_recipient"]);

// Gelato-status → Shopify FulfillmentEvent-status.
const EVENT_MAP: Record<string, string> = {
  in_transit: "IN_TRANSIT",
  out_for_delivery: "OUT_FOR_DELIVERY",
  delivered: "DELIVERED",
};

const OPEN_FOS = `
  query($id: ID!) {
    order(id: $id) {
      displayFulfillmentStatus
      fulfillmentOrders(first: 10) {
        nodes { id status supportedActions { action } }
      }
    }
  }`;

const CREATE_FULFILLMENT = `
  mutation($fulfillment: FulfillmentInput!) {
    fulfillmentCreate(fulfillment: $fulfillment) {
      fulfillment { id status }
      userErrors { field message }
    }
  }`;

const CREATE_EVENT = `
  mutation($fulfillmentEvent: FulfillmentEventInput!) {
    fulfillmentEventCreate(fulfillmentEvent: $fulfillmentEvent) {
      fulfillmentEvent { id status }
      userErrors { field message }
    }
  }`;

interface TrackingInfo {
  number: string | null;
  url: string | null;
  company: string | null;
}

interface ParsedEvent {
  eventType: string;           // Gelatos event-namn, t.ex. "order_status_updated"
  eventId: string | null;      // Gelatos event-id, t.ex. "os_5e5680ce494f6"
  status: string;              // fulfillmentStatus / status (lower-case)
  gelatoOrderId: string | null;
  shopifyOrderName: string | null; // vår orderReferenceId (ex "#1042")
  trackingInfo: TrackingInfo;
  fulfillmentCount: number;    // för loggning
}

function pickTracking(event: any): { info: TrackingInfo; count: number } {
  // order_item_tracking_code_updated: allt på root.
  if (event?.event === "order_item_tracking_code_updated") {
    return {
      info: {
        number: event.trackingCode ?? null,
        url: event.trackingUrl ?? null,
        company: event.shipmentMethodName ?? "Gelato",
      },
      count: event.trackingCode ? 1 : 0,
    };
  }

  // order_status_updated: items[].fulfillments[]
  let count = 0;
  let first: any = null;
  const items = Array.isArray(event?.items) ? event.items : [];
  for (const item of items) {
    const fs = Array.isArray(item?.fulfillments) ? item.fulfillments : [];
    for (const f of fs) {
      count += 1;
      if (!first && f?.trackingCode) first = f;
    }
  }
  if (!first && items[0]?.fulfillments?.[0]) first = items[0].fulfillments[0];

  return {
    info: {
      number: first?.trackingCode ?? null,
      url: first?.trackingUrl ?? null,
      company: first?.shipmentMethodName ?? "Gelato",
    },
    count,
  };
}

function parseGelatoEvent(event: any): ParsedEvent {
  const eventType = String(event?.event ?? "").trim();
  const eventId = event?.id ? String(event.id) : null;

  // Status per event-typ:
  //   order_status_updated       → fulfillmentStatus
  //   order_item_status_updated  → status
  //   order_item_tracking_code_updated → alltid "shipped"-ish (använd eventType)
  //   order_delivery_estimate_updated  → ingen status
  const status = String(
    event?.fulfillmentStatus ?? event?.status ?? "",
  )
    .toLowerCase()
    .trim();

  const gelatoOrderId = event?.orderId ? String(event.orderId) : null;
  const shopifyOrderName = event?.orderReferenceId
    ? String(event.orderReferenceId)
    : null;

  const { info: trackingInfo, count: fulfillmentCount } = pickTracking(event);

  return {
    eventType,
    eventId,
    status,
    gelatoOrderId,
    shopifyOrderName,
    trackingInfo,
    fulfillmentCount,
  };
}

async function ensureFulfillment(
  shopifyOrderGid: string,
  trackingInfo: TrackingInfo,
  existingFulfillmentGid: string | null,
): Promise<string | null> {
  if (existingFulfillmentGid) return existingFulfillmentGid;

  const data = await shopifyAdmin<{
    order: {
      displayFulfillmentStatus: string;
      fulfillmentOrders: { nodes: Array<{ id: string; status: string; supportedActions: Array<{ action: string }> }> };
    } | null;
  }>(OPEN_FOS, { id: shopifyOrderGid });

  if (!data.order) {
    console.warn(`[gelato-webhook] no shopify order found for ${shopifyOrderGid}`);
    return null;
  }
  if (data.order.displayFulfillmentStatus === "FULFILLED") {
    console.log(`[gelato-webhook] ${shopifyOrderGid} already FULFILLED outside our flow`);
    return null;
  }

  const openFOs = (data.order.fulfillmentOrders.nodes ?? [])
    .filter(
      (fo) =>
        fo.status === "OPEN" &&
        fo.supportedActions.some((a) => a.action === "CREATE_FULFILLMENT"),
    )
    .map((fo) => ({ fulfillmentOrderId: fo.id }));

  if (openFOs.length === 0) {
    console.warn(`[gelato-webhook] ${shopifyOrderGid} has no open fulfillment orders`);
    return null;
  }

  const res = await shopifyAdmin<{
    fulfillmentCreate: {
      fulfillment: { id: string; status: string } | null;
      userErrors: Array<{ field: string[]; message: string }>;
    };
  }>(CREATE_FULFILLMENT, {
    fulfillment: {
      lineItemsByFulfillmentOrder: openFOs,
      trackingInfo: {
        number: trackingInfo.number,
        url: trackingInfo.url,
        company: trackingInfo.company,
      },
      notifyCustomer: true,
    },
  });

  const errs = res.fulfillmentCreate.userErrors ?? [];
  if (errs.length) {
    throw new Error(`fulfillmentCreate: ${JSON.stringify(errs)}`);
  }
  return res.fulfillmentCreate.fulfillment?.id ?? null;
}

async function postEvent(fulfillmentGid: string, status: string) {
  const res = await shopifyAdmin<{
    fulfillmentEventCreate: {
      fulfillmentEvent: { id: string; status: string } | null;
      userErrors: Array<{ field: string[]; message: string }>;
    };
  }>(CREATE_EVENT, {
    fulfillmentEvent: {
      fulfillmentId: fulfillmentGid,
      status,
      happenedAt: new Date().toISOString(),
    },
  });
  const errs = res.fulfillmentEventCreate.userErrors ?? [];
  if (errs.length) {
    // Logga men kasta inte — Gelato har redan levererat eventet, vi vill inte loopa retries.
    console.error(`[gelato-webhook] fulfillmentEventCreate userErrors`, errs);
  }
}

async function findLink(
  supabase: SupabaseClient<any, "public", "public", any, any>,
  parsed: ParsedEvent,
): Promise<any | null> {
  if (parsed.gelatoOrderId) {
    const r = await supabase
      .from("gelato_orders")
      .select("*")
      .eq("gelato_order_id", parsed.gelatoOrderId)
      .maybeSingle();
    if (r.data) return r.data;
  }
  if (parsed.shopifyOrderName) {
    const r = await supabase
      .from("gelato_orders")
      .select("*")
      .eq("shopify_order_name", parsed.shopifyOrderName)
      .maybeSingle();
    if (r.data) return r.data;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // 1) Authenticate
    const url = new URL(req.url);
    const secret =
      req.headers.get("x-gelato-secret") ?? url.searchParams.get("secret");
    const expected = Deno.env.get("GELATO_WEBHOOK_SECRET");
    if (!expected) {
      console.error("[gelato-webhook] GELATO_WEBHOOK_SECRET not configured");
      return new Response("misconfigured", { status: 500, headers: corsHeaders });
    }
    if (secret !== expected) {
      return new Response("unauthorized", { status: 401, headers: corsHeaders });
    }

    const event = await req.json().catch(() => null);
    if (!event) {
      return new Response("bad json", { status: 400, headers: corsHeaders });
    }

    const parsed = parseGelatoEvent(event);
    console.log(
      `[gelato-webhook] event=${parsed.eventType} id=${parsed.eventId} ` +
        `status=${parsed.status || "-"} gelatoOrderId=${parsed.gelatoOrderId} ` +
        `ref=${parsed.shopifyOrderName} fulfillments=${parsed.fulfillmentCount} ` +
        `tracking=${parsed.trackingInfo.number ?? "-"}`,
    );

    if (!parsed.eventType) {
      return new Response("no event type", { status: 200, headers: corsHeaders });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 2) Hitta vår länk-rad. Sök på gelato_order_id → shopify_order_name.
    const link = await findLink(supabase, parsed);
    if (!link) {
      console.warn(
        `[gelato-webhook] no gelato_orders row matched event ` +
          `(orderId=${parsed.gelatoOrderId}, ref=${parsed.shopifyOrderName})`,
      );
      return new Response("no link", { status: 200, headers: corsHeaders });
    }

    // 3) Idempotens per Gelato-event id.
    const lastEventId = (link.raw as any)?.id ?? null;
    if (parsed.eventId && lastEventId === parsed.eventId) {
      return new Response("duplicate event id", { status: 200, headers: corsHeaders });
    }

    const shopifyOrderGid =
      link.shopify_order_gid ?? `gid://shopify/Order/${link.shopify_order_id}`;

    // ------------------------------------------------------------------
    // 4) Route på event-typ
    // ------------------------------------------------------------------

    // 4a) Rena logg-events (ingen Shopify-action).
    if (
      parsed.eventType === "order_item_status_updated" ||
      parsed.eventType === "order_delivery_estimate_updated"
    ) {
      await supabase
        .from("gelato_orders")
        .update({
          raw: event,
          shopify_order_gid: shopifyOrderGid,
          ...(parsed.gelatoOrderId && !link.gelato_order_id
            ? { gelato_order_id: parsed.gelatoOrderId }
            : {}),
        })
        .eq("id", link.id);
      return new Response("recorded", { status: 200, headers: corsHeaders });
    }

    // 4b) Tracking-only event: uppdatera tracking + posta event om vi har en fulfillment.
    if (parsed.eventType === "order_item_tracking_code_updated") {
      const patch: Record<string, unknown> = {
        raw: event,
        shopify_order_gid: shopifyOrderGid,
        tracking_code: parsed.trackingInfo.number ?? link.tracking_code,
        tracking_url: parsed.trackingInfo.url ?? link.tracking_url,
        carrier: parsed.trackingInfo.company ?? link.carrier,
      };
      if (parsed.gelatoOrderId && !link.gelato_order_id) {
        patch.gelato_order_id = parsed.gelatoOrderId;
      }
      // Om vi redan skapat fulfillment: posta ett IN_TRANSIT-event så att kunden
      // ser tracking-uppdateringen i Shopifys order-timeline.
      if (link.shopify_fulfillment_gid) {
        await postEvent(link.shopify_fulfillment_gid, "IN_TRANSIT");
      }
      await supabase.from("gelato_orders").update(patch).eq("id", link.id);
      return new Response("tracking updated", { status: 200, headers: corsHeaders });
    }

    // 4c) order_status_updated: huvudflödet.
    if (parsed.eventType !== "order_status_updated") {
      // Okänd event-typ — logga och bail. Vi vill inte råka posta något fel.
      console.warn(`[gelato-webhook] unhandled event type: ${parsed.eventType}`);
      return new Response("unhandled event", { status: 200, headers: corsHeaders });
    }

    // Idempotens på status-transition.
    if (parsed.status && link.last_status === parsed.status) {
      return new Response("duplicate status", { status: 200, headers: corsHeaders });
    }

    const isShip = SHIP_STATUSES.has(parsed.status);
    const eventStatus = EVENT_MAP[parsed.status];

    // 4c-i) Statuses vi inte agerar på (created/printed/in_production…) — logga bara.
    if (!isShip && !eventStatus) {
      await supabase
        .from("gelato_orders")
        .update({
          last_status: parsed.status,
          raw: event,
          shopify_order_gid: shopifyOrderGid,
          ...(parsed.gelatoOrderId && !link.gelato_order_id
            ? { gelato_order_id: parsed.gelatoOrderId }
            : {}),
        })
        .eq("id", link.id);
      return new Response("recorded", { status: 200, headers: corsHeaders });
    }

    // 4c-ii) Säkerställ fulfillment (skapas + mejlas kund första gången).
    const fulfillmentGid = await ensureFulfillment(
      shopifyOrderGid,
      parsed.trackingInfo,
      link.shopify_fulfillment_gid ?? null,
    );

    if (!fulfillmentGid) {
      await supabase
        .from("gelato_orders")
        .update({
          last_status: parsed.status,
          raw: event,
          shopify_order_gid: shopifyOrderGid,
        })
        .eq("id", link.id);
      return new Response("no open fulfillment orders", { status: 200, headers: corsHeaders });
    }

    // 4c-iii) Post status-event om sådan mappning finns.
    if (eventStatus) {
      await postEvent(fulfillmentGid, eventStatus);
    }

    // 4c-iv) Persist.
    const patch: Record<string, unknown> = {
      shopify_order_gid: shopifyOrderGid,
      shopify_fulfillment_gid: fulfillmentGid,
      last_status: parsed.status,
      tracking_code: parsed.trackingInfo.number ?? link.tracking_code,
      tracking_url: parsed.trackingInfo.url ?? link.tracking_url,
      carrier: parsed.trackingInfo.company ?? link.carrier,
      raw: event,
    };
    if (parsed.gelatoOrderId && !link.gelato_order_id) {
      patch.gelato_order_id = parsed.gelatoOrderId;
    }
    if (isShip && !link.fulfilled_at) {
      patch.fulfilled_at = new Date().toISOString();
    }
    if (eventStatus === "DELIVERED" && !link.delivered_at) {
      patch.delivered_at = new Date().toISOString();
    }

    await supabase.from("gelato_orders").update(patch).eq("id", link.id);

    return new Response("ok", { status: 200, headers: corsHeaders });
  } catch (e) {
    console.error("[gelato-webhook] error", e);
    // 5xx ⇒ Gelato gör retry
    return new Response("error", { status: 500, headers: corsHeaders });
  }
});
