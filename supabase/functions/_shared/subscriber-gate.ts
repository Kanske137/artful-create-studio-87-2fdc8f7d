// Prenumerant-gate (Fas 4): EN gratis AI-generering per enhet/session —
// därefter krävs registrerad e-post. Kontrollen körs i genereringsfunktionerna
// FÖRE det dyra Replicate-anropet. Räkningen sker server-sidigt mot
// generations-tabellen (endast lyckade körningar förbrukar gratisgenereringen;
// klientens cache-träffar når aldrig hit). Misslyckas någon DB-fråga släpps
// anropet igenom (fail-open): gaten är en affärsregel, inte en säkerhetsgräns,
// och får aldrig fälla kundflödet.
//
// Nödbroms utan omdeploy: sätt secret SUBSCRIBER_GATE_DISABLED=true.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

/** Antal gratisgenereringar per session/enhet innan e-post krävs.
 *  Akrams beslut 2026-07-24: 3 (höjt från 1). Spegla FREE_GENERATIONS_CLIENT
 *  i src/lib/subscriber-gate.ts vid ändring. */
const FREE_GENERATIONS_PER_SESSION = 3;
/** Tak per registrerad e-post per rullande dygn (missbruks-/kostnadsskydd).
 *  Akrams beslut 2026-07-22: 10/dygn. */
const MAX_GENERATIONS_PER_EMAIL_24H = 10;

/** Visas ordagrant av GAMLA cachade klientbundlar (fallback-vägen). Nya
 *  bundlar känner igen `code` och visar i18n-text + e-postdialogen i stället. */
const MSG_EMAIL_REQUIRED =
  "Du har använt dina kostnadsfria AI-genereringar. Ladda om sidan och ange din e-post för att fortsätta skapa.";
const MSG_RATE_LIMITED =
  "Du har nått dagens gräns för AI-genereringar. Försök igen imorgon.";

export type GateVerdict =
  | { allowed: true }
  | { allowed: false; code: "email_required" | "rate_limited"; userMessage: string };

export async function checkGenerationGate(
  sessionKey: string | null | undefined,
): Promise<GateVerdict> {
  try {
    if (Deno.env.get("SUBSCRIBER_GATE_DISABLED") === "true") return { allowed: true };
    // Gamla cachade bundlar skickar ingen sessionKey — släpp hellre igenom än
    // att fälla dem (nyckeln går inte att härleda server-sidigt).
    if (typeof sessionKey !== "string" || sessionKey.length < 8) return { allowed: true };

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { count, error: cntErr } = await db
      .from("generations")
      .select("id", { count: "exact", head: true })
      .eq("session_key", sessionKey)
      .eq("status", "succeeded");
    if (cntErr) throw new Error(cntErr.message);
    if ((count ?? 0) < FREE_GENERATIONS_PER_SESSION) return { allowed: true };

    const { data: session, error: sesErr } = await db
      .from("editor_sessions")
      .select("email")
      .eq("session_key", sessionKey)
      .maybeSingle();
    if (sesErr) throw new Error(sesErr.message);
    const email: string | null = session?.email ?? null;
    if (!email) {
      return { allowed: false, code: "email_required", userMessage: MSG_EMAIL_REQUIRED };
    }

    // Rate-limit per e-post, räknat över kundens ALLA sessioner/enheter.
    const { data: sessions, error: keysErr } = await db
      .from("editor_sessions")
      .select("session_key")
      .eq("email", email)
      .limit(200);
    if (keysErr) throw new Error(keysErr.message);
    const keys = (sessions ?? []).map((s: { session_key: string }) => s.session_key);
    if (keys.length > 0) {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { count: dayCount, error: dayErr } = await db
        .from("generations")
        .select("id", { count: "exact", head: true })
        .in("session_key", keys)
        .eq("status", "succeeded")
        .gte("created_at", since);
      if (dayErr) throw new Error(dayErr.message);
      if ((dayCount ?? 0) >= MAX_GENERATIONS_PER_EMAIL_24H) {
        return { allowed: false, code: "rate_limited", userMessage: MSG_RATE_LIMITED };
      }
    }

    return { allowed: true };
  } catch (e) {
    console.warn(
      "[subscriber-gate] check failed — failing open:",
      e instanceof Error ? e.message : e,
    );
    return { allowed: true };
  }
}
