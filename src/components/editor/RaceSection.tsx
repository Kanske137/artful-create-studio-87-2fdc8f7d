// Lopptavlans kundpanel: två flikar i kontrollpanelen.
//  - "Lopp": välj lopp ur katalogen (filter + sök) eller ladda upp GPX.
//  - "Dina uppgifter": texter, vad som visas på tavlan, utseende.
// Hela lager slås av/på via editorStore.setLayerVisible (flödeslayouten
// flyttar om tavlan); värden inne i statistikraden/kartan via raceStore.
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Loader2, Search, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useEditorStore } from "@/stores/editorStore";
import { useRaceStore, raceLocaleFor } from "@/stores/raceStore";
import {
  RACE_CATEGORY_LABELS,
  RACE_DEFAULT_FILTER,
  availableRaces,
  loadCourse,
  type RaceDef,
} from "@/lib/race/catalog";
import { GPX_ERROR_MESSAGES, GpxError, readGpxFile } from "@/lib/race/gpx";
import { formatDistance, parseDuration } from "@/lib/race/format";
import type { RaceCategory, RaceShow } from "@/lib/race/types";
import { DEFAULT_LAYOUT_ID, getAllLayouts, type RaceStatKey, type TemplateLayer } from "@/lib/template-schema";
import { mapStyleLabel, mapStylePreviewBg } from "@/lib/map-style-catalog";
import { PhotoUploadSection } from "./PhotoUploadSection";

type Filter = RaceCategory | "all";

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">{children}</h3>;
}

// ---------------------------------------------------------------------------
// Flik 1: välj lopp / GPX
// ---------------------------------------------------------------------------

export function RacePickerPanel() {
  const { t, i18n } = useTranslation();
  const locale = raceLocaleFor(i18n.language);
  const config = useEditorStore((s) => s.config);
  const raceOptions = useEditorStore((s) => s.productOptions?.raceOptions);
  const { raceId, source, route, loading, error } = useRaceStore();
  const setLoading = useRaceStore((s) => s.setLoading);
  const setError = useRaceStore((s) => s.setError);
  const setFromCatalog = useRaceStore((s) => s.setFromCatalog);
  const setFromGpx = useRaceStore((s) => s.setFromGpx);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [gpxName, setGpxName] = useState<string | null>(null);

  const races = useMemo(() => availableRaces(), []);
  const categories = useMemo(() => {
    const present = new Set(races.map((r) => r.category));
    return (["marathon", "half", "10k", "5k", "trail", "ultra", "other"] as RaceCategory[]).filter((c) => present.has(c));
  }, [races]);

  const productDefault = RACE_DEFAULT_FILTER[config?.shopify_handle ?? ""] ?? "all";
  const [filter, setFilter] = useState<Filter>(
    productDefault !== "all" && categories.includes(productDefault) ? productDefault : "all",
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return races.filter((r) => {
      if (filter !== "all" && r.category !== filter) return false;
      if (!q) return true;
      const hay = [r.name, r.city, ...(r.aliases ?? [])].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [races, filter, query]);

  const pick = async (race: RaceDef) => {
    setLoadingId(race.id);
    setLoading(true);
    try {
      const course = await loadCourse(race);
      setFromCatalog(race, course, null);
    } catch (e) {
      console.warn("[race] loadCourse failed", e);
      setError(t("race.loadFailed"));
    } finally {
      setLoadingId(null);
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setLoading(true);
    try {
      const result = await readGpxFile(file);
      setFromGpx(result, file.name);
      setGpxName(file.name);
    } catch (e) {
      const msg =
        e instanceof GpxError ? GPX_ERROR_MESSAGES[locale][e.code] : GPX_ERROR_MESSAGES[locale]["not-xml"];
      setError(msg);
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const allowGpx = raceOptions?.allowGpx !== false;

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <div>
          <SectionHeading>{t("race.pickTitle")}</SectionHeading>
          <p className="text-xs text-muted-foreground mt-1">{t("race.pickHint")}</p>
        </div>

        {races.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("race.noRaces")}</p>
        ) : (
          <>
            {categories.length > 1 && (
              <div className="flex flex-wrap gap-1.5">
                {(["all", ...categories] as Filter[]).map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setFilter(c)}
                    className={cn(
                      "px-3 py-1 rounded-full text-xs border transition",
                      filter === c
                        ? "bg-foreground text-background border-foreground"
                        : "bg-background border-border hover:border-foreground/40",
                    )}
                  >
                    {RACE_CATEGORY_LABELS[c][locale]}
                  </button>
                ))}
              </div>
            )}
            {races.length > 6 && (
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("race.search")}
                  className="pl-8 h-9 text-sm"
                />
              </div>
            )}
            <ul className="space-y-1.5" role="listbox" aria-label={t("race.pickTitle")}>
              {visible.map((r) => {
                const active = source === "catalog" && raceId === r.id;
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={active}
                      onClick={() => void pick(r)}
                      disabled={loading && loadingId !== null}
                      className={cn(
                        "w-full flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left transition",
                        active ? "ring-2 ring-primary border-transparent" : "border-border hover:border-foreground/30",
                      )}
                    >
                      <span className="min-w-0">
                        <span className="block text-sm font-medium truncate">{r.name}</span>
                        <span className="block text-xs text-muted-foreground truncate">
                          {r.city} · {formatDistance(r.distanceKm, locale)}
                        </span>
                      </span>
                      {loadingId === r.id ? (
                        <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                      ) : active ? (
                        <Check className="h-4 w-4 text-primary shrink-0" />
                      ) : null}
                    </button>
                  </li>
                );
              })}
              {visible.length === 0 && <li className="text-xs text-muted-foreground">{t("race.noMatch")}</li>}
            </ul>
          </>
        )}
      </div>

      {allowGpx && (
        <div className="space-y-2 rounded-xl border border-dashed p-3">
          <SectionHeading>{t("race.gpxTitle")}</SectionHeading>
          <p className="text-xs text-muted-foreground">{t("race.gpxHint")}</p>
          {source === "gpx" && route && (
            <p className="text-xs font-medium flex items-center gap-1.5">
              <Check className="h-3.5 w-3.5 text-primary" />
              {t("race.gpxActive", { distance: formatDistance(route.distanceKm, locale) })}
              {gpxName ? <span className="text-muted-foreground font-normal truncate">· {gpxName}</span> : null}
            </p>
          )}
          <input
            ref={fileRef}
            type="file"
            accept=".gpx,application/gpx+xml,application/xml,text/xml"
            className="hidden"
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileRef.current?.click()}
            disabled={loading}
            className="w-full"
          >
            {loading && loadingId === null ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Upload className="h-4 w-4 mr-2" />
            )}
            {source === "gpx" ? t("race.gpxReplace") : t("race.gpxButton")}
          </Button>
        </div>
      )}

      {loading && loadingId !== null && <p className="text-xs text-muted-foreground">{t("race.loading")}</p>}
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Flik 2: dina uppgifter, visa på tavlan, utseende
// ---------------------------------------------------------------------------

type RaceTextField = NonNullable<Extract<TemplateLayer, { type: "text" }>["defaults"]["raceField"]>;

/** Lager kunden kan slå av/på från loppanelen, i visningsordning. */
function toggleableLayers(layers: TemplateLayer[]) {
  const order: Record<string, number> = { finishTime: 0, raceStats: 1, elevation: 2, runnerName: 3, subtitle: 4, date: 5, customLine: 6, photo: 7 };
  const out: Array<{ layer: TemplateLayer; key: string }> = [];
  for (const l of layers) {
    if (l.locks.visibility) continue;
    if (l.type === "photo") out.push({ layer: l, key: "photo" });
    else if (l.type === "elevation") out.push({ layer: l, key: "elevation" });
    else if (l.type === "raceStats") out.push({ layer: l, key: "raceStats" });
    else if (l.type === "text" && l.defaults.raceField && l.defaults.raceField !== "title") {
      out.push({ layer: l, key: l.defaults.raceField });
    }
  }
  return out.sort((a, b) => (order[a.key] ?? 9) - (order[b.key] ?? 9));
}

const TOGGLE_LABEL_KEY: Record<string, string> = {
  photo: "race.show.photo",
  elevation: "race.show.elevation",
  raceStats: "race.show.stats",
  subtitle: "race.show.subtitle",
  runnerName: "race.show.runnerName",
  date: "race.show.date",
  customLine: "race.show.customLine",
  finishTime: "race.show.time",
};

function ToggleRow({ label, checked, onChange, indent }: { label: string; checked: boolean; onChange: (v: boolean) => void; indent?: boolean }) {
  return (
    <label className={cn("flex items-center justify-between gap-3 py-1 cursor-pointer", indent && "pl-4")}>
      <span className={cn("text-sm", indent && "text-muted-foreground")}>{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

export function RaceDetailsPanel({ mapStyleSlot }: { mapStyleSlot?: React.ReactNode }) {
  const { t } = useTranslation();
  const templateLayers = useEditorStore((s) => s.templateLayers);
  const hiddenLayerIds = useEditorStore((s) => s.hiddenLayerIds);
  const setLayerVisible = useEditorStore((s) => s.setLayerVisible);
  const raceOptions = useEditorStore((s) => s.productOptions?.raceOptions);
  const template = useEditorStore((s) => s.template);
  const layoutId = useEditorStore((s) => s.layoutId);
  const setLayoutId = useEditorStore((s) => s.setLayoutId);
  // Prenumerera på orientering så listan följer aktiv layout.
  useEditorStore((s) => s.orientation);
  // Bakgrunder = mallens stilar (var och en med egen kartstil + textfärger).
  const backgrounds = (template ? getAllLayouts(template) : []).map((l) => {
    const map = l.defaultLayout.portrait.layers.find((x) => x.type === "map");
    const styleId = map && map.type === "map" ? map.defaults.styleId : "";
    return { id: l.id, name: l.name || mapStyleLabel(styleId), bg: mapStylePreviewBg(styleId) };
  });
  const activeLayout = layoutId ?? DEFAULT_LAYOUT_ID;
  const { fields, show, routeColor, source } = useRaceStore();
  const setField = useRaceStore((s) => s.setField);
  const setShow = useRaceStore((s) => s.setShow);
  const setRouteColor = useRaceStore((s) => s.setRouteColor);

  const layers = templateLayers();
  const toggles = toggleableLayers(layers);
  const fieldsInTemplate = new Set(
    layers.flatMap((l) => (l.type === "text" && l.defaults.raceField ? [l.defaults.raceField as RaceTextField] : [])),
  );
  const statsLayer = layers.find((l): l is Extract<TemplateLayer, { type: "raceStats" }> => l.type === "raceStats");
  const statsVisible = !!statsLayer && !hiddenLayerIds[statsLayer.id];
  const statKeys: RaceStatKey[] = statsLayer?.defaults.items ?? [];
  const photoLayer = layers.find((l) => l.type === "photo");
  const routeMap = layers.find(
    (l): l is Extract<TemplateLayer, { type: "map" }> => l.type === "map" && !!l.defaults.routeStyle,
  );
  const timeInvalid = fields.finishTime.trim() !== "" && parseDuration(fields.finishTime) === null;
  const colors = raceOptions?.routeColors ?? [];
  const activeColor = routeColor ?? routeMap?.defaults.routeStyle?.color ?? colors[0];

  const isVisible = (id: string) => !hiddenLayerIds[id];
  const showKey = (k: keyof RaceShow, label: string, indent = false) => (
    <ToggleRow key={k} label={label} checked={show[k]} onChange={(v) => setShow(k, v)} indent={indent} />
  );

  return (
    <div className="space-y-6">
      {/* Texter */}
      <div className="space-y-3">
        <SectionHeading>{t("race.fieldsTitle")}</SectionHeading>
        {fieldsInTemplate.has("title") && (
          <div className="space-y-1">
            <Label className="text-xs">{t("race.title")}</Label>
            <Input
              value={fields.title}
              onChange={(e) => setField("title", e.target.value)}
              placeholder={t("race.titlePlaceholder")}
              maxLength={40}
            />
          </div>
        )}
        {fieldsInTemplate.has("subtitle") && source === "gpx" && (
          <div className="space-y-1">
            <Label className="text-xs">{t("race.city")}</Label>
            <Input value={fields.city} onChange={(e) => setField("city", e.target.value)} maxLength={40} />
          </div>
        )}
        {fieldsInTemplate.has("runnerName") && (
          <div className="space-y-1">
            <Label className="text-xs">{t("race.runnerName")}</Label>
            <Input value={fields.runnerName} onChange={(e) => setField("runnerName", e.target.value)} maxLength={40} />
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          {(fieldsInTemplate.has("date") || fieldsInTemplate.has("subtitle")) && (
            <div className="space-y-1">
              <Label className="text-xs">{t("race.date")}</Label>
              <Input type="date" value={fields.dateISO} onChange={(e) => setField("dateISO", e.target.value)} />
            </div>
          )}
          {(statKeys.includes("time") || fieldsInTemplate.has("finishTime")) && (
            <div className="space-y-1">
              <Label className="text-xs">{t("race.finishTime")}</Label>
              <Input
                value={fields.finishTime}
                onChange={(e) => setField("finishTime", e.target.value)}
                placeholder={t("race.finishTimePlaceholder")}
                inputMode="numeric"
                aria-invalid={timeInvalid}
              />
            </div>
          )}
          {statKeys.includes("bib") && (
            <div className="space-y-1">
              <Label className="text-xs">{t("race.bib")}</Label>
              <Input value={fields.bib} onChange={(e) => setField("bib", e.target.value)} maxLength={8} />
            </div>
          )}
          {statKeys.includes("placement") && (
            <div className="space-y-1">
              <Label className="text-xs">{t("race.placement")}</Label>
              <Input value={fields.placement} onChange={(e) => setField("placement", e.target.value)} maxLength={10} />
            </div>
          )}
        </div>
        {timeInvalid && <p className="text-xs text-destructive">{t("race.finishTimeInvalid")}</p>}
        {fieldsInTemplate.has("customLine") && (
          <div className="space-y-1">
            <Label className="text-xs">{t("race.customLine")}</Label>
            <Input
              value={fields.customLine}
              onChange={(e) => setField("customLine", e.target.value)}
              placeholder={t("race.customLinePlaceholder")}
              maxLength={50}
            />
          </div>
        )}
      </div>

      {/* Visa på tavlan */}
      <div className="space-y-1">
        <SectionHeading>{t("race.showTitle")}</SectionHeading>
        {toggles.map(({ layer, key }) => (
          <div key={layer.id}>
            <ToggleRow
              label={t(TOGGLE_LABEL_KEY[key] ?? key)}
              checked={isVisible(layer.id)}
              onChange={(v) => setLayerVisible(layer.id, v)}
            />
            {key === "raceStats" && statsVisible && (
              <div>
                {statKeys.map((k) => showKey(k, t(`race.show.${k}`), true))}
              </div>
            )}
          </div>
        ))}
        {routeMap && (
          <>
            {showKey("startFinish", t("race.show.startFinish"))}
            {showKey("kmMarkers", t("race.show.kmMarkers"))}
          </>
        )}
        {photoLayer && isVisible(photoLayer.id) && (
          <div className="pt-2">
            <PhotoUploadSection layerId={photoLayer.id} />
          </div>
        )}
      </div>

      {/* Utseende */}
      {routeMap && (
        <div className="space-y-3">
          <SectionHeading>{t("race.look")}</SectionHeading>
          {backgrounds.length > 1 && (
            <div className="space-y-1.5">
              <Label className="text-xs">{t("race.background")}</Label>
              <div className="grid grid-cols-4 gap-2">
                {backgrounds.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setLayoutId(b.id)}
                    className="flex flex-col items-center gap-1"
                    aria-pressed={activeLayout === b.id}
                  >
                    <span
                      className={cn(
                        "h-10 w-full rounded-lg border transition",
                        activeLayout === b.id ? "ring-2 ring-offset-2 ring-foreground" : "border-border",
                      )}
                      style={{ background: b.bg }}
                    />
                    <span className="text-[11px] text-muted-foreground truncate max-w-full">{b.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {colors.length > 1 && (
            <div className="space-y-1.5">
              <Label className="text-xs">{t("race.routeColor")}</Label>
              <div className="flex flex-wrap gap-2">
                {colors.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={c}
                    onClick={() => setRouteColor(c === routeMap.defaults.routeStyle?.color ? null : c)}
                    className={cn(
                      "h-8 w-8 rounded-full border transition",
                      activeColor?.toLowerCase() === c.toLowerCase()
                        ? "ring-2 ring-offset-2 ring-foreground"
                        : "border-border",
                    )}
                    style={{ background: c }}
                  />
                ))}
              </div>
            </div>
          )}
          {mapStyleSlot}
        </div>
      )}
    </div>
  );
}
