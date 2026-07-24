// Dataåtkomst för admin-Analytics (Fas 3). Läser sessioner, händelser och
// genereringar via den inloggade admin-sessionen — RLS-läspolicys på
// databasnivå kräver admin-e-posten, så anropen returnerar tomt/fel för
// alla andra. Tabellerna finns ännu inte i den genererade Database-typen,
// därav den otypade vyn av klienten.
import { supabase } from "@/integrations/supabase/client";

export interface SessionRow {
  id: string;
  session_key: string;
  created_at: string;
  last_seen_at: string;
  locale: string | null;
  country: string | null;
  device: string | null;
  embedded: boolean | null;
  first_handle: string | null;
  email: string | null;
  email_linked_at: string | null;
}

export interface EventRow {
  id: number;
  session_key: string;
  ts: string;
  type: string;
  design_id: string | null;
  handle: string | null;
  product_type: string | null;
  payload: Record<string, unknown>;
}

export interface GenerationRow {
  id: string;
  session_key: string | null;
  design_id: string | null;
  created_at: string;
  completed_at: string | null;
  handle: string | null;
  layer_id: string | null;
  subject_kind: string | null;
  provider: string | null;
  style_id: string | null;
  style_label: string | null;
  status: string;
  error: string | null;
  duration_ms: number | null;
  input_image_url: string | null;
  /** Alla uppladdade bilder (multiface) — äldre rader har bara singularen. */
  input_image_urls: string[] | null;
  reference_image_url: string | null;
  output_image_url: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyFrom = (table: string): any =>
  (supabase as unknown as { from: (t: string) => unknown }).from(table);

export async function fetchSessions(limit = 500): Promise<SessionRow[]> {
  const { data, error } = await anyFrom("editor_sessions")
    .select("*")
    .order("last_seen_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as SessionRow[];
}

/** Senaste händelserna (nyast först). Aggregat byggs klientsidigt — vid låg
 *  trafik täcker limiten allt; annars visas en "visar senaste N"-notis. */
export async function fetchEvents(limit = 5000): Promise<EventRow[]> {
  const { data, error } = await anyFrom("editor_events")
    .select("*")
    .order("ts", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as EventRow[];
}

export async function fetchGenerations(limit = 1000): Promise<GenerationRow[]> {
  const { data, error } = await anyFrom("generations")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as GenerationRow[];
}

export interface FeedbackRow {
  id: string;
  created_at: string;
  design_id: string;
  session_key: string | null;
  handle: string | null;
  provider: string | null;
  rating: "up" | "down";
  comment: string | null;
}

/** Kundfeedback per generering (Paket B), nyast först. */
export async function fetchFeedback(limit = 1000): Promise<FeedbackRow[]> {
  const { data, error } = await anyFrom("generation_feedback")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as FeedbackRow[];
}

export interface SummaryCounts {
  sessions: number;
  generations: number;
  generationsOk: number;
  cartAdds: number;
  orders: number;
  feedbackUp: number;
  feedbackDown: number;
}

/** Riktiga räknare via count-frågor — påverkas inte av listornas hämtningstak.
 *  Sessioner räknas som aktiva ELLER skapade inom perioden (last_seen_at kan
 *  historiskt släpa — se migration 20260724130000). */
export async function fetchSummaryCounts(sinceIso: string): Promise<SummaryCounts> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const countOf = async (build: (q: any) => any): Promise<number> => {
    const { count, error } = await build(null);
    if (error) throw new Error(error.message);
    return count ?? 0;
  };
  const [sessions, generations, generationsOk, cartAdds, orders, feedbackUp, feedbackDown] =
    await Promise.all([
      countOf(() =>
        anyFrom("editor_sessions")
          .select("*", { count: "exact", head: true })
          .or(`last_seen_at.gte.${sinceIso},created_at.gte.${sinceIso}`),
      ),
      countOf(() =>
        anyFrom("generations").select("*", { count: "exact", head: true }).gte("created_at", sinceIso),
      ),
      countOf(() =>
        anyFrom("generations")
          .select("*", { count: "exact", head: true })
          .eq("status", "succeeded")
          .gte("created_at", sinceIso),
      ),
      countOf(() =>
        anyFrom("editor_events")
          .select("*", { count: "exact", head: true })
          .eq("type", "add_to_cart")
          .gte("ts", sinceIso),
      ),
      countOf(() =>
        anyFrom("editor_events")
          .select("*", { count: "exact", head: true })
          .eq("type", "order_placed")
          .gte("ts", sinceIso),
      ),
      countOf(() =>
        anyFrom("generation_feedback")
          .select("*", { count: "exact", head: true })
          .eq("rating", "up")
          .gte("created_at", sinceIso),
      ),
      countOf(() =>
        anyFrom("generation_feedback")
          .select("*", { count: "exact", head: true })
          .eq("rating", "down")
          .gte("created_at", sinceIso),
      ),
    ]);
  return { sessions, generations, generationsOk, cartAdds, orders, feedbackUp, feedbackDown };
}

/** Publik URL till kundvagnsminiatyren för ett design-id. */
export function cartPreviewUrl(designId: string): string {
  return supabase.storage.from("cart-previews").getPublicUrl(`${designId}.jpg`).data.publicUrl;
}

/** Länk till ordern i Shopify admin. */
export function shopifyOrderAdminUrl(shopifyOrderId: string): string {
  return `https://admin.shopify.com/store/wdxugd-yq/orders/${shopifyOrderId}`;
}
