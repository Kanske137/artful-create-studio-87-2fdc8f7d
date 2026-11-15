import { describe, expect, it } from "vitest";
import { templateSchema, type Template } from "./template-schema";
import {
  collectTranslatableStrings,
  localizeTemplate,
  remapSpans,
  translationStatus,
  type TemplateDictionaries,
} from "./template-i18n";
import { SAME_IN_ALL_LANGUAGES, TEMPLATE_STRINGS } from "@/i18n/template-strings";
import { applyRaceSeed } from "./race/seed-template";

const locks = { position: true, size: true, shape: true, content: false, font: true, visibility: true, style: true };

function layout(layers: unknown[]) {
  return { aspect: "3:4", background: { color: "#FFFFFF" }, layers };
}

function makeTemplate(extra: Record<string, unknown> = {}): Template {
  const layers = [
    {
      id: "title", name: "Rubrik", type: "text", xPct: 10, yPct: 10, wPct: 80, hPct: 10, zIndex: 2, locks,
      defaults: { text: "Bästa vän", font: "Inter", align: "center", color: "#111111", spans: [{ start: 0, end: 9, bold: true }] },
    },
    {
      id: "place", name: "Plats", type: "text", xPct: 10, yPct: 30, wPct: 80, hPct: 10, zIndex: 3, locks,
      defaults: { text: "[[city]] · 12 Juni 2024", font: "Inter", align: "center", color: "#111111" },
    },
    {
      id: "tokens", name: "Koordinater", type: "text", xPct: 10, yPct: 40, wPct: 80, hPct: 10, zIndex: 4, locks,
      defaults: { text: "[[coords]]", font: "Inter", align: "center", color: "#111111" },
    },
    {
      id: "mirror", name: "Spegel", type: "text", xPct: 10, yPct: 50, wPct: 10, hPct: 5, zIndex: 5, locks,
      defaults: { text: "Bästa vän", font: "Inter", align: "center", color: "#111111", mirrorTextLayerId: "title" },
    },
    {
      id: "art", name: "art", type: "aiPhoto", xPct: 0, yPct: 0, wPct: 100, hPct: 100, zIndex: 1, locks,
      defaults: {
        shape: "rect", fit: "cover",
        referenceImages: [{ id: "r1", url: "https://example.com/a.png", label: "Hermelinkungen" }],
        multiFaceSwap: { enabled: true, slots: [{ id: "a", label: "Kung", position: "left" }, { id: "b", label: "Drottning", position: "right" }] },
      },
    },
  ];
  return templateSchema.parse({
    version: 1,
    productOptions: {
      poster: { enabled: true, allowedSizes: ["30x40"], allowedFrames: ["Ingen"] },
      aiStyles: [{ id: "oil", label: "Olja", prompt: "oil painting" }],
    },
    orientations: ["portrait"],
    defaultLayout: { portrait: layout(layers), landscape: layout(layers) },
    extraLayouts: [{ id: "x", name: "Renässans", defaultLayout: { portrait: layout(layers), landscape: layout(layers) } }],
    contentVariantLabel: "Drink",
    contentVariants: [{ id: "neg", name: "Negroni", overrides: { title: { text: "Bästa vän" } } }],
    ...extra,
  });
}

describe("localizeTemplate", () => {
  it("lämnar svenska orörd", () => {
    const tpl = makeTemplate();
    expect(localizeTemplate(tpl, "sv", TEMPLATE_STRINGS)).toBe(tpl);
    expect(localizeTemplate(tpl, "sv-SE", TEMPLATE_STRINGS)).toBe(tpl);
  });

  it("översätter layoutnamn, AI-stilar, motiv, personer, varianter, texter och lagernamn", () => {
    const fi = localizeTemplate(makeTemplate(), "fi", TEMPLATE_STRINGS);
    expect(fi.defaultLayoutName).toBe("Perus");
    expect(fi.extraLayouts[0]!.name).toBe("Renessanssi");
    expect(fi.productOptions.aiStyles![0]).toMatchObject({ label: "Öljy", sourceLabel: "Olja", prompt: "oil painting" });
    expect(fi.contentVariantLabel).toBe("Drinkki");
    expect(fi.contentVariants[0]!.name).toBe("Negroni");
    expect(fi.contentVariants[0]!.overrides.title!.text).toBe("Paras ystävä");

    const layers = fi.defaultLayout.portrait.layers;
    const title = layers.find((l) => l.id === "title")!;
    expect(title.name).toBe("Otsikko");
    expect(title.type === "text" && title.defaults.text).toBe("Paras ystävä");
    const place = layers.find((l) => l.id === "place")!;
    expect(place.type === "text" && place.defaults.text).toBe("[[city]] · 12. kesäkuuta 2024");
    const art = layers.find((l) => l.id === "art")!;
    expect(art.type === "aiPhoto" && art.defaults.referenceImages[0]!.label).toBe("Kärppäkuningas");
    expect(art.type === "aiPhoto" && art.defaults.multiFaceSwap!.slots.map((s) => s.label)).toEqual(["Kuningas", "Kuningatar"]);
    expect(fi.extraLayouts[0]!.defaultLayout.landscape.layers.find((l) => l.id === "title")!.name).toBe("Otsikko");
  });

  it("flyttar stilavsnitt som täcker hela texten till översättningen", () => {
    const en = localizeTemplate(makeTemplate(), "en-GB", TEMPLATE_STRINGS);
    const title = en.defaultLayout.portrait.layers.find((l) => l.id === "title")!;
    expect(title.type === "text" && title.defaults.text).toBe("Best friend");
    expect(title.type === "text" && title.defaults.spans).toEqual([{ start: 0, end: 11, bold: true }]);
  });

  it("rör inte speglade texter eller texter med bara platshållare", () => {
    const da = localizeTemplate(makeTemplate(), "da", TEMPLATE_STRINGS);
    const layers = da.defaultLayout.portrait.layers;
    const mirror = layers.find((l) => l.id === "mirror")!;
    expect(mirror.type === "text" && mirror.defaults.text).toBe("Bästa vän");
    const tokens = layers.find((l) => l.id === "tokens")!;
    expect(tokens.type === "text" && tokens.defaults.text).toBe("[[coords]]");
  });

  it("låter mallens egna översättningar vinna och ignorerar dem som tappar platshållare", () => {
    const tpl = makeTemplate({
      i18n: { en: { "Bästa vän": "My best friend", "[[city]] · 12 Juni 2024": "12 June 2024" } },
    });
    const en = localizeTemplate(tpl, "en", TEMPLATE_STRINGS);
    const layers = en.defaultLayout.portrait.layers;
    const title = layers.find((l) => l.id === "title")!;
    expect(title.type === "text" && title.defaults.text).toBe("My best friend");
    // Översättningen saknar [[city]] → den gemensamma ordlistan används i stället.
    const place = layers.find((l) => l.id === "place")!;
    expect(place.type === "text" && place.defaults.text).toBe("[[city]] · 12 June 2024");
  });

  it("översätter kartans förvalda plats", () => {
    const mapLayer = {
      id: "map", name: "Karta", type: "map", xPct: 0, yPct: 0, wPct: 100, hPct: 60, zIndex: 0, locks,
      defaults: { shape: "rect", styleId: "light-v11", center: [18.07, 59.33], zoom: 12, showLabels: true, placeName: "Stockholm", city: "Stockholm", country: "Sverige" },
    };
    const tpl = makeTemplate({ defaultLayout: { portrait: layout([mapLayer]), landscape: layout([mapLayer]) } });
    const fi = localizeTemplate(tpl, "fi", TEMPLATE_STRINGS).defaultLayout.portrait.layers[0]!;
    expect(fi.type === "map" && [fi.defaults.city, fi.defaults.country, fi.name]).toEqual(["Tukholma", "Ruotsi", "Kartta"]);
    const en = localizeTemplate(tpl, "en", TEMPLATE_STRINGS).defaultLayout.portrait.layers[0]!;
    expect(en.type === "map" && en.defaults.country).toBe("Sweden");
  });

  it("visar svenskan när en text saknar översättning", () => {
    const tpl = makeTemplate({ extraLayouts: [{ id: "y", name: "Helt ny stil", defaultLayout: makeTemplate().defaultLayout }] });
    expect(localizeTemplate(tpl, "da", TEMPLATE_STRINGS).extraLayouts[0]!.name).toBe("Helt ny stil");
  });

  it("ger tillbaka mallen för språk utan ordlista", () => {
    const tpl = makeTemplate();
    expect(localizeTemplate(tpl, "de", TEMPLATE_STRINGS)).toBe(tpl);
  });
});

describe("översatta mallar är fortfarande giltiga", () => {
  const raceBase = {
    version: 1 as const,
    publishedAt: null,
    productOptions: { poster: { enabled: true, allowedSizes: ["30x40"], allowedFrames: ["Ingen"] } },
    orientations: ["portrait" as const],
    defaultLayout: {
      portrait: { aspect: "3:4" as const, background: { color: "#FFFFFF" }, layers: [] },
      landscape: { aspect: "4:3" as const, background: { color: "#FFFFFF" }, layers: [] },
    },
    sizeOverrides: {},
    extraLayouts: [],
    contentVariants: [],
  };
  const race = templateSchema.parse(applyRaceSeed(raceBase));

  for (const lang of ["en", "da", "fi"] as const) {
    it(`${lang}: testmallen och lopptavlans startmall klarar schemat`, () => {
      for (const tpl of [makeTemplate(), race]) {
        const out = localizeTemplate(tpl, lang, TEMPLATE_STRINGS);
        const r = templateSchema.safeParse(out);
        if (!r.success) throw new Error(JSON.stringify(r.error.issues.slice(0, 3)));
        for (const block of [out.defaultLayout.portrait, out.defaultLayout.landscape]) {
          for (const l of block.layers) {
            if (l.type !== "text") continue;
            for (const s of l.defaults.spans ?? []) {
              expect(s.start).toBeGreaterThanOrEqual(0);
              expect(s.end).toBeLessThanOrEqual(l.defaults.text.length);
              expect(s.end).toBeGreaterThan(s.start);
            }
          }
        }
      }
    });
  }

  it("översätter lopptavlans platshållartexter", () => {
    const out = localizeTemplate(race, "da", TEMPLATE_STRINGS);
    const texts = out.defaultLayout.portrait.layers.flatMap((l) => (l.type === "text" ? [l.defaults.text] : []));
    expect(texts).toEqual(expect.arrayContaining(["Dit løb", "Dit navn", "By · Dato", "Mit første maraton"]));
    expect(out.extraLayouts.map((x) => x.name)).toContain("Blåtryk");
  });
});

describe("remapSpans", () => {
  it("följer hela rader när radantalet är detsamma", () => {
    const src = "Ingredienser:\n6 cl gin";
    const dst = "Ingredients:\n6 cl gin";
    expect(remapSpans([{ start: 0, end: 13, bold: true }], src, dst)).toEqual([{ start: 0, end: 12, bold: true }]);
  });

  it("släpper avsnitt mitt i en rad", () => {
    expect(remapSpans([{ start: 2, end: 4, bold: true }], "Bästa vän", "Best friend")).toEqual([]);
  });
});

describe("collectTranslatableStrings", () => {
  it("listar texter kunden ser, en gång var, utan platshållartexter", () => {
    const found = collectTranslatableStrings(makeTemplate());
    const by = (kind: string) => found.filter((f) => f.kind === kind).map((f) => f.source);
    expect(by("layout")).toEqual(["Standard", "Renässans"]);
    expect(by("aiStyle")).toEqual(["Olja"]);
    expect(by("motif")).toEqual(["Hermelinkungen"]);
    expect(by("slot")).toEqual(["Kung", "Drottning"]);
    expect(by("variant")).toEqual(["Negroni"]);
    expect(by("text")).toEqual(["Bästa vän", "[[city]] · 12 Juni 2024"]);
    expect(by("layerName")).toContain("Rubrik");
    expect(by("layerName")).not.toContain("Spegel");
  });
});

describe("translationStatus", () => {
  const common: TemplateDictionaries = { en: { Olja: "Oil" } };
  const same = new Set(["Negroni"]);
  it("skiljer på mallens, gemensamma, likadana och saknade", () => {
    const tpl = makeTemplate({ i18n: { en: { Rubrik: "Headline" } } });
    expect(translationStatus("Rubrik", "en", tpl, common, same)).toBe("template");
    expect(translationStatus("Olja", "en", tpl, common, same)).toBe("common");
    expect(translationStatus("Negroni", "en", tpl, common, same)).toBe("same");
    expect(translationStatus("Plats", "en", tpl, common, same)).toBe("missing");
  });
});

describe("gemensam ordlista", () => {
  const langs = ["en", "da", "fi"] as const;
  const keys = (l: (typeof langs)[number]) => Object.keys(TEMPLATE_STRINGS[l] ?? {}).sort();

  it("har samma svenska nycklar på alla språk", () => {
    expect(keys("da")).toEqual(keys("en"));
    expect(keys("fi")).toEqual(keys("en"));
  });

  it("har ifyllda översättningar med samma platshållare", () => {
    const tok = (s: string) => (s.match(/\[\[[a-z]+\]\]/g) ?? []).sort().join(",");
    for (const l of langs) {
      for (const [sv, v] of Object.entries(TEMPLATE_STRINGS[l] ?? {})) {
        expect(v.trim(), `${l}: ${sv}`).not.toBe("");
        expect(tok(v), `${l}: ${sv}`).toBe(tok(sv));
      }
    }
  });

  it("listar inte samma text både som översatt och likadan", () => {
    for (const s of SAME_IN_ALL_LANGUAGES) expect(TEMPLATE_STRINGS.en?.[s], s).toBeUndefined();
  });
});
