// Sporttavlornas startmallar: giltiga mallar, samma fält i alla stilar,
// text inom säkerhetsmarginalen, grafiken finns och allt kunden ser är
// översatt till en, da och fi.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { templateSchema, type Template, type TemplateLayer } from "@/lib/template-schema";
import { applySportSeed, SPORT_SEEDS, type SportSeedKey } from "@/lib/sport/seed-templates";
import { localizeTemplate } from "@/lib/template-i18n";
import { sumDurations } from "@/lib/text-typography";

const base: Template = {
  version: 1,
  publishedAt: null,
  productOptions: { poster: { enabled: true, allowedSizes: ["30x40"], allowedFrames: ["Ingen"] } },
  orientations: ["portrait", "landscape"],
  defaultLayout: {
    portrait: { aspect: "3:4", background: { color: "#FFFFFF" }, layers: [] },
    landscape: { aspect: "4:3", background: { color: "#FFFFFF" }, layers: [] },
  },
  sizeOverrides: {},
  extraLayouts: [],
  contentVariants: [],
};

type TextLayer = Extract<TemplateLayer, { type: "text" }>;

function layouts(t: Template) {
  return [
    { name: t.defaultLayoutName!, layers: t.defaultLayout.portrait.layers },
    ...t.extraLayouts.map((x) => ({ name: x.name, layers: x.defaultLayout.portrait.layers })),
  ];
}

const KEYS = Object.keys(SPORT_SEEDS) as SportSeedKey[];

describe.each(KEYS)("startmall %s", (key) => {
  const tpl = templateSchema.parse(applySportSeed(base, key));

  it("är en giltig mall med fyra stående stilar", () => {
    expect(tpl.orientations).toEqual(["portrait"]);
    expect(layouts(tpl)).toHaveLength(4);
  });

  it("kundfälten har samma namn, grupp och förvalda text i alla stilar", () => {
    const seen = new Map<string, { name: string; group: string; text: string }>();
    for (const lay of layouts(tpl)) {
      for (const l of lay.layers) {
        if (l.type !== "text" || !l.defaults.formGroup) continue;
        const cur = { name: l.name, group: l.defaults.formGroup, text: l.defaults.text };
        const prev = seen.get(l.id);
        if (prev) expect(cur, `${lay.name}: ${l.id}`).toEqual(prev);
        else seen.set(l.id, cur);
        expect(l.locks.content, l.id).toBe(false);
      }
    }
    expect(seen.size).toBeGreaterThan(5);
  });

  it("varianterna pekar på kundfält och den förvalda varianten stämmer med fältens text", () => {
    const fieldIds = new Set(
      layouts(tpl).flatMap((x) => x.layers.filter((l) => l.type === "text" && l.defaults.formGroup).map((l) => l.id)),
    );
    const texts = new Map(
      layouts(tpl).flatMap((x) => x.layers.filter((l): l is TextLayer => l.type === "text").map((l) => [l.id, l.defaults.text])),
    );
    for (const v of tpl.contentVariants) {
      for (const id of Object.keys(v.overrides)) expect(fieldIds.has(id), `${v.id}: ${id}`).toBe(true);
    }
    const def = tpl.contentVariants.find((v) => v.id === tpl.defaultContentVariantId)!;
    expect(def).toBeTruthy();
    for (const [id, ov] of Object.entries(def.overrides)) expect(ov.text).toBe(texts.get(id));
  });

  it("summafälten stämmer med delfältens förvalda tider", () => {
    for (const lay of layouts(tpl)) {
      const byId = new Map(lay.layers.map((l) => [l.id, l]));
      for (const l of lay.layers) {
        if (l.type !== "text" || !l.defaults.sumTimesOf) continue;
        const parts = l.defaults.sumTimesOf.map((id) => {
          const src = byId.get(id) ?? layouts(tpl).flatMap((x) => x.layers).find((x) => x.id === id);
          return src && src.type === "text" ? src.defaults.text : "";
        });
        expect(sumDurations(parts), `${lay.name}: ${l.id}`).toBe(l.defaults.text);
      }
    }
  });

  it("all text ligger inom 8 % säkerhetsmarginal", () => {
    for (const lay of layouts(tpl)) {
      for (const l of lay.layers) {
        if (l.type !== "text") continue;
        const where = `${lay.name}: ${l.id}`;
        expect(l.xPct, where).toBeGreaterThanOrEqual(7.99);
        expect(l.yPct, where).toBeGreaterThanOrEqual(7.99);
        expect(l.xPct + l.wPct, where).toBeLessThanOrEqual(92.01);
        expect(l.yPct + l.hPct, where).toBeLessThanOrEqual(92.01);
      }
    }
  });

  it("grafiken finns i public/sport", () => {
    const urls = [
      ...layouts(tpl).flatMap((x) => x.layers.filter((l) => l.type === "image").map((l) => (l.type === "image" ? l.defaults.url : ""))),
      ...tpl.contentVariants.map((v) => v.thumbnailUrl ?? ""),
    ];
    for (const url of urls) {
      expect(url).toMatch(/^https:\/\/artful-create-studio-87\.lovable\.app\/sport\/[a-z0-9-]+\.svg\?v=\d+$/);
      const file = url.replace(/^.*\/sport\//, "").replace(/\?.*$/, "");
      expect(existsSync(resolve(__dirname, "../../../public/sport", file)), file).toBe(true);
    }
  });

  it.each(["en", "da", "fi"])("allt kunden ser har en rad i mallens ordlista för %s", (lang) => {
    const dict = tpl.i18n?.[lang] ?? {};
    const needs = new Set<string>([
      tpl.defaultLayoutName!,
      ...tpl.extraLayouts.map((x) => x.name),
      tpl.contentVariantLabel!,
      ...tpl.contentVariants.map((v) => v.name),
      ...tpl.contentVariants.flatMap((v) => Object.values(v.overrides).map((o) => o.text ?? "")),
    ]);
    for (const lay of layouts(tpl)) {
      for (const l of lay.layers) {
        if (l.type !== "text") continue;
        if (l.defaults.formGroup) {
          needs.add(l.name);
          needs.add(l.defaults.formGroup);
        }
        needs.add(l.defaults.text);
      }
    }
    // Personnamn och siffror (tider, nummer, sträckor utan decimaler) är
    // desamma på alla språk och behöver ingen rad.
    const exempt = (s: string) => !/\p{L}/u.test(s.replace(/\bkm\b/g, "")) || /^(Anna Lindqvist|Linnea Berg|Johan Ek)$/.test(s);
    const missing = [...needs].filter((s) => s && !exempt(s) && dict[s] === undefined);
    expect(missing, lang).toEqual([]);
  });

  it("översätts utan att tappa fält", () => {
    const en = localizeTemplate(tpl, "en");
    expect(layouts(en).map((x) => x.layers.length)).toEqual(layouts(tpl).map((x) => x.layers.length));
    const groups = layouts(en).flatMap((x) => x.layers.filter((l): l is TextLayer => l.type === "text").map((l) => l.defaults.formGroup));
    expect(groups).not.toContain("Om dig");
  });
});
