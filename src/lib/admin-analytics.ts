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
  reference_image_url: string | null;
  output_image_url: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyFrom = (table: string): any =>
  (supabase as unknown as { from: (t: string) => unknown }).from(table);

export async function fetchSessions(limit = 150): Promise<SessionRow[]> {
  const { data, error } = await anyFrom("editor_sessions")
    .select("*")
    .order("last_seen_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as SessionRow[];
}

/** Senaste händelserna (nyast först). Aggregat byggs klientsidigt — vid låg
 *  trafik täcker limiten allt; annars visas en "visar senaste N"-notis. */
export async function fetchEvents(limit = 3000): Promise<EventRow[]> {
  const { data, error } = await anyFrom("editor_events")
    .select("*")
    .order("ts", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as EventRow[];
}

export async function fetchGenerations(limit = 500): Promise<GenerationRow[]> {
  const { data, error } = await anyFrom("generations")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as GenerationRow[];
}

/** Publik URL till kundvagnsminiatyren för ett design-id. */
export function cartPreviewUrl(designId: string): string {
  return supabase.storage.from("cart-previews").getPublicUrl(`${designId}.jpg`).data.publicUrl;
}

/** Länk till ordern i Shopify admin. */
export function shopifyOrderAdminUrl(shopifyOrderId: string): string {
  return `https://admin.shopify.com/store/wdxugd-yq/orders/${shopifyOrderId}`;
}
