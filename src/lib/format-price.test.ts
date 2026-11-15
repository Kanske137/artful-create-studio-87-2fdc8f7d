import { describe, expect, it } from "vitest";
import { hasKnownRate } from "./format-price";

describe("hasKnownRate", () => {
  it("svenska kronor räknas alltid som känd kurs", () => {
    expect(hasKnownRate({ currency: "SEK", rate: 1 })).toBe(true);
  });
  it("EU-marknaden med omräknad valuta har en riktig kurs", () => {
    expect(hasKnownRate({ currency: "EUR", rate: 0.0913 })).toBe(true);
  });
  it("Danmark och Finland med egen basvaluta får kurs 1 från temat och räknas som okänd", () => {
    expect(hasKnownRate({ currency: "DKK", rate: 1 })).toBe(false);
    expect(hasKnownRate({ currency: "EUR", rate: 1 })).toBe(false);
  });
});
