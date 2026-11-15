// Kundeditorns språkfiler: svenska, engelska, danska och finska ska ha exakt
// samma nycklar och samma variabler ({{name}} m.fl.), så att ingen text
// faller tillbaka till svenska på ett lanserat språk.
import { describe, expect, it } from "vitest";
import sv from "./locales/sv.json";
import en from "./locales/en.json";
import da from "./locales/da.json";
import fi from "./locales/fi.json";

type Tree = { [k: string]: string | Tree };

function flatten(tree: Tree, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out[key] = v;
    else Object.assign(out, flatten(v, key));
  }
  return out;
}

const SV = flatten(sv as Tree);
const LANGS = { en: flatten(en as Tree), da: flatten(da as Tree), fi: flatten(fi as Tree) };
const vars = (s: string) => (s.match(/\{\{\s*\w+\s*\}\}/g) ?? []).map((v) => v.replace(/\s/g, "")).sort();

describe("språkfiler", () => {
  for (const [lang, dict] of Object.entries(LANGS)) {
    it(`${lang} har samma nycklar som sv`, () => {
      expect(Object.keys(dict).sort()).toEqual(Object.keys(SV).sort());
    });

    it(`${lang} har samma variabler som sv och inga tomma texter`, () => {
      for (const [key, value] of Object.entries(dict)) {
        expect(value.trim(), `${lang}.${key}`).not.toBe("");
        expect(vars(value), `${lang}.${key}`).toEqual(vars(SV[key] ?? ""));
      }
    });
  }
});
