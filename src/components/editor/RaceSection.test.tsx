import { describe, expect, it, beforeEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import "@/i18n";
import { RaceDetailsPanel, RacePickerPanel } from "./RaceSection";
import { useEditorStore } from "@/stores/editorStore";
import { useRaceStore } from "@/stores/raceStore";
import { applyRaceSeed, RACE_LAYER_IDS } from "@/lib/race/seed-template";
import type { Template } from "@/lib/template-schema";
import type { ProductConfig } from "@/lib/product-config";


// Minimal render-hjälp utan @testing-library (saknas i repot).
let root: Root | null = null;
let host: HTMLDivElement | null = null;
function render(ui: React.ReactElement) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(ui));
  return { container: host };
}
function cleanup() {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = null;
  host = null;
}
function byText(re: RegExp | string, selector = "*"): HTMLElement | null {
  const els = Array.from(document.body.querySelectorAll<HTMLElement>(selector));
  return (
    els.find((e) =>
      e.children.length === 0 && (typeof re === "string" ? e.textContent === re : re.test(e.textContent ?? "")),
    ) ?? null
  );
}
async function waitFor(fn: () => void, timeout = 2000) {
  const start = Date.now();
  for (;;) {
    try {
      fn();
      return;
    } catch (e) {
      if (Date.now() - start > timeout) throw e;
      await act(async () => {
        await new Promise((r) => setTimeout(r, 20));
      });
    }
  }
}
async function changeFile(input: HTMLInputElement, file: File) {
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
function click(el: HTMLElement | null) {
  if (!el) throw new Error("element saknas");
  act(() => el.click());
}

function gpxFile(): File {
  const t0 = Date.parse("2026-05-30T10:00:00Z");
  const pts = Array.from({ length: 120 }, (_, i) => {
    const lat = 59.3293 + i * 0.001;
    return `<trkpt lat="${lat}" lon="18.0686"><ele>${12 + (i % 9)}</ele><time>${new Date(t0 + i * 30_000).toISOString()}</time></trkpt>`;
  }).join("");
  const xml = `<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Test</name><trkseg>${pts}</trkseg></trk></gpx>`;
  return new File([xml], "lopp.gpx", { type: "application/gpx+xml" });
}

const baseTemplate: Template = {
  version: 1,
  publishedAt: null,
  productOptions: { poster: { enabled: true, allowedSizes: ["30x40"], allowedFrames: ["Ingen"] } },
  orientations: ["portrait"],
  defaultLayout: {
    portrait: { aspect: "3:4", background: { color: "#FFFFFF" }, layers: [] },
    landscape: { aspect: "4:3", background: { color: "#FFFFFF" }, layers: [] },
  },
  sizeOverrides: {},
  extraLayouts: [],
  contentVariants: [],
};

function loadRaceTemplate() {
  const config = {
    id: "test",
    shopify_handle: "maratontavla",
    template_slug: "maratontavla",
    title: "Maratontavla",
    product_type: "posters",
    layouts: {},
    map_styles: [],
    text_config: { fonts: ["Inter"], maxChars: 24, defaultFont: "Inter" },
    sizes: [],
    gelato_sku_map: {},
    template: applyRaceSeed(baseTemplate),
  } as unknown as ProductConfig;
  useEditorStore.setState({ config: null, template: null });
  act(() => useEditorStore.getState().setConfig(config));
}

describe("Lopptavlans kundpanel", () => {
  beforeEach(() => {
    cleanup();
    useRaceStore.getState().reset();
    loadRaceTemplate();
  });

  it("startmallen döljer foto, höjdprofil och egen rad från början", () => {
    const hidden = useEditorStore.getState().hiddenLayerIds;
    expect(hidden[RACE_LAYER_IDS.photo]).toBe(true);
    expect(hidden[RACE_LAYER_IDS.custom]).toBe(true);
    expect(hidden[RACE_LAYER_IDS.elevation]).toBe(true);
    expect(hidden[RACE_LAYER_IDS.stats]).toBeUndefined();
  });

  it("spärrar beställning tills ett lopp eller en GPX-fil valts", async () => {
    expect(useEditorStore.getState().orderBlockReason()).toBe("race");
    const { container } = render(<RacePickerPanel />);
    // Loppisten visar katalogens lopp som har en ritad bana.
    expect(byText("Göteborgsvarvet", "span")).not.toBeNull();
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await changeFile(input, gpxFile());
    await waitFor(() => expect(useRaceStore.getState().route).not.toBeNull());
    const s = useRaceStore.getState();
    expect(s.source).toBe("gpx");
    expect(s.fields.dateISO).toBe("2026-05-30");
    expect(s.fields.finishTime).toBe("59:30");
    await waitFor(() => expect(container.textContent).toMatch(/Din rutt: 13,2 km/));
    expect(useEditorStore.getState().orderBlockReason()).not.toBe("race");
  });

  it("felaktig fil ger ett tydligt meddelande", async () => {
    const { container } = render(<RacePickerPanel />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await changeFile(input, new File(["<kml></kml>"], "fel.kml"));
    await waitFor(() => expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/inte vara en GPX-fil/));
  });

  it("reglagen döljer lager och flödet flyttar upp det som ligger under", () => {
    const y = (id: string) => useEditorStore.getState().templateLayers().find((l) => l.id === id)!.yPct;
    render(<RaceDetailsPanel />);
    // Etiketten omsluter reglaget — klick på texten växlar det.
    click(byText("Höjdprofil", "span"));
    expect(useEditorStore.getState().hiddenLayerIds[RACE_LAYER_IDS.elevation]).toBeUndefined();
    const before = y(RACE_LAYER_IDS.elevation);
    click(byText("Statistikrad", "span"));
    expect(useEditorStore.getState().hiddenLayerIds[RACE_LAYER_IDS.stats]).toBe(true);
    expect(y(RACE_LAYER_IDS.elevation)).toBeLessThan(before);
  });

  it("bakgrundsbyte byter stil men behåller kundens av/på-val", () => {
    render(<RaceDetailsPanel />);
    click(byText("Höjdprofil", "span"));
    click(byText("Sand", "span"));
    expect(useEditorStore.getState().layoutId).toBe("race-sand");
    expect(useEditorStore.getState().hiddenLayerIds[RACE_LAYER_IDS.elevation]).toBeUndefined();
    const map = useEditorStore.getState().templateLayers().find((l) => l.type === "map");
    expect(map?.id).toBe("race-map-sand");
  });

  it("statistikvärden slås av och på individuellt", () => {
    render(<RaceDetailsPanel />);
    expect(useRaceStore.getState().show.bib).toBe(false);
    click(byText("Startnummer", "span"));
    expect(useRaceStore.getState().show.bib).toBe(true);
  });
});
