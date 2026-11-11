import { describe, expect, it } from "vitest";
import { applyFlowLayout } from "./flow-layout";
import type { FlowGroup } from "./template-schema";

const L = (id: string, yPct: number, hPct: number) => ({ id, yPct, hPct, xPct: 5, wPct: 90 });

// Stående lopptavla: titel 10, karta (växer), höjdprofil 8, statistik 8, namn 5.
const layers = [L("title", 0, 10), L("map", 0, 50), L("elev", 0, 8), L("stats", 0, 8), L("name", 0, 5), L("bg", 0, 100)];
const flow: FlowGroup[] = [
  {
    id: "main",
    xPct: 5, yPct: 5, wPct: 90, hPct: 90,
    gapPct: 2,
    align: "start",
    items: [
      { layerId: "title" },
      { layerId: "map", grow: true },
      { layerId: "elev" },
      { layerId: "stats" },
      { layerId: "name" },
    ],
  },
];

const byId = (ls: ReturnType<typeof applyFlowLayout<ReturnType<typeof L>>>) =>
  Object.fromEntries(ls.map((l) => [l.id, l]));

describe("applyFlowLayout", () => {
  it("är identitet utan flödesgrupper", () => {
    expect(applyFlowLayout(layers, undefined)).toBe(layers);
  });

  it("staplar lagren och låter kartan fylla resten", () => {
    const r = byId(applyFlowLayout(layers, flow));
    // 90 - 4 luckor à 2 - (10+8+8+5) = 51
    expect(r.title!.yPct).toBeCloseTo(5);
    expect(r.map!.yPct).toBeCloseTo(17);
    expect(r.map!.hPct).toBeCloseTo(51);
    expect(r.elev!.yPct).toBeCloseTo(70);
    expect(r.stats!.yPct).toBeCloseTo(80);
    expect(r.name!.yPct).toBeCloseTo(90);
    expect(r.name!.yPct + r.name!.hPct).toBeCloseTo(95);
    // Lager utanför gruppen rörs inte.
    expect(r.bg).toEqual(L("bg", 0, 100));
  });

  it("dolt lager lämnar inget hål — kartan växer", () => {
    const r = byId(applyFlowLayout(layers, flow, (id) => id === "elev"));
    expect(r.map!.hPct).toBeCloseTo(61); // +8 höjd +2 lucka
    expect(r.stats!.yPct).toBeCloseTo(80);
    expect(r.name!.yPct + r.name!.hPct).toBeCloseTo(95);
  });

  it("borttaget lager (filtrerat inför tryck) behandlas som dolt", () => {
    const printable = layers.filter((l) => l.id !== "elev");
    const r = byId(applyFlowLayout(printable, flow));
    expect(r.map!.hPct).toBeCloseTo(61);
    expect(r.elev).toBeUndefined();
  });

  it("centrerar när inget lager växer", () => {
    const g: FlowGroup[] = [{ ...flow[0]!, align: "center", items: [{ layerId: "title" }, { layerId: "name" }] }];
    const r = byId(applyFlowLayout(layers, g));
    // 10 + 2 + 5 = 17 av 90 → 36,5 över
    expect(r.title!.yPct).toBeCloseTo(5 + 36.5);
    expect(r.name!.yPct).toBeCloseTo(5 + 36.5 + 12);
  });
});
