import { describe, expect, it } from "vitest";
import { deliveryEstimate, freeShippingThresholdSek } from "./delivery";

describe("delivery", () => {
  it("visar ingen fri-frakt-gräns för DK och FI", () => {
    expect(freeShippingThresholdSek("DK")).toBeNull();
    expect(freeShippingThresholdSek("fi")).toBeNull();
  });

  it("behåller policyns gränser för SE och övriga EU", () => {
    expect(freeShippingThresholdSek("SE")).toBe(499);
    expect(freeShippingThresholdSek(null)).toBe(499);
    expect(freeShippingThresholdSek("DE")).toBe(599);
  });

  it("ger EU-leveranstider för DK/FI", () => {
    expect(deliveryEstimate("posters", "DK")).toEqual({ minDays: 4, maxDays: 7 });
    expect(deliveryEstimate("canvas", "FI")).toEqual({ minDays: 5, maxDays: 8 });
  });
});
