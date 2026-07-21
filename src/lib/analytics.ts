// Lättviktig händelsespårning för kundeditorn (Fas 2 i analytics-planen).
//
// Principer:
//  - Ett anonymt sessions-id (UUID) i localStorage följer kunden mellan besök
//    och skickas med i varje edge-anrop + som `_session_id` i kundvagnen, så
//    orderwebhooken kan knyta köp → session i efterhand.
//  - All spårning är fire-and-forget och får ALDRIG störa editorn — varje
//    anrop sväljer sina egna fel (t.ex. innan tabellerna finns i databasen).
//  - Klienten (anon) kan bara SKRIVA händelser — aldrig läsa (RLS + revokes i
//    migrationen 20260721090000_editor_analytics.sql).
import { supabase } from "@/integrations/supabase/client";

// Tabellerna är nya och finns ännu inte i den genererade Database-typen —
// otypad vy av samma klient tills typerna regenererats av Lovable.
const db = supabase as unknown as {
  from: (table: string) => {
    insert: (row: Record<string, unknown>) => PromiseLike<{ error: { message: string } | null }>;
    upsert: (
      row: Record<string, unknown>,
      opts: { onConflict: string; ignoreDuplicates: boolean },
    ) => PromiseLike<{ error: { message: string } | null }>;
    update: (patch: Record<string, unknown>) => {
      eq: (col: string, val: string) => PromiseLike<{ error: { message: string } | null }>;
    };
  };
};

const SESSION_STORAGE_KEY = "arthena-session-key";
let cachedKey: string | null = null;

/** Stabilt anonymt sessions-id per enhet/webbläsare. Faller tillbaka på ett
 *  flyktigt id om localStorage är blockerat (t.ex. hårda iframe-policys). */
export function getSessionKey(): string {
  if (cachedKey) return cachedKey;
  const fresh = () =>
    (crypto as { randomUUID?: () => string }).randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  try {
    let k = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!k) {
      k = fresh();
      localStorage.setItem(SESSION_STORAGE_KEY, k);
    }
    cachedKey = k;
  } catch {
    cachedKey = `ephemeral-${fresh()}`;
  }
  return cachedKey;
}

export interface SessionContext {
  locale?: string;
  country?: string;
  handle?: string;
}

let sessionInserted = false;

/** Skapa/uppdatera sessionsraden. Anropas vid editor-öppning och produktbyte.
 *  Insert sker en gång per sidladdning; last_seen uppdateras varje gång. */
export function ensureSession(ctx: SessionContext): void {
  const key = getSessionKey();
  void (async () => {
    try {
      if (!sessionInserted) {
        sessionInserted = true;
        const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
        const device = /Mobi|Android|iPhone|iPad|iPod/i.test(ua) ? "mobile" : "desktop";
        await db.from("editor_sessions").upsert(
          {
            session_key: key,
            locale: ctx.locale ?? null,
            country: ctx.country ?? null,
            device,
            embedded: typeof window !== "undefined" && window.self !== window.top,
            first_handle: ctx.handle ?? null,
          },
          { onConflict: "session_key", ignoreDuplicates: true },
        );
      }
      await db
        .from("editor_sessions")
        .update({ last_seen_at: new Date().toISOString(), ...(ctx.locale ? { locale: ctx.locale } : {}) })
        .eq("session_key", key);
    } catch {
      /* spårning får aldrig störa editorn */
    }
  })();
}

/** Logga en händelse. designId/handle/productType i payload lyfts till egna
 *  kolumner (indexerade); resten hamnar i jsonb-payloaden. */
export function track(
  type: string,
  payload: Record<string, unknown> = {},
): void {
  const { designId, handle, productType, ...rest } = payload;
  void (async () => {
    try {
      await db.from("editor_events").insert({
        session_key: getSessionKey(),
        type,
        design_id: (designId as string | undefined) ?? null,
        handle: (handle as string | undefined) ?? null,
        product_type: (productType as string | undefined) ?? null,
        payload: rest,
      });
    } catch {
      /* spårning får aldrig störa editorn */
    }
  })();
}
