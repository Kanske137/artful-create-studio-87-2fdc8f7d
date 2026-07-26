// Properties panel for the currently selected layer.
//   - Edit defaults per layer-type
//   - Toggle each lock independently
//   - Edit position/size numerically (snap to 5%)
//   - Map: search a default place (geocoding) → updates center/zoom +
//     placeName/city/country, AND auto-builds text for any linked text layers.
import React, { useEffect, useRef, useState } from "react";
import { Loader2, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { ProductConfig } from "@/lib/product-config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type {
  AiPhotoSubjectKind,
  LayerLocks,
  LinkedTextToken,
  TemplateLayer,
  TextDecoration,
  TextSpan,
} from "@/lib/template-schema";
import { resolveLinkedTokens, substituteTokens, FALLBACK_PLACE } from "@/lib/text-typography";
import { geocode, type GeocodeResult } from "@/lib/mapbox";
import { applyAdminPlaceToLinkedTexts } from "@/lib/template-migrate";
import { MAP_STYLE_CATALOG } from "@/lib/map-style-catalog";
import { defaultPromptFor } from "@/lib/ai-photo-prompts";
import { uploadAiReferenceImage } from "@/lib/ai-reference-upload";
import { FONT_CATALOG, FONT_CATEGORY_LABELS, type FontCategory } from "@/lib/font-catalog";
import MultiFaceInspector from "./MultiFaceInspector";

interface Props {
  config: ProductConfig;
  layer: TemplateLayer | null;
  allLayers: TemplateLayer[];
  onChange: (next: TemplateLayer) => void;
  /** Bulk replacement (used when picking a default place updates linked texts). */
  onLayersChange?: (next: TemplateLayer[]) => void;
}

const LOCK_LABELS: Array<{ key: keyof LayerLocks; label: string }> = [
  { key: "position", label: "Position (karta pan/zoom)" },
  { key: "move", label: "Förflytta lager" },
  { key: "size", label: "Storlek" },
  { key: "shape", label: "Form" },
  { key: "content", label: "Innehåll" },
  { key: "font", label: "Typsnitt" },
  { key: "visibility", label: "Synlighet" },
  { key: "style", label: "Stil" },
];

export default function LayerInspector({ config, layer, allLayers, onChange, onLayersChange }: Props) {
  if (!layer) {
    return (
      <p className="text-xs text-muted-foreground py-4 text-center">
        Välj ett lager för att redigera dess inställningar.
      </p>
    );
  }

  function updateDefaults<T extends TemplateLayer>(patch: Partial<T["defaults"]>) {
    onChange({
      ...layer,
      defaults: { ...layer!.defaults, ...patch },
    } as TemplateLayer);
  }

  function updateLock(key: keyof LayerLocks, value: boolean) {
    onChange({ ...layer!, locks: { ...layer!.locks, [key]: value } });
  }

  return (
    <div className="space-y-5">
      {/* Name */}
      <Field label="Namn">
        <Input
          value={layer.name}
          onChange={(e) => onChange({ ...layer, name: e.target.value })}
        />
      </Field>

      {/* Position + size */}
      <div className="grid grid-cols-2 gap-3">
        <Field label="X (%)">
          <Input
            type="number"
            value={layer.xPct}
            min={0}
            max={100}
            step={5}
            onChange={(e) => onChange({ ...layer, xPct: Number(e.target.value) })}
          />
        </Field>
        <Field label="Y (%)">
          <Input
            type="number"
            value={layer.yPct}
            min={0}
            max={100}
            step={5}
            onChange={(e) => onChange({ ...layer, yPct: Number(e.target.value) })}
          />
        </Field>
        <Field label="Bredd (%)">
          <Input
            type="number"
            value={layer.wPct}
            min={1}
            max={100}
            step={5}
            onChange={(e) => onChange({ ...layer, wPct: Number(e.target.value) })}
          />
        </Field>
        <Field label="Höjd (%)">
          <Input
            type="number"
            value={layer.hPct}
            min={1}
            max={100}
            step={5}
            onChange={(e) => onChange({ ...layer, hPct: Number(e.target.value) })}
          />
        </Field>
      </div>

      {/* Type-specific defaults */}
      {layer.type === "map" && (
        <div className="space-y-3 border-t pt-4">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Karta — defaults
          </p>

          <DefaultPlaceSearch
            current={layer.defaults.placeName}
            onPick={(r) => {
              const mapId = layer.id;
              const nextMap: TemplateLayer = {
                ...layer,
                defaults: {
                  ...layer.defaults,
                  center: r.center,
                  placeName: r.place_name,
                  city: r.city,
                  country: r.country,
                },
              };
              if (onLayersChange) {
                const replaced = allLayers.map((l) => (l.id === mapId ? nextMap : l));
                const propagated = applyAdminPlaceToLinkedTexts(replaced, mapId, {
                  placeName: r.place_name,
                  city: r.city,
                  country: r.country,
                  center: r.center,
                });
                onLayersChange(propagated);
              } else {
                onChange(nextMap);
              }
            }}
          />

          <Field label="Form">
            <Select
              value={layer.defaults.shape}
              onValueChange={(v) => updateDefaults({ shape: v as typeof layer.defaults.shape })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="rect">Fyll lager (rektangel)</SelectItem>
                <SelectItem value="circle">Cirkel</SelectItem>
                <SelectItem value="heart">Hjärta</SelectItem>
                <SelectItem value="star">Stjärna</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Kartstil">
            <Select
              value={layer.defaults.styleId}
              onValueChange={(v) => updateDefaults({ styleId: v })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {MAP_STYLE_CATALOG.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Lng">
              <Input
                type="number"
                step="0.0001"
                value={layer.defaults.center[0]}
                onChange={(e) =>
                  updateDefaults({ center: [Number(e.target.value), layer.defaults.center[1]] })
                }
              />
            </Field>
            <Field label="Lat">
              <Input
                type="number"
                step="0.0001"
                value={layer.defaults.center[1]}
                onChange={(e) =>
                  updateDefaults({ center: [layer.defaults.center[0], Number(e.target.value)] })
                }
              />
            </Field>
          </div>
          <Field label="Zoom">
            <Input
              type="number"
              step="0.5"
              min={0}
              max={22}
              value={layer.defaults.zoom}
              onChange={(e) => updateDefaults({ zoom: Number(e.target.value) })}
            />
          </Field>
          <div className="flex items-center justify-between">
            <Label className="text-sm">Visa labels</Label>
            <Switch
              checked={layer.defaults.showLabels}
              onCheckedChange={(c) => updateDefaults({ showLabels: c })}
            />
          </div>
        </div>
      )}

      {layer.type === "starmap" && (
        <div className="space-y-3 border-t pt-4">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Stjärnhimmel — defaults
          </p>

          <DefaultPlaceSearch
            current={layer.defaults.placeName}
            onPick={(r) => {
              const starId = layer.id;
              const nextStar: TemplateLayer = {
                ...layer,
                defaults: {
                  ...layer.defaults,
                  center: r.center,
                  placeName: r.place_name,
                },
              };
              if (onLayersChange) {
                const replaced = allLayers.map((l) => (l.id === starId ? nextStar : l));
                const propagated = applyAdminPlaceToLinkedTexts(replaced, starId, {
                  placeName: r.place_name,
                  city: r.city,
                  country: r.country,
                  center: r.center,
                });
                onLayersChange(propagated);
              } else {
                onChange(nextStar);
              }
            }}
          />

          <div className="grid grid-cols-2 gap-3">
            <Field label="Datum">
              <Input
                type="date"
                value={layer.defaults.dateISO}
                onChange={(e) => e.target.value && updateDefaults({ dateISO: e.target.value })}
              />
            </Field>
            <Field label="Klockslag">
              <Input
                type="time"
                value={layer.defaults.timeHHMM ?? "22:00"}
                onChange={(e) => e.target.value && updateDefaults({ timeHHMM: e.target.value })}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Lng">
              <Input
                type="number"
                step="0.0001"
                value={layer.defaults.center[0]}
                onChange={(e) =>
                  updateDefaults({ center: [Number(e.target.value), layer.defaults.center[1]] })
                }
              />
            </Field>
            <Field label="Lat">
              <Input
                type="number"
                step="0.0001"
                value={layer.defaults.center[1]}
                onChange={(e) =>
                  updateDefaults({ center: [layer.defaults.center[0], Number(e.target.value)] })
                }
              />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Himmel">
              <Input
                type="color"
                value={layer.defaults.bgColor}
                onChange={(e) => updateDefaults({ bgColor: e.target.value })}
              />
            </Field>
            <Field label="Stjärnor">
              <Input
                type="color"
                value={layer.defaults.starColor}
                onChange={(e) => updateDefaults({ starColor: e.target.value })}
              />
            </Field>
            <Field label="Linjer">
              <Input
                type="color"
                value={layer.defaults.lineColor}
                onChange={(e) => updateDefaults({ lineColor: e.target.value })}
              />
            </Field>
          </div>
          <div className="flex items-center justify-between">
            <Label className="text-sm">Stjärnbildslinjer</Label>
            <Switch
              checked={layer.defaults.showConstellations}
              onCheckedChange={(c) => updateDefaults({ showConstellations: c })}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label className="text-sm">Gradnät</Label>
            <Switch
              checked={layer.defaults.showGrid}
              onCheckedChange={(c) => updateDefaults({ showGrid: c })}
            />
          </div>
          <Field label="Magnitudgräns (2–6.5, högre = fler stjärnor)">
            <Input
              type="number"
              step="0.1"
              min={2}
              max={6.5}
              value={layer.defaults.magLimit ?? 5.8}
              onChange={(e) => updateDefaults({ magLimit: Number(e.target.value) })}
            />
          </Field>
        </div>
      )}

      {layer.type === "text" && (
        <TextLayerDefaults
          layer={layer}
          allLayers={allLayers}
          updateDefaults={updateDefaults}
        />
      )}

      {layer.type === "photo" && (
        <div className="space-y-3 border-t pt-4">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Foto — defaults
          </p>
          <Field label="Form">
            <Select
              value={layer.defaults.shape}
              onValueChange={(v) => updateDefaults({ shape: v as typeof layer.defaults.shape })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="rect">Rektangel</SelectItem>
                <SelectItem value="circle">Cirkel</SelectItem>
                <SelectItem value="heart">Hjärta</SelectItem>
                <SelectItem value="star">Stjärna</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Anpassning">
            <Select
              value={layer.defaults.fit}
              onValueChange={(v) => updateDefaults({ fit: v as typeof layer.defaults.fit })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cover">Fyll (cover)</SelectItem>
                <SelectItem value="contain">Inrymd (contain)</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Placeholder-bild (URL, valfri)">
            <Input
              value={layer.defaults.placeholderUrl ?? ""}
              placeholder="https://…"
              onChange={(e) =>
                updateDefaults({
                  placeholderUrl: e.target.value.trim() ? e.target.value.trim() : undefined,
                })
              }
            />
          </Field>
          <p className="text-[11px] text-muted-foreground -mt-1">
            Visas i admin-canvas + kund-editor när inget kund-foto finns ännu.
          </p>
        </div>
      )}

      {layer.type === "aiPhoto" && (
        <AiPhotoDefaultsSection layer={layer} onChange={onChange} />
      )}

      {layer.type === "margin" && (
        <div className="space-y-3 border-t pt-4">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Marginal — defaults
          </p>
          <p className="text-[11px] text-muted-foreground">
            Symmetrisk marginal runt hela motivet. Tjockleken är samma åt alla
            sidor oavsett orientering. Kunden kan inte ändra detta.
          </p>
          <Field label={`Tjocklek: ${layer.defaults.thicknessPct}% av kortsidan`}>
            <Input
              type="number"
              min={0}
              max={40}
              step={0.5}
              value={layer.defaults.thicknessPct}
              onChange={(e) =>
                updateDefaults({ thicknessPct: Math.max(0, Math.min(40, Number(e.target.value))) })
              }
            />
          </Field>
          <Field label="Färg">
            <Input
              type="color"
              value={layer.defaults.color}
              onChange={(e) => updateDefaults({ color: e.target.value })}
            />
          </Field>
        </div>
      )}

      {layer.type === "line" && (
        <div className="space-y-3 border-t pt-4">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Linje — defaults
          </p>
          <p className="text-[11px] text-muted-foreground">
            Position och längd styrs via X/Y/Bredd/Höjd ovan. Kunden kan inte
            ändra linjen.
          </p>
          <Field label="Orientering">
            <Select
              value={layer.defaults.orientation}
              onValueChange={(v) => {
                const nextOrientation = v as typeof layer.defaults.orientation;
                if (nextOrientation === layer.defaults.orientation) return;
                // Swap width/height so the line keeps its length when rotating,
                // and re-centre so it doesn't visually jump.
                const newW = layer.hPct;
                const newH = layer.wPct;
                const cx = layer.xPct + layer.wPct / 2;
                const cy = layer.yPct + layer.hPct / 2;
                const clamp = (n: number, min: number, max: number) =>
                  Math.max(min, Math.min(max, n));
                const newX = clamp(cx - newW / 2, 0, Math.max(0, 100 - newW));
                const newY = clamp(cy - newH / 2, 0, Math.max(0, 100 - newH));
                onChange({
                  ...layer,
                  xPct: newX,
                  yPct: newY,
                  wPct: newW,
                  hPct: newH,
                  defaults: { ...layer.defaults, orientation: nextOrientation },
                });
              }}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="horizontal">Horisontell</SelectItem>
                <SelectItem value="vertical">Vertikal</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Tjocklek (mm)">
            <Input
              type="number"
              min={0.5}
              max={20}
              step={0.5}
              value={layer.defaults.thicknessMm}
              onChange={(e) => updateDefaults({ thicknessMm: Number(e.target.value) })}
            />
          </Field>
          <Field label="Färg">
            <Input
              type="color"
              value={layer.defaults.color}
              onChange={(e) => updateDefaults({ color: e.target.value })}
            />
          </Field>
        </div>
      )}

      {layer.type === "shape" && (
        <div className="space-y-3 border-t pt-4">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Figur — defaults
          </p>
          <p className="text-[11px] text-muted-foreground">
            Admin-bara dekoration. Position och storlek styrs via X/Y/Bredd/Höjd
            ovan. Kunden kan inte ändra figuren.
          </p>
          <Field label="Form">
            <Select
              value={layer.defaults.kind}
              onValueChange={(v) => updateDefaults({ kind: v as typeof layer.defaults.kind })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="line-horizontal">Horisontell linje</SelectItem>
                <SelectItem value="line-vertical">Vertikal linje</SelectItem>
                <SelectItem value="frame-rect">Rektangulär ram</SelectItem>
                <SelectItem value="frame-oval">Oval ram</SelectItem>
                <SelectItem value="frame-rounded">Rundad ram</SelectItem>
                <SelectItem value="frame-double">Dubbel ram</SelectItem>
                <SelectItem value="frame-corners">Hörn-dekoration</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Tjocklek (mm)">
            <Input
              type="number"
              min={0.5}
              max={20}
              step={0.5}
              value={layer.defaults.strokeMm}
              onChange={(e) => updateDefaults({ strokeMm: Number(e.target.value) })}
            />
          </Field>
          <Field label="Färg">
            <Input
              type="color"
              value={layer.defaults.color}
              onChange={(e) => updateDefaults({ color: e.target.value })}
            />
          </Field>
          {layer.defaults.kind === "frame-rounded" && (
            <Field label="Hörnradie (% av kortsida)">
              <Input
                type="number"
                min={0}
                max={50}
                step={1}
                value={layer.defaults.cornerRadiusPct ?? 5}
                onChange={(e) => updateDefaults({ cornerRadiusPct: Number(e.target.value) })}
              />
            </Field>
          )}
          {layer.defaults.kind === "frame-double" && (
            <Field label="Mellanrum (mm)">
              <Input
                type="number"
                min={0}
                max={50}
                step={0.5}
                value={layer.defaults.gapMm ?? 4}
                onChange={(e) => updateDefaults({ gapMm: Number(e.target.value) })}
              />
            </Field>
          )}
        </div>
      )}

      {/* Locks — hidden for admin-only layer types */}
      {layer.type !== "margin" && layer.type !== "line" && layer.type !== "shape" && (
        <div className="space-y-2 border-t pt-4">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Lås per egenskap
          </p>
          <p className="text-xs text-muted-foreground">
            Olåsta egenskaper kan kunden ändra i editorn.
          </p>
          <div className="grid grid-cols-2 gap-2 pt-2">
            {LOCK_LABELS.map(({ key, label }) => (
              <label key={key} className="flex items-center justify-between gap-2 text-sm">
                <span>{label}</span>
                <Switch
                  checked={layer.locks[key]}
                  onCheckedChange={(c) => updateLock(key, c)}
                />
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const Field = React.forwardRef<HTMLDivElement, { label: string; children: React.ReactNode }>(
  ({ label, children }, ref) => (
    <div ref={ref} className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  ),
);
Field.displayName = "Field";

// ---------- inline geocoding search for default place ----------
function DefaultPlaceSearch({
  current,
  onPick,
}: {
  current: string | undefined;
  onPick: (r: GeocodeResult) => void;
}) {
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

  return (
    <div className="space-y-1.5">
      <Label className="text-xs">Förvald plats</Label>
      <p className="text-[11px] text-muted-foreground -mt-1">
        Vald: <span className="font-medium text-foreground">{current || "—"}</span>
      </p>
      <Popover open={results.length > 0}>
        <PopoverTrigger asChild>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Sök stad eller adress…"
              className="pl-9 pr-9"
            />
            {searching && (
              <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
            )}
          </div>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={6}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="p-0 w-[var(--radix-popover-trigger-width)] z-[60] rounded-lg overflow-hidden"
        >
          <div className="max-h-56 overflow-y-auto divide-y">
            {results.slice(0, 5).map((r, i) => (
              <button
                key={i}
                type="button"
                onClick={() => {
                  onPick(r);
                  setQuery("");
                  setResults([]);
                }}
                className="block w-full text-left px-3 py-2 text-sm hover:bg-accent transition"
              >
                {r.place_name}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

// ---------- AI-photo (face-swap reference) defaults ----------
function AiPhotoDefaultsSection({
  layer,
  onChange,
}: {
  layer: Extract<TemplateLayer, { type: "aiPhoto" }>;
  onChange: (next: TemplateLayer) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const updateDefaults = (patch: Partial<typeof layer.defaults>) => {
    onChange({ ...layer, defaults: { ...layer.defaults, ...patch } });
  };

  const referenceImages = layer.defaults.referenceImages ?? [];

  const syncLegacy = (list: typeof referenceImages) =>
    list[0]?.url ?? undefined;

  const onFile = async (f: File | null | undefined) => {
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      toast.error("Endast bildfiler stöds");
      return;
    }
    setUploading(true);
    try {
      const url = await uploadAiReferenceImage(f);
      const id =
        (typeof crypto !== "undefined" && (crypto as { randomUUID?: () => string }).randomUUID?.()) ||
        `ref-${Date.now()}`;
      const nextList = [...referenceImages, { id, url, orientation: "any" as const }];
      updateDefaults({
        referenceImages: nextList,
        referenceImageUrl: syncLegacy(nextList),
      });
      toast.success("Referensbild uppladdad");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Okänt fel";
      toast.error("Uppladdning misslyckades", { description: msg });
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const removeReference = (id: string) => {
    const nextList = referenceImages.filter((r) => r.id !== id);
    updateDefaults({
      referenceImages: nextList,
      referenceImageUrl: syncLegacy(nextList),
    });
  };

  const setLabel = (id: string, label: string) => {
    const nextList = referenceImages.map((r) =>
      r.id === id ? { ...r, label: label || undefined } : r,
    );
    updateDefaults({ referenceImages: nextList });
  };

  const setFocal = (id: string, focalX: number, focalY: number) => {
    const nextList = referenceImages.map((r) =>
      r.id === id ? { ...r, focalX, focalY } : r,
    );
    updateDefaults({ referenceImages: nextList });
  };

  const resetFocal = (id: string) => {
    const nextList = referenceImages.map((r) =>
      r.id === id ? { ...r, focalX: 0, focalY: 0 } : r,
    );
    updateDefaults({ referenceImages: nextList });
  };

  const setOrientation = (id: string, orientation: "portrait" | "landscape" | "any") => {
    const nextList = referenceImages.map((r) =>
      r.id === id ? { ...r, orientation } : r,
    );
    updateDefaults({ referenceImages: nextList });
  };

  const isRemoveBg = layer.defaults.subjectKind === "removeBackground";

  return (
    <div className="space-y-3 border-t pt-4">
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        AI-bild — defaults
      </p>
      <p className="text-[11px] text-muted-foreground -mt-1">
        {isRemoveBg
          ? "Kunden laddar upp en bild — vi tar bort bakgrunden och lägger till en lekfull prick-/akvarell-effekt runt motivet. Kunden kan dessutom välja en av de aktiverade AI-stilarna nedanför."
          : "Kunden laddar upp ett ansikte som byts in på referensbilden via AI. Allt annat (kläder, miljö, pose) bevaras från referensbilden. Lägg till flera motiv så får kunden välja vilket de vill bli."}
      </p>

      <Field label="Motiv">
        <Select
          value={layer.defaults.subjectKind}
          onValueChange={(v) => {
            const kind = v as AiPhotoSubjectKind;
            updateDefaults({ subjectKind: kind, swapPrompt: defaultPromptFor(kind) });
          }}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="human">Människa</SelectItem>
            <SelectItem value="pet">Hund / Katt</SelectItem>
            <SelectItem value="removeBackground">Ta bort bakgrund (ingen referens)</SelectItem>
          </SelectContent>
        </Select>
      </Field>

      {!isRemoveBg && (
        <div className="space-y-2">
          <Label className="text-xs">Referensbilder ({referenceImages.length})</Label>
          {referenceImages.length === 0 && (
            <div className="rounded-lg border border-dashed bg-muted/40 px-3 py-4 text-[11px] text-muted-foreground text-center">
              Inga referensbilder uppladdade än.
            </div>
          )}
          {referenceImages.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {referenceImages.map((r) => (
                <div
                  key={r.id}
                  className="rounded-lg border bg-muted/30 p-2 space-y-2"
                >
                  <ReferenceFocalEditor
                    url={r.url}
                    label={r.label}
                    shape={layer.defaults.shape}
                    fit={layer.defaults.fit}
                    focalX={r.focalX ?? 0}
                    focalY={r.focalY ?? 0}
                    onChange={(fx, fy) => setFocal(r.id, fx, fy)}
                  />
                  <Input
                    value={r.label ?? ""}
                    onChange={(e) => setLabel(r.id, e.target.value)}
                    placeholder="Etikett (valfritt)"
                    className="h-8 text-xs"
                  />
                  <Select
                    value={r.orientation ?? "any"}
                    onValueChange={(v) =>
                      setOrientation(r.id, v as "portrait" | "landscape" | "any")
                    }
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="any">Båda orienteringar</SelectItem>
                      <SelectItem value="portrait">Endast porträtt</SelectItem>
                      <SelectItem value="landscape">Endast landskap</SelectItem>
                    </SelectContent>
                  </Select>
                  <div className="flex gap-1.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => resetFocal(r.id)}
                      className="flex-1 h-8 text-xs"
                    >
                      Återställ utsnitt
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeReference(r.id)}
                      className="flex-1 h-8 text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                      Ta bort
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
            className="w-full"
          >
            {uploading ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <Plus className="h-3.5 w-3.5 mr-1.5" />
            )}
            Lägg till referensbild
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
        </div>
      )}

      {isRemoveBg && (
        <>
          <p className="rounded-md bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
            Referensbild behövs inte. Kunden ser de AI-stilar du markerat som
            "enabled" i AI-stilar-sektionen — vald stil läggs på själva motivet
            medan bakgrunden alltid är borttagen.
          </p>
          <Field label="Bakgrundsfärg (hex)">
            <div className="flex gap-2 items-center">
              <Input
                type="color"
                value={layer.defaults.backdropColor ?? "#FFFFFF"}
                onChange={(e) =>
                  updateDefaults({ backdropColor: e.target.value.toUpperCase() })
                }
                className="h-9 w-14 p-1"
              />
              <Input
                value={layer.defaults.backdropColor ?? "#FFFFFF"}
                onChange={(e) => {
                  const v = e.target.value.trim();
                  if (/^#([0-9a-fA-F]{6})$/.test(v)) {
                    updateDefaults({ backdropColor: v.toUpperCase() });
                  }
                }}
                placeholder="#FFFFFF"
                className="h-9 text-xs flex-1"
              />
            </div>
          </Field>
          <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2">
            <div className="space-y-0.5">
              <Label className="text-xs">Fyll ramen (skala upp motivet)</Label>
              <p className="text-[10px] text-muted-foreground">
                Av = behåll kundens uppladdade position och storlek.
              </p>
            </div>
            <Switch
              checked={layer.defaults.fillFrame !== false}
              onCheckedChange={(v) => updateDefaults({ fillFrame: v })}
            />
          </div>
          <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2">
            <div className="space-y-0.5">
              <Label className="text-xs">Bevara motivets originalfärger</Label>
              <p className="text-[10px] text-muted-foreground">
                Konststilen blir då bara en ytbehandling — bilens lack/hudton ändras inte.
              </p>
            </div>
            <Switch
              checked={layer.defaults.preserveSubjectColors !== false}
              onCheckedChange={(v) => updateDefaults({ preserveSubjectColors: v })}
            />
          </div>
          <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2">
            <div className="space-y-0.5">
              <Label className="text-xs">Enkelt stil-läge (Kontext)</Label>
              <p className="text-[10px] text-muted-foreground">
                På = kör flux-kontext-pro direkt med stilens korta instruktion (geometri bevaras, bg tas bort efteråt). Av = befintligt flöde.
              </p>
            </div>
            <Switch
              checked={layer.defaults.simpleStyleMode === true}
              onCheckedChange={(v) => updateDefaults({ simpleStyleMode: v })}
            />
          </div>
        </>
      )}

      <Field label="Form">
        <Select
          value={layer.defaults.shape}
          onValueChange={(v) => updateDefaults({ shape: v as typeof layer.defaults.shape })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="rect">Rektangel</SelectItem>
            <SelectItem value="circle">Cirkel</SelectItem>
            <SelectItem value="heart">Hjärta</SelectItem>
            <SelectItem value="star">Stjärna</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <Field label="Anpassning">
        <Select
          value={layer.defaults.fit}
          onValueChange={(v) => updateDefaults({ fit: v as typeof layer.defaults.fit })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="cover">Fyll (cover)</SelectItem>
            <SelectItem value="contain">Inrymd (contain)</SelectItem>
          </SelectContent>
        </Select>
      </Field>

      <Field label={isRemoveBg ? "Stylguide för prick-effekten (valfri)" : "Prompt (skickas till AI)"}>
        <Textarea
          rows={4}
          value={layer.defaults.swapPrompt}
          onChange={(e) => updateDefaults({ swapPrompt: e.target.value })}
        />
      </Field>
      {!isRemoveBg && (
        <p className="text-[11px] text-muted-foreground -mt-2">
          Tips: referera till <code>input_image_1</code> (din referensbild =
          kostym/scen som ska behållas) och <code>input_image_2</code> (kundens
          foto = ansiktet som ska lyftas in). Var specifik om vad som ska
          bevaras (kläder, frisyr, miljö).
        </p>
      )}

      <MultiFaceInspector layer={layer} onChange={onChange} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// ReferenceFocalEditor: draggable thumb that lets the admin pick the visible
// portion of a reference image (focal point). Mirrors the cover-pan math used
// by the customer-side `PhotoLayerView` so what the admin sees matches what
// the customer/print pipeline will render. Always clamps inside the image
// bounds — focalX/Y can never push the picture off its own edges.
// ---------------------------------------------------------------------------
function ReferenceFocalEditor({
  url,
  label,
  shape,
  fit,
  focalX,
  focalY,
  onChange,
}: {
  url: string;
  label?: string;
  shape: "rect" | "circle" | "heart" | "star";
  fit: "cover" | "contain";
  focalX: number;
  focalY: number;
  onChange: (focalX: number, focalY: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    baseX: number;
    baseY: number;
    width: number;
    height: number;
  } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      setBox({ w: r.width, h: r.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { maxX, maxY, renderW, renderH } = (() => {
    if (fit === "contain" || !natural || box.w === 0 || box.h === 0) {
      return { maxX: 0, maxY: 0, renderW: 0, renderH: 0 };
    }
    const scale = Math.max(box.w / natural.w, box.h / natural.h);
    const rW = natural.w * scale;
    const rH = natural.h * scale;
    const overflowXPct = ((rW - box.w) / box.w) * 100;
    const overflowYPct = ((rH - box.h) / box.h) * 100;
    return { maxX: overflowXPct / 2, maxY: overflowYPct / 2, renderW: rW, renderH: rH };
  })();

  // Re-clamp if image / box changed.
  useEffect(() => {
    if (fit === "contain") return;
    const cx = Math.max(-maxX, Math.min(maxX, focalX));
    const cy = Math.max(-maxY, Math.min(maxY, focalY));
    if (cx !== focalX || cy !== focalY) onChange(cx, cy);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxX, maxY, fit]);

  const canPan = fit !== "contain" && (maxX > 0 || maxY > 0);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!canPan) return;
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      baseX: focalX,
      baseY: focalY,
      width: rect.width,
      height: rect.height,
    };
    el.setPointerCapture(e.pointerId);
    setDragging(true);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = dragRef.current;
    if (!s) return;
    const dxPct = ((e.clientX - s.startX) / s.width) * 100;
    const dyPct = ((e.clientY - s.startY) / s.height) * 100;
    const nx = Math.max(-maxX, Math.min(maxX, s.baseX + dxPct));
    const ny = Math.max(-maxY, Math.min(maxY, s.baseY + dyPct));
    onChange(nx, ny);
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = containerRef.current;
    if (el && el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    dragRef.current = null;
    setDragging(false);
  };

  const clipPath = (() => {
    if (shape === "circle" && box.w > 0 && box.h > 0) {
      return `circle(${Math.min(box.w, box.h) / 2}px at 50% 50%)`;
    }
    if (shape === "heart") {
      return "path('M 0.5 1 C 0.5 1 0 0.65 0 0.3 C 0 0.1 0.2 0 0.35 0 C 0.42 0 0.48 0.05 0.5 0.15 C 0.52 0.05 0.58 0 0.65 0 C 0.8 0 1 0.1 1 0.3 C 1 0.65 0.5 1 0.5 1 Z')";
    }
    return undefined;
  })();

  return (
    <div className="space-y-1">
      <div
        ref={containerRef}
        className="relative rounded-md overflow-hidden border bg-muted aspect-square"
        style={{
          cursor: canPan ? (dragging ? "grabbing" : "grab") : "default",
          touchAction: canPan ? "none" : undefined,
          clipPath,
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {fit === "contain" || !natural || renderW === 0 ? (
          <img
            src={url}
            alt={label ?? "Referensbild"}
            onLoad={(e) => {
              const i = e.currentTarget;
              setNatural({ w: i.naturalWidth, h: i.naturalHeight });
            }}
            className={`absolute inset-0 w-full h-full ${
              fit === "contain" ? "object-contain" : "object-cover"
            } pointer-events-none select-none`}
            draggable={false}
          />
        ) : (
          <img
            src={url}
            alt={label ?? "Referensbild"}
            onLoad={(e) => {
              const i = e.currentTarget;
              setNatural({ w: i.naturalWidth, h: i.naturalHeight });
            }}
            style={{
              position: "absolute",
              width: `${renderW}px`,
              height: `${renderH}px`,
              left: `${(box.w - renderW) / 2 + (focalX / 100) * box.w}px`,
              top: `${(box.h - renderH) / 2 + (focalY / 100) * box.h}px`,
              userSelect: "none",
              pointerEvents: "none",
              maxWidth: "none",
            }}
            draggable={false}
          />
        )}
      </div>
      {canPan && (
        <p className="text-[10px] text-muted-foreground leading-tight">
          Dra för att välja synlig del
        </p>
      )}
    </div>
  );
}

// =====================================================================
// Text layer v2 — defaults section
// =====================================================================
// (TextLayerDefaults helpers — types/imports defined at top of file)

function TextLayerDefaults({
  layer,
  allLayers,
  updateDefaults,
}: {
  layer: Extract<TemplateLayer, { type: "text" }>;
  allLayers: TemplateLayer[];
  updateDefaults: (patch: Partial<Extract<TemplateLayer, { type: "text" }>["defaults"]>) => void;
}) {
  const d = layer.defaults;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const tokens = resolveLinkedTokens(d);
  const decoration: TextDecoration = d.decoration ?? {
    kind: "none",
    thicknessMm: 0.5,
    color: "#000000",
    paddingMm: 2,
  };

  function insertAtCursor(text: string) {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart ?? d.text.length;
    const end = ta.selectionEnd ?? d.text.length;
    const next = d.text.slice(0, start) + text + d.text.slice(end);
    updateDefaults({ text: next });
    requestAnimationFrame(() => {
      ta.focus();
      const pos = start + text.length;
      ta.setSelectionRange(pos, pos);
    });
  }

  function moveToken(idx: number, dir: -1 | 1) {
    const next = [...tokens];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    updateDefaults({ linkedTokens: next });
  }

  function toggleToken(tok: LinkedTextToken) {
    const has = tokens.includes(tok);
    const next = has ? tokens.filter((t) => t !== tok) : [...tokens, tok];
    updateDefaults({ linkedTokens: next });
  }

  function addSpanFromSelection() {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart ?? 0;
    const end = ta.selectionEnd ?? 0;
    if (end <= start) {
      toast.message("Markera först en del av texten");
      return;
    }
    const next: TextSpan[] = [...(d.spans ?? []), { start, end }];
    updateDefaults({ spans: next });
  }

  function updateSpan(i: number, patch: Partial<TextSpan>) {
    const arr = [...(d.spans ?? [])];
    arr[i] = { ...arr[i], ...patch };
    updateDefaults({ spans: arr });
  }
  function removeSpan(i: number) {
    const arr = [...(d.spans ?? [])];
    arr.splice(i, 1);
    updateDefaults({ spans: arr });
  }

  return (
    <div className="space-y-3 border-t pt-4">
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Text — defaults
      </p>
      <Field label="Innehåll (Enter ger ny rad)">
        <Textarea
          ref={textareaRef}
          value={d.text}
          rows={4}
          onChange={(e) => updateDefaults({ text: e.target.value })}
          className="font-mono text-sm"
        />
      </Field>
      {(d.linkedMapLayerId || /\[\[(city|country|coords?|date)\]\]/.test(d.text)) && (
        <p className="text-[11px] text-muted-foreground -mt-1 px-0.5">
          Förhandsvisning:{" "}
          <span className="font-medium text-foreground/80 whitespace-pre-wrap">
            {(() => {
              const sibling = allLayers.find(
                (l) => l.type === "map" && (!d.linkedMapLayerId || l.id === d.linkedMapLayerId),
              );
              const place =
                sibling && sibling.type === "map"
                  ? {
                      placeName: sibling.defaults.placeName ?? "",
                      city: sibling.defaults.city ?? null,
                      country: sibling.defaults.country ?? null,
                      center: [sibling.defaults.center[0]!, sibling.defaults.center[1]!] as [number, number],
                    }
                  : FALLBACK_PLACE;
              return substituteTokens(d, place).replace(/\n/g, " · ") || "(tom)";
            })()}
          </span>
        </p>
      )}
      <Field label="Typsnitt">
        <Select value={d.font} onValueChange={(v) => updateDefaults({ font: v })}>
          <SelectTrigger>
            <SelectValue style={{ fontFamily: `"${d.font}", system-ui, sans-serif` }} />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            {(["sans", "serif", "display", "script", "mono"] as FontCategory[]).map((cat) => {
              const items = FONT_CATALOG.filter((f) => f.category === cat);
              if (items.length === 0) return null;
              return (
                <SelectGroup key={cat}>
                  <SelectLabel>{FONT_CATEGORY_LABELS[cat]}</SelectLabel>
                  {items.map((f) => (
                    <SelectItem
                      key={f.family}
                      value={f.family}
                      style={{ fontFamily: `"${f.family}", system-ui, sans-serif` }}
                    >
                      {f.family}
                    </SelectItem>
                  ))}
                </SelectGroup>
              );
            })}
          </SelectContent>
        </Select>
      </Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Storlek (pt)">
          <Input
            type="number"
            min={4}
            max={400}
            step={1}
            value={d.fontSizePt ?? ""}
            placeholder="12"
            onChange={(e) => {
              const n = Number(e.target.value);
              updateDefaults({ fontSizePt: Number.isFinite(n) && n > 0 ? n : undefined });
            }}
          />
        </Field>
        <Field label="Radavstånd">
          <Input
            type="number"
            min={0.8}
            max={3}
            step={0.05}
            value={d.lineHeight ?? 1.15}
            onChange={(e) => updateDefaults({ lineHeight: Number(e.target.value) })}
          />
        </Field>
        <Field label="Justering">
          <Select
            value={d.align}
            onValueChange={(v) => updateDefaults({ align: v as typeof d.align })}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="left">Vänster</SelectItem>
              <SelectItem value="center">Mitten</SelectItem>
              <SelectItem value="right">Höger</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>
      {typeof d.fontSizePct === "number" && typeof d.fontSizePt !== "number" && (
        <p className="text-[11px] text-amber-600">
          Använder gammal storlek (% av höjd: {d.fontSizePct}%). Sätt en pt-storlek
          för att uppgradera.
        </p>
      )}
      <Field label="Färg">
        <Input
          type="color"
          value={d.color}
          onChange={(e) => updateDefaults({ color: e.target.value })}
        />
      </Field>
      <Field label="Bakgrundsfärg">
        <div className="flex items-center gap-2">
          <Input
            type="color"
            value={d.backgroundColor || "#ffffff"}
            onChange={(e) => updateDefaults({ backgroundColor: e.target.value })}
            disabled={!d.backgroundColor}
            className="flex-1"
          />
          {d.backgroundColor ? (
            <button
              type="button"
              onClick={() => updateDefaults({ backgroundColor: undefined })}
              className="text-[11px] px-2 py-1 rounded border hover:bg-muted"
            >
              Ta bort
            </button>
          ) : (
            <button
              type="button"
              onClick={() => updateDefaults({ backgroundColor: "#ffffff" })}
              className="text-[11px] px-2 py-1 rounded border hover:bg-muted"
            >
              Lägg till
            </button>
          )}
        </div>
      </Field>

      {/* Decoration */}
      <div className="rounded-md border bg-muted/30 p-3 space-y-2">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Design (anpassar sig efter texten)
        </p>
        <Field label="Stil">
          <Select
            value={decoration.kind}
            onValueChange={(v) =>
              updateDefaults({
                decoration: { ...decoration, kind: v as TextDecoration["kind"] },
              })
            }
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Ingen</SelectItem>
              <SelectItem value="box">Ruta runt texten</SelectItem>
              <SelectItem value="side-rules">Streck på sidorna</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        {decoration.kind !== "none" && (
          <div className="grid grid-cols-3 gap-2">
            <Field label="Tjocklek (mm)">
              <Input
                type="number"
                min={0.1}
                max={20}
                step={0.1}
                value={decoration.thicknessMm}
                onChange={(e) =>
                  updateDefaults({
                    decoration: { ...decoration, thicknessMm: Number(e.target.value) },
                  })
                }
              />
            </Field>
            <Field label="Padding (mm)">
              <Input
                type="number"
                min={0}
                max={50}
                step={0.5}
                value={decoration.paddingMm}
                onChange={(e) =>
                  updateDefaults({
                    decoration: { ...decoration, paddingMm: Number(e.target.value) },
                  })
                }
              />
            </Field>
            <Field label="Färg">
              <Input
                type="color"
                value={decoration.color}
                onChange={(e) =>
                  updateDefaults({
                    decoration: { ...decoration, color: e.target.value },
                  })
                }
              />
            </Field>
          </div>
        )}
        {decoration.kind === "side-rules" && (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Strecklängd (mm) — tomt = elastisk">
              <Input
                type="number"
                min={0}
                max={300}
                step={1}
                value={decoration.ruleLengthMm ?? ""}
                placeholder="t.ex. 25"
                onChange={(e) => {
                  const n = Number(e.target.value);
                  updateDefaults({
                    decoration: {
                      ...decoration,
                      ruleLengthMm: Number.isFinite(n) && n > 0 ? n : undefined,
                    },
                  });
                }}
              />
            </Field>
            <Field label="Strecken börjar vid">
              <Select
                value={decoration.ruleAlign ?? "text-edge"}
                onValueChange={(v) =>
                  updateDefaults({
                    decoration: { ...decoration, ruleAlign: v as "text-edge" | "layer-edge" },
                  })
                }
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="text-edge">Texten</SelectItem>
                  <SelectItem value="layer-edge">Layerkanten</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
        )}
      </div>

      {/* Map link */}
      <Field label="Länka till karta">
        <Select
          value={d.linkedMapLayerId ?? "__none__"}
          onValueChange={(v) =>
            updateDefaults({ linkedMapLayerId: v === "__none__" ? null : v })
          }
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">Ingen (statisk text)</SelectItem>
            {allLayers
              .filter((l) => l.type === "map")
              .map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name || m.id}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </Field>
      {d.linkedMapLayerId && (
        <div className="rounded-md border bg-muted/30 p-3 space-y-2">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Länkade rader (drag för att ordna)
          </p>
          <p className="text-[10px] text-muted-foreground -mt-1">
            Ordningen avgör visningsordning. För finkontroll: skriv
            <code className="px-1">[[city]]</code>,
            <code className="px-1">[[country]]</code> eller
            <code className="px-1">[[coords]]</code> i innehållet — då följer
            renderaren din egen layout (samma rad eller egen rad).
          </p>
          {(["city", "country", "coordinates"] as const).map((tok) => {
            const labels = { city: "Stad / ort [[city]]", country: "Land [[country]]", coordinates: "Koordinater [[coords]]" };
            const idx = tokens.indexOf(tok);
            const checked = idx !== -1;
            return (
              <div key={tok} className="flex items-center gap-2 text-xs">
                <Checkbox checked={checked} onCheckedChange={() => toggleToken(tok)} />
                <span className="flex-1">{labels[tok]}</span>
                {checked && (
                  <>
                    <button
                      type="button"
                      className="text-[11px] px-1.5 py-0.5 rounded border hover:bg-muted"
                      disabled={idx <= 0}
                      onClick={() => moveToken(idx, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="text-[11px] px-1.5 py-0.5 rounded border hover:bg-muted"
                      disabled={idx >= tokens.length - 1}
                      onClick={() => moveToken(idx, 1)}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="text-[11px] px-1.5 py-0.5 rounded border hover:bg-muted"
                      onClick={() => insertAtCursor(`[[${tok === "coordinates" ? "coords" : tok}]]`)}
                    >
                      Infoga
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Spans (rich text overrides) */}
      <div className="rounded-md border bg-muted/30 p-3 space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Format-markeringar
          </p>
          <button
            type="button"
            className="text-[11px] px-2 py-1 rounded border hover:bg-muted"
            onClick={addSpanFromSelection}
          >
            + Markering
          </button>
        </div>
        <p className="text-[10px] text-muted-foreground">
          Markera text i innehållet ovan, klicka <em>+ Markering</em> och sätt
          font/storlek/färg endast för det området.
        </p>
        {(d.spans ?? []).length === 0 && (
          <p className="text-[11px] text-muted-foreground italic">Inga markeringar.</p>
        )}
        {(d.spans ?? []).map((s, i) => (
          <SpanEditor
            key={i}
            span={s}
            text={d.text}
            onChange={(p) => updateSpan(i, p)}
            onRemove={() => removeSpan(i)}
          />
        ))}
      </div>
    </div>
  );
}

function SpanEditor({
  span,
  text,
  onChange,
  onRemove,
}: {
  span: TextSpan;
  text: string;
  onChange: (p: Partial<TextSpan>) => void;
  onRemove: () => void;
}) {
  const slice = text.slice(span.start, span.end);
  return (
    <div className="rounded border bg-background p-2 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <code className="text-[11px] truncate flex-1 bg-muted px-1.5 py-0.5 rounded">
          [{span.start}–{span.end}] "{slice}"
        </code>
        <button
          type="button"
          className="text-[11px] text-destructive hover:underline"
          onClick={onRemove}
        >
          Ta bort
        </button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Input
          type="number"
          placeholder="pt"
          value={span.fontSizePt ?? ""}
          onChange={(e) => {
            const n = Number(e.target.value);
            onChange({ fontSizePt: Number.isFinite(n) && n > 0 ? n : undefined });
          }}
        />
        <Input
          placeholder="Typsnitt"
          value={span.font ?? ""}
          onChange={(e) => onChange({ font: e.target.value || undefined })}
        />
        <Input
          type="color"
          value={span.color ?? "#000000"}
          onChange={(e) => onChange({ color: e.target.value })}
        />
      </div>
      <div className="flex items-center gap-3 text-[11px]">
        <label className="flex items-center gap-1">
          <Checkbox
            checked={!!span.bold}
            onCheckedChange={(c) => onChange({ bold: c === true })}
          />
          Fet
        </label>
        <label className="flex items-center gap-1">
          <Checkbox
            checked={!!span.italic}
            onCheckedChange={(c) => onChange({ italic: c === true })}
          />
          Kursiv
        </label>
        <label className="flex items-center gap-1">
          <Checkbox
            checked={!!span.underline}
            onCheckedChange={(c) => onChange({ underline: c === true })}
          />
          Understruken
        </label>
      </div>
    </div>
  );
}
