// Pricing-tabeller (SEK) speglar Shopify-produkterna: priset kunden betalar.
// Används bara som reserv när Shopify-priset inte går att läsa (t.ex. utkast);
// jämförpriset (överstruket) kommer alltid från Shopify.
export const POSTER_SIZES = ["13x18", "21x30", "30x40", "40x50", "50x70", "70x100"] as const;
export const POSTER_FRAMES = [
  "Ingen",
  "Vit",
  "Svart",
  "Ek",
  "Valnöt",
  "Hängare Ek",
  "Hängare Valnöt",
  "Hängare Svart",
  "Hängare Vit",
] as const;

// Hängare har egna priser baserat på Gelatos wall-hanging-produkter.
// Finns inte i 13x18 (Gelato erbjuder ingen hängare i den storleken).
export const POSTER_PRICES: Record<string, Record<string, number>> = {
  "13x18": { Ingen: 149, Vit: 349, Svart: 349, Ek: 369, Valnöt: 369 },
  "21x30": { Ingen: 179, Vit: 399, Svart: 399, Ek: 429, Valnöt: 429, "Hängare Vit": 339, "Hängare Svart": 339, "Hängare Ek": 349, "Hängare Valnöt": 349 },
  "30x40": { Ingen: 189, Vit: 559, Svart: 559, Ek: 589, Valnöt: 589, "Hängare Vit": 439, "Hängare Svart": 439, "Hängare Ek": 449, "Hängare Valnöt": 449 },
  "40x50": { Ingen: 209, Vit: 749, Svart: 749, Ek: 789, Valnöt: 789, "Hängare Vit": 489, "Hängare Svart": 489, "Hängare Ek": 499, "Hängare Valnöt": 499 },
  "50x70": { Ingen: 239, Vit: 919, Svart: 919, Ek: 969, Valnöt: 969, "Hängare Vit": 589, "Hängare Svart": 589, "Hängare Ek": 599, "Hängare Valnöt": 599 },
  "70x100": { Ingen: 319, Vit: 1249, Svart: 1249, Ek: 1299, Valnöt: 1299, "Hängare Vit": 729, "Hängare Svart": 729, "Hängare Ek": 749, "Hängare Valnöt": 749 },
};

export const CANVAS_SIZES = ["20x25", "20x30", "30x40", "40x50", "40x60", "50x70", "60x80", "70x100"] as const;
export const CANVAS_DEPTHS = ["2cm", "4cm"] as const;

export const CANVAS_PRICES: Record<string, Record<string, number>> = {
  "20x25": { "2cm": 219, "4cm": 239 },
  "20x30": { "2cm": 259, "4cm": 279 },
  "30x40": { "2cm": 329, "4cm": 359 },
  "40x50": { "2cm": 449, "4cm": 479 },
  "40x60": { "2cm": 519, "4cm": 569 },
  "50x70": { "2cm": 599, "4cm": 649 },
  "60x80": { "2cm": 749, "4cm": 819 },
  "70x100": { "2cm": 969, "4cm": 1049 },
};

// Aluminium (vanlig — ej brushed). Använder pseudo-variantnamn "Standard"
// för att hålla samma datamodell (size × variant) som poster/canvas.
export const ALUMINUM_SIZES = ["20x30", "30x40", "40x50", "50x70", "70x100"] as const;
export const ALUMINUM_MATERIALS = ["Standard"] as const;
export const ALUMINUM_PRICES: Record<string, Record<string, number>> = {
  "20x30": { Standard: 399 },
  "30x40": { Standard: 499 },
  "40x50": { Standard: 649 },
  "50x70": { Standard: 849 },
  "70x100": { Standard: 1199 },
};

// Akryl (4 mm). Bara en finish — vi använder "Standard" som variantnamn
// för att hålla samma datamodell.
export const ACRYLIC_SIZES = ["20x30", "30x40", "40x50", "50x70", "70x100"] as const;
export const ACRYLIC_FINISHES = ["Standard"] as const;
export const ACRYLIC_PRICES: Record<string, Record<string, number>> = {
  "20x30": { Standard: 499 },
  "30x40": { Standard: 699 },
  "40x50": { Standard: 899 },
  "50x70": { Standard: 1099 },
  "70x100": { Standard: 1599 },
};

export const STYLE_PRESETS = [
  { id: "none", label: "Original", prompt: "" },
  { id: "watercolor", label: "Akvarell", prompt: "Transform this image into a soft watercolor painting with delicate brush strokes and pastel colors, preserving the composition." },
  { id: "minimal-line", label: "Minimal linje", prompt: "Convert this image into a minimal single-line drawing with clean black lines on white background." },
  { id: "vintage-poster", label: "Vintage", prompt: "Transform this image into a vintage travel poster style with bold flat colors, art deco influences." },
  { id: "oil-painting", label: "Oljemålning", prompt: "Transform this image into a classical oil painting with rich textures and dramatic lighting." },
  { id: "sketch", label: "Skiss", prompt: "Convert this image into a detailed pencil sketch with cross-hatching and shading." },
  { id: "anime", label: "Anime", prompt: "Transform this image into anime / manga illustration style with cel shading." },
];
