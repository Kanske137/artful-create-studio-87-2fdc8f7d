// Färdiga startmallar för sporttavlorna ("Skapa mall" → Startmall):
// Triathlontavla, Vasaloppstavla och Klassikertavla.
//
// Formspråk: en figur eller grafik för grenen plus namn, lopp, sträckor och
// tider (inte lopptavlans ruttkarta). Varje mall har fyra stilar som kunden
// växlar mellan; alla stilar delar fält-id, så det kunden fyllt i följer
// med vid byte. Lagren byggs av scripts/sport-seeds/build.py, som också
// ritar grafiken i public/sport/ — ändra där och kör om skriptet i stället
// för att redigera JSON-filerna för hand.
import type { Template } from "@/lib/template-schema";
import triathlon from "./seeds/triathlon.json";
import vasaloppet from "./seeds/vasaloppet.json";
import klassiker from "./seeds/klassiker.json";

export type SportSeedKey = "triathlon" | "vasaloppet" | "klassiker";

type SeedPart = Pick<
  Template,
  | "orientations"
  | "defaultOrientation"
  | "defaultLayoutName"
  | "defaultLayout"
  | "extraLayouts"
  | "contentVariants"
  | "contentVariantLabel"
  | "defaultContentVariantId"
  | "i18n"
>;

export const SPORT_SEEDS: Record<SportSeedKey, SeedPart> = {
  triathlon: triathlon as unknown as SeedPart,
  vasaloppet: vasaloppet as unknown as SeedPart,
  klassiker: klassiker as unknown as SeedPart,
};

/** Förslag på titel och handle när startmallen väljs i "Skapa mall". */
export const SPORT_PRESET_META: Record<SportSeedKey, { label: string; hint: string; title: string }> = {
  triathlon: { label: "Triathlontavla", hint: "Sim, cykel, löpning, fyra stilar", title: "Triathlontavla" },
  vasaloppet: { label: "Vasaloppstavla", hint: "Sälen–Mora, kontroller, fyra stilar", title: "Vasaloppstavla" },
  klassiker: { label: "Klassikertavla", hint: "En svensk klassiker, fyra stilar", title: "Klassikertavla" },
};

/** Kundens textfält tål längre texter än standardmallarnas 24 tecken
 *  (t.ex. "Mitt första långdistanstriathlon"). */
export const SPORT_MAX_CHARS = 60;

/** Lägg sporttavlans stilar, varianter och översättningar på en mall med
 *  valda produkttyper (storlekar och material kommer från basmallen). */
export function applySportSeed(base: Template, key: SportSeedKey): Template {
  const seed = SPORT_SEEDS[key];
  return {
    ...base,
    ...structuredClone(seed),
    productOptions: { ...base.productOptions, allowedFonts: undefined },
    sizeOverrides: {},
  };
}
