// Prisplan 19 november 2026 (beslut av Akram, kalkyl mot Gelatos priser).
//
// - Ramar: förslag B som ordinarie pris, utan jämförpris.
// - Canvas: lämnar julkampanjen. Nytt ordinarie pris ≈ tidigare ordinarie
//   × 0,85, utan jämförpris (prisinformationslagen 7 a § tillåter inte att
//   ett högre pris visas som rea mot 449 kr när canvasen kostat 329 kr).
// - Danmark och Finland (fasta prislistor): ramar, canvas, metall och akryl
//   satta för samma marginal som i Sverige, beräknat på Gelatos kostnader per
//   land. Posters (pågående kampanj) och hängare ändras inte.
// - Rabatter: "Köp 2"-rabatten och ARTHENA15 gäller bara posters utan ram och
//   posters med hängare.
//
// Ren modul utan Deno-beroenden så att den kan testas med vitest.

export type Market = "SE" | "DK" | "FI";

type Table = Record<string, Record<string, number>>;

const FRAMES = ["Vit", "Svart", "Ek", "Valnöt"];

function frames(rows: Record<string, [number, number]>): Table {
  // [vit/svart, ek/valnöt]
  const t: Table = {};
  for (const [size, [light, wood]] of Object.entries(rows)) {
    t[size] = { Vit: light, Svart: light, Ek: wood, "Valnöt": wood };
  }
  return t;
}

function canvas(rows: Record<string, [number, number]>): Table {
  const t: Table = {};
  for (const [size, [d2, d4]] of Object.entries(rows)) t[size] = { "2cm": d2, "4cm": d4 };
  return t;
}

function single(rows: Record<string, number>): Table {
  const t: Table = {};
  for (const [size, p] of Object.entries(rows)) t[size] = { Standard: p };
  return t;
}

export interface MarketPlan {
  frame: Table;
  canvas: Table;
  metal: Table;
  acrylic: Table;
}

export const PLAN: Record<Market, MarketPlan> = {
  SE: {
    frame: frames({
      "13x18": [399, 419], "21x30": [449, 479], "30x40": [649, 679],
      "40x50": [849, 889], "50x70": [1049, 1099], "70x100": [1599, 1699],
    }),
    canvas: canvas({
      "20x25": [259, 269], "20x30": [299, 319], "30x40": [379, 419], "40x50": [509, 549],
      "40x60": [599, 649], "50x70": [679, 739], "60x80": [849, 929], "70x100": [1099, 1189],
    }),
    // Metall och akryl ändras inte i Sverige.
    metal: {},
    acrylic: {},
  },
  DK: {
    frame: frames({
      "13x18": [289, 299], "21x30": [329, 359], "30x40": [469, 499],
      "40x50": [639, 669], "50x70": [859, 899], "70x100": [1299, 1349],
    }),
    canvas: canvas({
      "20x25": [159, 189], "20x30": [189, 229], "30x40": [209, 269], "40x50": [339, 389],
      "40x60": [389, 509], "50x70": [529, 619], "60x80": [659, 779], "70x100": [829, 989],
    }),
    metal: single({ "20x30": 289, "30x40": 319, "40x50": 469, "50x70": 609, "70x100": 859 }),
    acrylic: single({ "20x30": 319, "30x40": 499, "40x50": 639, "50x70": 789, "70x100": 1149 }),
  },
  FI: {
    frame: frames({
      "13x18": [49.95, 54.95], "21x30": [54.95, 64.95], "30x40": [69.95, 74.95],
      "40x50": [99, 109], "50x70": [129, 139], "70x100": [189, 199],
    }),
    canvas: canvas({
      "20x25": [24.95, 44.95], "20x30": [29.95, 64.95], "30x40": [34.95, 49.95], "40x50": [44.95, 64.95],
      "40x60": [69.95, 79.95], "50x70": [79.95, 94.95], "60x80": [99, 139], "70x100": [129, 169],
    }),
    metal: single({ "20x30": 49.95, "30x40": 64.95, "40x50": 89.95, "50x70": 129, "70x100": 169 }),
    acrylic: single({ "20x30": 54.95, "30x40": 89.95, "40x50": 119, "50x70": 149, "70x100": 219 }),
  },
};

export interface ParsedTitle {
  type: string;
  size: string;
  variant: string;
}

/** "Poster / 30x40 / Vit" → { type: "Poster", size: "30x40", variant: "Vit" } */
export function parseVariantTitle(title: string): ParsedTitle | null {
  const parts = (title ?? "").split(" / ").map((s) => s.trim());
  if (parts.length !== 3) return null;
  return { type: parts[0], size: parts[1], variant: parts[2] };
}

/** Nytt pris för en variant på en marknad, eller null om varianten inte ändras. */
export function targetPrice(market: Market, title: string): number | null {
  const p = parseVariantTitle(title);
  if (!p) return null;
  const plan = PLAN[market];
  if (p.type === "Poster" && FRAMES.includes(p.variant)) return plan.frame[p.size]?.[p.variant] ?? null;
  if (p.type === "Canvas") return plan.canvas[p.size]?.[p.variant] ?? null;
  if (p.type === "Metallposter") return plan.metal[p.size]?.[p.variant] ?? null;
  if (p.type === "Plexiglas") return plan.acrylic[p.size]?.[p.variant] ?? null;
  return null;
}

/** Varianter som "Köp 2"-rabatten och ARTHENA15 gäller: poster utan ram och poster med hängare. */
export function isPosterOrHanger(title: string): boolean {
  const p = parseVariantTitle(title);
  if (!p || p.type !== "Poster") return false;
  return p.variant === "Ingen" || p.variant.startsWith("Hängare");
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
