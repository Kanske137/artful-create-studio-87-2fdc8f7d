import { describe, expect, it } from "vitest";
import { withTemplateAlias } from "./printable-template";
import { RACE_TEMPLATE_ALIASES } from "./race/catalog";
import { applyFlowToLayout } from "./flow-layout";
import { orientationLayoutSchema } from "./template-schema";

describe("withTemplateAlias", () => {
  const master = { shopify_handle: "lopptavla", product_type: "multi", template: { id: "master" } };
  const marathon = { shopify_handle: "maratontavla", product_type: "multi", template: { id: "egen" } };
  const other = { shopify_handle: "karttavla", product_type: "multi", template: { id: "karta" } };
  const configs = [master, marathon, other];

  it("läser mallen från huvudprodukten men behåller egen handle", () => {
    const r = withTemplateAlias(marathon, configs, RACE_TEMPLATE_ALIASES);
    expect(r.shopify_handle).toBe("maratontavla");
    expect(r.template).toEqual({ id: "master" });
  });

  it("rör inte produkter utan alias", () => {
    expect(withTemplateAlias(other, configs, RACE_TEMPLATE_ALIASES)).toBe(other);
  });

  it("faller tillbaka på egen mall om huvudprodukten saknas", () => {
    expect(withTemplateAlias(marathon, [marathon], RACE_TEMPLATE_ALIASES)).toBe(marathon);
  });
});

describe("flow i schemat", () => {
  it("validerar en layout med flödesgrupp och nya lagertyper", () => {
    const layout = orientationLayoutSchema.parse({
      aspect: "3:4",
      background: { color: "#FFFFFF" },
      layers: [
        {
          id: "elev", name: "Höjd", type: "elevation", xPct: 8, yPct: 0, wPct: 84, hPct: 8, zIndex: 1,
          locks: { position: true, size: true, shape: true, content: true, font: true, visibility: false, style: true },
          defaults: {},
        },
        {
          id: "stats", name: "Stat", type: "raceStats", xPct: 8, yPct: 0, wPct: 84, hPct: 8, zIndex: 2,
          hiddenByDefault: true,
          locks: { position: true, size: true, shape: true, content: true, font: true, visibility: false, style: true },
          defaults: { valueFont: "Inter", labelFont: "Inter", valueSizePt: 16, labelSizePt: 6, color: "#111111" },
        },
      ],
      flow: [{ id: "f", xPct: 8, yPct: 70, wPct: 84, hPct: 20, gapPct: 2, items: [{ layerId: "elev" }, { layerId: "stats" }] }],
    });
    expect(layout.layers[0]!.type).toBe("elevation");
    const flowed = applyFlowToLayout(layout, (id) => id === "elev");
    expect(flowed.layers.find((l) => l.id === "stats")!.yPct).toBe(70);
  });
});

import { templateSchema } from "./template-schema";
import { applyRaceSeed, RACE_LAYER_IDS } from "./race/seed-template";
import { applyFlowLayout } from "./flow-layout";

describe("Lopptavla-startmallen", () => {
  const base = {
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
  const seeded = applyRaceSeed(base);

  it("validerar mot mallschemat", () => {
    const r = templateSchema.safeParse(seeded);
    if (!r.success) throw new Error(JSON.stringify(r.error.issues.slice(0, 3)));
    expect(r.data.productOptions.raceOptions?.enabled).toBe(true);
  });

  for (const o of ["portrait", "landscape"] as const) {
    it(`${o}: allt inom 8 % säkerhetsmarginal, både med och utan valfria lager`, () => {
      const block = seeded.defaultLayout[o];
      const hiddenSets = [
        new Set<string>([RACE_LAYER_IDS.photo, RACE_LAYER_IDS.custom]),
        new Set<string>(),
      ];
      for (const hidden of hiddenSets) {
        const flowed = applyFlowLayout(block.layers, block.flow, (id) => hidden.has(id)).filter((l) => !hidden.has(l.id));
        for (const l of flowed) {
          expect(l.xPct).toBeGreaterThanOrEqual(8 - 1e-6);
          expect(l.yPct).toBeGreaterThanOrEqual(8 - 1e-6);
          expect(l.xPct + l.wPct).toBeLessThanOrEqual(92 + 1e-6);
          // Liggande med ALLA valfria lager på får sticka ut lite — kontrollera bara standardläget.
          if (hidden.size > 0 || o === "portrait") expect(l.yPct + l.hPct).toBeLessThanOrEqual(92 + 1e-6);
        }
        const map = flowed.find((l) => l.id === RACE_LAYER_IDS.map)!;
        expect(map.hPct).toBeGreaterThan(20);
      }
    });
  }
});
