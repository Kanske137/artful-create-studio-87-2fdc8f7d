// Fysisk produktgeometri för Gelatos ram- och hängarprodukter.
// Källor: SKU-parametrarna i gelato-sku-map.json (frp_w12xt22-mm, w14xt20-mm,
// listlängder 229/310/410/510/710/1010 mm) + empirisk uppmätning i Gelatos
// egen produkteditor med mm-graderad testbild (2026-07-25):
//   • Ram: ~3,5–4 mm av trycket döljs per kant (utfall + ramfals) — verifierat
//     i både deras designcanvas och deras produkt-preview.
//   • Hängare: listen renderas ~21–22 mm hög, sticker ~3 mm ovanför pappers-
//     kanten och täcker ~18–19 mm av tryckets topp/botten.
// Tryckfilerna påverkas ALDRIG av detta — de är alltid full pappersyta.

/** Ramens frontbredd (frp_w12xt22-mm = 12 mm). */
export const FRAME_FRONT_CM = 1.2;

/** Hur mycket av TRYCKET som döljs under ramen per kant. */
export const FRAME_LIP_CM = 0.35;

/** Hängarlistens fronthöjd som Gelato renderar den. */
export const HANGER_SLAT_CM = 2.1;

/** Hur långt listen sticker upp ovanför papperskanten (topp; spegelvänt i botten). */
export const HANGER_SLAT_ABOVE_CM = 0.3;

/** Synlig täckning av trycket per list = SLAT − ABOVE (~18 mm). */
export const HANGER_COVER_CM = HANGER_SLAT_CM - HANGER_SLAT_ABOVE_CM;

/**
 * Listens överhäng utanför papperet per sida, från Gelatos listlängder:
 * 229 mm list på 210 mm papper (9,5 mm/sida); 310/300, 410/400, 510/500,
 * 710/700, 1010/1000 (5 mm/sida).
 */
export function hangerOverhangCm(paperWcm: number): number {
  return paperWcm <= 21 ? 0.95 : 0.5;
}

/**
 * Canvas: officiell tryckfilsspec (support.gelato.com artikel 8996347
 * "How do I upload my design for a canvas?"):
 *   slim (2 cm):  fil = front + 2×34 mm wrap + 2×15 mm bleed  (200×300 → 298×398)
 *   thick (4 cm): fil = front + 2×40 mm wrap + 2×15 mm bleed  (200×300 → 310×410)
 * Wrap-zonen är djupet + baksidesvik; bleed därutöver. Skickas för lite yta
 * autoskalar Gelatos preflight upp filen → motivet zoomas in på framsidan.
 */
export const CANVAS_BLEED_CM = 1.5;

/** Wrap-zonens bredd per sida (djup + baksidesvik) enligt filspecen. */
export function canvasWrapExtCm(depthCm: number): number {
  return depthCm >= 4 ? 4.0 : 3.4;
}
