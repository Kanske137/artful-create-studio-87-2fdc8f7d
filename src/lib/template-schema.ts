// Zod schema + TS types for the modular design template stored in
// `product_configs.template`. See `.lovable/plan.md` for the high-level model.
//
// Coordinate system: layer position/size are PERCENT of the FRONT zone of the
// design canvas. Marginal/line thickness is in millimetres so the print-file
// pipeline can convert them via PX_PER_CM.
import { z } from "zod";

// ---------- shared ----------
export const orientationSchema = z.enum(["portrait", "landscape"]);
export type Orientation = z.infer<typeof orientationSchema>;

export const aspectSchema = z.enum(["3:4", "4:3", "1:1"]);
export type Aspect = z.infer<typeof aspectSchema>;

export const productTypeSchema = z.enum(["poster", "canvas", "aluminum", "acrylic"]);
export type TemplateProductType = z.infer<typeof productTypeSchema>;

export const mapShapeSchema = z.enum(["rect", "circle", "heart", "star"]);
export type MapShape = z.infer<typeof mapShapeSchema>;

export const imageFitSchema = z.enum(["cover", "contain"]);
export const imageShapeSchema = z.enum(["rect", "square", "circle"]);
export const textAlignSchema = z.enum(["left", "center", "right"]);
export const lineOrientationSchema = z.enum(["horizontal", "vertical"]);

// Hex string `#RRGGBB`. We keep this loose on purpose — the editor enforces
// the picker, so a free-form hex is enough at the schema level.
export const hexColorSchema = z
  .string()
  .regex(/^#([0-9a-fA-F]{6})$/u, "Must be a #RRGGBB hex colour");

// ---------- locks ----------
// Every layer carries the same lock surface. Defaults are set per layer-type
// where it makes sense (e.g. text font usually stays admin-controlled).
export const layerLocksSchema = z.object({
  position: z.boolean(),
  move: z.boolean().default(true),
  size: z.boolean(),
  shape: z.boolean(),
  content: z.boolean(),
  font: z.boolean(),
  visibility: z.boolean(),
  style: z.boolean(),
});
export type LayerLocks = z.infer<typeof layerLocksSchema>;

export const defaultLocks = (overrides: Partial<LayerLocks> = {}): LayerLocks => ({
  position: true,
  move: true,
  size: true,
  shape: true,
  content: false,
  font: true,
  visibility: true,
  style: true,
  ...overrides,
});

// ---------- per-type defaults ----------
export const mapDefaultsSchema = z.object({
  shape: mapShapeSchema,
  styleId: z.string().min(1),
  center: z.tuple([z.number(), z.number()]), // [lng, lat]
  zoom: z.number().min(0).max(22),
  showLabels: z.boolean(),
  // Optional admin-set default place metadata (used to hydrate "Vald plats" and
  // auto-build linked text content on customer-side load).
  placeName: z.string().optional(),
  city: z.string().optional(),
  country: z.string().optional(),
});
export type MapDefaults = z.infer<typeof mapDefaultsSchema>;

export const imageDefaultsSchema = z.object({
  url: z.string().url().optional(),
  fit: imageFitSchema,
  shape: imageShapeSchema,
});
export type ImageDefaults = z.infer<typeof imageDefaultsSchema>;

// Photo layer = a customer-fillable image placeholder. Distinct from `image`
// (which is admin-static art). Shape is shared with the map shape vocabulary
// + a plain rectangle.
export const photoShapeSchema = z.enum(["rect", "circle", "heart", "star"]);
export type PhotoShape = z.infer<typeof photoShapeSchema>;

export const photoDefaultsSchema = z.object({
  shape: photoShapeSchema,
  fit: imageFitSchema,
  /** Optional placeholder image URL the admin can supply for preview only. */
  placeholderUrl: z.string().url().optional(),
  /** Valfritt förberett demo-resultat ("Prova med exempelbild", Paket D2).
   *  Visas via demo-knappen i editorn och spärras alltid från beställning. */
  demoResultUrl: z.string().url().optional(),
});
export type PhotoDefaults = z.infer<typeof photoDefaultsSchema>;

// Customer-uploads-a-face layer used for AI face-swap onto an admin-curated
// reference image (king/princess/etc). Same surface as `photo` (shape/fit) so
// it renders identically, but distinct semantics: customer uploads a FACE,
// the swap happens server-side, and the swapped result is shown in place of
// the placeholder/reference.
// "human" → Replicate cdingram/face-swap (dedicated face-swap model)
// "pet"   → Nano Banana 2 multi-image edit (works for both cats and dogs)
// "removeBackground" → Nano Banana 2 single-image edit; no reference needed.
//                      The customer's photo gets its background removed and
//                      replaced with a clean white backdrop + a colorful
//                      watercolor/dot ring around the subject. An optional
//                      AI style preset (from productOptions.aiStyles) can
//                      be applied to the SUBJECT while the background stays
//                      white-with-dots regardless.
export const aiPhotoSubjectKindSchema = z.enum(["human", "pet", "removeBackground"]);
export type AiPhotoSubjectKind = z.infer<typeof aiPhotoSubjectKindSchema>;

export const aiPhotoDefaultsSchema = z.object({
  shape: photoShapeSchema,
  fit: imageFitSchema,
  /** Valfritt förberett demo-resultat ("Prova med exempelbild", Paket D2) —
   *  främst för removeBackground-mallar utan referensbild. Spärras alltid
   *  från beställning. */
  demoResultUrl: z.string().url().optional(),
  /** Admin-uploaded reference image (the king/princess/etc body+outfit).
   *  Legacy: kept in sync with `referenceImages[0]?.url` when the admin uses
   *  the multi-reference list, so snapshot/print pipelines stay unchanged. */
  referenceImageUrl: z.string().url().optional(),
  /** One or more admin-uploaded reference subjects. The customer can pick
   *  which one face-swaps onto. When empty/single, no picker is shown. */
  referenceImages: z
    .array(
      z.object({
        id: z.string().min(1),
        url: z.string().url(),
        label: z.string().optional(),
        /** Which canvas orientation(s) this reference is valid for.
         *  "any" (default) = shown in both portrait & landscape — keeps
         *  legacy templates working without admin intervention. */
        orientation: z.enum(["portrait", "landscape", "any"]).default("any"),
        /** Admin-chosen focal point for the cover-fit reference image,
         *  expressed as percent of the layer box. Same semantics as
         *  `offsetX/offsetY` on photo layers (0 = centered, range -50..50).
         *  Applied to both the reference preview and the face-swapped result
         *  (which has the same dimensions as the reference). */
        focalX: z.number().min(-50).max(50).optional(),
        focalY: z.number().min(-50).max(50).optional(),
      }),
    )
    .default([]),
  /** Free-text prompt sent to the face-swap model. Edited by admin. */
  swapPrompt: z.string().min(1).default(
    "Replace only the face/head onto the reference subject. Preserve the reference outfit, hair contour, lighting, pose and background.",
  ),
  /** removeBackground + FLUX_REMOVEBG_ENABLED only: motif/isolation instruction
   *  forwarded to Flux Kontext Pro before background-removal. Must be
   *  STYLE-NEUTRAL — no artistic style words. Style comes solely from the
   *  customer's chosen AI style preset. Absent/empty ⇒ stay on the legacy
   *  Nano-Banana path. */
  fluxStylePrompt: z.string().optional(),
  /** Helps admin pick a sensible default prompt; also forwarded to the
   *  edge function so it can pick the best swap-mode for animals vs humans. */
  subjectKind: aiPhotoSubjectKindSchema.default("human"),
  /** removeBackground only: backdrop color sent to the model.
   *  Default = white (#FFFFFF) to preserve legacy behaviour. */
  backdropColor: z.string().regex(/^#([0-9a-fA-F]{6})$/).optional(),
  /** removeBackground only: when false, instruct the model to preserve the
   *  subject's original framing/scale/position instead of scaling it up to
   *  fill 90-95% of the output. Default = true (legacy behaviour). */
  fillFrame: z.boolean().optional(),
  /** removeBackground only: when true (default) inject an early, high-priority
   *  instruction to preserve the subject's original colors/hue so applied art
   *  styles act as a surface treatment only. */
  preserveSubjectColors: z.boolean().optional(),
  /** removeBackground only. When true the edge function bypasses the long
   *  Nano-Banana / Flux prompt pipeline and runs a single `flux-kontext-pro`
   *  call with the chosen preset's `styleInstruction` as the ONLY text input
   *  (no base prompt, no motif/isolation rules, no negative prompt). The
   *  result is then fed through `851-labs/background-remover` to strip the
   *  background, exactly as the existing Flux path does. Empirically Kontext
   *  preserves geometry and applies style perfectly when prompts are kept
   *  short — long prompts trigger geometry drift. When false/absent the
   *  legacy behaviour is unchanged. */
  simpleStyleMode: z.boolean().optional(),
  /** OPTIONAL multi-face mode. Strictly additive: when `enabled !== true`
   *  the layer behaves EXACTLY like a single-face aiPhoto (same UI, same
   *  edge function, same cache, same render). When enabled the customer
   *  uploads one portrait per slot and the new `multi-face-swap` edge
   *  function runs Nano Banana 2 with reference + N portraits in a single
   *  call. The result is written to the same `aiPhotoResults[layerId]`
   *  store field so preview/snapshot/print/cart pipelines stay unchanged.
   *  Pre-existing templates without this field are unaffected. */
  multiFaceSwap: z
    .object({
      enabled: z.boolean(),
      slots: z
        .array(
          z.object({
            id: z.string().min(1),
            label: z.string().min(1),
            position: z.string().min(1),
          }),
        )
        .min(2)
        .max(4),
    })
    .optional(),
});
export type AiPhotoDefaults = z.infer<typeof aiPhotoDefaultsSchema>;

// Token used in linked text: city / country / coords. Maps to placeholder
// `[[city]]`, `[[country]]`, `[[coords]]` in the text. The renderer replaces
// these at runtime with the linked map layer's place data.
export const linkedTextTokenSchema = z.enum(["city", "country", "coordinates"]);
export type LinkedTextToken = z.infer<typeof linkedTextTokenSchema>;

// Rich-text span: applies optional style overrides to a [start,end) range of
// the layer's plain `text` (utf-16 indices). Spans must be sorted and
// non-overlapping. Empty array = single style for the whole text.
export const textSpanSchema = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
  font: z.string().min(1).optional(),
  fontSizePt: z.number().positive().max(400).optional(),
  color: hexColorSchema.optional(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
});
export type TextSpan = z.infer<typeof textSpanSchema>;

// Decoration drawn around the text content (auto-fits to text bbox, not the
// layer rect). "side-rules" = two horizontal lines flanking the text.
export const textDecorationSchema = z.object({
  kind: z.enum(["none", "box", "side-rules"]),
  thicknessMm: z.number().positive().max(20).default(0.5),
  color: hexColorSchema.default("#000000"),
  paddingMm: z.number().min(0).max(50).default(2),
  gapMm: z.number().min(0).max(50).optional(),
  /** side-rules: fixed length per rule in mm. When omitted, rules expand
   *  elastically to fill the layer width. */
  ruleLengthMm: z.number().positive().max(300).optional(),
  /** side-rules: where the rule starts. "text-edge" (default) → next to the
   *  text and extends outward; "layer-edge" → from the layer edge inward. */
  ruleAlign: z.enum(["text-edge", "layer-edge"]).optional(),
});
export type TextDecoration = z.infer<typeof textDecorationSchema>;

export const textDefaultsSchema = z.object({
  text: z.string(),
  font: z.string().min(1),
  // Legacy: font size as % of the layer's HEIGHT. Kept for backwards
  // compatibility with existing templates. New templates should use
  // `fontSizePt` (true typographic size against an A4 short-side reference)
  // so "12 pt" looks like 12 pt in MS Word on A4 regardless of canvas.
  fontSizePct: z.number().positive().max(100).optional(),
  fontSizePt: z.number().positive().max(400).optional(),
  // Multiplier of the resolved font size, Word-style (default 1.15).
  lineHeight: z.number().min(0.5).max(3).optional(),
  // Letter spacing in em units (default 0).
  letterSpacingEm: z.number().min(-0.2).max(1).optional(),
  align: textAlignSchema,
  color: hexColorSchema,
  // Optional background colour for the entire text-layer rect. When omitted
  // or empty, the background is transparent (default for all legacy layers).
  backgroundColor: z.string().optional(),
  // Rich-text style overrides (per character range).
  spans: z.array(textSpanSchema).optional(),
  // Decoration around the text content.
  decoration: textDecorationSchema.optional(),
  // When set, this text auto-updates to match the selected place of the
  // referenced map layer (city/country/coords). Customer manual edits override
  // the auto-text until the field is cleared.
  linkedMapLayerId: z.string().nullable().optional(),
  // New token-based linking. The order of tokens is the visible order. Use
  // placeholders `[[city]]`, `[[country]]`, `[[coords]]` in `text` to control
  // exact position + line-grouping; tokens not present in `text` are appended
  // on their own lines in order.
  linkedTokens: z.array(linkedTextTokenSchema).optional(),
  // DEPRECATED — kept for back-compat. Migrated to `linkedTokens`.
  linkedMapFields: z
    .object({
      city: z.boolean().default(true),
      country: z.boolean().default(true),
      coordinates: z.boolean().default(true),
    })
    .optional(),
});
export type TextDefaults = z.infer<typeof textDefaultsSchema>;

export const lineDefaultsSchema = z.object({
  orientation: lineOrientationSchema,
  thicknessMm: z.number().positive().max(50),
  color: hexColorSchema,
});
export type LineDefaults = z.infer<typeof lineDefaultsSchema>;

export const marginDefaultsSchema = z.object({
  /** Margin thickness as % of the canvas SHORT side. Symmetric on all sides. */
  thicknessPct: z.number().min(0).max(40),
  color: hexColorSchema,
});
export type MarginDefaults = z.infer<typeof marginDefaultsSchema>;

// ---------- shape layer ----------
// Generic admin-only decoration: lines (h/v) and frames (rect, oval, double,
// rounded, decorative-corners). Strokes are in mm just like the legacy line
// layer so print + editor + 3D match exactly.
export const shapeKindSchema = z.enum([
  "line-horizontal",
  "line-vertical",
  "frame-rect",
  "frame-oval",
  "frame-double",
  "frame-rounded",
  "frame-corners",
]);
export type ShapeKind = z.infer<typeof shapeKindSchema>;

export const shapeDefaultsSchema = z.object({
  kind: shapeKindSchema,
  /** Stroke thickness in mm — true print measurement, identical formula
   *  to legacy line.thicknessMm so the editor visualises 1:1 with print. */
  strokeMm: z.number().positive().max(50),
  color: hexColorSchema,
  /** frame-rounded: corner radius as % of the shape's short side. */
  cornerRadiusPct: z.number().min(0).max(50).optional(),
  /** frame-double: gap (mm) between inner and outer stroke. */
  gapMm: z.number().min(0).max(50).optional(),
  /** frame-corners: which corner motif to draw. */
  cornerStyle: z.enum(["bracket", "art-deco", "floral"]).optional(),
});
export type ShapeDefaults = z.infer<typeof shapeDefaultsSchema>;

// ---------- layer base + discriminated union ----------
const layerBase = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  xPct: z.number().min(0).max(100),
  yPct: z.number().min(0).max(100),
  wPct: z.number().min(0).max(100),
  hPct: z.number().min(0).max(100),
  rotation: z.number().min(-360).max(360).default(0),
  zIndex: z.number().int(),
  locks: layerLocksSchema,
});

export const mapLayerSchema = layerBase.extend({
  type: z.literal("map"),
  defaults: mapDefaultsSchema,
});
export const imageLayerSchema = layerBase.extend({
  type: z.literal("image"),
  defaults: imageDefaultsSchema,
});
export const textLayerSchema = layerBase.extend({
  type: z.literal("text"),
  defaults: textDefaultsSchema,
});
export const lineLayerSchema = layerBase.extend({
  type: z.literal("line"),
  defaults: lineDefaultsSchema,
});
export const marginLayerSchema = layerBase.extend({
  type: z.literal("margin"),
  defaults: marginDefaultsSchema,
});
export const photoLayerSchema = layerBase.extend({
  type: z.literal("photo"),
  defaults: photoDefaultsSchema,
});
export const aiPhotoLayerSchema = layerBase.extend({
  type: z.literal("aiPhoto"),
  defaults: aiPhotoDefaultsSchema,
});
export const shapeLayerSchema = layerBase.extend({
  type: z.literal("shape"),
  defaults: shapeDefaultsSchema,
});

export const layerSchema = z.discriminatedUnion("type", [
  mapLayerSchema,
  imageLayerSchema,
  textLayerSchema,
  lineLayerSchema,
  marginLayerSchema,
  photoLayerSchema,
  aiPhotoLayerSchema,
  shapeLayerSchema,
]);
export type TemplateLayer = z.infer<typeof layerSchema>;
export type LayerType = TemplateLayer["type"];

// ---------- layout per orientation ----------
export const orientationLayoutSchema = z.object({
  aspect: aspectSchema,
  background: z.object({ color: hexColorSchema }),
  layers: z.array(layerSchema),
});
export type OrientationLayout = z.infer<typeof orientationLayoutSchema>;

export const sizeOverrideSchema = z.object({
  portrait: orientationLayoutSchema.partial({ aspect: true, background: true }).optional(),
  landscape: orientationLayoutSchema.partial({ aspect: true, background: true }).optional(),
});
export type SizeOverride = z.infer<typeof sizeOverrideSchema>;

// ---------- product options (replaces old `supports` block) ----------
const posterOptionsSchema = z.object({
  enabled: z.boolean(),
  allowedSizes: z.array(z.string()),
  allowedFrames: z.array(z.string()),
});
const canvasOptionsSchema = z.object({
  enabled: z.boolean(),
  allowedSizes: z.array(z.string()),
  allowedDepths: z.array(z.string()),
  /** Canvas wrap depth (cm) the admin DESIGNS against. Layer % in
   *  `canvasLayout` are relative to the editor surface at this depth. When the
   *  customer picks a different depth, % auto-rescales — a layer that covers
   *  half the wrap band at 2 cm covers half the (wider) band at 4 cm. */
  canvasDesignDepthCm: z.number().min(0).max(10).optional(),
});
// Aluminium: bara material-namn ("Standard"/"Brushed" — vi använder bara
// "Standard" idag men håller arrayen öppen för framtiden).
const aluminumOptionsSchema = z.object({
  enabled: z.boolean(),
  allowedSizes: z.array(z.string()),
  allowedMaterials: z.array(z.string()),
});
// Akryl: bara storlekar (4 mm är enda tjockleken — vi använder
// "Standard"-finish internt för att hålla samma datamodell).
const acrylicOptionsSchema = z.object({
  enabled: z.boolean(),
  allowedSizes: z.array(z.string()),
  allowedFinishes: z.array(z.string()),
});

export const aiStylePresetSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  thumbnailUrl: z.string().url().optional(),
  prompt: z.string().min(1),
  /** Per-template visibility toggle. Defaults to true for backwards-compat. */
  enabled: z.boolean().optional().default(true),
  /** Short Kontext-Pro instruction (e.g. "make this in oil styling"). Used
   *  ONLY when the layer's defaults.simpleStyleMode === true. When the layer
   *  is in simple mode and this is empty, the edge function falls back to
   *  `prompt`; if that's also missing it falls back to the legacy Nano-Banana
   *  pipeline. Ignored when simpleStyleMode is off. */
  styleInstruction: z.string().optional(),
});
export type AiStylePreset = z.infer<typeof aiStylePresetSchema>;

export const mapStylePresetSchema = z.object({
  id: z.string().min(1),
  /** Per-template visibility toggle. Defaults to true for backwards-compat. */
  enabled: z.boolean().optional().default(true),
});
export type MapStylePreset = z.infer<typeof mapStylePresetSchema>;

export const productOptionsSchema = z.object({
  poster: posterOptionsSchema.optional(),
  canvas: canvasOptionsSchema.optional(),
  aluminum: aluminumOptionsSchema.optional(),
  acrylic: acrylicOptionsSchema.optional(),
  /** Available AI style presets shown in the customer editor. Optional —
   *  when missing/empty the AI section is hidden. */
  aiStyles: z.array(aiStylePresetSchema).optional(),
  /** Per-template enabled map styles. When missing the editor falls back to
   *  the legacy `config.map_styles` column, then to the full catalog. */
  mapStyles: z.array(mapStylePresetSchema).optional(),
  /** Font families the customer is allowed to choose from in the editor.
   *  When missing/empty the customer sees the full FONT_CATALOG. */
  allowedFonts: z.array(z.string()).optional(),
});
export type ProductOptions = z.infer<typeof productOptionsSchema>;

// ---------- root template ----------
export const templateSchema = z
  .object({
    version: z.literal(1),
    publishedAt: z.string().datetime().nullable().optional(),
    productOptions: productOptionsSchema,
    orientations: z.array(orientationSchema).min(1),
    defaultLayout: z.object({
      portrait: orientationLayoutSchema,
      landscape: orientationLayoutSchema,
    }),
    /** Optional canvas-specific layout. When present and the active product
     *  type is "canvas", runtime + admin use this instead of `defaultLayout`.
     *
     *  `coordSpace`:
     *    - "front" (current): layer % are relative to the FRONT zone only.
     *      Wrap is added symmetrically by the renderer; full-bleed layers
     *      touching a front edge auto-extend into the wrap band so the
     *      canvas edges never look empty. This keeps a layer in the same
     *      visual position regardless of which size the customer picks.
     *    - "fullArea" (legacy): layer % are relative to FRONT + 2×wrap.
     *      Migrated to "front" automatically on read. */
    canvasLayout: z
      .object({
        portrait: orientationLayoutSchema,
        landscape: orientationLayoutSchema,
        coordSpace: z.enum(["front", "fullArea"]).optional(),
      })
      .optional(),
    /** Optional admin-overridden display name for the implicit Standard layout
     *  shown in the customer "Stil"-row. Defaults to "Standard" when omitted. */
    defaultLayoutName: z.string().min(1).optional(),
    /** Optional thumbnail URL for the Standard layout shown in the "Stil"-row. */
    defaultLayoutThumbnailUrl: z.string().url().optional(),
    sizeOverrides: z.record(z.string(), sizeOverrideSchema).default({}),
    /** Extra named layouts ("Stilar") in addition to the implicit
     *  "Standard"-layout backed by `defaultLayout`/`canvasLayout`. When the
     *  customer switches stil, the renderer reads the matching block via
     *  `getAllLayouts(template)` + `getActiveLayoutBlock(...layoutId)`.
     *  Each entry holds a full layout block (portrait+landscape) for the
     *  standard product types and an optional canvas-specific block. */
    extraLayouts: z
      .array(
        z.object({
          id: z.string().min(1),
          name: z.string().min(1),
          thumbnailUrl: z.string().url().optional(),
          defaultLayout: z.object({
            portrait: orientationLayoutSchema,
            landscape: orientationLayoutSchema,
          }),
          canvasLayout: z
            .object({
              portrait: orientationLayoutSchema,
              landscape: orientationLayoutSchema,
              coordSpace: z.enum(["front", "fullArea"]).optional(),
            })
            .optional(),
        }),
      )
      .default([]),
  })
  .superRefine((tpl, ctx) => {
    const anyEnabled =
      (tpl.productOptions.poster?.enabled ?? false) ||
      (tpl.productOptions.canvas?.enabled ?? false) ||
      (tpl.productOptions.aluminum?.enabled ?? false) ||
      (tpl.productOptions.acrylic?.enabled ?? false);
    if (!anyEnabled) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At least one product type must be enabled",
        path: ["productOptions"],
      });
    }
    for (const key of ["poster", "canvas", "aluminum", "acrylic"] as const) {
      const opt = tpl.productOptions[key];
      if (opt?.enabled && opt.allowedSizes.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${key} is enabled but has no allowedSizes`,
          path: ["productOptions", key, "allowedSizes"],
        });
      }
    }
  });

export type Template = z.infer<typeof templateSchema>;

export type ParseTemplateResult =
  | { ok: true; template: Template }
  | { ok: false; error: z.ZodError };

/**
 * `safeParse` + return either a typed template or a structured error report.
 * Use this at all read boundaries (loadConfig, edge function, snapshot).
 */
export function parseTemplate(value: unknown): ParseTemplateResult {
  const r = templateSchema.safeParse(value);
  return r.success ? { ok: true, template: r.data } : { ok: false, error: r.error };
}

export function isEmptyTemplate(value: unknown): boolean {
  if (!value || typeof value !== "object") return true;
  const v = value as Record<string, unknown>;
  return Object.keys(v).length === 0;
}

/** A named layout entry — Standard (the implicit default) or one of the
 *  admin-defined extra "stilar". */
export interface NamedLayout {
  id: string;
  name: string;
  thumbnailUrl?: string;
  defaultLayout: { portrait: OrientationLayout; landscape: OrientationLayout };
  canvasLayout?: {
    portrait: OrientationLayout;
    landscape: OrientationLayout;
    coordSpace?: "front" | "fullArea";
  };
}

/** Stable id of the implicit "Standard"-layout backed by `defaultLayout`. */
export const DEFAULT_LAYOUT_ID = "default";

/** Enumerate every named layout: Standard first, then `extraLayouts` in order. */
export function getAllLayouts(template: Template): NamedLayout[] {
  const standard: NamedLayout = {
    id: DEFAULT_LAYOUT_ID,
    name: template.defaultLayoutName?.trim() || "Standard",
    thumbnailUrl: template.defaultLayoutThumbnailUrl,
    defaultLayout: template.defaultLayout,
    canvasLayout: template.canvasLayout,
  };
  return [standard, ...(template.extraLayouts ?? [])];
}

/** Resolve a layout id to its NamedLayout — falls back to Standard. */
export function getNamedLayout(template: Template, layoutId?: string | null): NamedLayout {
  const all = getAllLayouts(template);
  if (layoutId) {
    const hit = all.find((l) => l.id === layoutId);
    if (hit) return hit;
  }
  return all[0]!;
}

/**
 * Pick the layout block (portrait+landscape) the active product type should
 * render. Canvas products use `canvasLayout` when present so the wrap-zone
 * layout doesn't bleed onto poster siblings; everything else falls back to
 * `defaultLayout`. When a `layoutId` is supplied, the matching named layout
 * (Standard or one of `extraLayouts`) is used.
 */
export function getActiveLayoutBlock(
  template: Template,
  productType: string | null | undefined,
  layoutId?: string | null,
): { portrait: OrientationLayout; landscape: OrientationLayout } {
  const named = getNamedLayout(template, layoutId);
  const isCanvas = productType === "canvas";
  if (isCanvas && named.canvasLayout) return named.canvasLayout;
  return named.defaultLayout;
}

/** Resolve the depth (cm) the canvas template was DESIGNED against. */
export function getCanvasDesignDepthCm(template: Template): number {
  const explicit = template.productOptions.canvas?.canvasDesignDepthCm;
  if (typeof explicit === "number" && explicit > 0) return explicit;
  const allowed = template.productOptions.canvas?.allowedDepths ?? [];
  for (const v of allowed) {
    const m = v.match(/(\d+(?:[.,]\d+)?)/);
    if (m) {
      const n = parseFloat(m[1].replace(",", "."));
      if (n > 0) return n;
    }
  }
  return 2;
}
