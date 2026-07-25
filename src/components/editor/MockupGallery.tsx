import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useEditorStore } from "@/stores/editorStore";
import { Loader2, AlertCircle, ChevronLeft, ChevronRight, Maximize2, Box } from "lucide-react";
import { getScenesFor, frameColorFromVariant, hangerColorFromVariant, type MockupScene } from "@/lib/mockup-scenes";
import { compositeMockup } from "@/lib/mockup-composite";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Canvas3DPreview } from "./Canvas3DPreview";
import { renderTemplateSnapshot } from "@/lib/template-snapshot";
import { CANVAS_BLEED_CM, canvasWrapExtCm } from "@/lib/gelato-geometry";
import { getProductDetailsFor, type ProductDetail } from "./product-details";

interface MockupSlot {
  scene: MockupScene;
  url: string | null;
  loading: boolean;
  error?: string;
}

/**
 * En enhetlig "slot" i thumbnail-raden + lightbox. Tre varianter:
 *  - mockup: kompositerad scenbild
 *  - threeD: interaktiv 3D-canvas (öppnas i dialog)
 *  - detail: statisk produktdetalj-bild
 */
type GallerySlot =
  | { kind: "mockup"; id: string; label: string; thumbUrl: string | null; fullUrl: string | null; loading: boolean; error?: string }
  | { kind: "threeD"; id: string; label: string; thumbUrl: string | null; loading: boolean; error?: string }
  | { kind: "detail"; id: string; label: string; thumbUrl: string; fullUrl: string };

export function MockupGallery() {
  const { t } = useTranslation();
  const {
    config, template, size, variant, orientation, layoutId,
    mapStyleId, mapCenter, mapZoom,
    text, textFont, textVisible,
    showLabels, mapShape, posterBgColor,
    layerValues,
    layerTransforms,
    photoSources,
    photoAiResults,
    aiPhotoResults,
    whiteMarginEnabled,
    templateLayers,
  } = useEditorStore();
  const [slots, setSlots] = useState<MockupSlot[]>([]);
  const [snapshotUrl, setSnapshotUrl] = useState<string | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [snapshotError, setSnapshotError] = useState<string | undefined>();
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const debounceRef = useRef<number | null>(null);
  const reqIdRef = useRef(0);

  const isCanvas = config?.product_type === "canvas";

  // Compute canvas wrap depth from variant (e.g. "2 cm" → 2). Used both for
  // the snapshot (extends print area with wrap+bleed) AND the 3D preview UVs.
  const canvasDepthCm = isCanvas
    ? (variant?.match(/(\d+)/)?.[1] ? parseInt(variant!.match(/(\d+)/)![1], 10) : 2)
    : 0;
  // Gelatos canvas-filspec: wrap (djup + baksidesvik) + bleed per sida.
  const canvasWrapCm = isCanvas ? canvasWrapExtCm(canvasDepthCm) : 0;

  // Visible front size (for 3D mesh)
  const [a, b] = (size ?? "30x40").split("x").map(Number);
  const widthCm = orientation === "portrait" ? Math.min(a, b) : Math.max(a, b);
  const heightCm = orientation === "portrait" ? Math.max(a, b) : Math.min(a, b);

  useEffect(() => {
    if (!config || !size || !template) return;
    // Invalidate any in-flight render synchronously so stale results never overwrite.
    reqIdRef.current++;
    const scenes = getScenesFor(config.product_type);
    setSlots(scenes.map((s) => ({ scene: s, url: null, loading: true })));
    setSnapshotLoading(true);
    setSnapshotError(undefined);

    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(async () => {
      const myReq = ++reqIdRef.current;
      try {
        const newSnapshot = await renderTemplateSnapshot({
          template,
          orientation,
          size,
          productType: config.product_type,
          layoutId,
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
          wrapCm: canvasWrapCm,
          bleedCm: isCanvas ? CANVAS_BLEED_CM : 0,
          coordWrapCm: isCanvas ? canvasDepthCm : undefined,
          acrylicCorners: config.product_type === "acrylic",
          watermark: true,
          aiStyledLayerIds: Object.keys(photoAiResults ?? {}),
          photoOverlays: { ...photoSources && Object.fromEntries(Object.entries(photoSources).map(([id, s]) => [id, s.previewUrl])), ...photoAiResults },
          aiPhotoResults,
        });
        if (myReq !== reqIdRef.current) return;

        setSnapshotUrl(newSnapshot);
        setSnapshotLoading(false);

        const sceneCanvasDepthCm = 2;
        const frameColor = frameColorFromVariant(variant);
        const hangerColor = hangerColorFromVariant(variant);

        const results = await Promise.all(
          scenes.map(async (scene) => {
            try {
              const url = await compositeMockup({
                scene,
                printUrl: newSnapshot,
                size,
                orientation,
                productType: config.product_type,
                canvasDepthCm: sceneCanvasDepthCm,
                frameColor,
                hangerColor,
              });
              return { scene, url, error: undefined as string | undefined };
            } catch (e) {
              const msg = e instanceof Error ? e.message : t("preview.compositeFailed");
              return { scene, url: null as string | null, error: msg };
            }
          }),
        );
        if (myReq !== reqIdRef.current) return;

        setSlots(
          results.map((r) => ({
            scene: r.scene,
            url: r.url,
            loading: false,
            error: r.error,
          })),
        );
      } catch (e) {
        if (myReq !== reqIdRef.current) return;
        console.error("[MockupGallery] failed", e);
        const msg = e instanceof Error ? e.message : t("preview.somethingWrong");
        setSnapshotError(msg);
        setSnapshotLoading(false);
        setSlots(scenes.map((s) => ({ scene: s, url: null, loading: false, error: msg })));
      }
    }, 600);

    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [
    config, template, size, variant, orientation, isCanvas, canvasDepthCm, layoutId,
    layerValues, layerTransforms, posterBgColor, whiteMarginEnabled,
    mapStyleId, mapCenter, mapZoom, showLabels, mapShape,
    text, textFont, textVisible,
    photoSources, photoAiResults,
    aiPhotoResults,
  ]);

  // Bygg en enhetlig lista av "slots" i den ordning vi vill visa dem.
  const allSlots: GallerySlot[] = useMemo(() => {
    if (!config) return [];
    const list: GallerySlot[] = [];

    // Canvas: 3D-thumbnail först
    if (isCanvas) {
      list.push({
        kind: "threeD",
        id: "3d",
        label: t("preview.threeDLabel"),
        thumbUrl: snapshotUrl,
        loading: snapshotLoading,
        error: snapshotError,
      });
    }

    // Mockup-scener
    for (const s of slots) {
      list.push({
        kind: "mockup",
        id: s.scene.id,
        label: t(s.scene.labelKey),
        thumbUrl: s.url,
        fullUrl: s.url,
        loading: s.loading,
        error: s.error,
      });
    }

    // Statiska produktdetaljer sist
    for (const d of getProductDetailsFor(config.product_type)) {
      list.push({
        kind: "detail",
        id: d.id,
        label: t(d.labelKey),
        thumbUrl: d.src,
        fullUrl: d.src,
      });
    }

    return list;
  }, [config, isCanvas, slots, snapshotUrl, snapshotLoading, snapshotError, t]);

  if (!config) return null;

  // Endast slots som är klickbara (har en bild eller är 3D som klar att visa).
  const openableSlots = allSlots.filter((s) => {
    if (s.kind === "threeD") return !!s.thumbUrl && !s.loading;
    if (s.kind === "mockup") return !!s.thumbUrl;
    return true;
  });

  const currentSlot = lightboxIdx !== null ? openableSlots[lightboxIdx] : null;

  const goPrev = () =>
    setLightboxIdx((i) => (i === null ? null : (i - 1 + openableSlots.length) % openableSlots.length));
  const goNext = () =>
    setLightboxIdx((i) => (i === null ? null : (i + 1) % openableSlots.length));

  return (
    <>
      <div className="border-t bg-[hsl(var(--paper))]">
        <div className="px-4 py-3">
          <h3 className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-3">
            {t("preview.title")}
          </h3>
          <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4 snap-x">
            {allSlots.map((s, i) => {
              const openableIdx = openableSlots.findIndex((v) => v.id === s.id);
              const isLoading = (s.kind === "mockup" || s.kind === "threeD") && s.loading;
              const error = (s.kind === "mockup" || s.kind === "threeD") ? s.error : undefined;
              const hasImage = !!s.thumbUrl;

              return (
                <button
                  type="button"
                  key={s.id}
                  disabled={openableIdx < 0}
                  onClick={() => openableIdx >= 0 && setLightboxIdx(openableIdx)}
                  className="group flex-shrink-0 w-32 h-32 md:w-40 md:h-40 rounded-2xl overflow-hidden bg-card border snap-start relative disabled:cursor-default cursor-zoom-in"
                  aria-label={t("preview.enlarge", { name: s.label })}
                >
                  {isLoading ? (
                    <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-muted to-muted/40 animate-pulse">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : hasImage ? (
                    <>
                      <img
                        src={s.thumbUrl!}
                        alt={s.label}
                        className={`w-full h-full transition-transform group-hover:scale-105 ${
                          s.kind === "threeD" ? "object-contain bg-[#f5f2ec] p-2" : "object-cover"
                        }`}
                        loading="lazy"
                      />
                      {s.kind === "threeD" && (
                        <span className="absolute top-1.5 left-1.5 inline-flex items-center gap-1 rounded-full bg-foreground/85 text-background text-[10px] font-semibold px-2 py-0.5 backdrop-blur-sm">
                          <Box className="h-3 w-3" />
                          {t("preview.threeDBadge")}
                        </span>
                      )}
                      <span className="absolute top-1.5 right-1.5 inline-flex items-center justify-center h-6 w-6 rounded-full bg-background/85 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition">
                        <Maximize2 className="h-3.5 w-3.5" />
                      </span>
                    </>
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center bg-destructive/5 text-destructive text-[10px] p-2 text-center gap-1">
                      <AlertCircle className="h-4 w-4" />
                      <span className="line-clamp-3">{error ?? t("preview.noImage")}</span>
                    </div>
                  )}
                  <div className="absolute bottom-0 inset-x-0 bg-background/85 backdrop-blur-sm text-[11px] py-1 text-center font-medium pointer-events-none">
                    {s.label}
                  </div>
                </button>
              );
            })}
          </div>
          {/* Notis endast när mallen har bildlager (= vattenmärke kan synas). */}
          {templateLayers().some(
            (l) => l.type === "photo" || l.type === "aiPhoto" || (l.type === "image" && !!l.defaults.url),
          ) && (
            <p className="text-[11px] text-muted-foreground mt-1">
              {t("watermark.notice")}
            </p>
          )}
        </div>
      </div>

      <Dialog open={lightboxIdx !== null} onOpenChange={(o) => !o && setLightboxIdx(null)}>
        <DialogContent className="max-w-[95vw] md:max-w-4xl p-0 bg-background border-0 overflow-hidden">
          <DialogTitle className="sr-only">{currentSlot?.label ?? t("preview.title")}</DialogTitle>
          {currentSlot && (
            <div className="relative bg-muted">
              {currentSlot.kind === "threeD" ? (
                <div className="p-3 md:p-4">
                  <Canvas3DPreview
                    embedded
                    printUrl={snapshotUrl}
                    loading={snapshotLoading}
                    error={snapshotError}
                    widthCm={widthCm}
                    heightCm={heightCm}
                    depthCm={canvasDepthCm}
                    wrapExtCm={canvasWrapCm}
                    bleedCm={CANVAS_BLEED_CM}
                  />
                </div>
              ) : (
                <img
                  src={currentSlot.kind === "mockup" ? currentSlot.fullUrl! : currentSlot.fullUrl}
                  alt={currentSlot.label}
                  className="w-full h-auto max-h-[85vh] object-contain"
                />
              )}
              {openableSlots.length > 1 && (
                <>
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon"
                    onClick={goPrev}
                    className="absolute left-2 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full shadow-lg bg-background/90 hover:bg-background z-10"
                    aria-label={t("common.previous")}
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon"
                    onClick={goNext}
                    className="absolute right-2 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full shadow-lg bg-background/90 hover:bg-background z-10"
                    aria-label={t("common.next")}
                  >
                    <ChevronRight className="h-5 w-5" />
                  </Button>
                </>
              )}
              <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent text-background px-4 py-3 text-sm font-medium pointer-events-none">
                {currentSlot.label}
                {openableSlots.length > 1 && (
                  <span className="ml-2 opacity-70">
                    {(lightboxIdx ?? 0) + 1} / {openableSlots.length}
                  </span>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
