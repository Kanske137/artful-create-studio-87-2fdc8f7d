// Prenumerant-gate (Fas 4), klientsidan. Regel: EN gratis AI-generering per
// enhet — därefter krävs e-post. Servern är facit (genereringsfunktionerna
// svarar med code=email_required när gratisgenereringen är förbrukad); det
// här lagret ger sömlös UX ovanpå:
//  • pre-flight: visa dialogen direkt när vi redan VET att gratis är använt
//    (localStorage-flagga) i stället för att vänta på serverns svar,
//  • svarshantering: öppna dialogen vid email_required och kör om anropet
//    EN gång efter lyckad registrering.
// Dialogen monteras en gång i EditorPage och öppnas via requestSubscriberGate().
import { create } from "zustand";
import { toast } from "sonner";

import i18n from "@/i18n";
import { supabase } from "@/integrations/supabase/client";
import { getSessionKey } from "@/lib/analytics";

const EMAIL_KEY = "arthena-subscriber-email";
const GEN_COUNT_KEY = "arthena-gen-count";
/** Spegel av serverns FREE_GENERATIONS_PER_SESSION — håll i synk. */
const FREE_GENERATIONS_CLIENT = 3;

export function hasRegisteredEmail(): boolean {
  try {
    return !!localStorage.getItem(EMAIL_KEY);
  } catch {
    return false;
  }
}

/** Anropas vid varje LYCKAD generering — räknaren driver pre-flighten.
 *  Servern är alltid facit (räknar succeeded-rader per session). */
export function markFreeGenerationUsed(): void {
  try {
    const n = parseInt(localStorage.getItem(GEN_COUNT_KEY) ?? "0", 10) || 0;
    localStorage.setItem(GEN_COUNT_KEY, String(n + 1));
  } catch {
    /* privat läge utan storage — servern gatar ändå */
  }
}

function freeAllowanceExhausted(): boolean {
  try {
    const n = parseInt(localStorage.getItem(GEN_COUNT_KEY) ?? "0", 10) || 0;
    return n >= FREE_GENERATIONS_CLIENT;
  } catch {
    return false;
  }
}

/** Pre-flight för genereringssektionerna: anropas FÖRE busy-overlayen startar
 *  så dialogen visas utan spinner bakom sig, och flödet fortsätter automatiskt
 *  in i genereringen när kunden registrerat sig. true = kör vidare. */
export async function ensureSubscriberGatePassed(): Promise<boolean> {
  if (!freeAllowanceExhausted() || hasRegisteredEmail()) return true;
  return requestSubscriberGate();
}

interface SubscriberGateState {
  open: boolean;
  resolve: ((registered: boolean) => void) | null;
}

export const useSubscriberGateStore = create<SubscriberGateState>(() => ({
  open: false,
  resolve: null,
}));

let pending: Promise<boolean> | null = null;

/** Öppna e-postdialogen. true = kunden registrerade sig, false = stängde. */
export function requestSubscriberGate(): Promise<boolean> {
  if (pending) return pending;
  pending = new Promise<boolean>((outer) => {
    useSubscriberGateStore.setState({
      open: true,
      resolve: (registered: boolean) => {
        pending = null;
        useSubscriberGateStore.setState({ open: false, resolve: null });
        outer(registered);
      },
    });
  });
  return pending;
}

/** Registrera e-post via edge-funktionen och cacha lokalt.
 *  Kastar Error("invalid_email") eller Error("generic"). */
export async function registerSubscriberEmail(
  email: string,
  newsletterConsent: boolean,
): Promise<void> {
  const { data, error } = await supabase.functions.invoke("subscriber-gate", {
    body: { email, sessionKey: getSessionKey(), newsletterConsent, locale: i18n.language },
  });
  const payload = data as { ok?: boolean; code?: string } | null;
  if (error || !payload?.ok) {
    throw new Error(payload?.code === "invalid_email" ? "invalid_email" : "generic");
  }
  try {
    localStorage.setItem(EMAIL_KEY, email);
  } catch {
    /* ignorera */
  }
}

export interface GatedInvokeResult<T> {
  data: T | null;
  error: unknown;
  /** true = gaten har redan hanterat utfallet (dialog stängd / limit-toast)
   *  — anroparen ska bara avbryta tyst. */
  handled?: boolean;
}

/** Som supabase.functions.invoke, men med prenumerant-gaten inbyggd. */
export async function invokeWithSubscriberGate<T>(
  fn: string,
  body: Record<string, unknown>,
): Promise<GatedInvokeResult<T>> {
  if (freeAllowanceExhausted() && !hasRegisteredEmail()) {
    const registered = await requestSubscriberGate();
    if (!registered) return { data: null, error: null, handled: true };
  }
  let res = await supabase.functions.invoke(fn, { body });
  let code = gateCode(res.data);
  if (code === "email_required") {
    // Servern vet bäst — synka flaggan även om lokala lagret rensats.
    markFreeGenerationUsed();
    const registered = await requestSubscriberGate();
    if (!registered) return { data: null, error: null, handled: true };
    res = await supabase.functions.invoke(fn, { body });
    code = gateCode(res.data);
  }
  if (code === "rate_limited") {
    toast.error(i18n.t("subGate.rateLimited"));
    return { data: null, error: null, handled: true };
  }
  return { data: (res.data as T) ?? null, error: res.error };
}

function gateCode(data: unknown): string | null {
  const d = data as { error?: string; code?: string } | null;
  return d && d.error === "subscriber-gate" && typeof d.code === "string" ? d.code : null;
}
