import { describe, expect, it } from "vitest";
import { wrapPieceLines } from "./text-wrap";

type P = { text: string; k: string };
// Varje tecken är 10 px brett — förutsägbart att räkna på.
const measure = (_p: P, s: string) => s.length * 10;
const texts = (lines: P[][]) => lines.map((l) => l.map((p) => p.text).join(""));

describe("wrapPieceLines", () => {
  it("lämnar rader som får plats orörda", () => {
    const lines = [[{ text: "Stockholm", k: "a" }]];
    const out = wrapPieceLines(lines, measure, 200);
    expect(out[0]).toBe(lines[0]);
    expect(texts(out)).toEqual(["Stockholm"]);
  });

  it("bryter vid mellanslag som editorn (Stockholm Marathon på två rader)", () => {
    const out = wrapPieceLines([[{ text: "Stockholm Marathon", k: "a" }]], measure, 120);
    expect(texts(out)).toEqual(["Stockholm", "Marathon"]);
  });

  it("packar så många ord som får plats per rad", () => {
    const out = wrapPieceLines([[{ text: "New York City Marathon", k: "a" }]], measure, 130);
    expect(texts(out)).toEqual(["New York City", "Marathon"]);
  });

  it("behåller hårda radbrytningar", () => {
    const out = wrapPieceLines([[{ text: "Rad ett", k: "a" }], [], [{ text: "Rad tre", k: "a" }]], measure, 500);
    expect(texts(out)).toEqual(["Rad ett", "", "Rad tre"]);
  });

  it("bryter inom ett ord bara när ordet ensamt inte får plats", () => {
    const out = wrapPieceLines([[{ text: "ab Halvmaratonloppet", k: "a" }]], measure, 80);
    expect(texts(out)).toEqual(["ab", "Halvmara", "tonloppe", "t"]);
  });

  it("behåller stilen per bit över radbrytningen", () => {
    const out = wrapPieceLines(
      [[{ text: "Göteborgs", k: "fet" }, { text: "varvet halvmaraton", k: "tunn" }]],
      measure,
      150,
    );
    expect(texts(out)).toEqual(["Göteborgsvarvet", "halvmaraton"]);
    expect(out[0].map((p) => p.k)).toEqual(["fet", "tunn"]);
    expect(out[1].map((p) => p.k)).toEqual(["tunn"]);
  });

  it("gör inget om bredden saknas", () => {
    const lines = [[{ text: "Hej på dig", k: "a" }]];
    expect(wrapPieceLines(lines, measure, 0)).toBe(lines);
  });
});
