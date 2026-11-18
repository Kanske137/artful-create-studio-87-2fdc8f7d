import { describe, expect, it, vi, beforeEach } from "vitest";
import { act } from "react";
import { useEditorStore } from "@/stores/editorStore";
import { useRaceStore } from "@/stores/raceStore";
import { applyRaceSeed } from "@/lib/race/seed-template";
import type { Template } from "@/lib/template-schema";
import type { ProductConfig } from "@/lib/product-config";
import type { RaceRoute } from "@/lib/race/types";

const uploads: string[] = [];
vi.mock("@/lib/upload-preview", () => ({
  uploadPrintFileBlob: vi.fn(async (_blob: Blob, id: string, ext: string) => {
    uploads.push(id);
    return `https://example.supabase.co/storage/v1/object/public/print-files/${id}.${ext}`;
  }),
}));

import { editDesignIdFrom, loadDesignSnapshot, restoreDesignSnapshot, saveDesignSnapshot } from "./design-snapshot";

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

function loadTemplate() {
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
  useEditorStore.setState({ config: null, template: null, photoSources: {}, layerTransforms: {}, hiddenLayerIds: {} });
  useRaceStore.getState().reset();
  act(() => useEditorStore.getState().setConfig(config));
}

describe("design-snapshot", () => {
  beforeEach(() => {
    localStorage.clear();
    uploads.length = 0;
    loadTemplate();
  });

  it("validerar edit-id", () => {
    expect(editDesignIdFrom("3f1c2a9e-1b2c-4d5e-8f90-123456789abc")).toBe("3f1c2a9e-1b2c-4d5e-8f90-123456789abc");
    expect(editDesignIdFrom("<script>")).toBeNull();
    expect(editDesignIdFrom(null)).toBeNull();
  });

  it("sparar och återställer design, foto och lopp", async () => {
    const st = useEditorStore.getState();
    const textLayer = st.templateLayers().find((l) => l.type === "text")!;
    act(() => {
      st.setLayerText(textLayer.id, "Stockholm Marathon 2026");
      st.setLayerTransform(textLayer.id, { yPct: 40 });
    });
    const transformsBefore = useEditorStore.getState().layerTransforms;
    expect(Object.keys(transformsBefore).length).toBeGreaterThan(0);
    const photo = new File([new Uint8Array([1, 2, 3])], "jag.jpg", { type: "image/jpeg" });
    useEditorStore.setState({
      photoSources: { p1: { file: photo, previewUrl: "blob:x", hash: "abc123", originalUrl: null } },
    });
    const route = { coords: [[18.06, 59.33], [18.07, 59.34]] } as unknown as RaceRoute;
    useRaceStore.setState({ source: "gpx", route, routeColor: "#ff0000" });

    const saved = await saveDesignSnapshot("3f1c2a9e-1b2c-4d5e-8f90-123456789abc");
    expect(saved).toBe(true);
    expect(uploads).toEqual(["edit-abc123"]);
    const snap = loadDesignSnapshot("3f1c2a9e-1b2c-4d5e-8f90-123456789abc")!;
    expect(snap.photos.p1.url).toMatch(/edit-abc123\.jpg$/);

    // Ny sidladdning: tom editor och tomt lopp.
    loadTemplate();
    expect(useEditorStore.getState().text).not.toBe("Stockholm Marathon 2026");

    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" }))));
    if (!URL.createObjectURL) (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => "blob:restored";
    await act(async () => {
      await restoreDesignSnapshot(snap);
    });
    vi.unstubAllGlobals();

    const after = useEditorStore.getState();
    const tv = after.layerValues[textLayer.id];
    expect(tv && tv.kind === "text" ? tv.text : null).toBe("Stockholm Marathon 2026");
    expect(after.layerTransforms).toEqual(transformsBefore);
    expect(after.photoSources.p1.file.name).toBe("jag.jpg");
    expect(after.photoSources.p1.hash).toBe("abc123");
    expect(after.shopifyVariantId).toBeNull();
    expect(useRaceStore.getState().routeColor).toBe("#ff0000");
    expect(useRaceStore.getState().route).toEqual(route);

    // Samma foto igen: ingen ny uppladdning.
    await saveDesignSnapshot("9a8b7c6d-1b2c-4d5e-8f90-123456789abc");
    expect(uploads).toEqual(["edit-abc123"]);
  });
});
