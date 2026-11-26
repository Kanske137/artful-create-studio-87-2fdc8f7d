// Översättning av mallinnehåll (layoutnamn, motivnamn, AI-stilar, förvalda
// texter, lagernamn och innehållsvarianter) till kundens språk.
//
// Källspråket är svenska: allt i product_configs.template skrivs på svenska i
// admin. Översättningarna slås upp på den svenska texten i två ordlistor:
//   1. mallens egen `template.i18n[språk]` (redigeras i admin, vinner), och
//   2. den gemensamma ordlistan i src/i18n/template-strings (i koden).
// Saknas en översättning visas svenskan, så en mall går aldrig sönder av att
// en text är oöversatt.
//
// localizeTemplate() körs EN gång när kundeditorn laddar mallen
// (editorStore.setConfig). Allt nedströms — förhandsvisning, tryckfil,
// kundvagnsbild — läser samma översatta mall, så kunden får det hon ser.
// Admin läser alltid den svenska originalmallen.
import type { OrientationLayout, Template, TemplateLayer, TextSpan } from "./template-schema";

export const SOURCE_LOCALE = "sv";
export const TRANSLATION_LOCALES = ["en", "da", "fi"] as const;
export type TranslationLocale = (typeof TRANSLATION_LOCALES)[number];

/** Ordlista per språk: svensk källtext → översättning. */
export type TemplateDictionary = Record<string, string>;
export type TemplateDictionaries = Partial<Record<TranslationLocale, TemplateDictionary>>;

/** Standardlayoutens namn när admin inte har döpt den (se getAllLayouts). */
export const IMPLICIT_STANDARD_LAYOUT_NAME = "Standard";

export function baseLocale(lang: string | null | undefined): string {
  return (lang ?? SOURCE_LOCALE).toLowerCase().split(/[-_]/)[0] || SOURCE_LOCALE;
}

export function isTranslationLocale(lang: string): lang is TranslationLocale {
  return (TRANSLATION_LOCALES as readonly string[]).includes(lang);
}

const TOKEN_RE = /\[\[[a-z]+\]\]/g;

/** Platshållarna ([[city]], [[date]] …) i en text, sorterade. */
export function tokensOf(text: string): string {
  return (text.match(TOKEN_RE) ?? []).sort().join(",");
}

/** En översättning används bara om den är ifylld och har samma platshållare
 *  som källtexten — annars skulle t.ex. [[city]] försvinna från tavlan. */
export function isValidTranslation(source: string, target: string | undefined | null): target is string {
  if (typeof target !== "string" || target.trim() === "") return false;
  return tokensOf(source) === tokensOf(target);
}

/** Har texten något att översätta (bokstäver utanför platshållarna)? */
export function hasTranslatableText(text: string | null | undefined): text is string {
  if (!text) return false;
  return /\p{L}/u.test(text.replace(TOKEN_RE, ""));
}

/** Slå ihop gemensam ordlista och mallens egna översättningar för ett språk. */
export function buildDictionary(
  lang: string,
  template: Pick<Template, "i18n"> | null | undefined,
  common: TemplateDictionaries = {},
): TemplateDictionary {
  const base = baseLocale(lang);
  if (!isTranslationLocale(base)) return {};
  // Mallens ogiltiga översättningar (tomma, tappade platshållare) får inte
  // skugga en giltig rad i den gemensamma ordlistan.
  const own = Object.entries(template?.i18n?.[base] ?? {}).filter(([sv, v]) => isValidTranslation(sv, v));
  return { ...(common[base] ?? {}), ...Object.fromEntries(own) };
}

export function translateString(source: string, dict: TemplateDictionary): string {
  const hit = dict[source];
  if (isValidTranslation(source, hit)) return hit;
  // Tolerera skillnad i omgivande blanksteg (vanligt efter kopiering i admin).
  const trimmed = source.trim();
  if (trimmed !== source) {
    const hit2 = dict[trimmed];
    if (isValidTranslation(trimmed, hit2)) return source.replace(trimmed, hit2);
  }
  return source;
}

function lineBounds(text: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let pos = 0;
  for (const line of text.split("\n")) {
    out.push([pos, pos + line.length]);
    pos += line.length + 1;
  }
  return out;
}

/** Flytta textens stilavsnitt (spans) till den översatta texten.
 *  - Avsnitt som täcker hela texten täcker hela översättningen.
 *  - Avsnitt som täcker hela rader följer raden, om radantalet är detsamma.
 *  - Övriga avsnitt kan inte flyttas säkert och släpps (texten får lagrets
 *    grundstil i stället för fel stil på fel tecken). */
export function remapSpans(
  spans: TextSpan[] | undefined,
  source: string,
  target: string,
): TextSpan[] | undefined {
  if (!spans || spans.length === 0 || source === target) return spans;
  const srcLines = lineBounds(source);
  const dstLines = lineBounds(target);
  const out: TextSpan[] = [];
  for (const s of spans) {
    if (s.start <= 0 && s.end >= source.length) {
      if (target.length > 0) out.push({ ...s, start: 0, end: target.length });
      continue;
    }
    if (srcLines.length === dstLines.length) {
      const startLine = srcLines.findIndex(([a]) => a === s.start);
      const endLine = srcLines.findIndex(([, e]) => e === s.end || e + 1 === s.end);
      if (startLine >= 0 && endLine >= startLine) {
        const start = dstLines[startLine]![0];
        const end = dstLines[endLine]![1] + (srcLines[endLine]![1] + 1 === s.end ? 1 : 0);
        if (end > start) out.push({ ...s, start, end: Math.min(end, target.length) });
      }
    }
  }
  return out;
}

function localizeLayer(layer: TemplateLayer, dict: TemplateDictionary): TemplateLayer {
  const name = translateString(layer.name, dict);
  if (layer.type === "text") {
    // Formulärgruppens rubrik (kundpanelen) översätts som lagernamnen.
    const d0 = layer.defaults;
    const formGroup = d0.formGroup ? translateString(d0.formGroup, dict) : d0.formGroup;
    const d = formGroup === d0.formGroup ? d0 : { ...d0, formGroup };
    const base = d === d0 ? layer : { ...layer, defaults: d };
    if (d.mirrorTextLayerId || !hasTranslatableText(d.text)) {
      return name === layer.name ? base : { ...base, name };
    }
    const text = translateString(d.text, dict);
    if (text === d.text) return name === layer.name ? base : { ...base, name };
    return { ...layer, name, defaults: { ...d, text, spans: remapSpans(d.spans, d.text, text) } };
  }
  if (layer.type === "aiPhoto") {
    const d = layer.defaults;
    return {
      ...layer,
      name,
      defaults: {
        ...d,
        referenceImages: (d.referenceImages ?? []).map((r) =>
          r.label ? { ...r, label: translateString(r.label, dict) } : r,
        ),
        multiFaceSwap: d.multiFaceSwap
          ? {
              ...d.multiFaceSwap,
              slots: d.multiFaceSwap.slots.map((s) => ({ ...s, label: translateString(s.label, dict) })),
            }
          : d.multiFaceSwap,
      },
    };
  }
  if (layer.type === "map" || layer.type === "starmap") {
    // Förvald plats (t.ex. "Stockholm, Sverige") visas på tavlan via [[city]]
    // och [[country]] tills kunden söker en egen plats.
    const d = layer.defaults as { placeName?: string; city?: string; country?: string };
    const place = {
      ...(d.placeName ? { placeName: translateString(d.placeName, dict) } : {}),
      ...(d.city ? { city: translateString(d.city, dict) } : {}),
      ...(d.country ? { country: translateString(d.country, dict) } : {}),
    };
    return { ...layer, name, defaults: { ...layer.defaults, ...place } } as TemplateLayer;
  }
  return name === layer.name ? layer : { ...layer, name };
}

function localizeOrientationLayout(layout: OrientationLayout, dict: TemplateDictionary): OrientationLayout {
  return { ...layout, layers: layout.layers.map((l) => localizeLayer(l, dict)) };
}

function localizeBlock<B extends { portrait: OrientationLayout; landscape: OrientationLayout }>(
  block: B,
  dict: TemplateDictionary,
): B {
  return {
    ...block,
    portrait: localizeOrientationLayout(block.portrait, dict),
    landscape: localizeOrientationLayout(block.landscape, dict),
  };
}

/** Översätt mallen till `lang`. Svenska (och språk utan ordlista) ger
 *  tillbaka samma objekt. */
export function localizeTemplate(
  template: Template,
  lang: string | null | undefined,
  common: TemplateDictionaries = {},
): Template {
  const dict = buildDictionary(baseLocale(lang), template, common);
  if (Object.keys(dict).length === 0) return template;
  const tr = (s: string) => translateString(s, dict);

  const standardSource = template.defaultLayoutName?.trim() || IMPLICIT_STANDARD_LAYOUT_NAME;
  const standardName = tr(standardSource);
  const aiStyles = template.productOptions.aiStyles?.map((a) => {
    const label = tr(a.label);
    return label === a.label ? a : { ...a, label, sourceLabel: a.label };
  });

  return {
    ...template,
    defaultLayoutName:
      template.defaultLayoutName || standardName !== standardSource ? standardName : template.defaultLayoutName,
    productOptions: aiStyles ? { ...template.productOptions, aiStyles } : template.productOptions,
    contentVariantLabel: template.contentVariantLabel ? tr(template.contentVariantLabel) : template.contentVariantLabel,
    contentVariants: (template.contentVariants ?? []).map((v) => ({
      ...v,
      name: tr(v.name),
      overrides: Object.fromEntries(
        Object.entries(v.overrides ?? {}).map(([layerId, ov]) => [
          layerId,
          ov.text && hasTranslatableText(ov.text) ? { ...ov, text: tr(ov.text) } : ov,
        ]),
      ),
    })),
    defaultLayout: localizeBlock(template.defaultLayout, dict),
    canvasLayout: template.canvasLayout ? localizeBlock(template.canvasLayout, dict) : template.canvasLayout,
    extraLayouts: (template.extraLayouts ?? []).map((x) => ({
      ...x,
      name: tr(x.name),
      defaultLayout: localizeBlock(x.defaultLayout, dict),
      canvasLayout: x.canvasLayout ? localizeBlock(x.canvasLayout, dict) : x.canvasLayout,
    })),
  };
}

// ---------- insamling (för admin och kontroller) ----------

export type TranslatableKind =
  | "layout"
  | "aiStyle"
  | "motif"
  | "slot"
  | "variantLabel"
  | "variant"
  | "text"
  | "place"
  | "layerName";

export const TRANSLATABLE_KIND_ORDER: TranslatableKind[] = [
  "layout",
  "aiStyle",
  "motif",
  "slot",
  "variantLabel",
  "variant",
  "text",
  "place",
  "layerName",
];

export interface TranslatableString {
  source: string;
  kind: TranslatableKind;
}

/** Lager vars namn kunden kan se (rubrik i panelen när mallen har flera). */
function customerSeesLayerName(layer: TemplateLayer): boolean {
  if (layer.type === "text") {
    const l = layer.locks;
    if (layer.defaults.mirrorTextLayerId) return false;
    return !l.content || !l.font || !l.visibility || !l.size || !l.move;
  }
  return ["map", "photo", "aiPhoto", "starmap", "elevation", "raceStats", "splits"].includes(layer.type);
}

/** Alla svenska texter i mallen som kunden kan se, en gång var, i den
 *  ordning admin bör översätta dem. */
export function collectTranslatableStrings(template: Template): TranslatableString[] {
  const seen = new Map<string, TranslatableString>();
  const add = (kind: TranslatableKind, s: string | null | undefined, requireLetters = true) => {
    if (!s || !s.trim()) return;
    if (requireLetters && !hasTranslatableText(s)) return;
    const key = `${kind}\u0000${s}`;
    if (!seen.has(key)) seen.set(key, { source: s, kind });
  };

  add("layout", template.defaultLayoutName?.trim() || IMPLICIT_STANDARD_LAYOUT_NAME);
  for (const x of template.extraLayouts ?? []) add("layout", x.name);
  for (const a of template.productOptions.aiStyles ?? []) if (a.enabled !== false) add("aiStyle", a.label);
  add("variantLabel", template.contentVariantLabel);
  for (const v of template.contentVariants ?? []) {
    add("variant", v.name);
    for (const ov of Object.values(v.overrides ?? {})) add("text", ov.text);
  }

  const blocks: OrientationLayout[] = [];
  const pushBlock = (b?: { portrait: OrientationLayout; landscape: OrientationLayout }) => {
    if (b) blocks.push(b.portrait, b.landscape);
  };
  pushBlock(template.defaultLayout);
  pushBlock(template.canvasLayout);
  for (const x of template.extraLayouts ?? []) {
    pushBlock(x.defaultLayout);
    pushBlock(x.canvasLayout);
  }
  for (const layout of blocks) {
    for (const layer of layout.layers) {
      if (layer.type === "text" && !layer.defaults.mirrorTextLayerId) add("text", layer.defaults.text);
      if (layer.type === "aiPhoto") {
        for (const r of layer.defaults.referenceImages ?? []) add("motif", r.label);
        for (const s of layer.defaults.multiFaceSwap?.slots ?? []) add("slot", s.label);
      }
      if (layer.type === "map" || layer.type === "starmap") {
        const d = layer.defaults as { placeName?: string; city?: string; country?: string };
        add("place", d.placeName);
        add("place", d.city);
        add("place", d.country);
      }
      if (customerSeesLayerName(layer)) {
        add("layerName", layer.name);
        if (layer.type === "text") add("layerName", layer.defaults.formGroup);
      }
    }
  }

  const order = new Map(TRANSLATABLE_KIND_ORDER.map((k, i) => [k, i]));
  return [...seen.values()].sort((a, b) => order.get(a.kind)! - order.get(b.kind)!);
}

export type TranslationStatus = "template" | "common" | "same" | "missing";

/** Var översättningen kommer ifrån: mallen, den gemensamma ordlistan, en
 *  text som är likadan på alla språk (namn, engelska, latin) eller saknas. */
export function translationStatus(
  source: string,
  lang: TranslationLocale,
  template: Pick<Template, "i18n">,
  common: TemplateDictionaries,
  sameInAll: ReadonlySet<string>,
): TranslationStatus {
  if (isValidTranslation(source, template.i18n?.[lang]?.[source])) return "template";
  if (isValidTranslation(source, common[lang]?.[source])) return "common";
  if (sameInAll.has(source)) return "same";
  return "missing";
}
