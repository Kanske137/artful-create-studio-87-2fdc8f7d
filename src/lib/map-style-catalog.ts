// Centralized catalog of all available Mapbox styles. Single source of truth
// for label + preview background. Per-template visibility is controlled via
// `productOptions.mapStyles` (Alt B), with backwards-compat fallback to the
// legacy `config.map_styles` column.
export interface MapStyleCatalogEntry {
  id: string;
  label: string;
  /** Optional i18n key for translated label. Falls back to `label` (Swedish). */
  labelKey?: string;
  previewBg: string;
  /** Full Mapbox style URL, e.g. mapbox://styles/username/style-id */
  styleUrl?: string;
  /** Static image thumbnail URL for the style picker */
  thumbnailUrl?: string;
}

export const MAP_STYLE_CATALOG: MapStyleCatalogEntry[] = [
  // v2-stilar 2026-07-25: poster-klass kontrast (mörka/ljusa viktade vägar,
  // tydligt vatten, gatunät från z11) — originalen (cmp2…) finns kvar orörda
  // i Mapbox-kontot som fallback om något behöver rullas tillbaka.
  {
    id: "skandinavisk",
    label: "Skandinavisk",
    labelKey: "mapStyle.skandinavisk",
    previewBg: "linear-gradient(135deg, #f5f5f0, #e8e8e0)",
    styleUrl: "mapbox://styles/maybe137/cms0mtqjz00rh01qt7n6t64ir",
    thumbnailUrl:
      "https://api.mapbox.com/styles/v1/maybe137/cms0mtqjz00rh01qt7n6t64ir/static/18.0686,59.3293,12,0/200x200@2x?access_token=pk.eyJ1IjoibWF5YmUxMzciLCJhIjoiY21vN2ptNzFrMDhuYTJ3cjZneHFvb2poZCJ9.bPlyl4zWIapN0R213Loyaw",
  },
  {
    id: "midnatt",
    label: "Midnatt",
    labelKey: "mapStyle.midnatt",
    previewBg: "linear-gradient(135deg, #1a1a2e, #16213e)",
    styleUrl: "mapbox://styles/maybe137/cms0mtqrp00qu01sc00bbdq9o",
    thumbnailUrl:
      "https://api.mapbox.com/styles/v1/maybe137/cms0mtqrp00qu01sc00bbdq9o/static/18.0686,59.3293,12,0/200x200@2x?access_token=pk.eyJ1IjoibWF5YmUxMzciLCJhIjoiY21vN2ptNzFrMDhuYTJ3cjZneHFvb2poZCJ9.bPlyl4zWIapN0R213Loyaw",
  },
  {
    id: "outdoors-v12",
    label: "Mintgrön/Salvia",
    labelKey: "mapStyle.mintgron",
    previewBg: "linear-gradient(135deg, #d4e8d4, #a8d5a2)",
    styleUrl: "mapbox://styles/maybe137/cms0mtqzm00ri01qt8jjj81p9",
    thumbnailUrl:
      "https://api.mapbox.com/styles/v1/maybe137/cms0mtqzm00ri01qt8jjj81p9/static/18.0686,59.3293,12,0/200x200@2x?access_token=pk.eyJ1IjoibWF5YmUxMzciLCJhIjoiY21vN2ptNzFrMDhuYTJ3cjZneHFvb2poZCJ9.bPlyl4zWIapN0R213Loyaw",
  },
  {
    id: "satellite-v9",
    label: "Marin Blå",
    labelKey: "mapStyle.marinbla",
    previewBg: "linear-gradient(135deg, #1a2f4a, #0d1b2a)",
    styleUrl: "mapbox://styles/maybe137/cms0mtr7100ot01qx8eqf8lam",
    thumbnailUrl:
      "https://api.mapbox.com/styles/v1/maybe137/cms0mtr7100ot01qx8eqf8lam/static/18.0686,59.3293,12,0/200x200@2x?access_token=pk.eyJ1IjoibWF5YmUxMzciLCJhIjoiY21vN2ptNzFrMDhuYTJ3cjZneHFvb2poZCJ9.bPlyl4zWIapN0R213Loyaw",
  },
  {
    id: "streets-v12",
    label: "Varm Beige/Cream",
    labelKey: "mapStyle.varmbeige",
    previewBg: "linear-gradient(135deg, #f5efe0, #e8dcc8)",
    styleUrl: "mapbox://styles/maybe137/cms0mtre800qv01scfoz22dhn",
    thumbnailUrl:
      "https://api.mapbox.com/styles/v1/maybe137/cms0mtre800qv01scfoz22dhn/static/18.0686,59.3293,12,0/200x200@2x?access_token=pk.eyJ1IjoibWF5YmUxMzciLCJhIjoiY21vN2ptNzFrMDhuYTJ3cjZneHFvb2poZCJ9.bPlyl4zWIapN0R213Loyaw",
  },
  {
    id: "navigation-night-v1",
    label: "Djup Skogsgrön/Svart",
    labelKey: "mapStyle.skogsgron",
    previewBg: "linear-gradient(135deg, #0a1f0a, #051405)",
    styleUrl: "mapbox://styles/maybe137/cms0mtrim00px01qz27t87307",
    thumbnailUrl:
      "https://api.mapbox.com/styles/v1/maybe137/cms0mtrim00px01qz27t87307/static/18.0686,59.3293,12,0/200x200@2x?access_token=pk.eyJ1IjoibWF5YmUxMzciLCJhIjoiY21vN2ptNzFrMDhuYTJ3cjZneHFvb2poZCJ9.bPlyl4zWIapN0R213Loyaw",
  },
  // v3-exklusiva 2026-07-26: strukturellt egna teman (inte nyansvarianter av
  // samma karta) — cyanotyp-blåtryck, guld-på-kol och ren inverterad noir.
  {
    id: "blatryck",
    label: "Blåtryck",
    previewBg: "linear-gradient(135deg, #16395E, #0D2743)",
    styleUrl: "mapbox://styles/maybe137/cms14qgka00qh01qz8xe0cic7",
    thumbnailUrl:
      "https://api.mapbox.com/styles/v1/maybe137/cms14qgka00qh01qz8xe0cic7/static/18.0686,59.3293,12,0/200x200@2x?access_token=pk.eyJ1IjoibWF5YmUxMzciLCJhIjoiY21vN2ptNzFrMDhuYTJ3cjZneHFvb2poZCJ9.bPlyl4zWIapN0R213Loyaw",
  },
  {
    id: "guldlinje",
    label: "Guldlinje",
    previewBg: "linear-gradient(135deg, #181512, #0D0B09)",
    styleUrl: "mapbox://styles/maybe137/cms14qgrn00rg01schtwa6w3e",
    thumbnailUrl:
      "https://api.mapbox.com/styles/v1/maybe137/cms14qgrn00rg01schtwa6w3e/static/18.0686,59.3293,12,0/200x200@2x?access_token=pk.eyJ1IjoibWF5YmUxMzciLCJhIjoiY21vN2ptNzFrMDhuYTJ3cjZneHFvb2poZCJ9.bPlyl4zWIapN0R213Loyaw",
  },
  {
    id: "noir",
    label: "Noir",
    previewBg: "linear-gradient(135deg, #111111, #060606)",
    styleUrl: "mapbox://styles/maybe137/cms14qgzb00oz01qkf11fdlnb",
    thumbnailUrl:
      "https://api.mapbox.com/styles/v1/maybe137/cms14qgzb00oz01qkf11fdlnb/static/18.0686,59.3293,12,0/200x200@2x?access_token=pk.eyJ1IjoibWF5YmUxMzciLCJhIjoiY21vN2ptNzFrMDhuYTJ3cjZneHFvb2poZCJ9.bPlyl4zWIapN0R213Loyaw",
  },
];

export const MAP_STYLE_BY_ID: Record<string, MapStyleCatalogEntry> = Object.fromEntries(
  MAP_STYLE_CATALOG.map((s) => [s.id, s]),
);

export function mapStyleLabel(styleId: string): string {
  return MAP_STYLE_BY_ID[styleId]?.label ?? styleId;
}

export function mapStyleLabelKey(styleId: string): string | undefined {
  return MAP_STYLE_BY_ID[styleId]?.labelKey;
}

export function mapStylePreviewBg(styleId: string): string {
  return MAP_STYLE_BY_ID[styleId]?.previewBg ?? "#888";
}

export function mapStyleThumbnailUrl(styleId: string): string | undefined {
  return MAP_STYLE_BY_ID[styleId]?.thumbnailUrl;
}

/** Resolve the full Mapbox style URL for a given catalog style id. */
export function mapStyleUrl(styleId: string): string {
  return MAP_STYLE_BY_ID[styleId]?.styleUrl ?? `mapbox://styles/mapbox/${styleId}`;
}

/** Parse a mapbox://styles/username/style-id URL into its components. */
export function parseMapboxStyleUrl(
  url: string,
): { username: string; styleId: string } | null {
  const match = url.match(/mapbox:\/\/styles\/([^/]+)\/(.+)/);
  if (!match) return null;
  return { username: match[1], styleId: match[2] };
}

export function isKnownMapStyle(styleId: string): boolean {
  return styleId in MAP_STYLE_BY_ID;
}

interface MapStyleTogglesLike {
  productOptions?: {
    mapStyles?: Array<{ id: string; enabled?: boolean }>;
  } | null;
}

/**
 * Resolve the list of map style IDs visible in the customer editor for a given
 * template. Priority:
 *   1. `productOptions.mapStyles` (Alt B per-template enabling)
 *   2. Legacy `config.map_styles` column
 *   3. Full catalog (so a brand-new template still shows something)
 */
export function getEnabledMapStyleIds(
  template: MapStyleTogglesLike | null | undefined,
  legacyConfigStyles: string[] | null | undefined,
): string[] {
  const fromTemplate = template?.productOptions?.mapStyles;
  if (fromTemplate && fromTemplate.length > 0) {
    return fromTemplate
      .filter((s) => s.enabled !== false && isKnownMapStyle(s.id))
      .map((s) => s.id);
  }
  if (legacyConfigStyles && legacyConfigStyles.length > 0) {
    return legacyConfigStyles.filter(isKnownMapStyle);
  }
  return MAP_STYLE_CATALOG.map((s) => s.id);
}
