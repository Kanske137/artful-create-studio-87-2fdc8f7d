import { create } from "zustand";
import type { Orientation, ProductConfig } from "@/lib/product-config";
import { getEffectiveSizes } from "@/lib/product-config";
import type { DesignSource } from "@/lib/print-pipeline";
import type { ProductOptions, Template, TemplateLayer } from "@/lib/template-schema";
import { getActiveLayoutBlock, getAllLayouts } from "@/lib/template-schema";
import { resolveTemplate } from "@/lib/template-migrate";
import { clampLayerRect } from "@/lib/layer-utils";
import {
  createFreeformLayer,
  mutateActiveLayoutBlock,
  nextTopZIndex,
} from "@/lib/freeform-layers";
import {
  type AiCacheEntry,
  loadAiCache,
  makeCacheKey,
  saveAiCache,
} from "@/lib/ai-cache-storage";
import {
  type FaceSwapCacheEntry,
  loadFaceSwapCache,
  makeFaceSwapKey,
  saveFaceSwapCache,
} from "@/lib/face-swap-cache";
import { track } from "@/lib/analytics";

interface ApplyPlaceArgs {
  placeName: string;
  center: [number, number];
  city?: string;
  country?: string;
}

export type MapShape = "rect" | "circle" | "heart" | "star";

export interface MapIcon {
  /** Stable per-icon uuid so React lists + selection state work. */
  id: string;
  /** Catalog id from `src/lib/map-icon-catalog.ts`. */
  iconId: string;
  /** Geographic anchor — icon sticks to this point on the map regardless of
   *  pan/zoom. Required for newly placed icons. */
  lng?: number;
  lat?: number;
  /** LEGACY layer-box position (0..100). Used as fallback when lng/lat is
   *  missing and upgraded to lng/lat on first render. */
  xPct?: number;
  yPct?: number;
}

export interface MapLayerValue {
  kind: "map";
  center: [number, number];
  zoom: number;
  styleId: string;
  shape: MapShape;
  showLabels: boolean;
  placeName: string;
  city?: string;
  country?: string;
  /** Customer-placed icons (hearts, home, …). Always present (default []). */
  icons: MapIcon[];
}

export interface TextLayerValue {
  kind: "text";
  /** Effective rendered text (legacy mirror). Equals
   *  `overrideText ?? autoText(place)` and is recomputed every time the
   *  linked map's place changes. Cart/snapshot/mirrors read this. */
  text: string;
  /** Customer override. When null, layer follows the auto-text built from the
   *  linked map. Cleared on every kartuppdatering — kartan vinner alltid. */
  overrideText: string | null;
  font: string;
  /** Customer-overridden font size i pt (A4-relativ, samma referens som
   *  `defaults.fontSizePt`). null = följer admin-default. */
  fontSizePt: number | null;
  visible: boolean;
}

export type PhotoShape = "rect" | "circle" | "heart" | "star";

export interface PhotoLayerValue {
  kind: "photo";
  shape: PhotoShape;
  /** Pan offset within the layer's frame, in percent of layer width/height.
   *  Range clamped to [-50, 50]. 0,0 = centered cover crop. */
  offsetX: number;
  offsetY: number;
  /** Extra zoom factor on top of the cover-fit scale. 1 = cover, max 5. */
  zoom: number;
}

export interface AiPhotoLayerValue {
  kind: "aiPhoto";
  shape: PhotoShape;
  offsetX: number;
  offsetY: number;
  zoom: number;
}

export interface StarmapLayerValue {
  kind: "starmap";
  /** [lng, lat] — samma konvention som map-lagret. */
  center: [number, number];
  /** "YYYY-MM-DD" lokalt datum för himlen. */
  dateISO: string;
  /** "HH:MM" lokal tid (tom ⇒ 22:00 i renderaren). */
  timeHHMM: string;
  placeName: string;
  city?: string;
  country?: string;
  showConstellations: boolean;
  showGrid: boolean;
}

export type LayerValue =
  | MapLayerValue
  | TextLayerValue
  | PhotoLayerValue
  | AiPhotoLayerValue
  | StarmapLayerValue;

/** Per-aiPhoto-layer customer state. The customer's selfie/pet photo lives
 *  here keyed by layer id, so multiple aiPhoto layers in one template are
 *  independent. */
export interface AiPhotoSource {
  file: File;
  previewUrl: string;
  /** SHA-256 of the file bytes; lazy-computed by AiPhotoSection. */
  hash: string | null;
  /** Public URL after lazy upload to cart-previews (so Replicate can fetch). */
  uploadedUrl: string | null;
}

/** Per-slot customer portrait for the OPTIONAL multi-face mode. Mirrors the
 *  shape of `AiPhotoSource` — uploaded lazily to cart-previews and hashed
 *  for caching. */
export interface MultiFacePortrait {
  file: File;
  previewUrl: string;
  hash: string | null;
  uploadedUrl: string | null;
}

/** Per-photo-layer customer state. Each `photo` layer in the template has
 *  its own uploaded file + AI state, so multi-photo templates show
 *  independent images per behållare. */
export interface PhotoLayerSource {
  file: File;
  previewUrl: string;
  /** SHA-256 of the file bytes; lazy-computed by AiStyleSection. */
  hash: string | null;
  /** Public URL after lazy upload to cart-previews (so Replicate can fetch). */
  originalUrl: string | null;
}

interface EditorState {
  config: ProductConfig | null;
  template: Template | null;
  productOptions: ProductOptions | null;

  /** Active named-layout id ("Stil"). Null while no template is loaded.
   *  Defaults to the implicit "default" Standard-layout. */
  layoutId: string | null;

  /** Aktiv innehållsvariant (t.ex. vald drink). Null när mallen saknar
   *  contentVariants. Oberoende av layoutId — layoutbyte behåller varianten. */
  contentVariantId: string | null;

  // Per-layer values keyed by layer id (covers map + text layers).
  layerValues: Record<string, LayerValue>;

  // Customer-driven rect overrides for layers (when locks.size or locks.move
  // are unlocked). All values in % of editor canvas. Missing fields fall
  // back to the template layer's xPct/yPct/wPct/hPct.
  layerTransforms: Record<string, { xPct?: number; yPct?: number; wPct?: number; hPct?: number }>;

  // Global background (one per layout). Other map/text values now live in
  // `layerValues`; the fields below are derived getters for legacy callers.
  /** Customer toggle: when false, the white margin layer is hidden and all
   *  other layers expand to fill the freed-up area. Default true. */
  whiteMarginEnabled: boolean;
  posterBgColor: string;

  // format
  size: string | null;
  variant: string | null;
  orientation: Orientation;

  /** Per-photo-layer uploaded sources, keyed by layer id. */
  photoSources: Record<string, PhotoLayerSource>;
  /** Per-photo-layer AI-styled print-file URL, keyed by layer id. */
  photoAiResults: Record<string, string>;

  // ---- legacy mirrors of the FIRST photo layer (kept for backward compat
  // with cart payload + existing snapshot/mockup callers). Computed via
  // `mirrorPhoto()` on every per-layer change. New code should read the
  // per-layer maps above instead. ----
  designSource: DesignSource;
  photoFile: File | null;
  photoPreviewUrl: string | null;
  originalPhotoUrl: string | null;
  photoHash: string | null;
  aiPrintFileUrl: string | null;
  /** Real Shopify variant GID (e.g. gid://shopify/ProductVariant/123). Resolved
   *  lazily based on (handle, size, variant). Null while resolving / not found. */
  shopifyVariantId: string | null;
  shopifyVariantResolving: boolean;

  /** AI-styled image cache keyed by `${photoHash}|${presetId}`. Avoids repeat
   *  Replicate calls when the customer revisits a style they already tried.
   *  Persisted to localStorage with LRU eviction. */
  aiResultCache: Record<string, AiCacheEntry>;

  /** Customer-uploaded face photos per aiPhoto layer. */
  aiPhotoSources: Record<string, AiPhotoSource>;
  /** Face-swap result URLs per aiPhoto layer (current selection only). */
  aiPhotoResults: Record<string, string>;
  /** Customer-selected reference image URL per aiPhoto layer (when admin
   *  uploaded multiple references). Drives live preview before "Skapa nu". */
  aiPhotoSelectedRefUrl: Record<string, string>;
  /** Persistent face-swap cache keyed by `${faceHash}|${refUrl}|${layerId}`. */
  faceSwapCache: Record<string, FaceSwapCacheEntry>;

  /** Customer-uploaded portraits per aiPhoto layer per slot id, for the
   *  OPTIONAL multi-face mode. Strictly additive — does not affect any
   *  existing single-face behavior. */
  multiFacePortraits: Record<string, Record<string, MultiFacePortrait>>;

  // ---------- setters ----------
  setConfig: (c: ProductConfig) => void;
  setPosterBgColor: (c: string) => void;
  setSize: (s: string) => void;
  setVariant: (v: string) => void;
  setOrientation: (o: Orientation) => void;
  setLayoutId: (id: string) => void;
  /** Byt innehållsvariant (drink): sätter varianttexterna som kund-overrides
   *  och pekar om render-overrides (bild + accentfärg). */
  setContentVariant: (id: string) => void;
  setWhiteMarginEnabled: (v: boolean) => void;
  setLayerTransform: (id: string, patch: { xPct?: number; yPct?: number; wPct?: number; hPct?: number }) => void;
  resetLayerTransform: (id: string) => void;
  setPhotoSource: (file: File | null, previewUrl: string | null) => void;
  setOriginalPhotoUrl: (url: string | null) => void;
  setPhotoHash: (hash: string | null) => void;
  setAiPrintFileUrl: (url: string | null) => void;
  /** Drops only the AI-styled result, keeps the original photo + hash + URL
   *  intact so the history list stays visible and re-applying a style is
   *  a cache hit. */
  clearAiResultOnly: () => void;
  resetDesignSource: () => void;

  // ---------- per-photo-layer setters ----------
  setPhotoSourceFor: (layerId: string, file: File | null, previewUrl: string | null) => void;
  setPhotoHashFor: (layerId: string, hash: string) => void;
  setOriginalPhotoUrlFor: (layerId: string, url: string) => void;
  setAiPrintFileUrlFor: (layerId: string, url: string | null) => void;
  clearAiResultOnlyFor: (layerId: string) => void;
  /** Returns a per-layer overlay map (AI result wins over upload) for use
   *  by the snapshot/print pipeline + mockup gallery. */
  getPhotoOverlays: () => Record<string, string>;
  firstPhotoLayerId: () => string | null;
  setShopifyVariantId: (id: string | null) => void;
  setShopifyVariantResolving: (resolving: boolean) => void;

  // ---------- AI cache ----------
  addAiResultToCache: (photoHash: string, presetId: string, presetLabel: string, url: string) => void;
  getCachedAiResult: (photoHash: string, presetId: string) => string | null;
  listAiResultsForPhoto: (photoHash: string) => AiCacheEntry[];
  clearAiResult: (photoHash: string, presetId: string) => void;

  // ---------- aiPhoto (face-swap) ----------
  setAiPhotoSource: (layerId: string, file: File | null, previewUrl: string | null) => void;
  setAiPhotoHash: (layerId: string, hash: string) => void;
  setAiPhotoUploadedUrl: (layerId: string, url: string) => void;
  setAiPhotoResult: (layerId: string, url: string | null) => void;
  setAiPhotoSelectedRef: (layerId: string, url: string | null) => void;
  clearAiPhoto: (layerId: string) => void;
  addFaceSwapToCache: (
    layerId: string,
    faceHash: string,
    referenceImageUrl: string,
    url: string,
  ) => void;
  getCachedFaceSwap: (
    layerId: string,
    faceHash: string,
    referenceImageUrl: string,
  ) => string | null;

  // ---------- multi-face (OPTIONAL) ----------
  setMultiFacePortrait: (
    layerId: string,
    slotId: string,
    file: File | null,
    previewUrl: string | null,
  ) => void;
  setMultiFacePortraitHash: (layerId: string, slotId: string, hash: string) => void;
  setMultiFacePortraitUploadedUrl: (layerId: string, slotId: string, url: string) => void;
  clearMultiFacePortraits: (layerId: string) => void;

  // Per-layer setters
  setLayerMapCenter: (id: string, c: [number, number]) => void;
  setLayerMapZoom: (id: string, z: number) => void;
  setLayerMapStyle: (id: string, s: string) => void;
  setLayerMapShape: (id: string, s: MapShape) => void;
  setLayerShowLabels: (id: string, v: boolean) => void;
  applyPlaceToLayer: (id: string, args: ApplyPlaceArgs) => void;
  updateMapLayerFromPan: (id: string, args: ApplyPlaceArgs) => void;
  /** Starmap: datum/tid/toggles. Plats sätts via `applyPlaceToLayer`. */
  patchStarmapLayer: (id: string, patch: Partial<Omit<StarmapLayerValue, "kind">>) => void;
  setLayerText: (id: string, t: string) => void;
  setLayerTextFont: (id: string, f: string) => void;
  setLayerTextFontSizePt: (id: string, pt: number | null) => void;
  setLayerTextVisible: (id: string, v: boolean) => void;
  setLayerPhotoShape: (id: string, s: PhotoShape) => void;
  setLayerPhotoOffset: (id: string, x: number, y: number) => void;
  setLayerPhotoZoom: (id: string, zoom: number) => void;

  // ---------- map icons (customer-placeable) ----------
  /** Transient: when set, clicking on a map layer drops this icon at the
   *  click point and deactivates the tool. */
  activeIconTool: { iconId: string } | null;
  setActiveIconTool: (tool: { iconId: string } | null) => void;
  /** Transient: id of the currently-selected placed icon (for trash popover). */
  selectedMapIcon: { layerId: string; iconId: string } | null;
  setSelectedMapIcon: (sel: { layerId: string; iconId: string } | null) => void;
  addMapIcon: (layerId: string, icon: MapIcon) => void;
  removeMapIcon: (layerId: string, iconInstanceId: string) => void;
  replaceMapIcon: (layerId: string, iconInstanceId: string, patch: Partial<MapIcon>) => void;

  // ---------- freeform (kund-tillagda lager i "fri mall"-läge) ----------
  /** Map of layer-id → true för lager som kunden valt att dölja. Respekteras
   *  av preview + print (filtreras innan snapshot/print-fil byggs). */
  hiddenLayerIds: Record<string, true>;
  /** Skapa själv: visa/dölj alla move/resize-handtag i previewen. Default true. */
  handlesVisible: boolean;
  setHandlesVisible: (v: boolean) => void;
  /** Lägg till ett kund-skapat lager i det aktiva layout-blocket. */
  addCustomLayer: (
    type: import("@/lib/freeform-layers").FreeformLayerType,
    opts?: { shapeKind?: import("@/lib/template-schema").ShapeKind; lineOrientation?: "horizontal" | "vertical" },
  ) => string | null;
  /** Patcha en del av ett kund-lagers `defaults` (typ-säkert per lagertyp). */
  updateLayerDefaults: (id: string, patch: Record<string, unknown>) => void;
  /** Ta bort ett (typiskt kund-tillagt) lager. Funkar även för admin-lager. */
  removeCustomLayer: (id: string) => void;
  /** Flytta ett lager upp/ner i z-stack (1 = upp, -1 = ner). */
  moveLayerZ: (id: string, direction: 1 | -1) => void;
  /** Sätt synlighet för ett lager (true = visa, false = dölj). */
  setLayerVisible: (id: string, visible: boolean) => void;
  /** Är lagret dolt? */
  isLayerHidden: (id: string) => boolean;
  /** Skriv om zIndex enligt orderedIds (TOPP-först = högst zIndex). */
  reorderLayers: (orderedIds: string[]) => void;
  /** True om fri mall har minst en designkälla med riktigt innehåll. */
  hasDesignContent: () => boolean;

  /** Beställningsspärr för vanliga mallar: null = OK att beställa, annars en
   *  orsakskod som UI:t översätter till en hint. Hindrar att kunden råkar
   *  beställa mallens exempel-/defaultdesign:
   *   - "generation": aiPhoto-lager saknar genererat resultat (skulle trycka
   *     admin-referensen med modellens ansikte)
   *   - "photo"/"photoMulti": foto-lager saknar kunduppladdning (skulle
   *     trycka placeholder-exempelbilden)
   *   - "customize": mall utan bildlager (t.ex. karttavla) där kunden inte
   *     ändrat någon parameter alls från default
   *  Freeform-mallar hanteras separat via hasDesignContent(). */
  orderBlockReason: () => "generation" | "photo" | "photoMulti" | "customize" | "demo" | null;

  // ---------- legacy globals (derived getters; mutators apply to first layer) ----------
  // These setters/getters keep older code (EditorPage cart payload, snapshot
  // pipeline, etc.) working unchanged while we migrate to per-layer everywhere.
  setMapCenter: (c: [number, number]) => void;
  setMapZoom: (z: number) => void;
  setMapStyleId: (s: string) => void;
  setShowLabels: (v: boolean) => void;
  setMapShape: (s: MapShape) => void;
  setText: (t: string) => void;
  setTextFont: (f: string) => void;
  setTextVisible: (v: boolean) => void;
  applyPlace: (args: ApplyPlaceArgs) => void;
  updateFromMap: (args: ApplyPlaceArgs) => void;

  // computed
  currentPrice: () => number;
  currentLayout: () => ProductConfig["layouts"]["portrait"] | null;
  templateLayers: () => TemplateLayer[];
  firstMapLayerId: () => string | null;
  firstTextLayerId: () => string | null;
  getMapValue: (id: string) => MapLayerValue | null;
  getTextValue: (id: string) => TextLayerValue | null;
  // Legacy mirrors of "first map / first text" for backward compat reads.
  mapCenter: [number, number];
  mapZoom: number;
  mapStyleId: string;
  mapShape: MapShape;
  showLabels: boolean;
  placeName: string;
  city?: string;
  country?: string;
  text: string;
  textFont: string;
  textVisible: boolean;
}

interface AutoTextFields {
  city?: boolean;
  country?: boolean;
  coordinates?: boolean;
}

import { buildLinkedText, resolveLinkedTokens, tokensFromLegacyFields } from "@/lib/text-typography";
import type { TextDefaults } from "@/lib/template-schema";

function buildAutoText(args: ApplyPlaceArgs, fields?: AutoTextFields): string {
  // Legacy entry point — preserved so older call sites keep working.
  return buildLinkedText(undefined, tokensFromLegacyFields(fields), {
    placeName: args.placeName,
    city: args.city,
    country: args.country,
    center: args.center,
  });
}

function buildAutoTextForLayer(
  args: ApplyPlaceArgs & { dateISO?: string },
  d: TextDefaults,
): string {
  return buildLinkedText(d.text, resolveLinkedTokens(d), {
    placeName: args.placeName,
    city: args.city,
    country: args.country,
    center: args.center,
    dateISO: args.dateISO,
  });
}


/** Re-apply the active content-variant's TEXT onto a freshly rebuilt layerValues
 *  set (used after a stil-byte / layout switch). Content-locked variant layers
 *  (title, corner labels, one-line recipe) always reflect the active drink;
 *  content-unlocked layers (the editable recipe) take the drink's text only when
 *  the customer hasn't set an override in this set — so in-layout edits survive,
 *  but layers that are new in this layout (or were reset) get the right drink.
 *  Image + colour come from applyContentVariant at render time. */
function applyVariantTextInPlace(
  template: Template,
  variantId: string | null,
  layersById: Record<string, TemplateLayer>,
  values: Record<string, LayerValue>,
): void {
  const variant = variantId ? (template.contentVariants ?? []).find((v) => v.id === variantId) : null;
  if (!variant) return;
  for (const [layerId, ov] of Object.entries(variant.overrides ?? {})) {
    if (ov.text === undefined) continue;
    const cur = values[layerId];
    const layer = layersById[layerId];
    if (!cur || cur.kind !== "text" || !layer || layer.type !== "text") continue;
    if (layer.locks.content || cur.overrideText === null) {
      values[layerId] = { ...cur, text: ov.text, overrideText: ov.text };
    }
  }
}

function hydrateLayerValues(
  template: Template,
  orientation: Orientation,
  productType: string | null | undefined,
  layoutId?: string | null,
): Record<string, LayerValue> {
  const layout = getActiveLayoutBlock(template, productType, layoutId)[orientation];
  const out: Record<string, LayerValue> = {};
  if (!layout) return out;
  for (const l of layout.layers) {
    if (l.type === "map") {
      out[l.id] = {
        kind: "map",
        center: [l.defaults.center[0], l.defaults.center[1]],
        zoom: l.defaults.zoom,
        styleId: l.defaults.styleId,
        shape: l.defaults.shape as MapShape,
        showLabels: l.defaults.showLabels,
        placeName: l.defaults.placeName ?? "",
        city: l.defaults.city,
        country: l.defaults.country,
        icons: [],
      };
    } else if (l.type === "text") {
      out[l.id] = {
        kind: "text",
        text: l.defaults.text,
        overrideText: null,
        font: l.defaults.font,
        fontSizePt: null,
        visible: true,
      };
    } else if (l.type === "photo") {
      out[l.id] = {
        kind: "photo",
        shape: l.defaults.shape as PhotoShape,
        offsetX: 0,
        offsetY: 0,
        zoom: 1,
      };
    } else if (l.type === "aiPhoto") {
      out[l.id] = {
        kind: "aiPhoto",
        shape: l.defaults.shape as PhotoShape,
        offsetX: 0,
        offsetY: 0,
        zoom: 1,
      };
    } else if (l.type === "starmap") {
      out[l.id] = {
        kind: "starmap",
        center: [l.defaults.center[0], l.defaults.center[1]],
        dateISO: l.defaults.dateISO,
        timeHHMM: l.defaults.timeHHMM ?? "22:00",
        placeName: l.defaults.placeName ?? "",
        showConstellations: l.defaults.showConstellations,
        showGrid: l.defaults.showGrid,
      };
    }
  }
  return out;
}

/**
 * Build a mapping from previous layer IDs to next layer IDs by pairing layers
 * of the same `type` index-by-index within each orientation. Used when the
 * active layout block changes (poster ↔ canvas) so per-layer state survives.
 */
function buildLayerIdMap(
  prevTemplate: Template | null,
  prevProductType: string | null | undefined,
  prevLayoutId: string | null | undefined,
  nextTemplate: Template,
  nextProductType: string | null | undefined,
  nextLayoutId: string | null | undefined,
): Record<string, string> {
  const map: Record<string, string> = {};
  if (!prevTemplate) return map;
  const prevBlock = getActiveLayoutBlock(prevTemplate, prevProductType, prevLayoutId);
  const nextBlock = getActiveLayoutBlock(nextTemplate, nextProductType, nextLayoutId);
  for (const orientation of ["portrait", "landscape"] as const) {
    const prevLayers = prevBlock[orientation]?.layers ?? [];
    const nextLayers = nextBlock[orientation]?.layers ?? [];
    const grouped: Record<string, TemplateLayer[]> = {};
    for (const l of nextLayers) {
      (grouped[l.type] ||= []).push(l);
    }
    const cursors: Record<string, number> = {};
    for (const prev of prevLayers) {
      const idx = cursors[prev.type] ?? 0;
      const next = grouped[prev.type]?.[idx];
      if (next && prev.id !== next.id) {
        map[prev.id] = next.id;
      }
      cursors[prev.type] = idx + 1;
    }
  }
  return map;
}

/** Recompute legacy "first map / first text" mirrors from layerValues. */
function mirrorLegacy(
  state: Pick<EditorState, "template" | "orientation" | "layerValues" | "config" | "layoutId">,
) {
  const layout = state.template
    ? getActiveLayoutBlock(state.template, state.config?.product_type, state.layoutId)[state.orientation]
    : undefined;
  const firstMap = layout?.layers.find((l) => l.type === "map");
  const firstText = layout?.layers.find((l) => l.type === "text");
  const m = firstMap ? (state.layerValues[firstMap.id] as MapLayerValue | undefined) : undefined;
  const t = firstText ? (state.layerValues[firstText.id] as TextLayerValue | undefined) : undefined;
  return {
    mapCenter: m?.center ?? ([18.0686, 59.3293] as [number, number]),
    mapZoom: m?.zoom ?? 12,
    mapStyleId: m?.styleId ?? "light-v11",
    mapShape: m?.shape ?? ("circle" as MapShape),
    showLabels: m?.showLabels ?? false,
    placeName: m?.placeName ?? "",
    city: m?.city,
    country: m?.country,
    text: t?.text ?? "",
    textFont: t?.font ?? "Inter",
    textVisible: t?.visible ?? true,
  };
}

/** Recompute legacy first-photo-layer mirrors. The mirrors keep the cart
 *  payload + EditorPage's existing reads working unchanged. */
function mirrorPhoto(
  state: Pick<EditorState, "template" | "orientation" | "config" | "photoSources" | "photoAiResults" | "layoutId">,
) {
  const layout = state.template
    ? getActiveLayoutBlock(state.template, state.config?.product_type, state.layoutId)[state.orientation]
    : undefined;
  const firstPhoto = layout?.layers.find((l) => l.type === "photo");
  const id = firstPhoto?.id ?? null;
  const src = id ? state.photoSources[id] : undefined;
  const ai = id ? state.photoAiResults[id] : undefined;
  // Aggregate `designSource` across ALL photo layers so the cart payload
  // reflects the strongest source in use anywhere on the template.
  const anyAi = Object.keys(state.photoAiResults).length > 0;
  const anyPhoto = Object.keys(state.photoSources).length > 0;
  const designSource: DesignSource = anyAi ? "ai" : anyPhoto ? "photo" : "map";
  return {
    designSource,
    photoFile: src?.file ?? null,
    photoPreviewUrl: src?.previewUrl ?? null,
    photoHash: src?.hash ?? null,
    originalPhotoUrl: src?.originalUrl ?? null,
    aiPrintFileUrl: ai ?? null,
  };
}
export const useEditorStore = create<EditorState>((set, get) => ({
  config: null,
  template: null,
  productOptions: null,
  layerValues: {},
  layerTransforms: {},
  layoutId: null,
  posterBgColor: "#EFE7D6",
  whiteMarginEnabled: true,

  size: null,
  variant: null,
  orientation: "portrait",
  contentVariantId: null,

  designSource: "map",
  photoFile: null,
  photoPreviewUrl: null,
  originalPhotoUrl: null,
  photoHash: null,
  aiPrintFileUrl: null,
  photoSources: {},
  photoAiResults: {},
  shopifyVariantId: null,
  shopifyVariantResolving: false,
  aiResultCache: loadAiCache(),
  aiPhotoSources: {},
  aiPhotoResults: {},
  aiPhotoSelectedRefUrl: {},
  faceSwapCache: loadFaceSwapCache(),
  multiFacePortraits: {},
  hiddenLayerIds: {},
  handlesVisible: true,

  // legacy mirrors (initial values, replaced once a config is loaded)
  mapCenter: [18.0686, 59.3293],
  mapZoom: 12,
  mapStyleId: "light-v11",
  mapShape: "circle",
  showLabels: false,
  placeName: "",
  city: undefined,
  country: undefined,
  text: "",
  textFont: "Inter",
  textVisible: true,

  // ---------- map icons transient state ----------
  activeIconTool: null,
  setActiveIconTool: (activeIconTool) => set({ activeIconTool }),
  selectedMapIcon: null,
  setSelectedMapIcon: (selectedMapIcon) => set({ selectedMapIcon }),
  addMapIcon: (layerId, icon) => {
    const state = get();
    const cur = state.layerValues[layerId];
    if (!cur || cur.kind !== "map") return;
    const next: MapLayerValue = { ...cur, icons: [...(cur.icons ?? []), icon] };
    set({ layerValues: { ...state.layerValues, [layerId]: next } });
  },
  removeMapIcon: (layerId, iconInstanceId) => {
    const state = get();
    const cur = state.layerValues[layerId];
    if (!cur || cur.kind !== "map") return;
    const next: MapLayerValue = {
      ...cur,
      icons: (cur.icons ?? []).filter((i) => i.id !== iconInstanceId),
    };
    set({
      layerValues: { ...state.layerValues, [layerId]: next },
      selectedMapIcon:
        state.selectedMapIcon?.iconId === iconInstanceId ? null : state.selectedMapIcon,
    });
  },
  replaceMapIcon: (layerId, iconInstanceId, patch) => {
    const state = get();
    const cur = state.layerValues[layerId];
    if (!cur || cur.kind !== "map") return;
    const icons = (cur.icons ?? []).map((i) =>
      i.id === iconInstanceId ? { ...i, ...patch } : i,
    );
    const next: MapLayerValue = { ...cur, icons };
    set({ layerValues: { ...state.layerValues, [layerId]: next } });
  },

  setConfig: (config) => {
    const state = get();
    const prevSize = state.size;
    const prevVariant = state.variant;

    const rawTemplate = (config as unknown as { template?: unknown }).template;
    const { template } = resolveTemplate(config, rawTemplate);
    const productOptions = template.productOptions;

    // Effective sizes (legacy `config.sizes` if present, otherwise derived
    // from productOptions × pricing tables) — keeps newly-built admin
    // templates working even when their legacy `sizes` jsonb is empty.
    const effectiveSizes = getEffectiveSizes(config, productOptions);

    const allowedSizesForType =
      config.product_type === "canvas"
        ? productOptions.canvas?.allowedSizes ?? []
        : productOptions.poster?.allowedSizes ?? [];
    const allowedFiltered = effectiveSizes.filter(
      (s) => allowedSizesForType.length === 0 || allowedSizesForType.includes(s.size),
    );
    const sizeStillValid = prevSize && allowedFiltered.find((s) => s.size === prevSize);
    const nextSize = sizeStillValid ? prevSize : allowedFiltered[0]?.size ?? effectiveSizes[0]?.size ?? null;
    const nextSizeDef = effectiveSizes.find((s) => s.size === nextSize);

    const allowedVariantsForType =
      config.product_type === "canvas"
        ? productOptions.canvas?.allowedDepths ?? []
        : productOptions.poster?.allowedFrames ?? [];
    const variantsForSize = (nextSizeDef?.variants ?? []).filter(
      (v) => allowedVariantsForType.length === 0 || allowedVariantsForType.includes(v.name),
    );
    const variantStillValid = prevVariant && variantsForSize.find((v) => v.name === prevVariant);
    const nextVariant = variantStillValid
      ? prevVariant
      : variantsForSize[0]?.name ?? nextSizeDef?.variants[0]?.name ?? null;

    const isFirstLoad = state.config === null;
    // First template load: honour the template's preferred orientation (e.g.
    // multi-map standard layouts designed for landscape). Later loads (product
    // type switches etc.) keep whatever the customer chose.
    const orientation =
      isFirstLoad && template.defaultOrientation && template.orientations.includes(template.defaultOrientation)
        ? template.defaultOrientation
        : state.orientation;
    const prevTemplate = state.template;
    const prevProductType = state.config?.product_type;
    const prevLayoutId = state.layoutId;
    // Keep prior layoutId if it still exists in the new template, else default.
    const allLayoutIds = new Set([
      "default",
      ...((template.extraLayouts ?? []).map((l) => l.id)),
    ]);
    const nextLayoutId = prevLayoutId && allLayoutIds.has(prevLayoutId) ? prevLayoutId : "default";
    const layoutBlockChanged =
      !!prevTemplate &&
      getActiveLayoutBlock(prevTemplate, prevProductType, prevLayoutId) !==
        getActiveLayoutBlock(template, config.product_type, nextLayoutId);

    const freshLayerValues = hydrateLayerValues(template, orientation, config.product_type, nextLayoutId);
    const layout = getActiveLayoutBlock(template, config.product_type, nextLayoutId)[orientation];

    let nextLayerValues = freshLayerValues;
    let nextLayerTransforms: Record<string, { xPct?: number; yPct?: number; wPct?: number; hPct?: number }> = {};
    let nextAiPhotoResults = state.aiPhotoResults;
    let nextAiPhotoSources = state.aiPhotoSources;
    let nextAiPhotoSelectedRefUrl = state.aiPhotoSelectedRefUrl;
    let nextPhotoSources = state.photoSources;
    let nextPhotoAiResults = state.photoAiResults;

    if (!isFirstLoad && layoutBlockChanged) {
      const idMap = buildLayerIdMap(prevTemplate, prevProductType, prevLayoutId, template, config.product_type, nextLayoutId);
      // Carry over per-layer values (photo shape/offset, text content, map state, …)
      const merged: Record<string, LayerValue> = { ...freshLayerValues };
      for (const [oldId, oldVal] of Object.entries(state.layerValues)) {
        const newId = idMap[oldId] ?? oldId;
        if (merged[newId] && merged[newId].kind === oldVal.kind) {
          merged[newId] = oldVal;
        }
      }
      nextLayerValues = merged;
      // Carry over layer transforms (custom rect)
      const remappedTransforms: typeof nextLayerTransforms = {};
      for (const [oldId, val] of Object.entries(state.layerTransforms)) {
        const newId = idMap[oldId] ?? oldId;
        remappedTransforms[newId] = val;
      }
      nextLayerTransforms = remappedTransforms;
      // Carry over AI photo results + sources (keyed by aiPhoto layer ID)
      const remappedAiResults: Record<string, string> = {};
      for (const [oldId, val] of Object.entries(state.aiPhotoResults)) {
        const newId = idMap[oldId] ?? oldId;
        remappedAiResults[newId] = val;
      }
      nextAiPhotoResults = remappedAiResults;
      const remappedAiSources: Record<string, AiPhotoSource> = {};
      for (const [oldId, val] of Object.entries(state.aiPhotoSources)) {
        const newId = idMap[oldId] ?? oldId;
        remappedAiSources[newId] = val;
      }
      nextAiPhotoSources = remappedAiSources;
      const remappedAiSelected: Record<string, string> = {};
      for (const [oldId, val] of Object.entries(state.aiPhotoSelectedRefUrl)) {
        const newId = idMap[oldId] ?? oldId;
        remappedAiSelected[newId] = val;
      }
      nextAiPhotoSelectedRefUrl = remappedAiSelected;
      // Carry over per-photo-layer sources + AI results (keyed by photo layer ID)
      const remappedPhotoSources: Record<string, PhotoLayerSource> = {};
      for (const [oldId, val] of Object.entries(state.photoSources)) {
        const newId = idMap[oldId] ?? oldId;
        remappedPhotoSources[newId] = val;
      }
      nextPhotoSources = remappedPhotoSources;
      const remappedPhotoAi: Record<string, string> = {};
      for (const [oldId, val] of Object.entries(state.photoAiResults)) {
        const newId = idMap[oldId] ?? oldId;
        remappedPhotoAi[newId] = val;
      }
      nextPhotoAiResults = remappedPhotoAi;
    } else if (!isFirstLoad) {
      // Same layout block (e.g. poster ↔ aluminum) → keep existing per-layer state untouched.
      nextLayerValues = { ...freshLayerValues, ...state.layerValues };
      nextLayerTransforms = state.layerTransforms;
    }

    // Innehållsvariant: behåll giltigt val, annars mallens default/första.
    const variants = template.contentVariants ?? [];
    const prevVariantId = state.contentVariantId;
    const nextContentVariantId =
      variants.length === 0
        ? null
        : (prevVariantId && variants.some((v) => v.id === prevVariantId))
          ? prevVariantId
          : (template.defaultContentVariantId && variants.some((v) => v.id === template.defaultContentVariantId))
            ? template.defaultContentVariantId
            : variants[0].id;

    const next = {
      config,
      template,
      productOptions,
      orientation,
      contentVariantId: nextContentVariantId,
      layoutId: nextLayoutId,
      size: nextSize,
      variant: nextVariant,
      layerValues: nextLayerValues,
      layerTransforms: nextLayerTransforms,
      aiPhotoResults: nextAiPhotoResults,
      aiPhotoSources: nextAiPhotoSources,
      aiPhotoSelectedRefUrl: nextAiPhotoSelectedRefUrl,
      photoSources: nextPhotoSources,
      photoAiResults: nextPhotoAiResults,
      whiteMarginEnabled: true,
      // Sync background colour from the active layout/orientation block on
      // every config load so per-style/per-product backgrounds take effect.
      ...(layout?.background?.color
        ? { posterBgColor: layout.background.color }
        : {}),
    };
    set({
      ...next,
      ...mirrorLegacy({ template, orientation, layerValues: nextLayerValues, config, layoutId: nextLayoutId }),
      ...mirrorPhoto({ template, orientation, config, photoSources: nextPhotoSources, photoAiResults: nextPhotoAiResults, layoutId: nextLayoutId }),
    });
  },

  setPosterBgColor: (posterBgColor) => set({ posterBgColor }),
  setWhiteMarginEnabled: (whiteMarginEnabled) => set({ whiteMarginEnabled }),
  setLayerTransform: (id, patch) => {
    const state = get();
    const layer = state.template
      ? getActiveLayoutBlock(state.template, state.config?.product_type, state.layoutId)[state.orientation].layers.find((l) => l.id === id)
      : undefined;
    if (!layer) return;
    const cur = state.layerTransforms[id] ?? {};
    const merged = {
      xPct: patch.xPct ?? cur.xPct ?? layer.xPct,
      yPct: patch.yPct ?? cur.yPct ?? layer.yPct,
      wPct: patch.wPct ?? cur.wPct ?? layer.wPct,
      hPct: patch.hPct ?? cur.hPct ?? layer.hPct,
    };
    const clamped = clampLayerRect(merged);
    set({
      layerTransforms: {
        ...state.layerTransforms,
        [id]: clamped,
      },
    });
  },
  resetLayerTransform: (id) => {
    const state = get();
    if (!(id in state.layerTransforms)) return;
    const next = { ...state.layerTransforms };
    delete next[id];
    set({ layerTransforms: next });
  },
  setSize: (size) => {
    const { config, productOptions } = get();
    if (!config) return set({ size });
    const effective = getEffectiveSizes(config, productOptions);
    const sizeDef = effective.find((s) => s.size === size);
    const currentVariant = get().variant;
    const variantStillValid = sizeDef?.variants.find((v) => v.name === currentVariant);
    set({
      size,
      variant: variantStillValid ? currentVariant : sizeDef?.variants[0]?.name ?? null,
    });
  },
  setVariant: (variant) => set({ variant }),
  setOrientation: (orientation) => {
    const state = get();
    const { template, config } = state;
    if (!template) return set({ orientation });
    const prevOrientation = state.orientation;
    const freshLayerValues = hydrateLayerValues(template, orientation, config?.product_type, state.layoutId);

    // Build a portrait↔landscape ID map within the active layout block by
    // pairing layers of the same type index-by-index. Lets per-layer state
    // (AI results, photo sources, transforms) follow over to the matching
    // container in the new orientation.
    const block = getActiveLayoutBlock(template, config?.product_type, state.layoutId);
    const prevLayers = block[prevOrientation]?.layers ?? [];
    const nextLayers = block[orientation]?.layers ?? [];
    const grouped: Record<string, TemplateLayer[]> = {};
    for (const l of nextLayers) (grouped[l.type] ||= []).push(l);
    const cursors: Record<string, number> = {};
    const idMap: Record<string, string> = {};
    for (const prev of prevLayers) {
      const idx = cursors[prev.type] ?? 0;
      const next = grouped[prev.type]?.[idx];
      if (next) idMap[prev.id] = next.id;
      cursors[prev.type] = idx + 1;
    }
    const remap = <T,>(m: Record<string, T>): Record<string, T> => {
      const out: Record<string, T> = {};
      for (const [oldId, v] of Object.entries(m)) {
        const newId = idMap[oldId] ?? oldId;
        out[newId] = v;
      }
      return out;
    };

    // Carry over layerValues for paired layers (same kind), otherwise fresh.
    const layerValues: Record<string, LayerValue> = { ...freshLayerValues };
    for (const [oldId, oldVal] of Object.entries(state.layerValues)) {
      const newId = idMap[oldId] ?? oldId;
      if (layerValues[newId] && layerValues[newId].kind === oldVal.kind) {
        layerValues[newId] = oldVal;
      }
    }

    const photoSources = remap(state.photoSources);
    const photoAiResults = remap(state.photoAiResults);
    const aiPhotoSources = remap(state.aiPhotoSources);
    const aiPhotoResults = remap(state.aiPhotoResults);
    const aiPhotoSelectedRefUrl = remap(state.aiPhotoSelectedRefUrl);
    // Orientation-aware healing: for every aiPhoto layer in the new
    // orientation, ensure the selected reference URL matches an entry
    // tagged for this orientation (or "any"). Otherwise switch to the
    // first matching one. This keeps MapPreview in sync even before the
    // AiPhotoSection control panel mounts.
    for (const l of nextLayers) {
      if (l.type !== "aiPhoto") continue;
      const refs = l.defaults.referenceImages ?? [];
      if (refs.length === 0) continue;
      const matching = refs.filter((r) => {
        const o = (r as { orientation?: string }).orientation ?? "any";
        return o === "any" || o === orientation;
      });
      if (matching.length === 0) continue;
      const cur = aiPhotoSelectedRefUrl[l.id];
      if (!cur || !matching.some((r) => r.url === cur)) {
        aiPhotoSelectedRefUrl[l.id] = matching[0].url;
      }
    }
    const layerTransforms = remap(state.layerTransforms);

    const nextBgColor = block[orientation]?.background?.color;
    set({
      orientation,
      layerValues,
      layerTransforms,
      photoSources,
      photoAiResults,
      aiPhotoSources,
      aiPhotoResults,
      aiPhotoSelectedRefUrl,
      whiteMarginEnabled: true,
      ...(nextBgColor ? { posterBgColor: nextBgColor } : {}),
      ...mirrorLegacy({ template, orientation, layerValues, config, layoutId: state.layoutId }),
      ...mirrorPhoto({ template, orientation, config, photoSources, photoAiResults, layoutId: state.layoutId }),
    });
  },

  setLayoutId: (nextLayoutId) => {
    const state = get();
    const { template, config } = state;
    if (!template) return set({ layoutId: nextLayoutId });
    const prevLayoutId = state.layoutId;
    if (prevLayoutId === nextLayoutId) return;

    const productType = config?.product_type;
    const freshLayerValues = hydrateLayerValues(template, state.orientation, productType, nextLayoutId);

    // Map old layer ids to new layer ids by pairing same-type layers index-
    // by-index across both orientations so per-layer state (uploads, AI
    // results, transforms, text content) follows the customer over.
    const idMap = buildLayerIdMap(template, productType, prevLayoutId, template, productType, nextLayoutId);

    const remap = <T,>(m: Record<string, T>): Record<string, T> => {
      const out: Record<string, T> = {};
      for (const [oldId, v] of Object.entries(m)) {
        const newId = idMap[oldId] ?? oldId;
        out[newId] = v;
      }
      return out;
    };

    // Merge strategy: ALWAYS start from the destination layout's fresh
    // defaults. Layout-defining fields (map styleId/shape/showLabels, photo
    // shape, text content/font) are intentionally per-layout and must NEVER
    // bleed from a previous layout — otherwise switching e.g. Midnatt →
    // Standard keeps Midnatt's map style. Only truly customer-owned values
    // (a panned map center, custom-edited text, photo offset) survive — and
    // only when the destination's locks allow them.
    const nextBlock = getActiveLayoutBlock(template, productType, nextLayoutId);
    const nextLayersById: Record<string, TemplateLayer> = {};
    for (const o of ["portrait", "landscape"] as const) {
      for (const l of nextBlock[o]?.layers ?? []) nextLayersById[l.id] = l;
    }

    // Build a map of prev-layout defaults keyed by old layer id so we can
    // detect "the customer hasn't actually changed this from the previous
    // layout's default" — those values should not be carried over.
    const prevBlock = getActiveLayoutBlock(template, productType, prevLayoutId);
    const prevLayersById: Record<string, TemplateLayer> = {};
    for (const o of ["portrait", "landscape"] as const) {
      for (const l of prevBlock[o]?.layers ?? []) prevLayersById[l.id] = l;
    }

    const layerValues: Record<string, LayerValue> = { ...freshLayerValues };
    for (const [oldId, oldVal] of Object.entries(state.layerValues)) {
      const newId = idMap[oldId] ?? oldId;
      const fresh = layerValues[newId];
      const newLayer = nextLayersById[newId];
      const prevLayer = prevLayersById[oldId];
      if (!fresh || !newLayer || fresh.kind !== oldVal.kind) continue;
      if (oldVal.kind === "map" && fresh.kind === "map" && newLayer.type === "map" && prevLayer?.type === "map") {
        const locks = newLayer.locks;
        // Only carry over the panned map position when the customer has
        // actually moved it away from the previous layout's default center.
        const prevCenter = prevLayer.defaults.center;
        const movedByCustomer =
          Math.abs(prevCenter[0] - oldVal.center[0]) > 1e-6 ||
          Math.abs(prevCenter[1] - oldVal.center[1]) > 1e-6 ||
          Math.abs((prevLayer.defaults.zoom ?? 0) - oldVal.zoom) > 1e-3;
        layerValues[newId] = {
          ...fresh,
          ...(!locks.position && movedByCustomer
            ? {
                center: oldVal.center,
                zoom: oldVal.zoom,
                placeName: oldVal.placeName,
                city: oldVal.city,
                country: oldVal.country,
              }
            : {}),
        };
      } else if (oldVal.kind === "text" && fresh.kind === "text" && newLayer.type === "text") {
        const locks = newLayer.locks;
        // Only customer-edited override survives a layout switch — otherwise
        // the destination layout's default text should win. Bevara även
        // kundens font-size-override (om satt) över layout-byten.
        layerValues[newId] = {
          ...fresh,
          ...(!locks.content && oldVal.overrideText !== null
            ? { overrideText: oldVal.overrideText, text: oldVal.overrideText }
            : {}),
          ...(oldVal.fontSizePt !== null ? { fontSizePt: oldVal.fontSizePt } : {}),
        };
      } else if (oldVal.kind === "photo" && fresh.kind === "photo" && newLayer.type === "photo") {
        const locks = newLayer.locks;
        // Photo shape is layout-defining; only customer offset/zoom survives.
        layerValues[newId] = {
          ...fresh,
          ...(!locks.move ? { offsetX: oldVal.offsetX, offsetY: oldVal.offsetY, zoom: oldVal.zoom } : {}),
        };
      } else if (oldVal.kind === "aiPhoto" && fresh.kind === "aiPhoto" && newLayer.type === "aiPhoto") {
        const locks = newLayer.locks;
        layerValues[newId] = {
          ...fresh,
          ...(!locks.move ? { offsetX: oldVal.offsetX, offsetY: oldVal.offsetY, zoom: oldVal.zoom } : {}),
        };
      } else if (
        oldVal.kind === "starmap" &&
        fresh.kind === "starmap" &&
        newLayer.type === "starmap" &&
        prevLayer?.type === "starmap"
      ) {
        // Kundens datum/tid/plats/toggles är innehåll, inte layout — bär över
        // det som avviker från förra layoutens defaults (annars vinner nya
        // layoutens egna defaults, t.ex. andra färger).
        const pd = prevLayer.defaults;
        const changed =
          oldVal.dateISO !== pd.dateISO ||
          oldVal.timeHHMM !== (pd.timeHHMM ?? "22:00") ||
          Math.abs(oldVal.center[0] - pd.center[0]) > 1e-6 ||
          Math.abs(oldVal.center[1] - pd.center[1]) > 1e-6;
        layerValues[newId] = {
          ...fresh,
          ...(changed
            ? {
                dateISO: oldVal.dateISO,
                timeHHMM: oldVal.timeHHMM,
                center: oldVal.center,
                placeName: oldVal.placeName,
                city: oldVal.city,
                country: oldVal.country,
              }
            : {}),
          showConstellations:
            oldVal.showConstellations !== pd.showConstellations
              ? oldVal.showConstellations
              : fresh.showConstellations,
          showGrid: oldVal.showGrid !== pd.showGrid ? oldVal.showGrid : fresh.showGrid,
        };
      }
    }

    // Re-generate auto-text for text layers linked to a map, so place names
    // (city/country/coords) follow the carried-over map position when the
    // customer switches layout. Customer override is preserved.
    for (const o of ["portrait", "landscape"] as const) {
      for (const l of nextBlock[o]?.layers ?? []) {
        if (l.type !== "text") continue;
        const linkedMapId = l.defaults.linkedMapLayerId;
        if (!linkedMapId) continue;
        const tv = layerValues[l.id];
        if (!tv || tv.kind !== "text") continue;
        const mv = layerValues[linkedMapId];
        if (!mv || (mv.kind !== "map" && mv.kind !== "starmap")) continue;
        const autoText = buildAutoTextForLayer(
          {
            placeName: mv.placeName,
            city: mv.city,
            country: mv.country,
            center: mv.center,
            dateISO: mv.kind === "starmap" ? mv.dateISO : undefined,
          },
          l.defaults,
        );
        layerValues[l.id] = { ...tv, text: tv.overrideText ?? autoText };
      }
    }

    // Layer transforms only apply when size/move locks are open; carry only
    // those entries forward to avoid resurrecting stale rects on locked layers.
    const layerTransformsRemapped = remap(state.layerTransforms);
    const layerTransforms: typeof state.layerTransforms = {};
    for (const [id, val] of Object.entries(layerTransformsRemapped)) {
      const layer = nextLayersById[id];
      if (!layer) continue;
      if (!layer.locks.size || !layer.locks.move) layerTransforms[id] = val;
    }

    const photoSources = remap(state.photoSources);
    const photoAiResults = remap(state.photoAiResults);
    const aiPhotoSources = remap(state.aiPhotoSources);
    const aiPhotoResults = remap(state.aiPhotoResults);
    const aiPhotoSelectedRefUrl = remap(state.aiPhotoSelectedRefUrl);

    // Re-apply the active drink's variant text so title/labels/one-liner and
    // untouched recipe fields reflect the selected drink in the new layout —
    // not the layout's own (Aperol) defaults — after a stil-byte.
    applyVariantTextInPlace(template, state.contentVariantId, nextLayersById, layerValues);

    const nextBgColor = nextBlock[state.orientation]?.background?.color;
    set({
      layoutId: nextLayoutId,
      layerValues,
      layerTransforms,
      photoSources,
      photoAiResults,
      aiPhotoSources,
      aiPhotoResults,
      aiPhotoSelectedRefUrl,
      ...(nextBgColor ? { posterBgColor: nextBgColor } : {}),
      ...mirrorLegacy({ template, orientation: state.orientation, layerValues, config, layoutId: nextLayoutId }),
      ...mirrorPhoto({ template, orientation: state.orientation, config, photoSources, photoAiResults, layoutId: nextLayoutId }),
    });

    // Auto-switch to the layout's preferred orientation (e.g. multi-map
    // "Vår resa 2"/"Två himlar" are designed landscape). Runs after the
    // layout state has landed so setOrientation re-hydrates + carries values
    // against the new layout. The customer can still toggle back via Format.
    const preferred = getAllLayouts(template).find((l) => l.id === nextLayoutId)?.preferredOrientation;
    if (preferred && preferred !== state.orientation && template.orientations.includes(preferred)) {
      get().setOrientation(preferred);
    }
  },
  setContentVariant: (variantId) => {
    const state = get();
    const { template, config } = state;
    if (!template) return;
    const variant = (template.contentVariants ?? []).find((v) => v.id === variantId);
    if (!variant || variantId === state.contentVariantId) return;
    // Varianttexterna sätts som kund-override (overrideText) så de överlever
    // layoutbyten och förblir fritt redigerbara i Text-fliken. Bild- och
    // färg-overrides löses vid rendering via applyContentVariant.
    const nextValues: Record<string, LayerValue> = { ...state.layerValues };
    for (const [layerId, ov] of Object.entries(variant.overrides ?? {})) {
      if (ov.text === undefined) continue;
      const existing = nextValues[layerId];
      if (existing && existing.kind === "text") {
        nextValues[layerId] = { ...existing, text: ov.text, overrideText: ov.text };
      }
    }
    set({
      contentVariantId: variantId,
      layerValues: nextValues,
      ...mirrorLegacy({ template, orientation: state.orientation, layerValues: nextValues, config, layoutId: state.layoutId }),
    });
  },
  // ---------- per-photo-layer setters ----------
  setPhotoSourceFor: (layerId, file, previewUrl) => {
    const state = get();
    const prevSrc = state.photoSources[layerId];
    if (prevSrc?.previewUrl?.startsWith("blob:") && prevSrc.previewUrl !== previewUrl) {
      try { URL.revokeObjectURL(prevSrc.previewUrl); } catch { /* noop */ }
    }
    const nextSources = { ...state.photoSources };
    const nextResults = { ...state.photoAiResults };
    if (!file || !previewUrl) {
      delete nextSources[layerId];
      delete nextResults[layerId];
    } else {
      nextSources[layerId] = { file, previewUrl, hash: null, originalUrl: null };
      // New photo → drop any AI result for this layer.
      delete nextResults[layerId];
      track("photo_uploaded", {
        layerId,
        kind: "photo",
        handle: state.config?.shopify_handle,
        productType: state.config?.product_type,
      });
    }
    // Reset offset for this specific photo layer.
    const layerValues = { ...state.layerValues };
    const v = layerValues[layerId];
    if (v && v.kind === "photo") {
      layerValues[layerId] = { ...v, offsetX: 0, offsetY: 0, zoom: 1 };
    }
    set({
      photoSources: nextSources,
      photoAiResults: nextResults,
      layerValues,
      ...mirrorPhoto({ ...state, photoSources: nextSources, photoAiResults: nextResults }),
    });
  },
  setPhotoHashFor: (layerId, hash) => {
    const state = get();
    const cur = state.photoSources[layerId];
    if (!cur || cur.hash === hash) return;
    const nextSources = { ...state.photoSources, [layerId]: { ...cur, hash } };
    set({ photoSources: nextSources, ...mirrorPhoto({ ...state, photoSources: nextSources }) });
  },
  setOriginalPhotoUrlFor: (layerId, url) => {
    const state = get();
    const cur = state.photoSources[layerId];
    if (!cur) return;
    const nextSources = { ...state.photoSources, [layerId]: { ...cur, originalUrl: url } };
    set({ photoSources: nextSources, ...mirrorPhoto({ ...state, photoSources: nextSources }) });
  },
  setAiPrintFileUrlFor: (layerId, url) => {
    const state = get();
    const nextResults = { ...state.photoAiResults };
    if (url) nextResults[layerId] = url;
    else delete nextResults[layerId];
    set({ photoAiResults: nextResults, ...mirrorPhoto({ ...state, photoAiResults: nextResults }) });
  },
  clearAiResultOnlyFor: (layerId) => {
    const state = get();
    if (!(layerId in state.photoAiResults)) return;
    const nextResults = { ...state.photoAiResults };
    delete nextResults[layerId];
    set({ photoAiResults: nextResults, ...mirrorPhoto({ ...state, photoAiResults: nextResults }) });
  },
  getPhotoOverlays: () => {
    const { photoSources, photoAiResults } = get();
    const out: Record<string, string> = {};
    for (const [id, src] of Object.entries(photoSources)) {
      if (src.previewUrl) out[id] = src.previewUrl;
    }
    for (const [id, url] of Object.entries(photoAiResults)) {
      if (url) out[id] = url;
    }
    return out;
  },
  firstPhotoLayerId: () => {
    const layers = get().templateLayers();
    return layers.find((l) => l.type === "photo")?.id ?? null;
  },

  // ---------- legacy globals → operate on first photo layer ----------
  setPhotoSource: (file, previewUrl) => {
    const id = get().firstPhotoLayerId();
    if (id) get().setPhotoSourceFor(id, file, previewUrl);
  },
  setOriginalPhotoUrl: (url) => {
    const id = get().firstPhotoLayerId();
    if (id && url) get().setOriginalPhotoUrlFor(id, url);
  },
  setPhotoHash: (hash) => {
    const id = get().firstPhotoLayerId();
    if (id && hash) get().setPhotoHashFor(id, hash);
  },
  setAiPrintFileUrl: (url) => {
    const id = get().firstPhotoLayerId();
    if (id) get().setAiPrintFileUrlFor(id, url);
  },
  clearAiResultOnly: () => {
    const id = get().firstPhotoLayerId();
    if (id) get().clearAiResultOnlyFor(id);
  },
  resetDesignSource: () => {
    const state = get();
    // Revoke all blob URLs.
    for (const src of Object.values(state.photoSources)) {
      if (src.previewUrl?.startsWith("blob:")) {
        try { URL.revokeObjectURL(src.previewUrl); } catch { /* noop */ }
      }
    }
    set({
      photoSources: {},
      photoAiResults: {},
      layerValues: resetPhotoOffsets(state.layerValues),
      ...mirrorPhoto({ ...state, photoSources: {}, photoAiResults: {} }),
    });
  },
  setShopifyVariantId: (shopifyVariantId) => set({ shopifyVariantId }),
  setShopifyVariantResolving: (shopifyVariantResolving) => set({ shopifyVariantResolving }),

  // ---------- AI cache ----------
  addAiResultToCache: (photoHash, presetId, presetLabel, url) => {
    if (!photoHash) return;
    const key = makeCacheKey(photoHash, presetId);
    const next: Record<string, AiCacheEntry> = {
      ...get().aiResultCache,
      [key]: { url, presetId, presetLabel, photoHash, timestamp: Date.now() },
    };
    set({ aiResultCache: next });
    saveAiCache(next);
  },
  getCachedAiResult: (photoHash, presetId) => {
    if (!photoHash) return null;
    const entry = get().aiResultCache[makeCacheKey(photoHash, presetId)];
    return entry?.url ?? null;
  },
  listAiResultsForPhoto: (photoHash) => {
    if (!photoHash) return [];
    return Object.values(get().aiResultCache)
      .filter((e) => e.photoHash === photoHash)
      .sort((a, b) => b.timestamp - a.timestamp);
  },
  clearAiResult: (photoHash, presetId) => {
    if (!photoHash) return;
    const key = makeCacheKey(photoHash, presetId);
    const cur = get().aiResultCache;
    if (!cur[key]) return;
    const next = { ...cur };
    delete next[key];
    set({ aiResultCache: next });
    saveAiCache(next);
  },

  // ---------- aiPhoto (face-swap) ----------
  setAiPhotoSource: (layerId, file, previewUrl) => {
    const cur = get().aiPhotoSources;
    const prev = cur[layerId];
    if (!file || !previewUrl) {
      // Clear
      if (prev?.previewUrl?.startsWith("blob:")) {
        try { URL.revokeObjectURL(prev.previewUrl); } catch { /* noop */ }
      }
      const next = { ...cur };
      delete next[layerId];
      const results = { ...get().aiPhotoResults };
      delete results[layerId];
      set({ aiPhotoSources: next, aiPhotoResults: results });
      return;
    }
    if (prev?.previewUrl?.startsWith("blob:") && prev.previewUrl !== previewUrl) {
      try { URL.revokeObjectURL(prev.previewUrl); } catch { /* noop */ }
    }
    track("photo_uploaded", {
      layerId,
      kind: "aiPhoto",
      handle: get().config?.shopify_handle,
      productType: get().config?.product_type,
    });
    set({
      aiPhotoSources: {
        ...cur,
        [layerId]: { file, previewUrl, hash: null, uploadedUrl: null },
      },
      // New face → drop the old swap result for this layer.
      aiPhotoResults: (() => {
        const r = { ...get().aiPhotoResults };
        delete r[layerId];
        return r;
      })(),
    });
  },
  setAiPhotoHash: (layerId, hash) => {
    const cur = get().aiPhotoSources[layerId];
    if (!cur || cur.hash === hash) return;
    set({
      aiPhotoSources: {
        ...get().aiPhotoSources,
        [layerId]: { ...cur, hash },
      },
    });
  },
  setAiPhotoUploadedUrl: (layerId, url) => {
    const cur = get().aiPhotoSources[layerId];
    if (!cur) return;
    set({
      aiPhotoSources: {
        ...get().aiPhotoSources,
        [layerId]: { ...cur, uploadedUrl: url },
      },
    });
  },
  setAiPhotoResult: (layerId, url) => {
    const cur = { ...get().aiPhotoResults };
    if (url) cur[layerId] = url;
    else delete cur[layerId];
    set({ aiPhotoResults: cur });
  },
  setAiPhotoSelectedRef: (layerId, url) => {
    const cur = { ...get().aiPhotoSelectedRefUrl };
    if (url) cur[layerId] = url;
    else delete cur[layerId];
    set({ aiPhotoSelectedRefUrl: cur });
  },
  clearAiPhoto: (layerId) => {
    const sources = { ...get().aiPhotoSources };
    const prev = sources[layerId];
    if (prev?.previewUrl?.startsWith("blob:")) {
      try { URL.revokeObjectURL(prev.previewUrl); } catch { /* noop */ }
    }
    delete sources[layerId];
    const results = { ...get().aiPhotoResults };
    delete results[layerId];
    set({ aiPhotoSources: sources, aiPhotoResults: results });
  },
  addFaceSwapToCache: (layerId, faceHash, referenceImageUrl, url) => {
    if (!faceHash || !referenceImageUrl) return;
    const key = makeFaceSwapKey(faceHash, referenceImageUrl, layerId);
    const next: Record<string, FaceSwapCacheEntry> = {
      ...get().faceSwapCache,
      [key]: { url, layerId, faceHash, referenceImageUrl, timestamp: Date.now() },
    };
    set({ faceSwapCache: next });
    saveFaceSwapCache(next);
  },
  getCachedFaceSwap: (layerId, faceHash, referenceImageUrl) => {
    if (!faceHash || !referenceImageUrl) return null;
    const entry = get().faceSwapCache[makeFaceSwapKey(faceHash, referenceImageUrl, layerId)];
    return entry?.url ?? null;
  },

  // ---------- multi-face (OPTIONAL) ----------
  setMultiFacePortrait: (layerId, slotId, file, previewUrl) => {
    const cur = get().multiFacePortraits;
    const layerMap = { ...(cur[layerId] ?? {}) };
    const prev = layerMap[slotId];
    if (prev?.previewUrl?.startsWith("blob:") && prev.previewUrl !== previewUrl) {
      try { URL.revokeObjectURL(prev.previewUrl); } catch { /* noop */ }
    }
    if (!file || !previewUrl) {
      delete layerMap[slotId];
    } else {
      layerMap[slotId] = { file, previewUrl, hash: null, uploadedUrl: null };
      track("photo_uploaded", {
        layerId,
        kind: "multiFace",
        slotId,
        handle: get().config?.shopify_handle,
        productType: get().config?.product_type,
      });
    }
    const nextLayers = { ...cur };
    if (Object.keys(layerMap).length === 0) {
      delete nextLayers[layerId];
    } else {
      nextLayers[layerId] = layerMap;
    }
    // New portrait on any slot → drop the cached aggregated result for the
    // layer so the customer's next "Skapa" re-runs with the fresh inputs.
    const results = { ...get().aiPhotoResults };
    delete results[layerId];
    set({ multiFacePortraits: nextLayers, aiPhotoResults: results });
  },
  setMultiFacePortraitHash: (layerId, slotId, hash) => {
    const cur = get().multiFacePortraits;
    const layerMap = cur[layerId];
    const entry = layerMap?.[slotId];
    if (!entry || entry.hash === hash) return;
    set({
      multiFacePortraits: {
        ...cur,
        [layerId]: { ...layerMap, [slotId]: { ...entry, hash } },
      },
    });
  },
  setMultiFacePortraitUploadedUrl: (layerId, slotId, url) => {
    const cur = get().multiFacePortraits;
    const layerMap = cur[layerId];
    const entry = layerMap?.[slotId];
    if (!entry) return;
    set({
      multiFacePortraits: {
        ...cur,
        [layerId]: { ...layerMap, [slotId]: { ...entry, uploadedUrl: url } },
      },
    });
  },
  clearMultiFacePortraits: (layerId) => {
    const cur = get().multiFacePortraits;
    if (!cur[layerId]) return;
    for (const entry of Object.values(cur[layerId])) {
      if (entry.previewUrl?.startsWith("blob:")) {
        try { URL.revokeObjectURL(entry.previewUrl); } catch { /* noop */ }
      }
    }
    const next = { ...cur };
    delete next[layerId];
    const results = { ...get().aiPhotoResults };
    delete results[layerId];
    set({ multiFacePortraits: next, aiPhotoResults: results });
  },

  setLayerMapCenter: (id, c) => updateMap(set, get, id, { center: c }),
  setLayerMapZoom: (id, z) => updateMap(set, get, id, { zoom: z }),
  setLayerMapStyle: (id, s) => updateMap(set, get, id, { styleId: s }),
  setLayerMapShape: (id, s) => updateMap(set, get, id, { shape: s }),
  setLayerShowLabels: (id, v) => updateMap(set, get, id, { showLabels: v }),

  applyPlaceToLayer: (id, args) => {
    applyPlaceInternal(set, get, id, args, /* moveCenter */ true);
  },
  updateMapLayerFromPan: (id, args) => {
    applyPlaceInternal(set, get, id, args, /* moveCenter */ false);
  },
  patchStarmapLayer: (id, patch) => patchStarmap(set, get, id, patch),

  setLayerText: (id, t) => setLayerOverrideText(set, get, id, t),
  setLayerTextFont: (id, f) => updateText(set, get, id, { font: f }),
  setLayerTextFontSizePt: (id, pt) => updateText(set, get, id, { fontSizePt: pt }),
  setLayerTextVisible: (id, v) => updateText(set, get, id, { visible: v }),
  setLayerPhotoShape: (id, s) => updatePhoto(set, get, id, { shape: s }),
  setLayerPhotoOffset: (id, x, y) =>
    // Clamp is performed at the call site (PhotoLayerView) where natural
    // image dimensions and container size are known. Store the raw value.
    updatePhoto(set, get, id, { offsetX: x, offsetY: y }),
  setLayerPhotoZoom: (id, zoom) => {
    const z = Math.max(1, Math.min(5, zoom));
    updatePhoto(set, get, id, { zoom: z });
  },

  // ---------- legacy globals → operate on first layer ----------
  setMapCenter: (c) => {
    const id = get().firstMapLayerId();
    if (id) updateMap(set, get, id, { center: c });
  },
  setMapZoom: (z) => {
    const id = get().firstMapLayerId();
    if (id) updateMap(set, get, id, { zoom: z });
  },
  setMapStyleId: (s) => {
    const id = get().firstMapLayerId();
    if (id) updateMap(set, get, id, { styleId: s });
  },
  setShowLabels: (v) => {
    const id = get().firstMapLayerId();
    if (id) updateMap(set, get, id, { showLabels: v });
  },
  setMapShape: (s) => {
    const id = get().firstMapLayerId();
    if (id) updateMap(set, get, id, { shape: s });
  },
  setText: (t) => {
    const id = get().firstTextLayerId();
    if (id) setLayerOverrideText(set, get, id, t);
  },
  setTextFont: (f) => {
    const id = get().firstTextLayerId();
    if (id) updateText(set, get, id, { font: f });
  },
  setTextVisible: (v) => {
    const id = get().firstTextLayerId();
    if (id) updateText(set, get, id, { visible: v });
  },
  applyPlace: (args) => {
    const id = get().firstMapLayerId();
    if (id) applyPlaceInternal(set, get, id, args, true);
  },
  updateFromMap: (args) => {
    const id = get().firstMapLayerId();
    if (id) applyPlaceInternal(set, get, id, args, false);
  },

  // ---------- computed ----------
  currentPrice: () => {
    const { config, productOptions, size, variant } = get();
    if (!config || !size || !variant) return 0;
    const effective = getEffectiveSizes(config, productOptions);
    const sizeDef = effective.find((s) => s.size === size);
    return sizeDef?.variants.find((v) => v.name === variant)?.price ?? 0;
  },
  currentLayout: () => {
    const { config, orientation } = get();
    return config?.layouts[orientation] ?? null;
  },
  templateLayers: () => {
    const { template, orientation, config } = get();
    if (!template) return [];
    return [...getActiveLayoutBlock(template, config?.product_type, get().layoutId)[orientation].layers].sort((a, b) => a.zIndex - b.zIndex);
  },
  firstMapLayerId: () => {
    const layers = get().templateLayers();
    return layers.find((l) => l.type === "map")?.id ?? null;
  },
  firstTextLayerId: () => {
    const layers = get().templateLayers();
    return layers.find((l) => l.type === "text")?.id ?? null;
  },
  getMapValue: (id) => {
    const v = get().layerValues[id];
    return v && v.kind === "map" ? v : null;
  },
  getTextValue: (id) => {
    const v = get().layerValues[id];
    return v && v.kind === "text" ? v : null;
  },

  // ---------- freeform actions ----------
  addCustomLayer: (type, opts) => {
    const state = get();
    const tpl = state.template;
    const config = state.config;
    if (!tpl || !config) return null;
    const block = getActiveLayoutBlock(tpl, config.product_type, state.layoutId)[state.orientation];
    const newLayer = createFreeformLayer(type, {
      zIndex: nextTopZIndex(block.layers),
      defaultFont: tpl.productOptions?.allowedFonts?.[0] ?? undefined,
      defaultMapStyleId: tpl.productOptions?.mapStyles?.[0]?.id ?? undefined,
      shapeKind: opts?.shapeKind,
      lineOrientation: opts?.lineOrientation,
    });
    const nextTemplate = mutateActiveLayoutBlock(
      tpl,
      config.product_type,
      state.layoutId,
      state.orientation,
      (layers) => [...layers, newLayer],
    );
    // Seed layer values entry
    const layerValues = { ...state.layerValues };
    if (newLayer.type === "map") {
      layerValues[newLayer.id] = {
        kind: "map",
        center: [newLayer.defaults.center[0], newLayer.defaults.center[1]],
        zoom: newLayer.defaults.zoom,
        styleId: newLayer.defaults.styleId,
        shape: newLayer.defaults.shape as MapShape,
        showLabels: newLayer.defaults.showLabels,
        placeName: newLayer.defaults.placeName ?? "",
        city: newLayer.defaults.city,
        country: newLayer.defaults.country,
        icons: [],
      };
    } else if (newLayer.type === "text") {
      layerValues[newLayer.id] = {
        kind: "text",
        text: newLayer.defaults.text,
        overrideText: null,
        font: newLayer.defaults.font,
        fontSizePt: null,
        visible: true,
      };
    } else if (newLayer.type === "photo") {
      layerValues[newLayer.id] = {
        kind: "photo",
        shape: newLayer.defaults.shape as PhotoShape,
        offsetX: 0,
        offsetY: 0,
        zoom: 1,
      };
    } else if (newLayer.type === "aiPhoto") {
      layerValues[newLayer.id] = {
        kind: "aiPhoto",
        shape: newLayer.defaults.shape as PhotoShape,
        offsetX: 0,
        offsetY: 0,
        zoom: 1,
      };
    }
    set({ template: nextTemplate, layerValues });
    return newLayer.id;
  },
  removeCustomLayer: (id) => {
    const state = get();
    const tpl = state.template;
    const config = state.config;
    if (!tpl || !config) return;
    const nextTemplate = mutateActiveLayoutBlock(
      tpl,
      config.product_type,
      state.layoutId,
      state.orientation,
      (layers) => layers.filter((l) => l.id !== id),
    );
    const layerValues = { ...state.layerValues };
    delete layerValues[id];
    const layerTransforms = { ...state.layerTransforms };
    delete layerTransforms[id];
    const hiddenLayerIds = { ...state.hiddenLayerIds };
    delete hiddenLayerIds[id];
    set({ template: nextTemplate, layerValues, layerTransforms, hiddenLayerIds });
  },
  setLayerVisible: (id, visible) => {
    const next = { ...get().hiddenLayerIds };
    if (visible) delete next[id];
    else next[id] = true;
    set({ hiddenLayerIds: next });
  },
  isLayerHidden: (id) => Boolean(get().hiddenLayerIds[id]),
  setHandlesVisible: (v) => set({ handlesVisible: v }),
  updateLayerDefaults: (id, patch) => {
    const state = get();
    const tpl = state.template;
    const config = state.config;
    if (!tpl || !config) return;
    const nextTemplate = mutateActiveLayoutBlock(
      tpl,
      config.product_type,
      state.layoutId,
      state.orientation,
      (layers) =>
        layers.map((l) =>
          l.id === id
            ? ({ ...l, defaults: { ...(l as { defaults: object }).defaults, ...patch } } as typeof l)
            : l,
        ),
    );
    set({ template: nextTemplate });
  },
  reorderLayers: (orderedIds) => {
    const state = get();
    const tpl = state.template;
    const config = state.config;
    if (!tpl || !config) return;
    const nextTemplate = mutateActiveLayoutBlock(
      tpl,
      config.product_type,
      state.layoutId,
      state.orientation,
      (layers) => {
        // orderedIds är TOPP-först (= högst zIndex först). Tilldela jämna
        // steg så det finns gap för framtida insert.
        const total = orderedIds.length;
        const byId = new Map(layers.map((l) => [l.id, l] as const));
        return layers.map((l) => {
          const idx = orderedIds.indexOf(l.id);
          if (idx === -1) return l;
          const newZ = (total - idx) * 10;
          return { ...l, zIndex: newZ };
        });
      },
    );
    set({ template: nextTemplate });
  },
  orderBlockReason: () => {
    const state = get();
    if (!state.template) return null;
    // Freeform har egen spärr (hasDesignContent) — dubbelblockera inte.
    if (state.config?.is_freeform) return null;
    const layers = state.templateLayers().filter((l) => !state.hiddenLayerIds[l.id]);
    if (layers.length === 0) return null;

    // 0) Demo-resultat ("Prova med exempelbild") får aldrig beställas.
    const demoActive = layers.some((l) => {
      const demoUrl = (l.defaults as { demoResultUrl?: string }).demoResultUrl;
      if (!demoUrl) return false;
      if (l.type === "aiPhoto") return state.aiPhotoResults[l.id] === demoUrl;
      if (l.type === "photo") return state.photoAiResults[l.id] === demoUrl;
      return false;
    });
    if (demoActive) return "demo";

    // 1) aiPhoto utan resultat skulle trycka admin-referensen som den är.
    if (layers.some((l) => l.type === "aiPhoto" && !state.aiPhotoResults[l.id])) {
      return "generation";
    }

    // 2) Foto-lager: minst ett måste vara ifyllt, och alla med placeholder
    //    måste ersättas (annars trycks exempelbilden i tomma platser).
    const photoLayers = layers.filter((l) => l.type === "photo");
    if (photoLayers.length > 0) {
      const filledCount = photoLayers.filter((l) => !!state.photoSources[l.id]).length;
      const missingPlaceholder = photoLayers.filter(
        (l) =>
          l.type === "photo" && !!l.defaults.placeholderUrl && !state.photoSources[l.id],
      ).length;
      if (filledCount === 0 || missingPlaceholder > 0) {
        const missing = filledCount === 0 ? photoLayers.length : missingPlaceholder;
        return missing > 1 ? "photoMulti" : "photo";
      }
    }

    // 3) Mallar utan bildlager (karttavlor m.fl.): kräv att kunden ändrat
    //    NÅGON parameter från default innan beställning.
    const hasImageLayers = layers.some((l) => l.type === "photo" || l.type === "aiPhoto");
    if (!hasImageLayers && layers.some((l) => l.type === "map" || l.type === "text")) {
      const block = getActiveLayoutBlock(state.template, state.config?.product_type, state.layoutId)[state.orientation];
      const defaultBg = block?.background?.color;
      const customized =
        Object.keys(state.layerTransforms).length > 0 ||
        !state.whiteMarginEnabled ||
        (!!defaultBg && state.posterBgColor !== defaultBg) ||
        layers.some((l) => {
          const v = state.layerValues[l.id];
          if (l.type === "map" && v?.kind === "map") {
            const d = l.defaults;
            const moved =
              Math.abs(d.center[0]! - v.center[0]) > 1e-6 ||
              Math.abs(d.center[1]! - v.center[1]) > 1e-6 ||
              Math.abs(d.zoom - v.zoom) > 1e-3;
            return (
              moved ||
              v.styleId !== d.styleId ||
              v.shape !== (d.shape as MapShape) ||
              v.showLabels !== d.showLabels ||
              (v.icons?.length ?? 0) > 0 ||
              (v.placeName ?? "") !== (d.placeName ?? "")
            );
          }
          if (l.type === "text" && v?.kind === "text") {
            return (
              v.overrideText !== null ||
              v.fontSizePt !== null ||
              v.font !== l.defaults.font ||
              !v.visible
            );
          }
          return false;
        });
      if (!customized) return "customize";
    }

    return null;
  },
  hasDesignContent: () => {
    const state = get();
    const layers = state.templateLayers();
    if (layers.length === 0) return false;
    for (const layer of layers) {
      if (state.hiddenLayerIds[layer.id]) continue;
      const v = state.layerValues[layer.id];
      if (layer.type === "photo") {
        const src = state.photoSources[layer.id];
        if (src?.previewUrl || src?.originalUrl) return true;
      } else if (layer.type === "aiPhoto") {
        if (state.aiPhotoResults[layer.id]) return true;
        const src = state.aiPhotoSources[layer.id];
        if (src?.previewUrl || src?.uploadedUrl) return true;
      } else if (layer.type === "map") {
        if (v && v.kind === "map" && v.placeName) return true;
      } else if (layer.type === "text") {
        if (v && v.kind === "text") {
          const eff = v.overrideText ?? v.text;
          if (eff && eff.trim().length > 0) return true;
        }
      }
    }
    return false;
  },
  moveLayerZ: (id, direction) => {
    const state = get();
    const tpl = state.template;
    const config = state.config;
    if (!tpl || !config) return;
    const nextTemplate = mutateActiveLayoutBlock(
      tpl,
      config.product_type,
      state.layoutId,
      state.orientation,
      (layers) => {
        const sorted = [...layers].sort((a, b) => a.zIndex - b.zIndex);
        const idx = sorted.findIndex((l) => l.id === id);
        if (idx === -1) return layers;
        const swapIdx = idx + direction;
        if (swapIdx < 0 || swapIdx >= sorted.length) return layers;
        const a = sorted[idx]!;
        const b = sorted[swapIdx]!;
        const out = layers.map((l) => {
          if (l.id === a.id) return { ...l, zIndex: b.zIndex };
          if (l.id === b.id) return { ...l, zIndex: a.zIndex };
          return l;
        });
        return out;
      },
    );
    set({ template: nextTemplate });
  },
}));


// ---------- internal helpers ----------
type SetFn = (partial: Partial<EditorState> | ((s: EditorState) => Partial<EditorState>)) => void;
type GetFn = () => EditorState;

function updateMap(set: SetFn, get: GetFn, id: string, patch: Partial<MapLayerValue>) {
  const state = get();
  const cur = state.layerValues[id];
  if (!cur || cur.kind !== "map") return;
  const next: MapLayerValue = { ...cur, ...patch };
  const layerValues = { ...state.layerValues, [id]: next };
  set({ layerValues, ...mirrorLegacy({ template: state.template, orientation: state.orientation, layerValues, config: state.config, layoutId: state.layoutId }) });
}

function updateText(set: SetFn, get: GetFn, id: string, patch: Partial<TextLayerValue>) {
  const state = get();
  const cur = state.layerValues[id];
  if (!cur || cur.kind !== "text") return;
  const next: TextLayerValue = { ...cur, ...patch };
  const layerValues = { ...state.layerValues, [id]: next };
  set({ layerValues, ...mirrorLegacy({ template: state.template, orientation: state.orientation, layerValues, config: state.config, layoutId: state.layoutId }) });
}

/** Customer-facing text setter: stores raw override and recomputes the
 *  effective `text` mirror from the linked map's current place. Empty/null
 *  override means "follow auto". */
function setLayerOverrideText(set: SetFn, get: GetFn, id: string, raw: string) {
  const state = get();
  const cur = state.layerValues[id];
  if (!cur || cur.kind !== "text") return;
  const layout = state.template
    ? getActiveLayoutBlock(state.template, state.config?.product_type, state.layoutId)[state.orientation]
    : null;
  const layer = layout?.layers.find((l) => l.id === id);
  const linkedMapId =
    layer && layer.type === "text" ? layer.defaults.linkedMapLayerId : null;
  const mv = linkedMapId ? state.layerValues[linkedMapId] : null;
  const autoText =
    layer && layer.type === "text"
      ? mv && mv.kind === "map"
        ? buildAutoTextForLayer(
            { placeName: mv.placeName, city: mv.city, country: mv.country, center: mv.center },
            layer.defaults,
          )
        : layer.defaults.text
      : "";
  // If the customer's input matches the auto-text exactly, treat as "follow
  // auto" so future kartuppdateringar continue to flow. Otherwise persist as
  // override (including empty string — that's a deliberate clear).
  const overrideText = raw === autoText ? null : raw;
  const next: TextLayerValue = {
    ...cur,
    overrideText,
    text: overrideText ?? autoText,
  };
  const layerValues = { ...state.layerValues, [id]: next };
  set({ layerValues, ...mirrorLegacy({ template: state.template, orientation: state.orientation, layerValues, config: state.config, layoutId: state.layoutId }) });
}

function updatePhoto(
  set: SetFn,
  get: GetFn,
  id: string,
  patch: Partial<PhotoLayerValue> & Partial<AiPhotoLayerValue>,
) {
  const state = get();
  const cur = state.layerValues[id];
  if (!cur || (cur.kind !== "photo" && cur.kind !== "aiPhoto")) return;
  const next = { ...cur, ...patch } as LayerValue;
  const layerValues = { ...state.layerValues, [id]: next };
  set({ layerValues });
}

function resetPhotoOffsets(values: Record<string, LayerValue>): Record<string, LayerValue> {
  const out: Record<string, LayerValue> = { ...values };
  for (const [id, v] of Object.entries(values)) {
    if (v.kind === "photo") {
      out[id] = { ...v, offsetX: 0, offsetY: 0, zoom: 1 };
    }
  }
  return out;
}

function applyPlaceInternal(
  set: SetFn,
  get: GetFn,
  mapId: string,
  args: ApplyPlaceArgs,
  moveCenter: boolean,
) {
  const state = get();
  const cur = state.layerValues[mapId];
  if (!cur || (cur.kind !== "map" && cur.kind !== "starmap")) return;
  // Starmap har inget manuellt pan-läge — platsen flyttar alltid centrum.
  const nextVal: LayerValue =
    cur.kind === "map"
      ? {
          ...cur,
          ...(moveCenter ? { center: args.center } : {}),
          placeName: args.placeName,
          city: args.city,
          country: args.country,
        }
      : {
          ...cur,
          center: args.center,
          placeName: args.placeName,
          city: args.city,
          country: args.country,
        };

  // Update any text layers explicitly linked to this map (only when not
  // user-customised). No implicit "first map → first text" fallback — that
  // promise is upheld by the migration step in template-migrate.ts which
  // back-fills `linkedMapLayerId` for single-map+single-text templates.
  const layers = state.template
    ? getActiveLayoutBlock(state.template, state.config?.product_type, state.layoutId)[state.orientation].layers
    : [];
  const newLayerValues: Record<string, LayerValue> = {
    ...state.layerValues,
    [mapId]: nextVal,
  };
  const dateISO = nextVal.kind === "starmap" ? nextVal.dateISO : undefined;
  for (const l of layers) {
    if (l.type !== "text") continue;
    if (l.defaults.linkedMapLayerId !== mapId) continue;
    const tv = state.layerValues[l.id];
    if (!tv || tv.kind !== "text") continue;
    // Kartan vinner alltid: rensa override + skriv ny auto-text.
    newLayerValues[l.id] = {
      ...tv,
      overrideText: null,
      text: buildAutoTextForLayer({ ...args, dateISO }, l.defaults),
    };
  }

  set({
    layerValues: newLayerValues,
    ...mirrorLegacy({ template: state.template, orientation: state.orientation, layerValues: newLayerValues, config: state.config, layoutId: state.layoutId }),
  });
}

/** Patch på starmap-lagret (datum/tid/toggles). Datum påverkar [[date]]-token
 *  i länkade texter, så auto-texterna räknas om — samma "kartan vinner
 *  alltid"-regel som platsbyten. */
function patchStarmap(
  set: SetFn,
  get: GetFn,
  id: string,
  patch: Partial<Omit<StarmapLayerValue, "kind">>,
) {
  const state = get();
  const cur = state.layerValues[id];
  if (!cur || cur.kind !== "starmap") return;
  const next: StarmapLayerValue = { ...cur, ...patch };
  const newLayerValues: Record<string, LayerValue> = { ...state.layerValues, [id]: next };
  if (patch.dateISO !== undefined && patch.dateISO !== cur.dateISO) {
    const layers = state.template
      ? getActiveLayoutBlock(state.template, state.config?.product_type, state.layoutId)[state.orientation].layers
      : [];
    for (const l of layers) {
      if (l.type !== "text") continue;
      if (l.defaults.linkedMapLayerId !== id) continue;
      const tv = state.layerValues[l.id];
      if (!tv || tv.kind !== "text") continue;
      newLayerValues[l.id] = {
        ...tv,
        overrideText: null,
        text: buildAutoTextForLayer(
          {
            placeName: next.placeName,
            center: next.center,
            city: next.city,
            country: next.country,
            dateISO: next.dateISO,
          },
          l.defaults,
        ),
      };
    }
  }
  set({
    layerValues: newLayerValues,
    ...mirrorLegacy({ template: state.template, orientation: state.orientation, layerValues: newLayerValues, config: state.config, layoutId: state.layoutId }),
  });
}
