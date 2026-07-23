// Kundfeedback per generering (Paket B). Fire-and-forget precis som
// analytics-spårningen — får aldrig störa kundflödet; fel loggas bara.
// design-id härleds ur resultat-URL:en (alla tre genereringsflödena döper
// filen till <designId>.<ext> i print-files).
import { supabase } from "@/integrations/supabase/client";
import { getSessionKey } from "@/lib/analytics";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyFrom = (table: string): any =>
  (supabase as unknown as { from: (t: string) => unknown }).from(table);

/** Plocka design-id ur en print-/resultat-URL (sista segmentet utan ändelse). */
export function designIdFromResultUrl(url: string): string | null {
  try {
    const last = new URL(url).pathname.split("/").pop() ?? "";
    const id = last.split(".")[0];
    return id.length > 0 ? id : null;
  } catch {
    return null;
  }
}

export async function sendGenerationFeedback(params: {
  designId: string;
  rating: "up" | "down";
  comment?: string;
  handle?: string | null;
  provider?: string | null;
}): Promise<void> {
  try {
    const { error } = await anyFrom("generation_feedback").insert({
      design_id: params.designId,
      session_key: getSessionKey(),
      handle: params.handle ?? null,
      provider: params.provider ?? null,
      rating: params.rating,
      comment: params.comment && params.comment.trim().length > 0 ? params.comment.trim().slice(0, 1000) : null,
    });
    if (error) console.warn("[feedback] insert misslyckades:", error.message);
  } catch (e) {
    console.warn("[feedback] fel:", e instanceof Error ? e.message : e);
  }
}
