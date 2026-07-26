import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Image as ImageIcon, Sparkles, MapPin, Palette, Type, Ruler, Layers, Star, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Circle, Heart, Star, Square, RotateCcw } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useEditorStore, type MapLayerValue, type TextLayerValue, type PhotoLayerValue, type PhotoShape, type StarmapLayerValue } from "@/stores/editorStore";
import { FONT_FAMILIES } from "@/lib/font-catalog";
import { substituteTokens } from "@/lib/text-typography";
import { geocode, type GeocodeResult } from "@/lib/mapbox";
import { type ProductConfig, type ProductType } from "@/lib/product-config";
import { getEnabledMapStyleIds, mapStyleLabel, mapStyleLabelKey, mapStylePreviewBg, mapStyleThumbnailUrl } from "@/lib/map-style-catalog";
import { FormatSection } from "./FormatSection";
import { PhotoUploadSection } from "./PhotoUploadSection";
import { AiStyleSection } from "./AiStyleSection";
import { AiPhotoSection } from "./AiPhotoSection";
import { MultiFaceUploadSection } from "./MultiFaceUploadSection";
import { LayersSection } from "./LayersSection";
import { Loader2, Search } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { effectiveLayerRect, clampLayerRect } from "@/lib/layer-utils";
import type { TemplateLayer, Template } from "@/lib/template-schema";
import { getAllLayouts, DEFAULT_LAYOUT_ID } from "@/lib/template-schema";
import TemplateThumbnail from "@/components/admin/TemplateThumbnail";
import { MAP_ICONS, MAP_ICON_INITIAL_COUNT, getMapIcon } from "@/lib/map-icon-catalog";
import { OnboardingHint } from "./OnboardingHint";

/** Per-layer slider that scales a layer up/down while preserving aspect ratio.
 *  Shown in the customer editor for any layer where `locks.size === false`.
 *  Scale percentage is RELATIVE to the layer's template default size. */
function LayerSizeSlider({ layer }: { layer: TemplateLayer }) {
  const { t } = useTranslation();
  const layerTransforms = useEditorStore((s) => s.layerTransforms);
  const setLayerTransform = useEditorStore((s) => s.setLayerTransform);
  const resetLayerTransform = useEditorStore((s) => s.resetLayerTransform);
  const eff = effectiveLayerRect(layer, layerTransforms);
  // % of original size (avoid /0)
  const scale = layer.wPct > 0 ? Math.round((eff.wPct / layer.wPct) * 100) : 100;

  const onChange = (val: number) => {
    const factor = val / 100;
    const newW = Math.max(1, Math.min(100, layer.wPct * factor));
    const newH = Math.max(1, Math.min(100, layer.hPct * factor));
    const cx = eff.xPct + eff.wPct / 2;
    const cy = eff.yPct + eff.hPct / 2;
    const clamped = clampLayerRect({
      xPct: cx - newW / 2,
      yPct: cy - newH / 2,
      wPct: newW,
      hPct: newH,
    });
    setLayerTransform(layer.id, clamped);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
          {t("layer.size")} <span className="ml-1 text-foreground/60 normal-case">{scale}%</span>
        </Label>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-[10px]"
          onClick={() => resetLayerTransform(layer.id)}
        >
          <RotateCcw className="h-3 w-3 mr-1" /> {t("common.reset")}
        </Button>
      </div>
      <Slider
        min={20}
        max={200}
        step={1}
        value={[scale]}
        onValueChange={(v) => onChange(v[0]!)}
      />
    </div>
  );
}

/** Aggregated transform controls for a layer (size slider when unlocked + a
 *  reminder that the user can drag the layer when move is unlocked). */
function LayerTransformControls({ layer }: { layer: TemplateLayer }) {
  const { t } = useTranslation();
  const showSize = !layer.locks.size;
  const showMove = !layer.locks.move;
  if (!showSize && !showMove) return null;
  return (
    <div className="space-y-3 pt-1">
      {showSize && <LayerSizeSlider layer={layer} />}
      {showMove && (
        <p className="text-[11px] text-muted-foreground">
          {t("layer.tipMove")}
        </p>
      )}
    </div>
  );
}

interface Props {
  configs: ProductConfig[];
  activeHandle: string;
  activeProductType: ProductType;
  onProductChange: (handle: string, productType: ProductType) => void;
  /** When set, only this section's content is rendered (no chrome). */
  sectionId?: SectionId;
}

export type SectionId =
  | "lager"
  | "bild"
  | "forvandling"
  | "karta"
  | "stjarnhimmel"
  | "stil"
  | "text"
  | "format";

export interface SectionMeta {
  id: SectionId;
  labelKey: string;
  icon: LucideIcon;
}

const SECTION_ORDER: SectionId[] = ["lager", "bild", "forvandling", "karta", "stjarnhimmel", "stil", "text", "format"];

const SECTION_META: Record<SectionId, { labelKey: string; icon: LucideIcon }> = {
  lager: { labelKey: "section.layers", icon: Layers },
  bild: { labelKey: "section.image", icon: ImageIcon },
  forvandling: { labelKey: "section.transformation", icon: Sparkles },
  karta: { labelKey: "section.map", icon: MapPin },
  stjarnhimmel: { labelKey: "section.starmap", icon: Star },
  stil: { labelKey: "section.style", icon: Palette },
  text: { labelKey: "section.text", icon: Type },
  format: { labelKey: "section.format", icon: Ruler },
};

/** Computes which sections are available for the currently loaded template. */
export function useAvailableSections(): SectionMeta[] {
  const config = useEditorStore((s) => s.config);
  const template = useEditorStore((s) => s.template);
  const templateLayers = useEditorStore((s) => s.templateLayers);
  // Re-derive layers when layoutId changes (different style → different layers).
  const layoutId = useEditorStore((s) => s.layoutId);

  return useMemo(() => {
    const layers = templateLayers();
    const photoLayers = layers.filter((l) => l.type === "photo");
    const aiPhotoLayers = layers.filter((l) => l.type === "aiPhoto");
    const mapLayers = layers.filter((l) => l.type === "map");
    const textLayers = layers.filter((l) => l.type === "text");
    const starmapLayers = layers.filter((l) => l.type === "starmap");

    const editableMaps = mapLayers.filter(
      (l: any) => !l.locks.position || !l.locks.style || !l.locks.shape || !l.locks.visibility || !l.locks.size || !l.locks.move,
    );
    const editableTexts = textLayers.filter(
      (l: any) => !l.locks.content || !l.locks.font || !l.locks.visibility || !l.locks.size || !l.locks.move,
    );
    const allLayouts = template ? getAllLayouts(template) : [];
    const isFreeform = !!config?.is_freeform;

    const flags: Record<SectionId, boolean> = {
      lager: isFreeform,
      bild: photoLayers.length > 0,
      forvandling: aiPhotoLayers.length > 0,
      karta: editableMaps.length > 0,
      stjarnhimmel: starmapLayers.length > 0,
      stil: allLayouts.length > 1,
      text: editableTexts.length > 0,
      format: true,
    };
    return SECTION_ORDER.filter((id) => flags[id]).map((id) => ({
      id,
      labelKey: SECTION_META[id].labelKey,
      icon: SECTION_META[id].icon,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template, layoutId, templateLayers, config?.is_freeform]);
}


export function ControlPanel({ configs, activeHandle, activeProductType, onProductChange, sectionId }: Props) {
  const { t } = useTranslation();
  const config = useEditorStore((s) => s.config);
  const template = useEditorStore((s) => s.template);
  const layoutId = useEditorStore((s) => s.layoutId);
  const setLayoutId = useEditorStore((s) => s.setLayoutId);
  const productOptions = useEditorStore((s) => s.productOptions);
  const templateLayers = useEditorStore((s) => s.templateLayers);
  const layerValues = useEditorStore((s) => s.layerValues);
  const photoSources = useEditorStore((s) => s.photoSources);
  const orientation = useEditorStore((s) => s.orientation);

  if (!config) return null;
  if (!sectionId) return null;

  const layers = templateLayers();
  const mapLayers = layers.filter((l): l is Extract<TemplateLayer, { type: "map" }> => l.type === "map");
  const textLayers = layers.filter((l): l is Extract<TemplateLayer, { type: "text" }> => l.type === "text");
  const photoLayers = layers.filter((l): l is Extract<TemplateLayer, { type: "photo" }> => l.type === "photo");
  const aiPhotoLayers = layers.filter(
    (l): l is Extract<TemplateLayer, { type: "aiPhoto" }> => l.type === "aiPhoto",
  );
  const editableMaps = mapLayers.filter(
    (l) => !l.locks.position || !l.locks.style || !l.locks.shape || !l.locks.visibility || !l.locks.size || !l.locks.move,
  );
  const editableTexts = textLayers.filter(
    (l) => !l.locks.content || !l.locks.font || !l.locks.visibility || !l.locks.size || !l.locks.move,
  );
  const aiStyles = productOptions?.aiStyles ?? [];
  const allLayouts = template ? getAllLayouts(template) : [];
  const productType = config.product_type ?? null;

  const renderSection = () => {
    switch (sectionId) {
    case "lager":
      return <LayersSection />;
    case "bild":
      return (
        <PhotoLayersControls
          photoLayers={photoLayers}
          layerValues={layerValues}
          photoSources={photoSources}
          aiStyles={aiStyles}
        />
      );
    case "forvandling":
      return (
        <div className="space-y-5">
          {aiPhotoLayers.map((l, idx, arr) => (
            <div key={l.id} className="space-y-3">
              {l.defaults.multiFaceSwap?.enabled ? (
                <MultiFaceUploadSection
                  layer={l}
                  heading={arr.length > 1 ? l.name || t("layer.transformationTab", { n: idx + 1 }) : null}
                />
              ) : (
                <AiPhotoSection
                  layer={l}
                  heading={arr.length > 1 ? l.name || t("layer.transformationTab", { n: idx + 1 }) : null}
                  aiStylePresets={aiStyles}
                />
              )}
              <LayerTransformControls layer={l} />
            </div>
          ))}
        </div>
      );
    case "karta":
      return <MapTabs config={config} layers={editableMaps} layerValues={layerValues} />;
    case "stjarnhimmel": {
      const starmapLayers = layers.filter(
        (l): l is Extract<TemplateLayer, { type: "starmap" }> => l.type === "starmap",
      );
      return (
        <div className="space-y-6">
          {starmapLayers.map((l) => {
            const v = layerValues[l.id];
            return (
              <StarmapSection
                key={l.id}
                layer={l}
                value={v && v.kind === "starmap" ? v : null}
              />
            );
          })}
        </div>
      );
    }
    case "stil":
      return (
        <div className="grid grid-cols-3 gap-2">
          {allLayouts.map((l) => {
            const id = l.id;
            const active = (layoutId ?? DEFAULT_LAYOUT_ID) === id;
            const aspect = l.defaultLayout[orientation]?.aspect ?? "3:4";
            const aspectClass =
              aspect === "1:1" ? "aspect-square" : aspect === "4:3" ? "aspect-[4/3]" : "aspect-[3/4]";
            return (
              <button
                key={id}
                type="button"
                onClick={() => setLayoutId(id)}
                className={cn(
                  "rounded-xl border bg-background overflow-hidden text-left transition",
                  active ? "ring-2 ring-primary border-transparent" : "border-border hover:border-foreground/30",
                )}
              >
                <div className={cn("bg-muted overflow-hidden", aspectClass)}>
                  {l.thumbnailUrl ? (
                    <img src={l.thumbnailUrl} alt={l.name} className="w-full h-full object-cover" />
                  ) : template ? (
                    <TemplateThumbnail
                      template={template}
                      layoutOverride={{ defaultLayout: l.defaultLayout, canvasLayout: l.canvasLayout }}
                      orientation={orientation}
                      productType={productType}
                      fill
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-[10px] text-muted-foreground uppercase tracking-wider">
                      {l.name.slice(0, 2)}
                    </div>
                  )}
                </div>
                <div className="px-2 py-1.5 text-[11px] font-medium truncate">{l.name}</div>
              </button>
            );
          })}
        </div>
      );
    case "text":
      return (
        <div className="space-y-6">
          {editableTexts.map((l, idx) => {
            const linkedMapId = l.defaults.linkedMapLayerId;
            const linkedMap =
              linkedMapId
                ? (layerValues[linkedMapId] as MapLayerValue | StarmapLayerValue | undefined)
                : undefined;
            return (
              <TextLayerSection
                key={l.id}
                config={config}
                layer={l}
                value={(layerValues[l.id] as TextLayerValue | undefined) ?? null}
                linkedMap={linkedMap ?? null}
                heading={editableTexts.length > 1 ? `${l.name || t("text.tab", { n: idx + 1 })}` : null}
              />
            );
          })}
        </div>
      );
    case "format":
      return (
        <FormatSection
          configs={configs}
          activeHandle={activeHandle}
          activeProductType={activeProductType}
          onProductChange={onProductChange}
        />
      );
    default:
      return null;
    }
  };

  return (
    <div className="space-y-4">
      <OnboardingHint sectionId={sectionId} />
      {renderSection()}
    </div>
  );
}

// ---------------- map tabs (place + style merged) ----------------

function MapTabs({
  config,
  layers,
  layerValues,
}: {
  config: ProductConfig;
  layers: Array<Extract<TemplateLayer, { type: "map" }>>;
  layerValues: Record<string, unknown>;
}) {
  const { t } = useTranslation();
  const [activeId, setActiveId] = useState<string>(layers[0]?.id ?? "");

  // If layers change (added/removed), make sure activeId still exists.
  useEffect(() => {
    if (!layers.some((l) => l.id === activeId)) {
      setActiveId(layers[0]?.id ?? "");
    }
  }, [layers, activeId]);

  const activeLayer = layers.find((l) => l.id === activeId) ?? layers[0];
  if (!activeLayer) return null;

  const renderForLayer = (l: Extract<TemplateLayer, { type: "map" }>) => (
    <div className="space-y-6">
      <PlaceLayerSection
        layer={l}
        value={(layerValues[l.id] as MapLayerValue | undefined) ?? null}
        heading={null}
      />
      <div className="pt-4 border-t">
        <MapStyleLayerSection
          config={config}
          layer={l}
          value={(layerValues[l.id] as MapLayerValue | undefined) ?? null}
          heading={null}
        />
      </div>
      <div className="pt-4 border-t">
        <MapIconsSection layerId={l.id} />
      </div>
    </div>
  );

  if (layers.length === 1) {
    return renderForLayer(activeLayer);
  }

  return (
    <div className="space-y-4">
      <Tabs value={activeId} onValueChange={setActiveId}>
        <TabsList className="w-full justify-start overflow-x-auto">
          {layers.map((l, idx) => (
            <TabsTrigger key={l.id} value={l.id} className="text-xs">
              {l.name || t("map.tab", { n: idx + 1 })}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {renderForLayer(activeLayer)}
    </div>
  );
}

// ---------------- photo layers (Tabs when >1) ----------------

function PhotoLayersControls({
  photoLayers,
  layerValues,
  photoSources,
  aiStyles,
}: {
  photoLayers: Array<Extract<TemplateLayer, { type: "photo" }>>;
  layerValues: Record<string, unknown>;
  photoSources: Record<string, { file: File; previewUrl: string } | undefined>;
  aiStyles: Array<{ id: string; label: string; thumbnailUrl?: string; prompt: string; enabled?: boolean }>;
}) {
  const { t } = useTranslation();
  const [activeId, setActiveId] = useState<string>(photoLayers[0]?.id ?? "");

  useEffect(() => {
    if (!photoLayers.some((l) => l.id === activeId)) {
      setActiveId(photoLayers[0]?.id ?? "");
    }
  }, [photoLayers, activeId]);

  if (photoLayers.length === 0) return null;

  const renderForLayer = (l: Extract<TemplateLayer, { type: "photo" }>) => {
    const showShape = !l.locks.shape || !l.locks.size || !l.locks.move;
    const hasUpload = !!photoSources[l.id];
    const showAi = hasUpload && aiStyles.length > 0;
    return (
      <div className="space-y-4">
        <PhotoUploadSection layerId={l.id} />
        {showShape && (
          <div className="pt-4 border-t">
            <PhotoShapeSection
              layer={l}
              value={(layerValues[l.id] as PhotoLayerValue | undefined) ?? null}
              heading={null}
            />
          </div>
        )}
        {showAi && (
          <div className="pt-4 border-t space-y-2">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              {t("section.aiStyle")}
            </Label>
            <AiStyleSection presets={aiStyles as any} layerId={l.id} />
          </div>
        )}
      </div>
    );
  };

  if (photoLayers.length === 1) {
    return renderForLayer(photoLayers[0]!);
  }

  const activeLayer = photoLayers.find((l) => l.id === activeId) ?? photoLayers[0]!;
  return (
    <div className="space-y-4">
      <Tabs value={activeId} onValueChange={setActiveId}>
        <TabsList className="w-full justify-start overflow-x-auto">
          {photoLayers.map((l, idx) => {
            const hasUpload = !!photoSources[l.id];
            return (
              <TabsTrigger key={l.id} value={l.id} className="text-xs gap-1.5">
                {l.name || t("layer.imageTab", { n: idx + 1 })}
                {hasUpload && (
                  <span
                    aria-hidden
                    className="inline-block w-1.5 h-1.5 rounded-full bg-primary"
                  />
                )}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>
      {renderForLayer(activeLayer)}
    </div>
  );
}

// ---------------- per-layer sub-sections ----------------

function PlaceLayerSection({
  layer,
  value,
  heading,
}: {
  layer: Extract<TemplateLayer, { type: "map" }>;
  value: MapLayerValue | null;
  heading: string | null;
}) {
  const { t } = useTranslation();
  const applyPlaceToLayer = useEditorStore((s) => s.applyPlaceToLayer);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    const t = setTimeout(async () => {
      const r = await geocode(q);
      setResults(r);
      setSearching(false);
    }, 300);
    return () => {
      clearTimeout(t);
      setSearching(false);
    };
  }, [query]);

  const onPick = (r: GeocodeResult) => {
    applyPlaceToLayer(layer.id, {
      placeName: r.place_name,
      center: r.center,
      city: r.city,
      country: r.country,
    });
    setResults([]);
    setQuery("");
  };

  const placeName = value?.placeName || "—";

  return (
    <div className="space-y-3">
      {heading && (
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-foreground">
          {heading}
        </h4>
      )}
      <div className="space-y-1">
        <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">{t("map.selectedPlace")}</Label>
        <p className="text-sm font-medium font-serif-display">{placeName}</p>
      </div>
      <div className="space-y-2">
        <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
          {t("map.searchAddress")}
        </Label>
        <Popover open={results.length > 0}>
          <PopoverTrigger asChild>
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("map.searchPlaceholder")}
                className="pl-10 pr-10 h-12 rounded-full bg-background shadow-inner"
              />
              {searching && (
                <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
              )}
            </div>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            sideOffset={6}
            onOpenAutoFocus={(e) => e.preventDefault()}
            className="p-0 w-[var(--radix-popover-trigger-width)] z-[60] rounded-2xl overflow-hidden"
          >
            <div className="max-h-[14rem] overflow-y-auto divide-y">
              {results.slice(0, 4).map((r, i) => (
                <button
                  key={i}
                  onClick={() => onPick(r)}
                  className="block w-full text-left px-4 py-2 text-sm hover:bg-accent transition h-[3.5rem] leading-tight"
                >
                  {r.place_name}
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      </div>
      <p className="text-[11px] text-muted-foreground">
        {t("map.tipDrag")}
      </p>
      <LayerTransformControls layer={layer} />
    </div>
  );
}

function StarmapSection({
  layer,
  value,
}: {
  layer: Extract<TemplateLayer, { type: "starmap" }>;
  value: StarmapLayerValue | null;
}) {
  const { t } = useTranslation();
  const applyPlaceToLayer = useEditorStore((s) => s.applyPlaceToLayer);
  const patchStarmapLayer = useEditorStore((s) => s.patchStarmapLayer);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      const r = await geocode(q);
      setResults(r);
      setSearching(false);
    }, 300);
    return () => {
      clearTimeout(timer);
      setSearching(false);
    };
  }, [query]);

  const onPick = (r: GeocodeResult) => {
    applyPlaceToLayer(layer.id, {
      placeName: r.place_name,
      center: r.center,
      city: r.city,
      country: r.country,
    });
    setResults([]);
    setQuery("");
  };

  const dateISO = value?.dateISO ?? layer.defaults.dateISO;
  const timeHHMM = value?.timeHHMM ?? layer.defaults.timeHHMM ?? "22:00";
  const showConstellations = value?.showConstellations ?? layer.defaults.showConstellations;
  const showGrid = value?.showGrid ?? layer.defaults.showGrid;
  const placeName = value?.placeName || layer.defaults.placeName || "—";

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">{t("map.selectedPlace")}</Label>
        <p className="text-sm font-medium font-serif-display">{placeName}</p>
      </div>
      <div className="space-y-2">
        <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
          {t("map.searchAddress")}
        </Label>
        <Popover open={results.length > 0}>
          <PopoverTrigger asChild>
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("map.searchPlaceholder")}
                className="pl-10 pr-10 h-12 rounded-full bg-background shadow-inner"
              />
              {searching && (
                <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
              )}
            </div>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            sideOffset={6}
            onOpenAutoFocus={(e) => e.preventDefault()}
            className="p-0 w-[var(--radix-popover-trigger-width)] z-[60] rounded-2xl overflow-hidden"
          >
            <div className="max-h-[14rem] overflow-y-auto divide-y">
              {results.slice(0, 4).map((r, i) => (
                <button
                  key={i}
                  onClick={() => onPick(r)}
                  className="block w-full text-left px-4 py-2 text-sm hover:bg-accent transition h-[3.5rem] leading-tight"
                >
                  {r.place_name}
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
            {t("starmap.date")}
          </Label>
          <Input
            type="date"
            value={dateISO}
            onChange={(e) => {
              if (e.target.value) patchStarmapLayer(layer.id, { dateISO: e.target.value });
            }}
            className="h-11 rounded-xl bg-background"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
            {t("starmap.time")}
          </Label>
          <Input
            type="time"
            value={timeHHMM}
            onChange={(e) => {
              if (e.target.value) patchStarmapLayer(layer.id, { timeHHMM: e.target.value });
            }}
            className="h-11 rounded-xl bg-background"
          />
        </div>
      </div>
      <div className="flex items-center justify-between">
        <Label className="text-sm">{t("starmap.constellations")}</Label>
        <Switch
          checked={showConstellations}
          onCheckedChange={(v) => patchStarmapLayer(layer.id, { showConstellations: v })}
        />
      </div>
      <div className="flex items-center justify-between">
        <Label className="text-sm">{t("starmap.grid")}</Label>
        <Switch
          checked={showGrid}
          onCheckedChange={(v) => patchStarmapLayer(layer.id, { showGrid: v })}
        />
      </div>
      <p className="text-[11px] text-muted-foreground">{t("starmap.tip")}</p>
    </div>
  );
}

function MapStyleLayerSection({
  config,
  layer,
  value,
  heading,
}: {
  config: ProductConfig;
  layer: Extract<TemplateLayer, { type: "map" }>;
  value: MapLayerValue | null;
  heading: string | null;
}) {
  const { t } = useTranslation();
  const setLayerMapStyle = useEditorStore((s) => s.setLayerMapStyle);
  const setLayerShowLabels = useEditorStore((s) => s.setLayerShowLabels);
  const setLayerMapShape = useEditorStore((s) => s.setLayerMapShape);
  const productOptions = useEditorStore((s) => s.productOptions);
  const styleId = value?.styleId ?? layer.defaults.styleId;
  const showLabels = value?.showLabels ?? layer.defaults.showLabels;
  const shape = value?.shape ?? layer.defaults.shape;

  // Per-template enabled list (Alt B), with legacy fallback.
  const enabledStyleIds = getEnabledMapStyleIds(
    productOptions ? { productOptions } : null,
    config.map_styles,
  );

  const shapeOptions = ([
    { id: "rect", label: t("shape.none"), Icon: Square },
    { id: "circle", label: t("shape.circle"), Icon: Circle },
    { id: "heart", label: t("shape.heart"), Icon: Heart },
    { id: "star", label: t("shape.star"), Icon: Star },
  ] as const);

  return (
    <div className="space-y-3">
      {heading && (
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-foreground">
          {heading}
        </h4>
      )}
      {!layer.locks.style && (
        <div className="grid grid-cols-3 gap-2">
          {enabledStyleIds.map((s) => {
            const thumb = mapStyleThumbnailUrl(s);
            const labelKey = mapStyleLabelKey(s);
            const label = labelKey ? t(labelKey, { defaultValue: mapStyleLabel(s) }) : mapStyleLabel(s);
            return (
              <button
                key={s}
                onClick={() => setLayerMapStyle(layer.id, s)}
                className={cn(
                  "relative aspect-square rounded-xl overflow-hidden transition hover:-translate-y-0.5",
                  s === styleId ? "ring-2 ring-primary" : "ring-1 ring-border",
                )}
              >
                {thumb ? (
                  <img
                    src={thumb}
                    alt={label}
                    className="absolute inset-0 w-full h-full object-cover"
                    loading="lazy"
                    draggable={false}
                  />
                ) : (
                  <div className="absolute inset-0" style={{ background: mapStylePreviewBg(s) }} />
                )}
                <span className="absolute bottom-0 left-0 right-0 bg-background/85 backdrop-blur-sm text-[10px] py-1 font-medium">
                  {label}
                </span>
              </button>
            );
          })}
        </div>
      )}
      {!layer.locks.style && (
        <div className="flex items-center justify-between pt-2">
          <Label className="text-xs text-foreground">{t("map.showLabels")}</Label>
          <Switch checked={showLabels} onCheckedChange={(v) => setLayerShowLabels(layer.id, v)} />
        </div>
      )}
      {!layer.locks.shape && (
        <div className="space-y-2 pt-1">
          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">{t("shape.mapShape")}</Label>
          <div className="grid grid-cols-3 gap-2">
            {shapeOptions.map(({ id, label, Icon }) => {
              const selected = shape === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setLayerMapShape(layer.id, id)}
                  className={cn(
                    "flex flex-col items-center justify-center gap-1.5 aspect-square rounded-xl transition",
                    selected
                      ? "bg-primary text-primary-foreground"
                      : "bg-background ring-1 ring-border hover:bg-accent/50",
                  )}
                >
                  <Icon className="h-6 w-6" />
                  <span className="text-[10px] font-medium">{label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function TextLayerSection({
  config,
  layer,
  value,
  linkedMap,
  heading,
}: {
  config: ProductConfig;
  layer: Extract<TemplateLayer, { type: "text" }>;
  value: TextLayerValue | null;
  linkedMap: MapLayerValue | StarmapLayerValue | null;
  heading: string | null;
}) {
  const { t } = useTranslation();
  const setLayerText = useEditorStore((s) => s.setLayerText);
  const setLayerTextFont = useEditorStore((s) => s.setLayerTextFont);
  const setLayerTextFontSizePt = useEditorStore((s) => s.setLayerTextFontSizePt);
  const setLayerTextVisible = useEditorStore((s) => s.setLayerTextVisible);
  const productOptions = useEditorStore((s) => s.productOptions);
  const isFreeform = !!config.is_freeform;
  const PT_OPTIONS = [8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 42, 48, 56, 64, 72, 80, 96, 120, 144];
  const effectivePt = Math.round(value?.fontSizePt ?? layer.defaults.fontSizePt ?? 24);
  const ptOptions = PT_OPTIONS.includes(effectivePt)
    ? PT_OPTIONS
    : [...PT_OPTIONS, effectivePt].sort((a, b) => a - b);

  const linked = !!layer.defaults.linkedMapLayerId;
  const place = linkedMap
    ? {
        placeName: linkedMap.placeName,
        city: linkedMap.city ?? null,
        country: linkedMap.country ?? null,
        center: linkedMap.center,
        // [[date]]-token löses bara när källan är ett starmap-lager.
        dateISO: linkedMap.kind === "starmap" ? linkedMap.dateISO : undefined,
      }
    : null;
  // Auto-text built from the linked map (or defaults when not linked).
  const autoText = linked
    ? substituteTokens(layer.defaults, place)
    : layer.defaults.text;
  // Customer override wins over auto-text. When override is null, the field
  // shows (and reverts to) auto-text. A kartuppdatering clears override in
  // the store, so the textarea immediately reflects the new auto-text.
  const committedText = value?.overrideText ?? autoText;

  // Local edit buffer used only WHILE the textarea is focused, so React
  // doesn't yank the caret if the store re-renders between keystrokes.
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft !== null ? draft : committedText;

  const font = value?.font ?? layer.defaults.font;
  const visible = value?.visible ?? true;
  const allowedFonts =
    productOptions?.allowedFonts && productOptions.allowedFonts.length > 0
      ? productOptions.allowedFonts
      : FONT_FAMILIES;

  return (
    <div className="space-y-3">
      {heading && (
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-foreground">
          {heading}
        </h4>
      )}
      {!layer.locks.visibility && (
        <div className="flex items-center justify-between">
          <Label className="text-xs text-foreground">{t("text.show")}</Label>
          <Switch checked={visible} onCheckedChange={(v) => setLayerTextVisible(layer.id, v)} />
        </div>
      )}
      {!layer.locks.content && (
        <>
          <Textarea
            value={text}
            onFocus={() => setDraft(committedText)}
            onChange={(e) => {
              setDraft(e.target.value);
              setLayerText(layer.id, e.target.value);
            }}
            onBlur={() => setDraft(null)}
            placeholder={t("text.placeholder")}
            maxLength={
              linked
                ? Math.max(config.text_config.maxChars, autoText.length + 120)
                : config.text_config.maxChars
            }
            rows={3}
            className="rounded-xl"
          />
          {linked && (
            <p className="text-[11px] text-muted-foreground -mt-1 px-1">
              {t("text.autoHint")}
            </p>
          )}
        </>
      )}
      {!layer.locks.font && (
        <div className="space-y-2">
          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">{t("text.font")}</Label>
          <div className="grid grid-cols-3 gap-2">
            {allowedFonts.map((f) => (
              <Button
                key={f}
                size="sm"
                variant={f === font ? "default" : "outline"}
                onClick={() => setLayerTextFont(layer.id, f)}
                style={{ fontFamily: `"${f}", system-ui, sans-serif` }}
                className="text-xs rounded-full"
              >
                {f.split(" ")[0]}
              </Button>
            ))}
          </div>
        </div>
      )}
      {isFreeform ? (
        <div className="space-y-2">
          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
            {t("text.fontSize")}
          </Label>
          <Select
            value={String(effectivePt)}
            onValueChange={(v) => setLayerTextFontSizePt(layer.id, Number(v))}
          >
            <SelectTrigger className="rounded-xl">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ptOptions.map((pt) => (
                <SelectItem key={pt} value={String(pt)}>
                  {pt} pt
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : (
        <LayerTransformControls layer={layer} />
      )}
    </div>
  );
}

function PhotoShapeSection({
  layer,
  value,
  heading,
}: {
  layer: Extract<TemplateLayer, { type: "photo" }>;
  value: PhotoLayerValue | null;
  heading: string | null;
}) {
  const { t } = useTranslation();
  const setLayerPhotoShape = useEditorStore((s) => s.setLayerPhotoShape);
  const shape = value?.shape ?? layer.defaults.shape;
  const options = [
    { id: "rect", label: t("shape.none"), Icon: Square },
    { id: "circle", label: t("shape.circle"), Icon: Circle },
    { id: "heart", label: t("shape.heart"), Icon: Heart },
    { id: "star", label: t("shape.star"), Icon: Star },
  ] as const;

  return (
    <div className="space-y-2">
      {heading && (
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-foreground">
          {heading}
        </h4>
      )}
      {!layer.locks.shape && (
        <>
          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
            {t("shape.imageShape")}
          </Label>
          <div className="grid grid-cols-4 gap-2">
            {options.map(({ id, label, Icon }) => {
              const selected = shape === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setLayerPhotoShape(layer.id, id as PhotoShape)}
                  className={cn(
                    "flex flex-col items-center justify-center gap-1.5 aspect-square rounded-xl transition",
                    selected
                      ? "bg-primary text-primary-foreground"
                      : "bg-background ring-1 ring-border hover:bg-accent/50",
                  )}
                >
                  <Icon className="h-5 w-5" />
                  <span className="text-[10px] font-medium">{label}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
      <LayerTransformControls layer={layer} />
    </div>
  );
}

// ---------------- map icons picker ----------------

function MapIconsSection({ layerId }: { layerId: string }) {
  const { t } = useTranslation();
  const activeIconTool = useEditorStore((s) => s.activeIconTool);
  const setActiveIconTool = useEditorStore((s) => s.setActiveIconTool);
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);



  const labelFor = (id: string, fallback: string) =>
    t(`mapIcon.${id}`, { defaultValue: fallback });

  const filtered = MAP_ICONS.filter((i) => {
    const label = labelFor(i.id, i.fallbackLabel).toLowerCase();
    return label.includes(query.trim().toLowerCase());
  });
  const visible = showAll || query ? filtered : filtered.slice(0, MAP_ICON_INITIAL_COUNT);

  return (
    <div className="space-y-3" data-layer-id={layerId}>
      <div className="space-y-1">
        <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
          {t("mapIcons.heading", { defaultValue: "Ikoner" })}
        </Label>
        <p className="text-xs text-muted-foreground">
          {t("mapIcons.subheading", { defaultValue: "Lägg till ikoner på kartan" })}
        </p>
      </div>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("mapIcons.search", { defaultValue: "Sök ikon" })}
          className="pl-8 h-9 text-sm"
        />
      </div>
      <div className="grid grid-cols-4 gap-2">
        {visible.map((def) => {
          const isActive = activeIconTool?.iconId === def.id;
          const label = labelFor(def.id, def.fallbackLabel);
          return (
            <button
              key={def.id}
              type="button"
              onClick={() => setActiveIconTool(isActive ? null : { iconId: def.id })}
              className={cn(
                "flex flex-col items-center justify-center gap-1 aspect-square rounded-xl transition p-1.5",
                isActive
                  ? "bg-primary/10 ring-2 ring-primary"
                  : "bg-background ring-1 ring-border hover:bg-accent/50",
              )}
              title={label}
              aria-label={label}
              aria-pressed={isActive}
            >
              <svg
                width={22}
                height={22}
                viewBox="0 0 24 24"
                fill="currentColor"
                stroke="none"
                aria-hidden
              >
                {getMapIcon(def.id)?.iconNode.map(([tag, attrs], i) => {
                  const props = { key: i, ...(attrs as Record<string, unknown>) } as Record<string, unknown>;
                  if (tag === "path") return <path {...props} />;
                  if (tag === "circle") return <circle {...props} />;
                  if (tag === "rect") return <rect {...props} />;
                  if (tag === "line") return <line {...props} />;
                  return null;
                })}
              </svg>
              <span className="text-[10px] leading-tight text-center line-clamp-1">{label}</span>
            </button>
          );
        })}
      </div>
      {!query && filtered.length > MAP_ICON_INITIAL_COUNT && (
        <Button
          variant="ghost"
          size="sm"
          className="w-full text-xs"
          onClick={() => setShowAll((s) => !s)}
        >
          {showAll
            ? t("mapIcons.showLess", { defaultValue: "Visa färre ikoner" })
            : t("mapIcons.showMore", { defaultValue: "Visa fler ikoner" })}
        </Button>
      )}
      {activeIconTool && (
        <p className="text-[11px] text-muted-foreground">
          {t("mapIcons.addToMap", { defaultValue: "Klicka för att placera på kartan" })}
        </p>
      )}
    </div>
  );
}
