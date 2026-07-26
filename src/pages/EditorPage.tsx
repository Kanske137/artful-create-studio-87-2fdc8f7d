import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Loader2, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useShopContextStore } from "@/stores/shopContextStore";
import { formatPrice, formatMoney } from "@/lib/format-price";
import { useShopifyPriceMap, priceFromMap } from "@/hooks/useShopifyPriceMap";
import { translateVariantName } from "@/lib/variant-labels";
import { useEditorStore } from "@/stores/editorStore";
import { useOnboardingStore } from "@/stores/onboardingStore";
import {
  loadAllConfigs,
  resolveConfigForHandle,
  deriveTemplateSlug,
  type ProductConfig,
  type ProductType,
} from "@/lib/product-config";
import { MapPreview } from "@/components/editor/MapPreview";
import { EditorShell } from "@/components/editor/EditorShell";
import { StickyCta } from "@/components/editor/StickyCta";
import { useOnboarding } from "@/hooks/useOnboarding";
import { MockupGallery } from "@/components/editor/MockupGallery";
import { postEditorResize } from "@/lib/iframe-resize";
import { useCartStore } from "@/stores/cartStore";
import { CartDrawer } from "@/components/CartDrawer";
import { renderTemplateSnapshot } from "@/lib/template-snapshot";
import { uploadCartPreview } from "@/lib/upload-preview";
import { getPrintFileUrl } from "@/lib/print-pipeline";
import { resolveShopifyVariantId } from "@/lib/shopify-variant-resolver";
import { hangerColorFromVariant } from "@/lib/mockup-scenes";
import { FRAME_FRONT_CM, CANVAS_BLEED_CM, canvasWrapExtCm } from "@/lib/gelato-geometry";
import { mutateActiveLayoutBlock } from "@/lib/freeform-layers";
import { ensureSession, getSessionKey, track } from "@/lib/analytics";
import { SubscriberGateDialog } from "@/components/editor/SubscriberGateDialog";
import { toast } from "sonner";

// OBS: värdena är identitetsnycklar för textureForHex (lib/frame-textures) —
// samma hex som frameColorFromVariant i mockup-scenes. Ändras de tappar
// editor-preview och cart-snapshot sina trätexturer.
const FRAME_COLORS: Record<string, string> = {
  Ingen: "",
  Vit: "#f5f5f2",
  Svart: "#1a1a1a",
  Ek: "#c8a371",
  Valnöt: "#5a3a26",
};
const FRAME_WIDTH_CM = FRAME_FRONT_CM; // Gelato frp_w12xt22-mm (12 mm front) — se lib/gelato-geometry

function normalizeType(raw: string | null): ProductType | undefined {
  if (!raw) return undefined;
  const v = raw.toLowerCase();
  if (v === "poster" || v === "posters") return "posters";
  if (v === "canvas") return "canvas";
  if (v === "aluminum" || v === "metallic") return "aluminum";
  if (v === "acrylic" || v === "akryl") return "acrylic";
  return undefined;
}

export default function EditorPage() {
  const [params, setParams] = useSearchParams();
  const handleParam = params.get("handle") ?? "personlig-karta-poster";
  const typeParam = normalizeType(params.get("type"));
  const [configs, setConfigs] = useState<ProductConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const {
    config,
    template,
    layoutId,
    layerValues,
    layerTransforms,
    whiteMarginEnabled,
    setConfig,
    currentPrice,
    currentLayout,
    mapStyleId,
    mapCenter,
    mapZoom,
    text,
    textFont,
    textVisible,
    showLabels,
    mapShape,
    orientation,
    size,
    variant,
    posterBgColor,
    designSource,
    aiPrintFileUrl,
    aiPhotoResults,
    shopifyVariantId,
    shopifyVariantResolving,
    setShopifyVariantId,
    setShopifyVariantResolving,
  } = useEditorStore();
  const { t } = useTranslation();
  const shopCtx = useShopContextStore();
  const addItem = useCartStore((s) => s.addItem);
  const isAdding = useCartStore((s) => s.isLoading);
  const [isPreparing, setIsPreparing] = useState(false);
  const { map: shopifyPriceMap, derivedFx } = useShopifyPriceMap();
  const { activeHintSection } = useOnboarding();
  const showCartHint = activeHintSection === null;
  const livePrice = priceFromMap(shopifyPriceMap, size, variant);
  const displayPrice = livePrice
    ? formatMoney(livePrice.amount, livePrice.currencyCode, shopCtx.locale)
    : derivedFx
      ? formatMoney(currentPrice() * derivedFx.rate, derivedFx.currencyCode, shopCtx.locale)
      : formatPrice(currentPrice(), shopCtx);

  // All configs that belong to the same template (same template_slug). Passed
  // down so FormatSection can render its poster/canvas toggle without having
  // to re-derive the relationship.
  const sameTemplateConfigs = useMemo(() => {
    if (!config) return [] as ProductConfig[];
    const slug = config.template_slug ?? deriveTemplateSlug(config.shopify_handle);
    return configs.filter((c) => (c.template_slug ?? deriveTemplateSlug(c.shopify_handle)) === slug);
  }, [configs, config]);

  // Resolve real Shopify variant ID whenever handle/size/variant changes.
  useEffect(() => {
    if (!config || !size || !variant) {
      setShopifyVariantId(null);
      return;
    }
    let cancelled = false;
    setShopifyVariantResolving(true);
    resolveShopifyVariantId(config.shopify_handle, size, variant, config.product_type)
      .then((id) => {
        if (cancelled) return;
        setShopifyVariantId(id);
      })
      .finally(() => {
        if (!cancelled) setShopifyVariantResolving(false);
      });
    return () => {
      cancelled = true;
    };
  }, [config, size, variant, setShopifyVariantId, setShopifyVariantResolving]);

  // Initial laddning: hämta alla configs en gång.
  useEffect(() => {
    (async () => {
      setLoading(true);
      const all = await loadAllConfigs();
      setConfigs(all);
      setLoading(false);
    })();
  }, []);

  // Analytics: registrera sessionen + logga editor-öppning per mall/produkttyp.
  useEffect(() => {
    if (!config) return;
    ensureSession({
      locale: shopCtx.locale,
      country: shopCtx.country ?? undefined,
      handle: config.shopify_handle,
    });
    track("editor_opened", {
      handle: config.shopify_handle,
      productType: config.product_type,
      freeform: Boolean(config.is_freeform),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.shopify_handle, config?.product_type]);

  // Iframe-höjdkommunikation: rapportera .editor-root verkliga höjd.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.self === window.top) return;
    if (loading || !config) return;
    let timer: number | null = null;
    let ro: ResizeObserver | null = null;
    const imgCleanups: Array<() => void> = [];
    const attach = () => {
      const root = document.querySelector(".editor-root");
      if (!root) {
        requestAnimationFrame(attach);
        return;
      }
      postEditorResize();
      if (typeof ResizeObserver !== "undefined") {
        ro = new ResizeObserver(() => postEditorResize());
        // Observera HELA app-roten (header + editor-root + mockup-galleri)
        // och vart och ett av dess barn — annars fångas inte när
        // MockupGallery växer (den ligger utanför .editor-root).
        const appRoot = (root.parentElement ?? root) as HTMLElement;
        ro.observe(appRoot);
        Array.from(appRoot.children).forEach((child) => ro!.observe(child));
      }
      // Mockup-bilder laddar asynkront och ändrar höjden efter mount.
      // Rapportera om när varje bild blivit klar.
      Array.from(document.querySelectorAll("img")).forEach((img) => {
        if (!img.complete) {
          const onDone = () => postEditorResize();
          img.addEventListener("load", onDone, { once: true });
          img.addEventListener("error", onDone, { once: true });
          imgCleanups.push(() => {
            img.removeEventListener("load", onDone);
            img.removeEventListener("error", onDone);
          });
        }
      });
    };
    const r1 = requestAnimationFrame(() => {
      const r2 = requestAnimationFrame(attach);
      (attach as any)._r2 = r2;
    });
    const onResize = () => {
      if (timer != null) window.clearTimeout(timer);
      timer = window.setTimeout(() => postEditorResize(), 100);
    };
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(r1);
      window.removeEventListener("resize", onResize);
      if (timer != null) window.clearTimeout(timer);
      if (ro) ro.disconnect();
      imgCleanups.forEach((fn) => fn());
    };
  }, [loading, config]);

  // Resolva aktiv config från redan laddade configs när URL-params ändras.
  // Detta undviker omladdning/spinner vid produkttyp-byte i konsoliderade mallar.
  useEffect(() => {
    if (configs.length === 0) return;
    const active = resolveConfigForHandle(configs, handleParam, typeParam);
    if (active) {
      setNotFound(false);
      setConfig(active);
    } else {
      setNotFound(true);
    }
  }, [configs, handleParam, typeParam, setConfig]);

  const onProductChange = (newHandle: string, newType?: import("@/lib/product-config").ProductType) => {
    // Konsoliderad mall: alla virtuella configs delar samma handle, så vi
    // måste matcha även på product_type. Falla tillbaka till äldre beteende
    // (matcha bara på handle) för icke-konsoliderade mallar.
    const next = newType
      ? configs.find((c) => c.shopify_handle === newHandle && c.product_type === newType)
      : configs.find((c) => c.shopify_handle === newHandle);
    if (!next) return;
    const nextTypeParam: string = next.product_type === "posters" ? "poster" : next.product_type;
    setShopifyVariantId(null);
    const nextParams = new URLSearchParams(window.location.search);
    nextParams.set("handle", newHandle);
    nextParams.set("type", nextTypeParam);
    setParams(nextParams, { replace: true });
    setConfig(next);
    // Ny mall → börja om onboarding-guidningen.
    useOnboardingStore.getState().reset();
  };

  const frameColor = config?.product_type === "posters" ? FRAME_COLORS[variant ?? "Ingen"] : "";
  const hangerColor = config?.product_type === "posters" ? hangerColorFromVariant(variant) : null;
  const isCanvas = config?.product_type === "canvas";
  const canvasDepthCm = isCanvas ? (variant?.match(/(\d+)/)?.[1] ? parseInt(variant!.match(/(\d+)/)![1], 10) : 2) : 0;

  const orientationLabel = orientation === "portrait" ? t("orientation.portrait") : t("orientation.landscape");
  const translatedVariant = translateVariantName(variant, t);
  const variantLabel =
    config?.product_type === "canvas" ? `${translatedVariant} ${t("format.depth").toLowerCase()}` : translatedVariant;
  const summary = [size ? `${size} cm` : null, variantLabel.trim() ? variantLabel : null, orientationLabel]
    .filter(Boolean)
    .join(" · ");

  const hiddenLayerIds = useEditorStore((s) => s.hiddenLayerIds);
  const hasDesignContent = useEditorStore((s) => s.hasDesignContent);
  const orderBlockReason = useEditorStore((s) => s.orderBlockReason);
  const isFreeform = Boolean(config?.is_freeform);
  // Beställningsspärr: freeform kräver innehåll; vanliga mallar kräver att
  // designen faktiskt personaliserats (ingen exempel-/defaultdesign i tryck).
  const blockReason = isFreeform ? null : orderBlockReason();
  const canAddToCart = (!isFreeform || hasDesignContent()) && blockReason === null;
  const blockHint = blockReason
    ? t(
        blockReason === "generation"
          ? "cartAdd.blockedGeneration"
          : blockReason === "demo"
            ? "cartAdd.blockedDemo"
            : blockReason === "photo"
            ? "cartAdd.blockedPhoto"
            : blockReason === "photoMulti"
              ? "cartAdd.blockedPhotoMulti"
              : "cartAdd.blockedCustomize",
      )
    : isFreeform && !hasDesignContent()
      ? t("cartAdd.freeformEmpty")
      : undefined;

  const handleAddToCart = async () => {
    if (!config || !size || !variant) return;
    if (isFreeform && !hasDesignContent()) {
      toast.error(t("cartAdd.freeformEmpty"), {
        description: t("cartAdd.freeformEmptyHint"),
      });
      return;
    }
    // Skyddsnät utöver disabled-knappen — designen får aldrig beställas
    // opersonaliserad (exempel-/defaultinnehåll i tryckfilen).
    if (blockReason) {
      if (blockHint) toast.error(blockHint);
      return;
    }
    const inIframe = window.self !== window.top;
    const designId = (crypto as any)?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    if (!template) return;
    // Strip hidden layers from the template before snapshot/print so the
    // customer's "öga av"-val faktiskt syns i tryckfilen och kundvagnsbilden.
    const printableTemplate = Object.keys(hiddenLayerIds).length
      ? mutateActiveLayoutBlock(
          template,
          config.product_type,
          layoutId,
          orientation,
          (ls) => ls.filter((l) => !hiddenLayerIds[l.id]),
        )
      : template;
    const baseTemplateInput = {
      template: printableTemplate,
      orientation,
      productType: config?.product_type,
      layoutId,
      contentVariantId: useEditorStore.getState().contentVariantId,
      size,
      layerValues,
      layerTransforms,
      whiteMarginEnabled,
      livePosterBgColor: posterBgColor,
      liveMapCenter: mapCenter,
      liveMapZoom: mapZoom,
      liveMapStyleId: mapStyleId,
      liveMapShape: mapShape,
      liveShowLabels: showLabels,
      liveText: text,
      liveTextFont: textFont,
      liveTextVisible: textVisible,
      // Gelatos canvas-filspec: wrap = djup + baksidesvik (3,4/4,0 cm) + 1,5 cm
      // bleed per sida. coordWrapCm = djupet (editorytan) för fullArea-layouter.
      wrapCm: isCanvas ? canvasWrapExtCm(canvasDepthCm) : 0,
      bleedCm: isCanvas ? CANVAS_BLEED_CM : 0,
      coordWrapCm: isCanvas ? canvasDepthCm : undefined,
      photoOverlays: useEditorStore.getState().getPhotoOverlays(),
      aiPhotoResults,
      aiPhotoSelectedRefUrl: useEditorStore.getState().aiPhotoSelectedRefUrl,
    };

    setIsPreparing(true);
    let previewUrl = "";
    let printFileUrl = "";
    try {
      // 1) Print file via dispatcher (always full multi-layer composite).
      printFileUrl = await getPrintFileUrl({
        source: designSource,
        designId,
        templateInput: baseTemplateInput,
      });

      // 2) Thumbnail for cart display — multi-layer snapshot WITH frame/wrap
      //    overlay so the cart preview matches the editor exactly. INGET
      //    vattenmärke här (Akrams beslut 2026-07-21): kundvagns-/orderbilden
      //    ska vara ren. Vattenmärket finns kvar i editor + mockups/3D.
      const thumbDataUrl = await renderTemplateSnapshot({
        ...baseTemplateInput,
        frameColor: !isCanvas ? frameColor : undefined,
        frameWidthCm: !isCanvas ? FRAME_WIDTH_CM : undefined,
        hangerColor: hangerColor ?? undefined,
        canvasWrap: isCanvas,
        acrylicCorners: config?.product_type === "acrylic",
      });
      previewUrl = await uploadCartPreview(thumbDataUrl, designId);
    } catch (err) {
      console.error("[print-pipeline] failed", err);
      const msg = err instanceof Error ? err.message : t("common.unknownError");
      toast.error(t("cartAdd.prepareFailed"), { description: msg });
      setIsPreparing(false);
      return; // ABORT — do NOT add a broken item to the cart.
    } finally {
      setIsPreparing(false);
    }

    const properties: Record<string, string> = {
      Orientering: orientation === "portrait" ? "Stående" : "Liggande",
      _map_style: mapStyleId,
      _map_center: `${mapCenter[1].toFixed(6)},${mapCenter[0].toFixed(6)}`,
      _map_zoom: mapZoom.toFixed(2),
      _size: size,
      _variant: variant,
      _bg_color: posterBgColor,
      _orientation: orientation,
      _product_handle: config.shopify_handle,
      _product_type: config.product_type,
      _design_id: designId,
      _map_shape: mapShape,
      _show_labels: showLabels ? "true" : "false",
      _text_visible: textVisible ? "true" : "false",
      _text_font: textFont,
      _text: text,
      _design_source: designSource,
      _preview_image: previewUrl,
      _print_file_url: printFileUrl,
      _session_id: getSessionKey(),
    };

    track("add_to_cart", {
      designId,
      handle: config.shopify_handle,
      productType: config.product_type,
      size,
      variant,
      orientation,
      source: designSource,
      priceSek: currentPrice(),
    });

    if (inIframe) {
      window.parent.postMessage(
        {
          type: "ADD_TO_CART",
          handle: config.shopify_handle,
          size,
          variant,
          quantity: 1,
          properties,
        },
        "*",
      );
      toast.success(t("cartAdd.added"));
      return;
    }

    // Resolve real variant ID. Fall back to a fresh lookup if not yet cached
    // (race when user clicks before the effect resolves).
    let variantGid = shopifyVariantId;
    if (!variantGid) {
      variantGid = await resolveShopifyVariantId(config.shopify_handle, size, variant, config.product_type);
      if (variantGid) setShopifyVariantId(variantGid);
    }
    if (!variantGid) {
      toast.error(t("cartAdd.variantUnavailable"), {
        description: t("cartAdd.variantUnavailableHint", { size, variant, handle: config.shopify_handle }),
      });
      return;
    }

    await addItem({
      variantId: variantGid,
      productTitle: config.title,
      variantTitle: `${size} · ${variant}`,
      imageUrl: previewUrl,
      price: { amount: String(currentPrice()), currencyCode: "SEK" },
      quantity: 1,
      attributes: Object.entries(properties).map(([key, value]) => ({ key, value: String(value) })),
    });
  };

  if (!loading && notFound) {
    return (
      <div className="min-h-[400px] flex flex-col items-center justify-center bg-background gap-2 p-6 text-center">
        <h2 className="text-lg font-semibold">{t("editorError.templateNotFoundTitle")}</h2>
        <p className="text-sm text-muted-foreground max-w-md">{t("editorError.templateNotFoundBody")}</p>
      </div>
    );
  }

  if (loading || !config) {
    return (
      <div className="min-h-[400px] flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }


  const previewNode = (
    <MapPreview
      frameColor={frameColor}
      frameWidthCm={FRAME_WIDTH_CM}
      hangerColor={hangerColor ?? undefined}
      wrapCm={canvasDepthCm}
      layersIncludeWrap={isCanvas && template?.canvasLayout?.coordSpace === "fullArea"}
    />
  );


  const ctaNode = (
    <StickyCta
      price={displayPrice}
      summary={summary}
      loading={isAdding || isPreparing}
      disabled={!canAddToCart}
      disabledHint={blockHint}
      onAdd={handleAddToCart}
      showCartHint={showCartHint}
    />
  );

  const standalone = window.self === window.top;
  return (
    <div className="flex flex-col bg-background">
      {/* Top bar (only outside iframe) */}
      {standalone && (
        <header className="border-b bg-background sticky top-0 z-30">
          <div className="px-4 py-3 flex items-center justify-between">
            <h1 className="font-serif-display text-xl md:text-2xl font-semibold">{config.title}</h1>
            <CartDrawer />
          </div>
        </header>
      )}

      <EditorShell
        configs={configs}
        activeHandle={config.shopify_handle}
        activeProductType={config.product_type}
        onProductChange={onProductChange}
        preview={previewNode}
        cta={ctaNode}
      />

      {/* Mockup gallery */}
      <MockupGallery />

      {/* Prenumerant-gate (Fas 4): e-postdialog efter första gratisgenereringen */}
      <SubscriberGateDialog />
    </div>
  );
}
