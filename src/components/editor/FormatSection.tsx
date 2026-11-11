import { forwardRef, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useEditorStore } from "@/stores/editorStore";
import { useShopContextStore } from "@/stores/shopContextStore";
import { formatPriceDelta, formatMoneyDelta, formatMoneyDeltaFromSEK } from "@/lib/format-price";
import { useShopifyPriceMap, priceFromMap } from "@/hooks/useShopifyPriceMap";
import { translateVariantName } from "@/lib/variant-labels";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { deriveTemplateSlug, getEffectiveSizes, type ProductConfig, type ProductType } from "@/lib/product-config";
import { getActiveLayoutBlock } from "@/lib/template-schema";
import { FrameOption } from "./FrameOption";
import frameWhite from "@/assets/frames/frame-white.jpg";
import frameOak from "@/assets/frames/frame-oak.jpg";
import frameWalnut from "@/assets/frames/frame-walnut.jpg";
import frameBlack from "@/assets/frames/frame-black.jpg";

interface Props {
  configs: ProductConfig[];
  activeHandle: string;
  activeProductType: ProductType;
  onProductChange: (handle: string, productType: ProductType) => void;
}

const FRAME_THUMBS: Record<string, string> = {
  Vit: frameWhite,
  Ek: frameOak,
  Valnöt: frameWalnut,
  Svart: frameBlack,
};

const HANGER_HEX: Record<string, string> = {
  "Hängare Ek": "#c8a371",
  "Hängare Valnöt": "#5a3a26",
  "Hängare Svart": "#1a1a1a",
  "Hängare Vit": "#f5f5f2",
};

const HangerIcon = forwardRef<SVGSVGElement, { color: string }>(({ color }, ref) => {
  const isWhite = color.toLowerCase() === "#f5f5f2";
  return (
    <svg ref={ref} viewBox="0 0 40 40" className="w-full h-full" preserveAspectRatio="xMidYMid meet">
      <path d="M 6 8 Q 20 0 34 8" fill="none" stroke="#3a2a1a" strokeWidth="1.2" strokeLinecap="round" />
      <rect x="4" y="8" width="32" height="3.2" fill={color} stroke={isWhite ? "rgba(0,0,0,0.25)" : "none"} strokeWidth="0.5" />
      <rect x="6" y="11.2" width="28" height="20" fill="#f3eee4" stroke="rgba(0,0,0,0.08)" strokeWidth="0.4" />
      <rect x="4" y="31.2" width="32" height="3.2" fill={color} stroke={isWhite ? "rgba(0,0,0,0.25)" : "none"} strokeWidth="0.5" />
    </svg>
  );
});
HangerIcon.displayName = "HangerIcon";

// Pris-delta formatteras nu via formatPriceDelta() i komponenten (kräver shop-context).

const NoFrameIcon = forwardRef<SVGSVGElement>((_, ref) => (
  <svg ref={ref} viewBox="0 0 40 40" className="w-1/2 h-1/2" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="5" y="5" width="30" height="30" rx="1" strokeDasharray="3 3" />
  </svg>
));
NoFrameIcon.displayName = "NoFrameIcon";

const DepthIcon = forwardRef<SVGSVGElement, { depth: string }>(({ depth }, ref) => {
  const thickness = depth.includes("4") ? 14 : 7;
  return (
    <svg ref={ref} viewBox="0 0 40 40" className="w-2/3 h-2/3" fill="currentColor">
      <rect x="6" y={20 - thickness / 2} width="28" height={thickness} rx="1" opacity="0.85" />
    </svg>
  );
});
DepthIcon.displayName = "DepthIcon";

export function FormatSection({ configs, activeHandle, activeProductType, onProductChange }: Props) {
  const { t } = useTranslation();
  const shopCtx = useShopContextStore();
  const { map: priceMap, derivedFx } = useShopifyPriceMap();
  const formatDiff = (sekDiff: number) =>
    derivedFx
      ? formatMoneyDeltaFromSEK(sekDiff, derivedFx, shopCtx.locale)
      : formatPriceDelta(sekDiff, shopCtx);
  /** Compute size delta in customer currency: prefer live Shopify prices when both targets exist. */
  const liveDelta = (sizeA: string | null, variantA: string | null, sizeB: string, variantB: string): string | null => {
    const a = priceFromMap(priceMap, sizeA, variantA);
    const b = priceFromMap(priceMap, sizeB, variantB);
    if (!a || !b || a.currencyCode !== b.currencyCode) return null;
    return formatMoneyDelta(b.amount - a.amount, b.currencyCode, shopCtx.locale);
  };
  const { config, productOptions, template, layoutId, size, variant, orientation, setSize, setVariant, setOrientation } = useEditorStore();

  const allowedOrientations = template?.orientations ?? ["portrait", "landscape"];

  // Auto-switch to a valid orientation if the current one is disabled by admin.
  useMemo(() => {
    if (!allowedOrientations.includes(orientation) && allowedOrientations[0]) {
      setOrientation(allowedOrientations[0]);
    }
  }, [allowedOrientations, orientation, setOrientation]);

  // Group configs by template_slug → only the configs from the SAME template
  // appear in the Poster/Canvas toggle. This is what fixes the "third Poster
  // option" bug: multiple templates no longer show up here.
  const templateSlug = useMemo(
    () => (config ? config.template_slug ?? deriveTemplateSlug(config.shopify_handle) : ""),
    [config],
  );

  const sameTemplateConfigs = useMemo(() => {
    if (!templateSlug) return [] as ProductConfig[];
    return configs.filter(
      (c) => (c.template_slug ?? deriveTemplateSlug(c.shopify_handle)) === templateSlug,
    );
  }, [configs, templateSlug]);

  if (!config) return null;

  const isCanvas = config.product_type === "canvas";
  const isAluminum = config.product_type === "aluminum";
  const isAcrylic = config.product_type === "acrylic";

  // Filter sizes/variants by template's productOptions (admin-controlled).
  // Falls back to all sizes/variants from config when template is missing/empty.
  const allowedSizes = isCanvas
    ? productOptions?.canvas?.allowedSizes
    : isAluminum
      ? productOptions?.aluminum?.allowedSizes
      : isAcrylic
        ? productOptions?.acrylic?.allowedSizes
        : productOptions?.poster?.allowedSizes;
  const allowedVariants = isCanvas
    ? productOptions?.canvas?.allowedDepths
    : isAluminum
      ? productOptions?.aluminum?.allowedMaterials
      : isAcrylic
        ? productOptions?.acrylic?.allowedFinishes
        : productOptions?.poster?.allowedFrames;

  // Effective sizes: legacy `config.sizes` if populated, otherwise derived
  // from productOptions × pricing tables. Then filtered to the admin-allowed
  // subset.
  const effectiveSizes = getEffectiveSizes(config, productOptions);
  const visibleSizes = effectiveSizes.filter(
    (s) => !allowedSizes || allowedSizes.length === 0 || allowedSizes.includes(s.size),
  );
  const sizeDef = visibleSizes.find((s) => s.size === size) ?? effectiveSizes.find((s) => s.size === size);
  const visibleVariants = (sizeDef?.variants ?? []).filter(
    (v) => !allowedVariants || allowedVariants.length === 0 || allowedVariants.includes(v.name),
  );

  const currentVariantPrice = sizeDef?.variants.find((v) => v.name === variant)?.price ?? 0;

  // Auto-byte: om vald variant inte längre är tillgänglig (t.ex. valde Hängare
  // Ek på 21×30 och bytte storlek till 13×18 där hängare saknas) → välj första
  // tillgängliga variant.
  useEffect(() => {
    if (!variant || visibleVariants.length === 0) return;
    const current = visibleVariants.find((v) => v.name === variant);
    if (current && current.available !== false) return;
    const firstAvailable = visibleVariants.find((v) => v.available !== false);
    if (firstAvailable) setVariant(firstAvailable.name);
  }, [variant, visibleVariants, setVariant]);

  // Build a stable Produkt toggle from the template group (each kind shows up
  // at most once even if multiple configs leak in).
  type Kind = "poster" | "canvas" | "aluminum" | "acrylic";
  const PRODUCT_TYPE_TO_KIND: Record<string, Kind> = {
    posters: "poster",
    canvas: "canvas",
    aluminum: "aluminum",
    acrylic: "acrylic",
  };
  const KIND_LABEL: Record<Kind, string> = {
    poster: t("productKind.poster"),
    canvas: t("productKind.canvas"),
    aluminum: t("productKind.aluminum"),
    acrylic: t("productKind.acrylic"),
  };
  const kindToConfig = new Map<Kind, ProductConfig>();
  for (const c of sameTemplateConfigs) {
    const k = PRODUCT_TYPE_TO_KIND[c.product_type];
    if (k && !kindToConfig.has(k)) kindToConfig.set(k, c);
  }

  const toggleEntries: { kind: Kind; label: string; handle: string; productType: ProductType; active: boolean }[] = [];
  for (const k of ["poster", "canvas", "aluminum", "acrylic"] as Kind[]) {
    const c = kindToConfig.get(k);
    if (!c) continue;
    toggleEntries.push({
      kind: k,
      label: KIND_LABEL[k],
      handle: c.shopify_handle,
      productType: c.product_type,
      active: c.product_type === activeProductType,
    });
  }

  // size price diffs use the current variant name (or first variant) for fair comparison
  const variantNameForCompare = variant ?? visibleVariants[0]?.name ?? sizeDef?.variants[0]?.name;
  const currentSizeBasePrice =
    sizeDef?.variants.find((v) => v.name === variantNameForCompare)?.price ?? currentVariantPrice;

  const posterBgColor = useEditorStore((s) => s.posterBgColor);
  const setPosterBgColor = useEditorStore((s) => s.setPosterBgColor);
  const whiteMarginEnabled = useEditorStore((s) => s.whiteMarginEnabled);
  const setWhiteMarginEnabled = useEditorStore((s) => s.setWhiteMarginEnabled);
  const BG_SWATCHES = ["#EFE7D6","#FFFFFF","#F8F4EC","#E5E5E5","#D9CDB5","#D6E4D2","#CFE0EA","#1A1A1A"];

  const activeLayoutBlock = template
    ? getActiveLayoutBlock(template, config.product_type, layoutId)
    : null;
  const hasMarginLayer = (activeLayoutBlock?.[orientation]?.layers ?? []).some(
    (l) => l.type === "margin",
  );

  return (
    <div className="space-y-5">
      {/* Bakgrundsfärg — högst upp. Lopptavlor väljer bakgrund i loppanelen
          (kartan täcker hela tavlan, så posterns bakgrundsfärg syns inte). */}
      <div className={template?.productOptions.raceOptions?.enabled ? "hidden" : "space-y-2"}>
        <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">{t("format.backgroundColor")}</Label>
        <div className="flex flex-wrap gap-2 items-center">
          {BG_SWATCHES.map((c) => {
            const selected = posterBgColor.toLowerCase() === c.toLowerCase();
            return (
              <button
                key={c}
                type="button"
                onClick={() => setPosterBgColor(c)}
                className={`h-8 w-8 rounded-full transition border ${
                  selected ? "ring-2 ring-primary ring-offset-2 ring-offset-card border-transparent" : "border-border"
                }`}
                style={{ background: c }}
                aria-label={c}
              />
            );
          })}
          <label className="h-8 w-8 rounded-full border border-dashed border-border flex items-center justify-center cursor-pointer relative overflow-hidden">
            <input
              type="color"
              value={posterBgColor}
              onChange={(e) => setPosterBgColor(e.target.value)}
              className="absolute inset-0 opacity-0 cursor-pointer"
            />
            <span className="text-[10px] text-muted-foreground">+</span>
          </label>
        </div>
      </div>

      {/* Vit marginal — Ja/Nej toggle, visas endast om mallen har ett margin-lager */}
      {hasMarginLayer && (
        <div className="space-y-2">
          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">{t("format.whiteMargin")}</Label>
          <div className="flex p-1 bg-muted rounded-full">
            {([
              { id: true, label: t("common.yes") },
              { id: false, label: t("common.no") },
            ] as const).map(({ id, label }) => {
              const active = whiteMarginEnabled === id;
              return (
                <button
                  key={String(id)}
                  type="button"
                  onClick={() => setWhiteMarginEnabled(id)}
                  className={`flex-1 h-10 rounded-full text-sm font-medium transition ${
                    active
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-foreground/70 hover:text-foreground"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Tomt-tillstånd: ingen storlek aktiverad i admin för den här produkttypen. */}
      {visibleSizes.length === 0 && (
        <div className="rounded-2xl border border-dashed bg-muted/40 p-4 text-sm text-muted-foreground">
          {t("format.noActiveSizes")}
        </div>
      )}

      {/* Produkt — segmented pill toggle. Only renders when this template
          actually has both a poster + canvas variant available. */}
      {toggleEntries.length > 1 && (
        <div className="space-y-2">
          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">{t("format.product")}</Label>
          <div className="grid grid-cols-2 gap-2">
            {toggleEntries.map((e) => (
              <button
                key={e.kind}
                onClick={() => onProductChange(e.handle, e.productType)}
                className={`h-10 rounded-full text-sm font-medium transition ${
                  e.active
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "bg-muted text-foreground/70 hover:text-foreground"
                }`}
              >
                {e.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Storlek dropdown */}
      <div className="space-y-2">
        <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">{t("format.size")}</Label>
        <Select value={size ?? undefined} onValueChange={setSize}>
          <SelectTrigger className="h-12 rounded-full px-5 text-base">
            <SelectValue placeholder={t("format.selectSize")} />
          </SelectTrigger>
          <SelectContent className="rounded-2xl">
            {visibleSizes.map((s) => {
              const matchVariant =
                s.variants.find((v) => v.name === variantNameForCompare) ?? s.variants[0];
              const diff = (matchVariant?.price ?? 0) - currentSizeBasePrice;
              const live = liveDelta(size, variantNameForCompare ?? null, s.size, matchVariant?.name ?? "");
              const isCurrent = s.size === size;
              return (
                <SelectItem key={s.size} value={s.size}>
                  <div className="flex items-center justify-between w-full gap-4">
                    <span>{s.size} cm</span>
                    {!isCurrent && (
                      <span className="text-xs text-muted-foreground">{live ?? formatDiff(diff)}</span>
                    )}
                  </div>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>

      {/* Ram / Djup — döljs när det bara finns en variant (aluminium/akryl) */}
      {visibleVariants.length > 1 && (
        <div className="space-y-2">
          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
            {isCanvas ? t("format.depth") : isAluminum ? t("format.material") : isAcrylic ? t("format.finish") : t("format.frameOrHanger")}
          </Label>
          <div className={`grid gap-2 ${isCanvas ? "grid-cols-2" : "grid-cols-3"}`}>
            {visibleVariants.map((v) => {
              const diff = v.price - currentVariantPrice;
              const live = liveDelta(size, variant, size ?? "", v.name);
              const isNoFrame = v.name.toLowerCase() === "ingen";
              const hangerHex = HANGER_HEX[v.name];
              const isAvailable = v.available !== false;
              return (
                <FrameOption
                  key={v.name}
                  name={translateVariantName(v.name, t)}
                  thumbnail={isCanvas || isAluminum || isAcrylic || hangerHex ? undefined : isNoFrame ? undefined : FRAME_THUMBS[v.name]}
                  svg={
                    isCanvas
                      ? <DepthIcon depth={v.name} />
                      : hangerHex
                        ? <HangerIcon color={hangerHex} />
                        : isNoFrame
                          ? <NoFrameIcon />
                          : undefined
                  }
                  selected={v.name === variant}
                  onClick={() => setVariant(v.name)}
                  priceLabel={live ?? formatDiff(diff)}
                  disabled={!isAvailable}
                  unavailableLabel={!isAvailable ? t("frame.unavailableForSize") : undefined}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Orientering — segmented pill (hidden when only one orientation is allowed) */}
      {allowedOrientations.length > 1 && (
        <div className="space-y-2">
          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">{t("format.orientation")}</Label>
          <div className="flex p-1 bg-muted rounded-full">
            {([
              { id: "portrait", label: t("orientation.portrait") },
              { id: "landscape", label: t("orientation.landscape") },
            ] as const)
              .filter(({ id }) => allowedOrientations.includes(id))
              .map(({ id, label }) => {
                const active = orientation === id;
                return (
                  <button
                    key={id}
                    onClick={() => setOrientation(id)}
                    className={`flex-1 h-10 rounded-full text-sm font-medium transition ${
                      active
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-foreground/70 hover:text-foreground"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}
