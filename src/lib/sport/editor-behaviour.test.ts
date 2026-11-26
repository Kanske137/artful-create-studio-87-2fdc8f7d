// Editorbeteenden som sporttavlorna bygger på: tidssummor, versaler,
// krympning till bredd och att kundens fält överlever stilbyten.
import { act } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { useEditorStore, type TextLayerValue } from "@/stores/editorStore";
import { DEFAULT_LAYOUT_ID, type Template } from "@/lib/template-schema";
import type { ProductConfig } from "@/lib/product-config";
import { applySportSeed } from "@/lib/sport/seed-templates";
import {
  displayText,
  fitWidthScale,
  formatDuration,
  parseDuration,
  sumDurations,
  FIT_MIN_SCALE,
} from "@/lib/text-typography";

describe("tider", () => {
  it("tolkar h:mm:ss, m:ss och punkt som avskiljare", () => {
    expect(parseDuration("1:12:45")).toBe(4365);
    expect(parseDuration("4:12")).toBe(252);
    expect(parseDuration("7.15.40")).toBe(26140);
    expect(parseDuration("")).toBe(0);
    expect(parseDuration("1:75:00")).toBeNull();
    expect(parseDuration("snabbt")).toBeNull();
  });

  it("summerar till h:mm:ss", () => {
    expect(sumDurations(["1:12:45", "4:12", "5:41:10", "2:48", "3:58:02"])).toBe("10:58:57");
    expect(sumDurations(["7:15:40", "10:48:00", "0:58:31", "2:41:09"])).toBe("21:43:20");
    expect(sumDurations(["1:00:00", ""])).toBe("1:00:00");
    expect(sumDurations(["", ""])).toBeNull();
    expect(sumDurations(["1:00:00", "x"])).toBeNull();
    expect(formatDuration(59)).toBe("0:00:59");
  });
});

describe("visning", () => {
  it("versaler med svenska tecken", () => {
    expect(displayText({ uppercase: true }, "Linnea Åberg")).toBe("LINNEA ÅBERG");
    expect(displayText({}, "Linnea")).toBe("Linnea");
  });

  it("krymper bara när raden är för bred, aldrig under minsta skala", () => {
    const measure = (text: string) => text.length * 10;
    const line = (t: string) => [[{ text: t, px: 20, font: "Barlow", bold: false, italic: false }]];
    expect(fitWidthScale(line("kort"), 20, 0, 200, measure)).toBe(1);
    const s = fitWidthScale(line("x".repeat(40)), 20, 0, 200, measure);
    expect(s).toBeCloseTo((200 * 0.94) / 400, 5);
    expect(fitWidthScale(line("x".repeat(400)), 20, 0, 200, measure)).toBe(FIT_MIN_SCALE);
  });
});

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

function load() {
  const config = {
    id: "tri",
    shopify_handle: "triathlontavla",
    template_slug: "triathlontavla",
    title: "Triathlontavla",
    product_type: "posters",
    layouts: {},
    map_styles: [],
    text_config: { fonts: ["Inter"], maxChars: 60, defaultFont: "Inter" },
    sizes: [],
    gelato_sku_map: {},
    template: applySportSeed(base, "triathlon"),
  } as unknown as ProductConfig;
  useEditorStore.setState({ config: null, template: null, layerTransforms: {}, hiddenLayerIds: {}, textStash: {}, manualSumIds: {} });
  act(() => useEditorStore.getState().setConfig(config));
}

const text = (id: string) => (useEditorStore.getState().layerValues[id] as TextLayerValue | undefined)?.text;
const value = (id: string) => useEditorStore.getState().layerValues[id] as TextLayerValue | undefined;

describe("triathlontavlan i editorn", () => {
  beforeEach(load);

  it("räknar ut totaltiden när en gren ändras, tills kunden skriver en egen", () => {
    const s = useEditorStore.getState();
    act(() => s.setLayerText("tri-swim", "1:02:45"));
    expect(text("tri-total")).toBe("10:48:57");
    act(() => s.setLayerText("tri-total", "10:50:00"));
    act(() => s.setLayerText("tri-run", "4:00:00"));
    expect(text("tri-total")).toBe("10:50:00");
    // Tomt summafält ⇒ räknas igen.
    act(() => s.setLayerText("tri-total", ""));
    expect(text("tri-total")).toBe("10:50:55");
  });

  it("behåller fält som saknas i en mellanliggande stil", () => {
    const s = useEditorStore.getState();
    act(() => s.setLayerText("tri-t1", "3:30"));
    act(() => s.setLayerText("tri-name", "Sara Holm"));
    act(() => s.setLayerTextVisible("tri-custom", false));
    act(() => s.setLayoutId("tri-c")); // Medaljen saknar T1 och egen rad
    expect(value("tri-t1")).toBeUndefined();
    expect(text("tri-name")).toBe("Sara Holm");
    act(() => useEditorStore.getState().setLayoutId(DEFAULT_LAYOUT_ID));
    expect(text("tri-t1")).toBe("3:30");
    expect(text("tri-name")).toBe("Sara Holm");
    expect(value("tri-custom")?.visible).toBe(false);
  });

  it("distansbyte gäller även fält som inte syns i aktuell stil", () => {
    act(() => useEditorStore.getState().setLayoutId("tri-c")); // visar inte sträckorna per gren
    act(() => useEditorStore.getState().setContentVariant("sprint"));
    expect(text("tri-totaldist")).toBe("25,75 km");
    act(() => useEditorStore.getState().setLayoutId(DEFAULT_LAYOUT_ID));
    expect(text("tri-swimdist")).toBe("750 m");
    expect(text("tri-kicker")).toBe("Triathlon · Sprintdistans");
  });
});
