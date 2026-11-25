// Motortest för personporträtt (admin), 2026-11-25. Se
// supabase/functions/_shared/portrait-engines.ts för motorerna.
//
// ?aiEngine=nbpro|nb2|seedream|current i editorns adress kör personporträtt
// (en eller flera personer) med vald motor. Funktionerna kräver admin-
// inloggning — för alla andra ignoreras parametern och dagens kedja körs.

export type PortraitEngine = "current" | "nbpro" | "nb2" | "seedream";

export const PORTRAIT_ENGINES: Array<{
  id: PortraitEngine;
  label: string;
  /** Ungefärligt pris per färdig bild i kronor (Replicate, ~10 kr/USD, 25 nov 2026). */
  costSek: number;
  /** Pris för parporträtt när det skiljer sig (dagens kedja gör två ansiktsbyten). */
  costPairSek?: number;
}> = [
  { id: "current", label: "I dag: ansiktsbyte + Nano Banana 2 4K", costSek: 1.6, costPairSek: 1.8 },
  { id: "nbpro", label: "Nano Banana Pro 2K, ett steg", costSek: 1.5 },
  { id: "nb2", label: "Nano Banana 2 2K, ett steg", costSek: 1.0 },
  { id: "seedream", label: "Seedream 4.5 2K, ett steg", costSek: 0.4 },
];

export function parsePortraitEngine(v: unknown): PortraitEngine | null {
  return v === "current" || v === "nbpro" || v === "nb2" || v === "seedream" ? v : null;
}

/** Motorn ur editorns adress (?aiEngine=…), eller null. */
export const AI_ENGINE_OVERRIDE: PortraitEngine | null = (() => {
  try {
    return parsePortraitEngine(new URLSearchParams(window.location.search).get("aiEngine"));
  } catch {
    return null;
  }
})();

/** session_key för adminens motortester. Räknas inte i editorns analys. */
export const PORTRAIT_TEST_SESSION_KEY = "portrait-test";
