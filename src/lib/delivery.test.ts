import { describe, expect, it } from "vitest";
import { deliveryEstimate, freeShippingThresholdSek } from "./delivery";

describe("delivery", () => {
  it("ger DK och FI samma fri-frakt-gräns som övriga EU", () => {
    expect(freeShippingThresholdSek("DK")).toBe(599);
    expect(freeShippingThresholdSek("fi")).toBe(599);
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
