// Admin-inställningar för lopptavlans lager: ruttkarta, höjdprofil,
// statistikrad och loppfält på textlager. Startmallen "Lopptavla" sätter
// rimliga värden — här finjusteras de.
import type React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FONT_FAMILIES } from "@/lib/font-catalog";
import type { RaceStatKey, TemplateLayer } from "@/lib/template-schema";

type Update = (patch: Record<string, unknown>) => void;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{children}</p>;
}

function ColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <input type="color" value={value} onChange={(e) => onChange(e.target.value.toUpperCase())} className="h-8 w-10 rounded border" />
      <Input value={value} onChange={(e) => /^#[0-9a-fA-F]{6}$/.test(e.target.value) && onChange(e.target.value.toUpperCase())} className="h-8 font-mono text-xs" />
    </div>
  );
}

function FontSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
      <SelectContent>
        {FONT_FAMILIES.map((f) => (
          <SelectItem key={f} value={f} style={{ fontFamily: f }}>{f}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function RouteStyleInspector({ layer, update }: { layer: Extract<TemplateLayer, { type: "map" }>; update: Update }) {
  const rs = layer.defaults.routeStyle;
  return (
    <div className="space-y-3 border-t pt-4">
      <Heading>Lopptavla — rutt</Heading>
      <label className="flex items-center justify-between gap-3">
        <span className="text-sm">Ruttkarta (ritar kundens lopp/GPX)</span>
        <Switch
          checked={!!rs}
          onCheckedChange={(on) =>
            update({ routeStyle: on ? { color: "#FC4C02", thicknessMm: 1.6, casing: false, casingColor: "#FFFFFF" } : undefined })
          }
        />
      </label>
      {rs && (
        <>
          <Row label="Standardfärg">
            <ColorInput value={rs.color} onChange={(color) => update({ routeStyle: { ...rs, color } })} />
          </Row>
          <Row label="Tjocklek (mm, A4-relativ)">
            <Input
              type="number"
              step={0.1}
              min={0.2}
              max={20}
              value={rs.thicknessMm}
              onChange={(e) => Number(e.target.value) > 0 && update({ routeStyle: { ...rs, thicknessMm: Number(e.target.value) } })}
              className="h-8"
            />
          </Row>
          <label className="flex items-center justify-between gap-3">
            <span className="text-sm">Ljus kontur (för mörka kartor)</span>
            <Switch checked={rs.casing} onCheckedChange={(casing) => update({ routeStyle: { ...rs, casing } })} />
          </label>
        </>
      )}
    </div>
  );
}

export function ElevationInspector({ layer, update }: { layer: Extract<TemplateLayer, { type: "elevation" }>; update: Update }) {
  const d = layer.defaults;
  return (
    <div className="space-y-3 border-t pt-4">
      <Heading>Höjdprofil</Heading>
      <Row label="Utseende">
        <Select value={d.style ?? "area"} onValueChange={(style) => update({ style })}>
          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="bars">Staplar</SelectItem>
            <SelectItem value="line">Linje</SelectItem>
            <SelectItem value="area">Fylld kurva</SelectItem>
          </SelectContent>
        </Select>
      </Row>
      <label className="flex items-center justify-between gap-3">
        <span className="text-sm">Följ ruttens färg</span>
        <Switch checked={!d.color} onCheckedChange={(on) => update({ color: on ? undefined : "#111111" })} />
      </label>
      {d.color && (
        <Row label="Linjefärg">
          <ColorInput value={d.color} onChange={(color) => update({ color })} />
        </Row>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Row label="Ytans opacitet (0–1)">
          <Input type="number" step={0.05} min={0} max={1} value={d.fillOpacity} onChange={(e) => update({ fillOpacity: Number(e.target.value) })} className="h-8" />
        </Row>
        <Row label="Linje (mm)">
          <Input type="number" step={0.1} min={0.1} max={10} value={d.thicknessMm} onChange={(e) => Number(e.target.value) > 0 && update({ thicknessMm: Number(e.target.value) })} className="h-8" />
        </Row>
      </div>
    </div>
  );
}

const STAT_LABELS: Record<RaceStatKey, string> = {
  distance: "Distans",
  time: "Tid",
  pace: "Tempo",
  bib: "Startnummer",
  placement: "Placering",
};

export function RaceStatsInspector({ layer, update }: { layer: Extract<TemplateLayer, { type: "raceStats" }>; update: Update }) {
  const d = layer.defaults;
  const toggleItem = (k: RaceStatKey, on: boolean) => {
    const order: RaceStatKey[] = ["distance", "time", "pace", "bib", "placement"];
    const next = on ? order.filter((x) => x === k || d.items.includes(x)) : d.items.filter((x) => x !== k);
    if (next.length > 0) update({ items: next });
  };
  return (
    <div className="space-y-3 border-t pt-4">
      <Heading>Loppstatistik</Heading>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
        {(Object.keys(STAT_LABELS) as RaceStatKey[]).map((k) => (
          <label key={k} className="flex items-center justify-between gap-2 text-sm">
            {STAT_LABELS[k]}
            <Switch checked={d.items.includes(k)} onCheckedChange={(on) => toggleItem(k, on)} />
          </label>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Row label="Värden — typsnitt"><FontSelect value={d.valueFont} onChange={(valueFont) => update({ valueFont })} /></Row>
        <Row label="Värden — storlek (pt)">
          <Input type="number" step={0.5} value={d.valueSizePt} onChange={(e) => Number(e.target.value) > 0 && update({ valueSizePt: Number(e.target.value) })} className="h-8" />
        </Row>
        <Row label="Etiketter — typsnitt"><FontSelect value={d.labelFont} onChange={(labelFont) => update({ labelFont })} /></Row>
        <Row label="Etiketter — storlek (pt)">
          <Input type="number" step={0.5} value={d.labelSizePt} onChange={(e) => Number(e.target.value) > 0 && update({ labelSizePt: Number(e.target.value) })} className="h-8" />
        </Row>
        <Row label="Färg"><ColorInput value={d.color} onChange={(color) => update({ color })} /></Row>
        <Row label="Etikettfärg"><ColorInput value={d.labelColor ?? d.color} onChange={(labelColor) => update({ labelColor })} /></Row>
      </div>
      <Row label="Placering">
        <Select value={d.arrange} onValueChange={(arrange) => update({ arrange })}>
          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">Automatiskt (rad om bred)</SelectItem>
            <SelectItem value="row">Rad</SelectItem>
            <SelectItem value="column">Lista</SelectItem>
          </SelectContent>
        </Select>
      </Row>
      <label className="flex items-center justify-between gap-3">
        <span className="text-sm">Avdelare</span>
        <Switch checked={d.dividers} onCheckedChange={(dividers) => update({ dividers })} />
      </label>
    </div>
  );
}

const RACE_FIELD_LABELS = {
  none: "Inget (vanlig text)",
  title: "Loppets namn",
  subtitle: "Ort · år",
  runnerName: "Löparens namn",
  date: "Datum",
  customLine: "Egen rad",
} as const;

export function RaceFieldInspector({ layer, update }: { layer: Extract<TemplateLayer, { type: "text" }>; update: Update }) {
  const d = layer.defaults;
  return (
    <div className="space-y-3 border-t pt-4">
      <Heading>Lopptavla — textkälla</Heading>
      <Row label="Texten hämtas från loppanelen">
        <Select value={d.raceField ?? "none"} onValueChange={(v) => update({ raceField: v === "none" ? undefined : v })}>
          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
          <SelectContent>
            {Object.entries(RACE_FIELD_LABELS).map(([k, label]) => (
              <SelectItem key={k} value={k}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Row>
      {d.raceField && (
        <label className="flex items-center justify-between gap-3">
          <span className="text-sm">Versaler</span>
          <Switch checked={!!d.raceFieldUppercase} onCheckedChange={(raceFieldUppercase) => update({ raceFieldUppercase })} />
        </label>
      )}
    </div>
  );
}

/** Lager-nivå: dolt när kunden öppnar editorn. */
export function HiddenByDefaultToggle({ layer, onChange }: { layer: TemplateLayer; onChange: (next: TemplateLayer) => void }) {
  if (layer.locks.visibility) return null;
  return (
    <label className="flex items-center justify-between gap-3 border-t pt-4">
      <span className="text-sm">Dolt från start (kunden kan slå på)</span>
      <Switch
        checked={!!layer.hiddenByDefault}
        onCheckedChange={(on) => onChange({ ...layer, hiddenByDefault: on || undefined } as TemplateLayer)}
      />
    </label>
  );
}
