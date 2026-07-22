// Edge function: prenumerant-gate-registrering (Fas 4).
//
// Tar emot kundens e-post (+ ev. frivilligt nyhetsbrevssamtycke), sparar
// GDPR-spåret i `subscribers`, kopplar e-posten till enhetens editor_session
// (gatens facit i _shared/subscriber-gate.ts) och synkar best-effort kunden
// till Shopify. Marknadsföringssamtycke sätts ENDAST när kunden kryssat i
// rutan — registreringen i sig är aldrig ett nyhetsbrevssamtycke
// (kopplingsförbudet). Shopify-fel stoppar aldrig registreringen;
// shopify_synced_at förblir null och kan backfyllas senare.
//
// Svarar alltid HTTP 200 med { ok } eller { ok: false, code } — klienten
// behöver aldrig tolka statuskoder.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { shopifyAdmin } from "../_shared/shopify-admin.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

async function syncShopifyCustomer(
  email: string,
  consent: boolean,
): Promise<{ customerId: string | null }> {
  const found = await shopifyAdmin<{
    customers: { nodes: Array<{ id: string; defaultEmailAddress: { marketingState: string } | null }> };
  }>(
    `query($q: String!) { customers(first: 1, query: $q) { nodes { id defaultEmailAddress { marketingState } } } }`,
    { q: `email:${email}` },
  );
  const existing = found.customers.nodes[0] ?? null;

  if (!existing) {
    const created = await shopifyAdmin<{
      customerCreate: { customer: { id: string } | null; userErrors: Array<{ message: string }> };
    }>(
      `mutation($input: CustomerInput!) { customerCreate(input: $input) { customer { id } userErrors { field message } } }`,
      {
        input: {
          email,
          tags: ["editor-gate"],
          ...(consent
            ? {
                emailMarketingConsent: {
                  marketingState: "SUBSCRIBED",
                  marketingOptInLevel: "SINGLE_OPT_IN",
                  consentUpdatedAt: new Date().toISOString(),
                },
              }
            : {}),
        },
      },
    );
    if (created.customerCreate.userErrors?.length) {
      throw new Error(created.customerCreate.userErrors.map((u) => u.message).join("; "));
    }
    return { customerId: created.customerCreate.customer?.id ?? null };
  }

  // Befintlig kund: uppgradera bara till SUBSCRIBED vid nytt samtycke —
  // aldrig något i motsatt riktning härifrån.
  if (consent && existing.defaultEmailAddress?.marketingState !== "SUBSCRIBED") {
    const upd = await shopifyAdmin<{
      customerEmailMarketingConsentUpdate: { userErrors: Array<{ message: string }> };
    }>(
      `mutation($input: CustomerEmailMarketingConsentUpdateInput!) {
        customerEmailMarketingConsentUpdate(input: $input) { userErrors { field message } }
      }`,
      {
        input: {
          customerId: existing.id,
          emailMarketingConsent: {
            marketingState: "SUBSCRIBED",
            marketingOptInLevel: "SINGLE_OPT_IN",
            consentUpdatedAt: new Date().toISOString(),
          },
        },
      },
    );
    const errs = upd.customerEmailMarketingConsentUpdate.userErrors;
    if (errs?.length) throw new Error(errs.map((u) => u.message).join("; "));
  }
  return { customerId: existing.id };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => null);
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const sessionKey = typeof body?.sessionKey === "string" ? body.sessionKey.trim() : "";
    const newsletterConsent = body?.newsletterConsent === true;
    const locale = typeof body?.locale === "string" ? body.locale.slice(0, 10) : null;

    if (!EMAIL_RE.test(email) || email.length > 320) {
      return json({ ok: false, code: "invalid_email" });
    }
    if (!/^[A-Za-z0-9-]{8,64}$/.test(sessionKey)) {
      return json({ ok: false, code: "invalid_session" });
    }

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // GDPR-spår: ett givet nyhetsbrevssamtycke skrivs aldrig över med false,
    // och tidsstämplas när det ges första gången.
    const { data: existing, error: exErr } = await db
      .from("subscribers")
      .select("email, newsletter_consent")
      .eq("email", email)
      .maybeSingle();
    if (exErr) throw new Error(exErr.message);
    const consentFinal = existing?.newsletter_consent === true || newsletterConsent;
    const consentAtPatch =
      existing?.newsletter_consent !== true && newsletterConsent
        ? { newsletter_consent_at: new Date().toISOString() }
        : {};
    const { error: upErr } = await db.from("subscribers").upsert(
      {
        email,
        newsletter_consent: consentFinal,
        ...consentAtPatch,
        locale,
        source_session_key: sessionKey,
      },
      { onConflict: "email" },
    );
    if (upErr) throw new Error(upErr.message);

    // Koppla enhetens session till e-posten. Saknas sessionsraden (klientens
    // vanliga insert kan ha fallerat) skapas den här — service role kringgår RLS.
    const now = new Date().toISOString();
    const { data: updated, error: sesErr } = await db
      .from("editor_sessions")
      .update({ email, email_linked_at: now })
      .eq("session_key", sessionKey)
      .select("id");
    if (sesErr) throw new Error(sesErr.message);
    if (!updated || updated.length === 0) {
      const { error: insErr } = await db.from("editor_sessions").insert({
        session_key: sessionKey,
        email,
        email_linked_at: now,
        locale,
      });
      if (insErr && insErr.code !== "23505") {
        console.warn("[subscriber-gate] session insert failed:", insErr.message);
      }
    }

    // Best-effort Shopify-synk — får aldrig blockera registreringen.
    let shopifySynced = false;
    try {
      const { customerId } = await syncShopifyCustomer(email, newsletterConsent);
      if (customerId) {
        shopifySynced = true;
        await db
          .from("subscribers")
          .update({ shopify_customer_id: customerId, shopify_synced_at: new Date().toISOString() })
          .eq("email", email);
      }
    } catch (e) {
      console.warn("[subscriber-gate] shopify sync failed:", e instanceof Error ? e.message : e);
    }

    console.log(`[subscriber-gate] registered session=${sessionKey.slice(0, 8)} consent=${newsletterConsent} shopifySynced=${shopifySynced}`);
    return json({ ok: true, shopifySynced });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("[subscriber-gate] error:", msg);
    return json({ ok: false, code: "server_error", error: msg }, 500);
  }
});
