// Curated catalog of Google Fonts available in the editor. Each entry's
// `family` is the CSS font-family name (also used as the persisted value).
// `googleSpec` is the `family=...` query fragment used in the Google Fonts
// css2 URL we inject in index.html.

export type FontCategory = "sans" | "serif" | "display" | "script" | "mono";

export interface FontDef {
  family: string;
  category: FontCategory;
  googleSpec: string;
}

export const FONT_CATEGORY_LABELS: Record<FontCategory, string> = {
  sans: "Sans-serif",
  serif: "Serif",
  display: "Display",
  script: "Handskrivet",
  mono: "Monospace",
};

// Weights kept moderate to keep CSS payload reasonable.
const W = "wght@400;500;600;700";

export const FONT_CATALOG: FontDef[] = [
  // Sans
  { family: "Inter", category: "sans", googleSpec: `Inter:${W}` },
  { family: "Roboto", category: "sans", googleSpec: `Roboto:${W}` },
  { family: "Open Sans", category: "sans", googleSpec: `Open+Sans:${W}` },
  { family: "Montserrat", category: "sans", googleSpec: `Montserrat:${W}` },
  { family: "Poppins", category: "sans", googleSpec: `Poppins:${W}` },
  { family: "Lato", category: "sans", googleSpec: `Lato:wght@400;700` },
  { family: "Nunito", category: "sans", googleSpec: `Nunito:${W}` },
  { family: "Work Sans", category: "sans", googleSpec: `Work+Sans:${W}` },
  { family: "DM Sans", category: "sans", googleSpec: `DM+Sans:${W}` },
  { family: "Manrope", category: "sans", googleSpec: `Manrope:${W}` },
  { family: "Raleway", category: "sans", googleSpec: `Raleway:${W}` },
  { family: "Questrial", category: "sans", googleSpec: `Questrial` },

  // Serif
  { family: "Playfair Display", category: "serif", googleSpec: `Playfair+Display:${W}` },
  { family: "Cormorant Garamond", category: "serif", googleSpec: `Cormorant+Garamond:${W}` },
  { family: "Lora", category: "serif", googleSpec: `Lora:${W}` },
  { family: "Merriweather", category: "serif", googleSpec: `Merriweather:wght@400;700` },
  { family: "EB Garamond", category: "serif", googleSpec: `EB+Garamond:${W}` },
  { family: "Crimson Text", category: "serif", googleSpec: `Crimson+Text:wght@400;600;700` },
  { family: "Libre Baskerville", category: "serif", googleSpec: `Libre+Baskerville:wght@400;700` },
  { family: "PT Serif", category: "serif", googleSpec: `PT+Serif:wght@400;700` },

  // Display
  { family: "Bebas Neue", category: "display", googleSpec: `Bebas+Neue` },
  { family: "Oswald", category: "display", googleSpec: `Oswald:${W}` },
  { family: "Abril Fatface", category: "display", googleSpec: `Abril+Fatface` },
  { family: "Archivo Black", category: "display", googleSpec: `Archivo+Black` },
  { family: "Anton", category: "display", googleSpec: `Anton` },
  { family: "Righteous", category: "display", googleSpec: `Righteous` },

  // Script / handwritten
  { family: "Dancing Script", category: "script", googleSpec: `Dancing+Script:wght@400;600;700` },
  { family: "Great Vibes", category: "script", googleSpec: `Great+Vibes` },
  { family: "Pacifico", category: "script", googleSpec: `Pacifico` },
  { family: "Caveat", category: "script", googleSpec: `Caveat:wght@400;600;700` },
  { family: "Sacramento", category: "script", googleSpec: `Sacramento` },
  { family: "Satisfy", category: "script", googleSpec: `Satisfy` },

  // Mono
  { family: "JetBrains Mono", category: "mono", googleSpec: `JetBrains+Mono:wght@400;500;700` },
  { family: "Roboto Mono", category: "mono", googleSpec: `Roboto+Mono:${W}` },
];

export const FONT_FAMILIES: string[] = FONT_CATALOG.map((f) => f.family);

export function isKnownFont(family: string): boolean {
  return FONT_CATALOG.some((f) => f.family === family);
}

export function fontsByCategory(): Record<FontCategory, FontDef[]> {
  const out: Record<FontCategory, FontDef[]> = {
    sans: [],
    serif: [],
    display: [],
    script: [],
    mono: [],
  };
  for (const f of FONT_CATALOG) out[f.category].push(f);
  return out;
}

/** Build the single Google Fonts css2 URL used in index.html. */
export function googleFontsHref(): string {
  const params = FONT_CATALOG.map((f) => `family=${f.googleSpec}`).join("&");
  return `https://fonts.googleapis.com/css2?${params}&display=swap`;
}
