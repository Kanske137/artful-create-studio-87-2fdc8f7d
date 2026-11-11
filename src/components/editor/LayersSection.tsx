// "Lager"-fliken som visas i editorn när config.is_freeform === true.
// Kunden kan lägga till, dölja, ta bort och dra-ordna lager.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Image as ImageIcon,
  Sparkles,
  MapPin,
  Type,
  Square,
  Minus,
  Frame,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  GripVertical,
  Move,
  Maximize2,
  HelpCircle,
  Mountain,
  Timer,
  type LucideIcon,
} from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useEditorStore } from "@/stores/editorStore";
import type { TemplateLayer, ShapeKind } from "@/lib/template-schema";
import { isCustomLayerId, type FreeformLayerType } from "@/lib/freeform-layers";
import { LayerQuickSettings } from "./LayerQuickSettings";


const TYPE_META: Record<
  FreeformLayerType,
  { icon: LucideIcon; labelKey: string }
> = {
  photo: { icon: ImageIcon, labelKey: "layers.addPhoto" },
  map: { icon: MapPin, labelKey: "layers.addMap" },
  text: { icon: Type, labelKey: "layers.addText" },
  shape: { icon: Frame, labelKey: "layers.addShape" },
  line: { icon: Minus, labelKey: "layers.addLine" },
  margin: { icon: Square, labelKey: "layers.addMargin" },
};

const ADD_ORDER: FreeformLayerType[] = [
  "photo",
  "map",
  "text",
  "shape",
  "line",
  "margin",
];


const LAYER_TYPE_ICON: Record<TemplateLayer["type"], LucideIcon> = {
  map: MapPin,
  text: Type,
  photo: ImageIcon,
  aiPhoto: Sparkles,
  shape: Frame,
  line: Minus,
  margin: Square,
  image: ImageIcon,
  starmap: Sparkles,
  elevation: Mountain,
  raceStats: Timer,
  splits: Timer,
};

const MAX_LAYERS = 12;
const ONBOARDING_KEY = "freeform-onboarding-seen";

interface RowProps {
  layer: TemplateLayer;
  hidden: boolean;
  onToggleVisible: () => void;
  onDelete: () => void;
  isCustom: boolean;
  t: (k: string) => string;
}

function SortableLayerRow({
  layer,
  hidden,
  onToggleVisible,
  onDelete,
  isCustom,
  t,
}: RowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: layer.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  const Icon = LAYER_TYPE_ICON[layer.type];
  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-1.5 p-2 rounded-lg border bg-background",
        hidden && "opacity-50",
        isDragging && "shadow-lg ring-2 ring-primary/40",
      )}
    >
      <button
        type="button"
        className="touch-none p-1 -ml-1 cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground"
        aria-label={t("layers.dragHandle")}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="flex-1 text-sm truncate">{layer.name}</span>
      {isCustom && (layer.type === "shape" || layer.type === "line") && (
        <LayerQuickSettings layer={layer} />
      )}
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="h-7 w-7"
        onClick={onToggleVisible}
        aria-label={hidden ? t("layers.toggleVisible") : t("layers.toggleHidden")}
        title={hidden ? t("layers.toggleVisible") : t("layers.toggleHidden")}
      >
        {hidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </Button>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="h-7 w-7 text-destructive hover:text-destructive"
        disabled={!isCustom}
        onClick={onDelete}
        aria-label={t("layers.delete")}
        title={
          isCustom ? t("layers.delete") : t("layers.deleteDisabledTpl")
        }
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </li>
  );
}

export function LayersSection() {
  const { t } = useTranslation();
  // OBS: hämta FUNKTIONEN i selectorn (stabil ref) och anropa i render.
  // `useEditorStore((s) => s.templateLayers())` triggar Zustands
  // "getSnapshot should be cached"-loop → editor kraschar (vit sida).
  const templateLayers = useEditorStore((s) => s.templateLayers);
  const layers = templateLayers();
  const addCustomLayer = useEditorStore((s) => s.addCustomLayer);
  const removeCustomLayer = useEditorStore((s) => s.removeCustomLayer);
  const setLayerVisible = useEditorStore((s) => s.setLayerVisible);
  const reorderLayers = useEditorStore((s) => s.reorderLayers);
  const hiddenLayerIds = useEditorStore((s) => s.hiddenLayerIds);
  const handlesVisible = useEditorStore((s) => s.handlesVisible);
  const setHandlesVisible = useEditorStore((s) => s.setHandlesVisible);
  const [sheetOpen, setSheetOpen] = useState(false);
  type Stage = "root" | "shape" | "line";
  const [stage, setStage] = useState<Stage>("root");

  // Onboarding-popover (visas första gången kunden öppnar Lager-fliken).
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  useEffect(() => {
    try {
      if (!localStorage.getItem(ONBOARDING_KEY)) setOnboardingOpen(true);
    } catch {
      // localStorage saknas (privat-läge) → visa inte upprepat.
    }
  }, []);
  const dismissOnboarding = () => {
    setOnboardingOpen(false);
    try {
      localStorage.setItem(ONBOARDING_KEY, "1");
    } catch {
      /* noop */
    }
  };
  const reopenOnboarding = () => {
    try {
      localStorage.removeItem(ONBOARDING_KEY);
    } catch {
      /* noop */
    }
    setOnboardingOpen(true);
  };


  // dnd-kit sensors. PointerSensor med distance:5 så vanliga klick på
  // grip-knappen inte triggar drag i misstag.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Visa lager i renderingsordning (överst i listan = överst i z-stack)
  const ordered = [...layers].sort((a, b) => b.zIndex - a.zIndex);
  const orderedIds = ordered.map((l) => l.id);

  const onAdd = (
    type: FreeformLayerType,
    opts?: { shapeKind?: ShapeKind; lineOrientation?: "horizontal" | "vertical" },
  ) => {
    if (layers.length >= MAX_LAYERS) {
      toast.error(t("layers.maxReached"));
      return;
    }
    // Form/Linje öppnar ett sub-steg där kunden väljer variant innan vi
    // skapar lagret.
    if (!opts && type === "shape") {
      setStage("shape");
      return;
    }
    if (!opts && type === "line") {
      setStage("line");
      return;
    }
    const id = addCustomLayer(type, opts);
    setSheetOpen(false);
    setStage("root");
    if (id) toast.success(t("layers.added"));
  };

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = orderedIds.indexOf(String(active.id));
    const newIdx = orderedIds.indexOf(String(over.id));
    if (oldIdx === -1 || newIdx === -1) return;
    const next = arrayMove(orderedIds, oldIdx, newIdx);
    reorderLayers(next);
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("layers.intro")}</p>

      <div className="flex items-start gap-3 p-3 rounded-lg border bg-muted/30">
        <div className="flex-1 min-w-0">
          <Label htmlFor="handles-toggle" className="text-sm font-medium cursor-pointer">
            {t("layers.handlesToggle.label")}
          </Label>
          <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
            {t("layers.handlesToggle.hint")}
          </p>
        </div>
        <Switch
          id="handles-toggle"
          checked={handlesVisible}
          onCheckedChange={setHandlesVisible}
          aria-label={t("layers.handlesToggle.label")}
        />
      </div>


      <Popover open={onboardingOpen} onOpenChange={(o) => !o && dismissOnboarding()}>
        <Sheet
          open={sheetOpen}
          onOpenChange={(o) => {
            setSheetOpen(o);
            if (o) dismissOnboarding();
            else setStage("root");
          }}
        >
          <PopoverTrigger asChild>
            <SheetTrigger asChild>
              <Button className="w-full" size="lg">
                <Plus className="h-4 w-4 mr-2" />
                {t("layers.add")}
              </Button>
            </SheetTrigger>
          </PopoverTrigger>
          <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto">
            <SheetHeader>
              <SheetTitle>
                {stage === "root"
                  ? t("layers.addTitle")
                  : stage === "shape"
                  ? t("layers.shape.pickTitle")
                  : t("layers.line.pickTitle")}
              </SheetTitle>
            </SheetHeader>
            {stage === "root" && (
              <div className="grid grid-cols-2 gap-3 mt-4 pb-4">
                {ADD_ORDER.map((type) => {
                  const meta = TYPE_META[type];
                  const Icon = meta.icon;
                  return (
                    <button
                      key={type}
                      type="button"
                      onClick={() => onAdd(type)}
                      className="flex flex-col items-center justify-center gap-2 p-4 rounded-xl border bg-background hover:bg-accent transition"
                    >
                      <Icon className="h-6 w-6" />
                      <span className="text-sm font-medium">{t(meta.labelKey)}</span>
                    </button>
                  );
                })}
              </div>
            )}
            {stage === "shape" && (
              <div className="grid grid-cols-2 gap-3 mt-4 pb-4">
                {(
                  [
                    { kind: "frame-rect", labelKey: "layers.shape.rect" },
                    { kind: "frame-oval", labelKey: "layers.shape.oval" },
                    { kind: "frame-rounded", labelKey: "layers.shape.rounded" },
                    { kind: "frame-double", labelKey: "layers.shape.double" },
                    { kind: "frame-corners", labelKey: "layers.shape.corners" },
                  ] as { kind: ShapeKind; labelKey: string }[]
                ).map(({ kind, labelKey }) => (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => onAdd("shape", { shapeKind: kind })}
                    className="flex flex-col items-center justify-center gap-2 p-4 rounded-xl border bg-background hover:bg-accent transition"
                  >
                    <Frame className="h-6 w-6" />
                    <span className="text-sm font-medium">{t(labelKey)}</span>
                  </button>
                ))}
                <Button variant="ghost" onClick={() => setStage("root")} className="col-span-2">
                  ←
                </Button>
              </div>
            )}
            {stage === "line" && (
              <div className="grid grid-cols-2 gap-3 mt-4 pb-4">
                {(["horizontal", "vertical"] as const).map((o) => (
                  <button
                    key={o}
                    type="button"
                    onClick={() => onAdd("line", { lineOrientation: o })}
                    className="flex flex-col items-center justify-center gap-2 p-6 rounded-xl border bg-background hover:bg-accent transition"
                  >
                    {o === "horizontal" ? (
                      <div className="w-12 h-0.5 bg-current" />
                    ) : (
                      <div className="w-0.5 h-12 bg-current" />
                    )}
                    <span className="text-sm font-medium">{t(`layers.line.${o}`)}</span>
                  </button>
                ))}
                <Button variant="ghost" onClick={() => setStage("root")} className="col-span-2">
                  ←
                </Button>
              </div>
            )}
          </SheetContent>
        </Sheet>
        <PopoverContent side="bottom" align="center" className="w-80">
          <div className="space-y-3">
            <h4 className="font-semibold text-sm">{t("layers.onboarding.title")}</h4>
            <ol className="space-y-2.5">
              <li className="flex gap-2.5">
                <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center">
                  <Plus className="h-3.5 w-3.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold leading-tight">{t("layers.onboarding.step1Title")}</p>
                  <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">
                    {t("layers.onboarding.step1Body")}
                  </p>
                </div>
              </li>
              <li className="flex gap-2.5">
                <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center">
                  <Move className="h-3.5 w-3.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold leading-tight">{t("layers.onboarding.step2Title")}</p>
                  <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">
                    {t("layers.onboarding.step2Body")}
                  </p>
                </div>
              </li>
              <li className="flex gap-2.5">
                <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center">
                  <Maximize2 className="h-3.5 w-3.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold leading-tight">{t("layers.onboarding.step3Title")}</p>
                  <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">
                    {t("layers.onboarding.step3Body")}
                  </p>
                </div>
              </li>
              <li className="flex gap-2.5">
                <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center">
                  <Eye className="h-3.5 w-3.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold leading-tight">{t("layers.onboarding.step4Title")}</p>
                  <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">
                    {t("layers.onboarding.step4Body")}
                  </p>
                </div>
              </li>
            </ol>
            <Button size="sm" className="w-full mt-1" onClick={dismissOnboarding}>
              {t("layers.onboarding.dismiss")}
            </Button>
          </div>
        </PopoverContent>
      </Popover>


      <div className="space-y-2">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
          {t("layers.listTitle")}{" "}
          <span className="normal-case text-foreground/60">
            ({layers.length}/{MAX_LAYERS})
          </span>
        </div>
        {ordered.length === 0 ? (
          <div className="py-4 space-y-3">
            <p className="text-sm text-muted-foreground text-center">
              {t("layers.empty")}
            </p>
            <div className="grid grid-cols-3 gap-2">
              {(["photo", "map", "text"] as const).map((type) => {
                const meta = TYPE_META[type];
                const Icon = meta.icon;
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => onAdd(type)}
                    className="flex flex-col items-center gap-1.5 p-3 rounded-lg border bg-background hover:bg-accent transition"
                  >
                    <Icon className="h-5 w-5" />
                    <span className="text-xs font-medium">{t(meta.labelKey)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={orderedIds} strategy={verticalListSortingStrategy}>
              <ul className="space-y-1.5">
                {ordered.map((layer) => {
                  const isCustom = isCustomLayerId(layer.id);
                  const hidden = Boolean(hiddenLayerIds[layer.id]);
                  return (
                    <SortableLayerRow
                      key={layer.id}
                      layer={layer}
                      hidden={hidden}
                      isCustom={isCustom}
                      onToggleVisible={() => setLayerVisible(layer.id, hidden)}
                      onDelete={() => removeCustomLayer(layer.id)}
                      t={t as unknown as (k: string) => string}
                    />
                  );
                })}
              </ul>
            </SortableContext>
          </DndContext>
        )}
      </div>

      <button
        type="button"
        onClick={reopenOnboarding}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition mx-auto"
      >
        <HelpCircle className="h-3.5 w-3.5" />
        {t("layers.onboarding.showAgain")}
      </button>
    </div>
  );
}
