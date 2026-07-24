import { useEffect, useRef, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import type mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useEditorStore, type PhotoLayerValue } from "@/stores/editorStore";
import type { TemplateLayer } from "@/lib/template-schema";
import { MapLayerInstance } from "./layers/MapLayerInstance";
import { ImageLayerView, LineLayerView, MarginLayerView } from "./layers/StaticLayers";
import { TextLayerView } from "./layers/TextLayerView";
import { substituteTokensWithSpans, buildEffectiveTextWithSpans } from "@/lib/text-typography";
import { ShapeLayerView } from "./layers/ShapeLayerView";
import {
  lineThicknessPxFromCanvas,
  effectiveLayerRect,
  clampLayerRect,
  getActiveMarginInsetsPct,
} from "@/lib/layer-utils";
import { AcrylicCornerOverlay } from "./AcrylicCornerOverlay";
import { MapIconsOverlay } from "./MapIconsOverlay";
import { WatermarkOverlay } from "./WatermarkOverlay";
import { isCustomLayerId } from "@/lib/freeform-layers";

interface Props {
  frameColor?: string;
  frameWidthCm?: number;
  /** Posterhängare (trälist topp+botten + snöre) — preview only. */
  hangerColor?: string;
  innerPadding?: string;
  /** Canvas wrap depth in cm. */
  wrapCm?: number;
  /** When true, layer % are anchored to the FULL editor surface (front + 2×wrap)
   *  rather than just the front zone. Used by canvas templates that have a
   *  separate canvasLayout designed against the wrap-extended editor. */
  layersIncludeWrap?: boolean;
}

function parseCm(size: string | null): { w: number; h: number } | null {
  if (!size) return null;
  const m = size.match(/(\d+)\s*[xX×]\s*(\d+)/);
  if (!m) return null;
  return { w: parseInt(m[1], 10), h: parseInt(m[2], 10) };
}

// Shape clipping (heart/star/circle) is centralized in `@/lib/shape-clip` so
// editor preview, admin thumbnail and print snapshot all share one source of
// truth and stay pixel-identical.
import { buildShapeClipPath, useShapeClip, type ClipShape } from "@/lib/shape-clip";
import { textureForHex } from "@/lib/frame-textures";

/**
 * Realistisk träram med mitred (45°) hörn.
 * Fyra trapets-sidor klipps via clip-path så hörnen möts i 45° — som en
 * riktig posterram (Gelato-stil). Sidornas grain roteras 90° så ådringen
 * löper längs varje list.
 */
function FrameBorder({
  borderPx,
  outerW,
  outerH,
  textureUrl,
  fallbackColor,
}: {
  borderPx: number;
  outerW: number;
  outerH: number;
  textureUrl: string | null;
  fallbackColor: string;
}) {
  if (borderPx <= 0 || outerW <= 0 || outerH <= 0) return null;
  const bp = borderPx;
  const bg: React.CSSProperties = textureUrl
    ? { backgroundImage: `url(${textureUrl})`, backgroundSize: "cover", backgroundRepeat: "no-repeat" }
    : { backgroundColor: fallbackColor };

  // Top + bottom: grain naturally horizontal — texture orientation matches list direction.
  const topStyle: React.CSSProperties = {
    ...bg,
    position: "absolute",
    top: -bp,
    left: -bp,
    width: outerW,
    height: bp,
    clipPath: `polygon(0 0, 100% 0, calc(100% - ${bp}px) 100%, ${bp}px 100%)`,
  };
  const bottomStyle: React.CSSProperties = {
    ...bg,
    position: "absolute",
    bottom: -bp,
    left: -bp,
    width: outerW,
    height: bp,
    clipPath: `polygon(${bp}px 0, calc(100% - ${bp}px) 0, 100% 100%, 0 100%)`,
  };

  // Left + right sides: rotate texture 90° so grain runs vertically along the list.
  // We render an inner <img>-sized div with dimensions (outerH × bp), rotated 90°,
  // positioned to fill a (bp × outerH) strip via clip-path mitre.
  const sideClipLeft = `polygon(0 0, 100% ${bp}px, 100% calc(100% - ${bp}px), 0 100%)`;
  const sideClipRight = `polygon(0 ${bp}px, 100% 0, 100% 100%, 0 calc(100% - ${bp}px))`;

  const sideInnerBg = (rotateDeg: number, translateX: number, translateY: number): React.CSSProperties => ({
    ...bg,
    position: "absolute",
    width: outerH,
    height: bp,
    top: 0,
    left: 0,
    transformOrigin: "top left",
    transform: `translate(${translateX}px, ${translateY}px) rotate(${rotateDeg}deg)`,
  });

  return (
    <div className="pointer-events-none absolute inset-0" style={{ zIndex: 55 }} aria-hidden>
      {/* Drop shadow behind the frame (drawn first, below sides) */}
      <div
        style={{
          position: "absolute",
          inset: -bp,
          boxShadow: "0 8px 22px -6px rgba(0,0,0,0.32), 0 18px 40px -14px rgba(0,0,0,0.22)",
        }}
      />
      <div style={topStyle} />
      <div style={bottomStyle} />
      {/* Left strip */}
      <div
        style={{
          position: "absolute",
          top: -bp,
          left: -bp,
          width: bp,
          height: outerH,
          clipPath: sideClipLeft,
          overflow: "hidden",
        }}
      >
        {/* rotate(90) around (0,0) maps (x,y) -> (-y,x); translate by (bp, 0) places result in bp×outerH strip */}
        <div style={sideInnerBg(90, bp, 0)} />
      </div>
      {/* Right strip */}
      <div
        style={{
          position: "absolute",
          top: -bp,
          right: -bp,
          width: bp,
          height: outerH,
          clipPath: sideClipRight,
          overflow: "hidden",
        }}
      >
        <div style={sideInnerBg(90, bp, 0)} />
      </div>
      {/* Soft 45° highlight overlay for depth */}
      <div
        style={{
          position: "absolute",
          inset: -bp,
          background:
            "linear-gradient(135deg, rgba(255,255,255,0.18), rgba(255,255,255,0) 45%, rgba(0,0,0,0.22))",
          mixBlendMode: "overlay",
        }}
      />
      {/* Inner shadow rim where frame meets the print */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.28), inset 0 2px 6px -2px rgba(0,0,0,0.38)",
        }}
      />
    </div>
  );
}

/**
 * Posterhängare: tunna trälister topp+botten + snöre.
 * Listerna placeras UTANFÖR motivets topp/botten så de inte täcker tryckytan.
 * Tjockleken skalas efter motivets verkliga höjd: Gelatos hängare har fast
 * 14 mm front (oavsett posterstorlek), så större postrar → relativt tunnare list.
 */
function HangerOverlay({ color, textureUrl, motifHeightCm }: { color: string; textureUrl: string | null; motifHeightCm: number }) {
  const isWhite = color.toLowerCase() === "#f5f5f2";
  // 21 mm = 2.1 cm fysisk listhöjd (Gelato-spec). Procent av motivets höjd.
  const slatPct = Math.max(0.8, (2.1 / Math.max(motifHeightCm, 1)) * 100);
  // Snörets båghöjd i cm, beroende av posterstorlek (men begränsad så det
  // varken blir för platt på stora eller för högt på små postrar).
  const cordRiseCm = Math.min(6, Math.max(2.5, motifHeightCm * 0.06));
  const cordRisePct = (cordRiseCm / Math.max(motifHeightCm, 1)) * 100;
  // Snörets fästpunkter på listen — nära ytterkanterna.
  const anchorXPct = 6; // % från vänsterkant av listen (matchar slatStyle left:-2%)

  const slatStyle: React.CSSProperties = {
    position: "absolute",
    left: "-2%",
    right: "-2%",
    height: `${slatPct}%`,
    background: color,
    backgroundImage: textureUrl
      ? `linear-gradient(to bottom, rgba(255,255,255,0.18), rgba(255,255,255,0) 50%, rgba(0,0,0,0.28)), url(${textureUrl})`
      : "linear-gradient(to bottom, rgba(255,255,255,0.22), rgba(255,255,255,0) 50%, rgba(0,0,0,0.28))",
    backgroundSize: textureUrl ? "auto, cover" : undefined,
    backgroundRepeat: textureUrl ? "repeat, no-repeat" : undefined,
    boxShadow: "0 4px 8px rgba(0,0,0,0.28)",
    border: isWhite ? "1px solid rgba(0,0,0,0.18)" : undefined,
  };
  return (
    <div className="pointer-events-none absolute inset-0" style={{ zIndex: 46, overflow: "visible" }} aria-hidden>
      {/* Snöre — fäst på topp-listens ÖVERKANT (= motivets överkant), triangulär form (spik) */}
      <svg
        className="absolute"
        style={{
          left: "-2%",
          width: "104%",
          top: `-${cordRisePct}%`,
          height: `${cordRisePct}%`,
          overflow: "visible",
        }}
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
      >
        <path
          d={`M ${anchorXPct} 100 L 50 0 L ${100 - anchorXPct} 100`}
          fill="none"
          stroke="rgba(40,30,20,0.82)"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          style={{ strokeWidth: Math.max(1.5, slatPct * 1.2) }}
        />
      </svg>
      {/* Trälist OVANPÅ motivets topp (täcker översta 21mm av tryckytan) */}
      <div style={{ ...slatStyle, top: 0 }} />
      {/* Trälist OVANPÅ motivets botten (täcker nedersta 21mm av tryckytan) */}
      <div style={{ ...slatStyle, bottom: 0 }} />
    </div>
  );
}

function shapeClipPath(shape: string): string | undefined {
  // Pre-measurement fallback. Real pixel-accurate clip is produced by
  // `useShapeClip` once the host element is laid out (1 frame later).
  // Returning `undefined` for non-rect shapes briefly shows the unclipped
  // rect, but in practice ResizeObserver fires synchronously before paint.
  if (shape === "rect") return undefined;
  return undefined;
}

// (Per-shape pixel-accurate clip is built via `useShapeClip` from
// `@/lib/shape-clip` directly inside MapLayerSlot / PhotoLayerView.)

export function MapPreview({
  frameColor,
  frameWidthCm = 2,
  hangerColor,
  innerPadding,
  wrapCm = 0,
  layersIncludeWrap = false,
}: Props) {
  const { t } = useTranslation();
  const frameRef = useRef<HTMLDivElement>(null);
  /** Per-layer Mapbox instance refs, populated by `MapLayerInstance` via
   *  `onMapReady`. Used by `MapIconsOverlay` to project geo-anchored icons. */
  const mapInstances = useRef<Record<string, mapboxgl.Map | null>>({});
  const [borderPx, setBorderPx] = useState(0);
  const [frameShortPx, setFrameShortPx] = useState(0);
  const [frameOuter, setFrameOuter] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  const {
    config,
    orientation,
    size,
    posterBgColor,
    templateLayers,
    layerValues,
    layerTransforms,
    setLayerTransform,
    photoSources,
    photoAiResults,
    aiPhotoResults,
    aiPhotoSelectedRefUrl,
    whiteMarginEnabled,
    handlesVisible,
  } = useEditorStore();
  const isAcrylic = config?.product_type === "acrylic";
  const isFreeform = !!config?.is_freeform;

  const allLayers = templateLayers();
  // Center-alignment guides shown while dragging a layer (in % of editor).
  const [guides, setGuides] = useState<{ h: boolean; v: boolean }>({ h: false, v: false });

  // Outer poster/canvas frame
  const sizeCm = parseCm(size);
  const frontW = sizeCm
    ? orientation === "portrait"
      ? Math.min(sizeCm.w, sizeCm.h)
      : Math.max(sizeCm.w, sizeCm.h)
    : 30;
  const frontH = sizeCm
    ? orientation === "portrait"
      ? Math.max(sizeCm.w, sizeCm.h)
      : Math.min(sizeCm.w, sizeCm.h)
    : 40;
  const editorW = frontW + 2 * wrapCm;
  const editorH = frontH + 2 * wrapCm;
  const posterAspect = editorW / editorH;
  const frontInsetX = wrapCm > 0 && !layersIncludeWrap ? wrapCm / editorW : 0;
  const frontInsetY = wrapCm > 0 && !layersIncludeWrap ? wrapCm / editorH : 0;

  // Derive margin insets and (when customer hides margin) filter the margin
  // layer + remap remaining layers so they fill the freed-up area.
  const marginInsets = getActiveMarginInsetsPct(allLayers, frontW, frontH);
  const marginRemovedInsets = !whiteMarginEnabled ? marginInsets : undefined;
  // Margin must always render visually on top of all other layers (but its
  // wrapper still has pointer-events:none so it never blocks clicks).
  const hiddenLayerIds = useEditorStore((s) => s.hiddenLayerIds);
  const notHidden = (l: TemplateLayer) => !hiddenLayerIds[l.id];
  const visibleLayers = (whiteMarginEnabled ? allLayers : allLayers.filter((l) => l.type !== "margin")).filter(notHidden);
  const layers = [
    ...visibleLayers.filter((l) => l.type !== "margin"),
    ...visibleLayers.filter((l) => l.type === "margin"),
  ];

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const compute = () => {
      const rect = el.getBoundingClientRect();
      const shortPx = Math.min(rect.width, rect.height);
      setFrameShortPx(shortPx);
      setFrameOuter({ w: rect.width, h: rect.height });
      if (!frameColor || !sizeCm) {
        setBorderPx(0);
        return;
      }
      const shortCm = Math.min(sizeCm.w, sizeCm.h);
      const px = Math.round((frameWidthCm / shortCm) * shortPx);
      setBorderPx(px);
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [frameColor, frameWidthCm, sizeCm?.w, sizeCm?.h]);

  const isPortrait = posterAspect < 1;
  // Innehållsdriven storlek: ingen vh. Postern är width-driven (width:100% +
  // aspectRatio) men cappad så att höjden inte överstiger desktopens
  // preview-höjd (~720px). Formeln maxWidth = aspect * 720px funkar på
  // både mobil (smal skärm → 100% vinner) och desktop (h-[720px] container).
  const DESKTOP_MAX_H = 820;
  const frameTextureUrl = textureForHex(frameColor);
  const hangerTextureUrl = textureForHex(hangerColor);
  const frameStyle: React.CSSProperties = {
    aspectRatio: `${posterAspect}`,
    width: "100%",
    height: "auto",
    maxWidth: `min(100%, ${posterAspect * DESKTOP_MAX_H}px)`,
    background: posterBgColor,
    // Border keeps layout space for the frame; visual frame is rendered via
    // <FrameBorder> overlay (textured + mitred corners). Transparent border
    // preserves print-area sizing without the old flat color band.
    borderStyle: frameColor ? "solid" : undefined,
    borderColor: "transparent",
    borderWidth: frameColor ? `${borderPx}px` : 0,
    padding: innerPadding,
    boxSizing: "border-box",
    // Lokal stacking context — alla interna z-index (inkl. akrylskruvar)
    // begränsas till ramen och kan inte krocka med dialoger / thumbnails.
    isolation: "isolate",
  };

  const layerToEditorRect = (l: TemplateLayer) => {
    const eff = effectiveLayerRect(l, layerTransforms, { marginRemovedInsets });
    let left = (frontInsetX + (eff.xPct / 100) * (1 - 2 * frontInsetX)) * 100;
    let top = (frontInsetY + (eff.yPct / 100) * (1 - 2 * frontInsetY)) * 100;
    let width = (eff.wPct / 100) * (1 - 2 * frontInsetX) * 100;
    let height = (eff.hPct / 100) * (1 - 2 * frontInsetY) * 100;
    // Bleed/wrap extension for front-relative full-bleed media: any layer
    // touching a front edge auto-extends out into the wrap band so the
    // canvas sides never look empty regardless of which size is selected.
    const BLEED_EPS = 0.5;
    const bleedEligible =
      wrapCm > 0 &&
      !layersIncludeWrap &&
      (l.type === "map" || l.type === "image" || l.type === "photo" || l.type === "aiPhoto");
    if (bleedEligible) {
      const extX = frontInsetX * 100;
      const extY = frontInsetY * 100;
      if (eff.xPct <= BLEED_EPS) {
        left -= extX;
        width += extX;
      }
      if (eff.yPct <= BLEED_EPS) {
        top -= extY;
        height += extY;
      }
      if (eff.xPct + eff.wPct >= 100 - BLEED_EPS) {
        width += extX;
      }
      if (eff.yPct + eff.hPct >= 100 - BLEED_EPS) {
        height += extY;
      }
    }
    return { left, top, width, height };
  };

  // Pointer-drag handler attached to the wrapper div of any draggable layer.
  // Translates pixel deltas → % of editor canvas, snaps to center (h/v) when
  // close, and clamps so the layer never crosses the editor edges.
  const SNAP_PCT = 0.6; // distance from center where we snap
  const onDragStart = useCallback(
    (l: TemplateLayer, e: React.PointerEvent<Element>) => {
      const frame = frameRef.current;
      if (!frame) return;
      e.preventDefault();
      e.stopPropagation();
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      const rect = frame.getBoundingClientRect();
      const eff = effectiveLayerRect(l, layerTransforms);
      const startX = e.clientX;
      const startY = e.clientY;
      const startXPct = eff.xPct;
      const startYPct = eff.yPct;
      const wPct = eff.wPct;
      const hPct = eff.hPct;

      const onMove = (ev: PointerEvent) => {
        const dxPct = ((ev.clientX - startX) / rect.width) * 100;
        const dyPct = ((ev.clientY - startY) / rect.height) * 100;
        let nx = startXPct + dxPct;
        let ny = startYPct + dyPct;
        // Center-snap (horizontal: layer center == 50; vertical likewise)
        const centerXTarget = 50 - wPct / 2;
        const centerYTarget = 50 - hPct / 2;
        let snapH = false,
          snapV = false;
        if (Math.abs(nx - centerXTarget) < SNAP_PCT) {
          nx = centerXTarget;
          snapV = true;
        }
        if (Math.abs(ny - centerYTarget) < SNAP_PCT) {
          ny = centerYTarget;
          snapH = true;
        }
        const c = clampLayerRect({ xPct: nx, yPct: ny, wPct, hPct });
        setLayerTransform(l.id, c);
        setGuides({ h: snapH, v: snapV });
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        setGuides({ h: false, v: false });
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [layerTransforms, setLayerTransform],
  );

  // Resize-handler för custom shape/line-lager (nedre högra hörnet). För
  // linjer låser vi kortsidan så bara längden ändras.
  const onResizeStart = useCallback(
    (l: TemplateLayer, e: React.PointerEvent<Element>) => {
      const frame = frameRef.current;
      if (!frame) return;
      e.preventDefault();
      e.stopPropagation();
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      const rect = frame.getBoundingClientRect();
      const eff = effectiveLayerRect(l, layerTransforms);
      const startX = e.clientX;
      const startY = e.clientY;
      const startW = eff.wPct;
      const startH = eff.hPct;
      const lineOrient =
        l.type === "line" ? (l.defaults.orientation as "horizontal" | "vertical") : null;
      const onMove = (ev: PointerEvent) => {
        const dxPct = ((ev.clientX - startX) / rect.width) * 100;
        const dyPct = ((ev.clientY - startY) / rect.height) * 100;
        let nw = startW + dxPct;
        let nh = startH + dyPct;
        if (lineOrient === "horizontal") nh = startH; // bara längden ändras
        if (lineOrient === "vertical") nw = startW;
        const c = clampLayerRect({ xPct: eff.xPct, yPct: eff.yPct, wPct: nw, hPct: nh });
        setLayerTransform(l.id, c);
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [layerTransforms, setLayerTransform],
  );

  const isWrap = wrapCm > 0;
  // Visual marker for the synlig front zone — always reflects wrapCm regardless
  // of whether layers are anchored to front or full-area.
  const frontMarkerInsetX = wrapCm > 0 ? wrapCm / editorW : 0;
  const frontMarkerInsetY = wrapCm > 0 ? wrapCm / editorH : 0;
  const frontZoneStyle: React.CSSProperties = {
    position: "absolute",
    left: `${frontMarkerInsetX * 100}%`,
    top: `${frontMarkerInsetY * 100}%`,
    right: `${frontMarkerInsetX * 100}%`,
    bottom: `${frontMarkerInsetY * 100}%`,
  };

  return (
    <div className="w-full flex flex-col items-center justify-center p-4 gap-2">
      <style>{`
        .mapboxgl-ctrl-logo, .mapboxgl-ctrl-attrib { display: none !important; }
      `}</style>
      <div ref={frameRef} className="relative shadow-[0_30px_60px_-20px_rgba(0,0,0,0.25)]" style={frameStyle}>
        {/* Loop all template layers in zIndex order */}
        {layers.map((l) => {
          const rect = layerToEditorRect(l);
          // Only layers that actually need pointer interaction in the
          // customer preview should catch clicks/drags. Otherwise an
          // overlapping locked text/image/decor layer can block photo pan.
          // Kund-tillagda shape/line ska kunna flyttas + resizas i previewen.
          const isCustomDecor = isCustomLayerId(l.id) && (l.type === "shape" || l.type === "line");
          const isInteractiveLayer =
            l.type === "photo" ||
            l.type === "aiPhoto" ||
            (l.type === "map" && !l.locks.position);

          const wrapStyle: React.CSSProperties = {
            position: "absolute",
            left: `${rect.left}%`,
            top: `${rect.top}%`,
            width: `${rect.width}%`,
            height: `${rect.height}%`,
            zIndex: l.type === "margin" ? 40 : l.zIndex,
            pointerEvents: isInteractiveLayer ? undefined : "none",
          };
          const movable =
            !l.locks.move &&
            (l.type === "map" || l.type === "photo" || l.type === "aiPhoto" || l.type === "text" || l.type === "image" || isCustomDecor);
          // Skapa själv: tillåt fri storleksändring på ALLA flyttbara lager
          // (utom margin). På vanliga mallar behåller vi tidigare beteende
          // där bara kund-tillagda shape/line har resize-handtag.
          const resizable =
            !l.locks.move &&
            (isCustomDecor ||
              (isFreeform &&
                (l.type === "photo" ||
                  l.type === "aiPhoto" ||
                  l.type === "map" ||
                  l.type === "text" ||
                  l.type === "image")));
          const moveHandle = movable && handlesVisible ? (
            <button
              type="button"
              onPointerDown={(e) => onDragStart(l, e)}
              className="absolute w-7 h-7 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center text-[12px] cursor-move touch-none ring-2 ring-background"
              style={{ top: -14, left: -14, zIndex: 39, pointerEvents: "auto" }}
              aria-label="Flytta lager"
              title="Dra för att flytta lagret"
            >
              ✥
            </button>
          ) : null;
          const resizeHandle = resizable && handlesVisible ? (
            <button
              type="button"
              onPointerDown={(e) => onResizeStart(l, e)}
              className="absolute w-6 h-6 rounded-md bg-primary text-primary-foreground shadow-lg flex items-center justify-center text-[10px] cursor-nwse-resize touch-none ring-2 ring-background"
              style={{ bottom: -12, right: -12, zIndex: 39, pointerEvents: "auto" }}
              aria-label="Ändra storlek"
              title="Dra för att ändra storlek"
            >
              ⤡
            </button>
          ) : null;

          if (l.type === "map") {
            const v = layerValues[l.id];
            const mv = v && v.kind === "map" ? v : null;
            const effectiveShape = (mv?.shape ?? l.defaults.shape) as "circle" | "heart" | "star";
            const effectiveStyleId = mv?.styleId ?? l.defaults.styleId;
            const effectiveCenter: [number, number] = mv?.center ?? [l.defaults.center[0]!, l.defaults.center[1]!];
            const effectiveZoom = mv?.zoom ?? l.defaults.zoom;
            const effectiveLabels = mv?.showLabels ?? l.defaults.showLabels;
            const icons = mv?.icons ?? [];
            const staticClip = shapeClipPath(effectiveShape);
            return (
              <MapLayerSlot
                key={l.id}
                wrapStyle={wrapStyle}
                shape={effectiveShape}
                staticClip={staticClip}
                overlay={
                  <>
                    <MapIconsOverlay
                      layerId={l.id}
                      shape={effectiveShape}
                      icons={icons}
                      getMap={() => mapInstances.current[l.id] ?? null}
                    />
                    {moveHandle}
                    {resizeHandle}
                  </>
                }
              >
                {(clip) => (
                  <MapLayerInstance
                    layerId={l.id}
                    shape={effectiveShape}
                    styleId={effectiveStyleId}
                    center={effectiveCenter}
                    zoom={effectiveZoom}
                    showLabels={effectiveLabels}
                    interactive={!l.locks.position}
                    clipPath={clip}
                    onMapReady={(m) => {
                      mapInstances.current[l.id] = m;
                    }}
                  />
                )}
              </MapLayerSlot>
            );
          }

          if (l.type === "photo") {
            const v = layerValues[l.id];
            const pv = v && v.kind === "photo" ? (v as PhotoLayerValue) : null;
            const effectiveShape = (pv?.shape ?? l.defaults.shape) as "rect" | "circle" | "heart" | "star";
            const offsetX = pv?.offsetX ?? 0;
            const offsetY = pv?.offsetY ?? 0;
            const zoom = pv?.zoom ?? 1;
            const staticClip = shapeClipPath(effectiveShape);
            const src = photoAiResults[l.id] ?? photoSources[l.id]?.previewUrl ?? l.defaults.placeholderUrl ?? null;
            return (
              <MapLayerSlot
                key={l.id}
                wrapStyle={wrapStyle}
                shape={effectiveShape}
                staticClip={staticClip}
                overlay={<>{moveHandle}{resizeHandle}</>}
              >
                {(clip) => (
                  <>
                    <PhotoLayerView
                      layerId={l.id}
                      src={src}
                      fit={l.defaults.fit}
                      shape={effectiveShape}
                      staticClipPath={clip}
                      offsetX={offsetX}
                      offsetY={offsetY}
                      zoom={zoom}
                      draggable={!!src}
                    />
                    {/* Vattenmärke på bildlagret — endast förhandsvisning. */}
                    {src ? <WatermarkOverlay clipPath={clip} /> : null}
                    {/* Exempelpill när placeholder/demo visas (Paket D2) —
                        även vanliga bildlager märker sina exempelbilder. */}
                    {!!src &&
                      (src === (l.defaults.placeholderUrl ?? null) ||
                        src ===
                          ((l.defaults as { demoResultUrl?: string }).demoResultUrl ?? null)) && (
                        <div
                          aria-hidden="true"
                          style={{
                            position: "absolute",
                            left: 0,
                            right: 0,
                            bottom: "4%",
                            display: "flex",
                            justifyContent: "center",
                            pointerEvents: "none",
                            clipPath: clip,
                          }}
                        >
                          <span className="bg-background/85 text-foreground/90 text-[10px] font-medium px-2 py-0.5 rounded-full ring-1 ring-border">
                            {t("exampleBadge.label")}
                          </span>
                        </div>
                      )}
                  </>
                )}
              </MapLayerSlot>
            );
          }

          if (l.type === "aiPhoto") {
            const v = layerValues[l.id];
            const av = v && v.kind === "aiPhoto" ? v : null;
            const effectiveShape = (av?.shape ?? l.defaults.shape) as "rect" | "circle" | "heart" | "star";
            const staticClip = shapeClipPath(effectiveShape);
            // Source priority: face-swap result → customer-selected reference
            // (when admin uploaded multiple) → admin reference image → empty.
            const aiResultUrl = aiPhotoResults[l.id] ?? null;
            const selectedRefUrl = aiPhotoSelectedRefUrl[l.id] ?? null;
            // Resolve the active reference item, filtered by current
            // orientation so a stale portrait selection doesn't render
            // when the canvas is now in landscape (and vice versa).
            const refList = l.defaults.referenceImages ?? [];
            const orientationMatches = refList.filter((r) => {
              const o = (r as { orientation?: string }).orientation ?? "any";
              return o === "any" || o === orientation;
            });
            const activeRefUrl =
              (selectedRefUrl && orientationMatches.some((r) => r.url === selectedRefUrl)
                ? selectedRefUrl
                : null)
              ?? orientationMatches[0]?.url
              ?? l.defaults.referenceImageUrl
              ?? null;
            // Demo-exemplet visas AUTOMATISKT när lagret saknar både resultat
            // och referens (Paket D2, Akrams design: inget knapptryck) —
            // beställningsspärren utgår från att resultat saknas.
            const demoFallbackUrl =
              (l.defaults as { demoResultUrl?: string }).demoResultUrl ?? null;
            const src = aiResultUrl ?? activeRefUrl ?? demoFallbackUrl;
            const activeRef = activeRefUrl ? (refList.find((r) => r.url === activeRefUrl) ?? null) : null;
            const refFocalX = activeRef?.focalX ?? 0;
            const refFocalY = activeRef?.focalY ?? 0;
            // If the visible image is the admin reference or its swap result,
            // honor the admin-chosen focal. Otherwise (no AI result, no ref —
            // e.g. removeBackground placeholder) fall back to layer offset.
            const usingRefOrSwap = !!(aiResultUrl || activeRefUrl);
            const offsetX = usingRefOrSwap ? refFocalX : (av?.offsetX ?? 0);
            const offsetY = usingRefOrSwap ? refFocalY : (av?.offsetY ?? 0);
            const zoom = av?.zoom ?? 1;
            // Only force `contain` for removeBackground (Nano Banana 2 doesn't
            // always honor target aspect ratio, and its pure-white padding
            // blends seamlessly into the layer). For human face-swap (Replicate
            // returns the same dimensions as the reference image) and pet swap
            // (prompt enforces same aspect ratio as the reference), use the
            // layer's default fit so the result fills the layer exactly like
            // the reference image did — no empty edges.
            const aiSubjectKind = l.defaults.subjectKind ?? "human";
            const effectiveFit = aiResultUrl && aiSubjectKind === "removeBackground" ? "contain" : l.defaults.fit;
            // removeBackground only: render the per-layer backdropColor as a
            // solid fill BEHIND the (potentially transparent) AI result so the
            // editor preview matches the print snapshot exactly. Shape-clipped
            // by the surrounding MapLayerSlot.
            const rbBackdropColor = aiResultUrl && aiSubjectKind === "removeBackground"
              ? (l.defaults as { backdropColor?: string }).backdropColor ?? null
              : null;
            return (
              <MapLayerSlot
                key={l.id}
                wrapStyle={wrapStyle}
                shape={effectiveShape}
                staticClip={staticClip}
                overlay={<>{moveHandle}{resizeHandle}</>}
              >
                {(clip) =>
                  src ? (
                    <>
                      {rbBackdropColor ? (
                        <div
                          aria-hidden="true"
                          style={{
                            position: "absolute",
                            inset: 0,
                            backgroundColor: rbBackdropColor,
                            clipPath: clip,
                            pointerEvents: "none",
                          }}
                        />
                      ) : null}
                      <PhotoLayerView
                        layerId={l.id}
                        src={src}
                        fit={effectiveFit}
                        shape={effectiveShape}
                        staticClipPath={clip}
                        offsetX={offsetX}
                        offsetY={offsetY}
                        zoom={zoom}
                        draggable={!!src && !usingRefOrSwap}
                      />
                      {/* Vattenmärke på AI-bildlagret — endast förhandsvisning. */}
                      <WatermarkOverlay clipPath={clip} />
                      {/* Referensen visas tills kundens eget resultat finns —
                          märk den som exempel så ingen tror att personen/djuret
                          på bilden följer med tavlan. */}
                      {(!aiResultUrl ||
                        aiResultUrl ===
                          (l.defaults as { demoResultUrl?: string }).demoResultUrl) && (
                        <div
                          aria-hidden="true"
                          style={{
                            position: "absolute",
                            left: 0,
                            right: 0,
                            bottom: "4%",
                            display: "flex",
                            justifyContent: "center",
                            pointerEvents: "none",
                            clipPath: clip,
                          }}
                        >
                          <span className="bg-background/85 text-foreground/90 text-[10px] font-medium px-2 py-0.5 rounded-full ring-1 ring-border">
                            {t("exampleBadge.label")}
                          </span>
                        </div>
                      )}
                    </>
                  ) : (
                    <div
                      className={`w-full h-full flex flex-col items-center justify-center gap-1 text-center px-2 bg-accent/30 rounded${
                        effectiveShape === "rect" ? " border-2 border-dashed border-primary/40" : ""
                      }`}
                      style={{ clipPath: clip }}
                    >
                      <span className="text-base">✨</span>
                      <span className="text-[10px] text-muted-foreground leading-tight">
                        AI-bild visas här efter Skapa nu
                      </span>
                    </div>
                  )
                }
              </MapLayerSlot>
            );
          }

          if (l.type === "text") {
            const v = layerValues[l.id];
            const tv = v && v.kind === "text" ? v : null;
            if (tv && !tv.visible) return null;
            const d = l.defaults;
            // If user customised the text, render it raw. Otherwise substitute
            // [[city]]/[[country]]/[[coords]] tokens using the linked map's
            // current value — so tokens never appear as literal text on first
            // load (before any pan/zoom).
            const mapId = d.linkedMapLayerId;
            const mv = mapId ? layerValues[mapId] : null;
            const place =
              mv && mv.kind === "map"
                ? {
                    placeName: mv.placeName,
                    city: mv.city ?? null,
                    country: mv.country ?? null,
                    center: mv.center,
                  }
                : null;
            const { text: effectiveText, spans: effectiveSpans } = buildEffectiveTextWithSpans(
              d,
              place,
              tv?.overrideText ?? null,
            );
            const effectiveFont = tv?.font || d.font;
            const layerHeightPx = (l.hPct / 100) * (frameShortPx > 0 ? frameShortPx : 0);
            return (
              <div key={l.id} style={wrapStyle}>
                <TextLayerView
                  layer={l}
                  effectiveText={effectiveText}
                  effectiveFont={effectiveFont}
                  effectiveSpans={effectiveSpans}
                  canvasShortPx={frameShortPx}
                  layerHeightPx={layerHeightPx}
                  effectiveFontSizePt={tv?.fontSizePt ?? undefined}
                />
                {moveHandle}
                {resizeHandle}
              </div>
            );
          }

          if (l.type === "image") {
            return (
              <div key={l.id} style={wrapStyle}>
                <ImageLayerView layer={l} />
                {/* Vattenmärke på statiska bildlager — endast förhandsvisning.
                    Samma cirkel-clip som ImageLayerView använder. */}
                {l.defaults.url ? (
                  <WatermarkOverlay
                    clipPath={l.defaults.shape === "circle" ? "circle(50% at 50% 50%)" : undefined}
                  />
                ) : null}
                {moveHandle}
                {resizeHandle}
              </div>
            );
          }

          if (l.type === "line") {
            // Wrappern släpper alltid igenom pekare till lager under;
            // bara move/resize-handtagen är interaktiva för kund-tillagda linjer.
            const style = { ...wrapStyle, pointerEvents: "none" as const };
            return (
              <div key={l.id} style={style}>
                <LineLayerView layer={l} thicknessPx={lineThicknessPxFromCanvas(l, frameShortPx)} />
                {moveHandle}
                {resizeHandle}
              </div>
            );
          }


          if (l.type === "margin") {
            // Margin wrapper covers the full canvas; without pointerEvents:none
            // it would steal all clicks from the map/text/photo layers below.
            // MarginLayerView already opts the four visible edge strips back
            // in via pointer-events:auto.
            return (
              <div key={l.id} style={{ ...wrapStyle, pointerEvents: "none" }}>
                <MarginLayerView layer={l} />
              </div>
            );
          }

          if (l.type === "shape") {
            const style = { ...wrapStyle, pointerEvents: "none" as const };
            return (
              <div key={l.id} style={style}>
                <ShapeLayerView layer={l} canvasShortPx={frameShortPx} />
                {moveHandle}
                {resizeHandle}
              </div>
            );
          }


          return null;
        })}

        {/* Visible front indicator (canvas wrap mode only) */}
        {isWrap && (
          <div
            className="absolute pointer-events-none border-2 border-dashed"
            style={{
              ...frontZoneStyle,
              borderColor: "hsl(var(--primary))",
              boxShadow: "0 0 0 1px hsl(var(--background) / 0.9), inset 0 0 0 1px hsl(var(--background) / 0.9)",
              zIndex: 41,
            }}
          >
            <span
              className="absolute -top-2 left-1/2 -translate-x-1/2 -translate-y-full px-2 py-0.5 text-[10px] uppercase tracking-wider rounded whitespace-nowrap font-semibold shadow"
              style={{
                background: "hsl(var(--primary))",
                color: "hsl(var(--primary-foreground))",
                zIndex: 42,
              }}
            >
              Synlig framsida · innehållet här viks om på sidorna
            </span>
          </div>
        )}

        {/* Center alignment guides (shown only while dragging snaps) */}
        {guides.v && (
          <div
            className="absolute pointer-events-none top-0 bottom-0 left-1/2 -translate-x-1/2 border-l border-dashed border-primary"
            style={{ zIndex: 10000 }}
          />
        )}
        {guides.h && (
          <div
            className="absolute pointer-events-none left-0 right-0 top-1/2 -translate-y-1/2 border-t border-dashed border-primary"
            style={{ zIndex: 10000 }}
          />
        )}
        {isAcrylic && (
          <div className="pointer-events-none absolute inset-0" style={{ zIndex: 45 }} aria-hidden>
            <AcrylicCornerOverlay frontWcm={frontW} frontHcm={frontH} zIndex={45} />
          </div>
        )}
        {hangerColor && <HangerOverlay color={hangerColor} textureUrl={hangerTextureUrl} motifHeightCm={frontH} />}
        {frameColor && borderPx > 0 && (
          <FrameBorder
            borderPx={borderPx}
            outerW={frameOuter.w}
            outerH={frameOuter.h}
            textureUrl={frameTextureUrl}
            fallbackColor={frameColor}
          />
        )}
      </div>
      {/* Notis endast när mallen har bildlager (= vattenmärke kan synas). */}
      {allLayers.some(
        (l) => l.type === "photo" || l.type === "aiPhoto" || (l.type === "image" && !!l.defaults.url),
      ) && (
        <p className="text-xs text-muted-foreground text-center max-w-sm">
          {t("watermark.notice")}
        </p>
      )}
      {allLayers.some((l) => l.type === "map") && (
        <p className="text-[10px] text-muted-foreground">© Mapbox · © OpenStreetMap</p>
      )}
    </div>
  );
}

/**
 * Renders a map layer wrapper that, when the shape is `circle`, measures its
 * own pixel size and produces a perfect-circle clip-path. For other shapes it
 * passes through the static (SVG / fallback) clip-path.
 */
function MapLayerSlot({
  wrapStyle,
  shape,
  staticClip,
  children,
  overlay,
}: {
  wrapStyle: React.CSSProperties;
  shape: ClipShape;
  staticClip: string | undefined;
  children: (clip: string | undefined) => React.ReactNode;
  overlay?: React.ReactNode;
}) {
  const { ref, clipPath } = useShapeClip(shape);
  const effectiveClip = clipPath ?? staticClip;
  return (
    <div ref={ref} style={wrapStyle}>
      {children(effectiveClip)}
      {overlay}
    </div>
  );
}

interface PhotoLayerViewProps {
  layerId: string;
  src: string | null;
  fit: "cover" | "contain";
  shape: "rect" | "circle" | "heart" | "star";
  staticClipPath?: string;
  offsetX: number;
  offsetY: number;
  zoom: number;
  draggable: boolean;
}

function PhotoLayerView({
  layerId,
  src,
  fit,
  shape,
  staticClipPath,
  offsetX,
  offsetY,
  zoom,
  draggable,
}: PhotoLayerViewProps) {
  const setLayerPhotoOffset = useEditorStore((s) => s.setLayerPhotoOffset);
  const setLayerPhotoZoom = useEditorStore((s) => s.setLayerPhotoZoom);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [dragging, setDragging] = useState(false);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [box, setBox] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  // True while user is actively dragging — used to suppress the re-clamp
  // useEffect from racing the drag and writing stale (0,0) values back.
  const draggingRef = useRef(false);

  // Track container size.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      setBox({ w: r.width, h: r.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Reset natural when src changes.
  useEffect(() => {
    setNatural(null);
  }, [src]);

  // Compute scaled image render size (cover) and max pan in percent of layer.
  const { maxX, maxY, renderW, renderH } = (() => {
    if (fit === "contain" || !natural || box.w === 0 || box.h === 0) {
      return { maxX: 0, maxY: 0, renderW: box.w, renderH: box.h };
    }
    const scale = Math.max(box.w / natural.w, box.h / natural.h) * zoom;
    const rW = natural.w * scale;
    const rH = natural.h * scale;
    const overflowXPct = ((rW - box.w) / box.w) * 100;
    const overflowYPct = ((rH - box.h) / box.h) * 100;
    return { maxX: overflowXPct / 2, maxY: overflowYPct / 2, renderW: rW, renderH: rH };
  })();

  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    baseX: number;
    baseY: number;
    width: number;
    height: number;
    nextX: number;
    nextY: number;
  } | null>(null);

  const applyImagePosition = useCallback(
    (x: number, y: number) => {
      const el = containerRef.current;
      const img = imgRef.current;
      if (!el || !img || fit === "contain") return;
      const rect = el.getBoundingClientRect();
      const nW = img.naturalWidth;
      const nH = img.naturalHeight;
      if (!nW || !nH || rect.width === 0 || rect.height === 0) return;
      const scale = Math.max(rect.width / nW, rect.height / nH) * zoom;
      const rW = nW * scale;
      const rH = nH * scale;
      img.style.position = "absolute";
      img.style.width = `${rW}px`;
      img.style.height = `${rH}px`;
      img.style.maxWidth = "none";
      img.style.objectFit = "fill";
      img.style.left = `${(rect.width - rW) / 2 + (x / 100) * rect.width}px`;
      img.style.top = `${(rect.height - rH) / 2 + (y / 100) * rect.height}px`;
    },
    [fit, zoom],
  );

  // Re-clamp current offset whenever bounds change. Skip while dragging and
  // skip until the image is measured — otherwise a transient state can wipe
  // the user's pan back to (0,0). Also skip when bounds are 0 (no overflow
  // measured yet) so we never overwrite a valid pan with (0,0) due to a
  // transient remeasure.
  useEffect(() => {
    if (fit === "contain" || !draggable) return;
    if (draggingRef.current) return;
    if (!natural) return;
    if (maxX === 0 && maxY === 0) return;
    const cx = Math.max(-maxX, Math.min(maxX, offsetX));
    const cy = Math.max(-maxY, Math.min(maxY, offsetY));
    if (cx !== offsetX || cy !== offsetY) {
      setLayerPhotoOffset(layerId, cx, cy);
    }
  }, [maxX, maxY, fit, layerId, offsetX, offsetY, setLayerPhotoOffset, draggable, natural]);

  // Clamped values used purely for rendering.
  const renderOffsetX = fit === "contain" || !natural ? 0 : Math.max(-maxX, Math.min(maxX, offsetX));
  const renderOffsetY = fit === "contain" || !natural ? 0 : Math.max(-maxY, Math.min(maxY, offsetY));

  // Keep latest bounds available to window listeners without re-binding.
  const boundsRef = useRef({ maxX, maxY });
  useEffect(() => {
    boundsRef.current = { maxX, maxY };
  }, [maxX, maxY]);

  // Live-measure bounds from the actual <img> in the DOM at pointer-down
  // so React state lag doesn't block the gesture.
  const measureBoundsNow = useCallback((): { maxX: number; maxY: number } => {
    const el = containerRef.current;
    const img = imgRef.current;
    if (!el || !img) return boundsRef.current;
    const rect = el.getBoundingClientRect();
    const nW = img.naturalWidth;
    const nH = img.naturalHeight;
    if (!nW || !nH || rect.width === 0 || rect.height === 0) return boundsRef.current;
    const scale = Math.max(rect.width / nW, rect.height / nH) * zoom;
    const rW = nW * scale;
    const rH = nH * scale;
    const mx = ((rW - rect.width) / rect.width) * 100 / 2;
    const my = ((rH - rect.height) / rect.height) * 100 / 2;
    if (!natural) setNatural({ w: nW, h: nH });
    return { maxX: Math.max(0, mx), maxY: Math.max(0, my) };
  }, [natural, zoom]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggable || fit === "contain") return;
      const el = containerRef.current;
      if (!el) return;
      const live = measureBoundsNow();
      boundsRef.current = live;
      // Nothing to pan → let event fall through to outer layer-move handler.
      if (live.maxX === 0 && live.maxY === 0) return;
      e.preventDefault();
      e.stopPropagation();
      const rect = el.getBoundingClientRect();
      dragStateRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        baseX: offsetX,
        baseY: offsetY,
        width: rect.width,
        height: rect.height,
        nextX: offsetX,
        nextY: offsetY,
      };
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      draggingRef.current = true;
      setDragging(true);

      const onMove = (ev: PointerEvent) => {
        const s = dragStateRef.current;
        if (!s || ev.pointerId !== s.pointerId) return;
        ev.preventDefault();
        const { maxX: mx, maxY: my } = boundsRef.current;
        const dxPct = ((ev.clientX - s.startX) / s.width) * 100;
        const dyPct = ((ev.clientY - s.startY) / s.height) * 100;
        const nextX = mx > 0 ? Math.max(-mx, Math.min(mx, s.baseX + dxPct)) : 0;
        const nextY = my > 0 ? Math.max(-my, Math.min(my, s.baseY + dyPct)) : 0;
        s.nextX = nextX;
        s.nextY = nextY;
        applyImagePosition(nextX, nextY);
      };
      const onUp = (ev: PointerEvent) => {
        const s = dragStateRef.current;
        if (s && ev.pointerId !== s.pointerId) return;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        window.removeEventListener("blur", onBlur);
        try {
          if (el.hasPointerCapture(ev.pointerId)) el.releasePointerCapture(ev.pointerId);
        } catch {
          /* ignore */
        }
        const finalX = s ? s.nextX : 0;
        const finalY = s ? s.nextY : 0;
        dragStateRef.current = null;
        setDragging(false);
        if (s) {
          // Commit to store, then keep the imperative DOM position pinned
          // for one frame so any re-render in between doesn't snap back.
          setLayerPhotoOffset(layerId, finalX, finalY);
          applyImagePosition(finalX, finalY);
          requestAnimationFrame(() => {
            applyImagePosition(finalX, finalY);
            draggingRef.current = false;
          });
        } else {
          draggingRef.current = false;
        }
      };
      const onBlur = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        window.removeEventListener("blur", onBlur);
        dragStateRef.current = null;
        draggingRef.current = false;
        setDragging(false);
      };
      window.addEventListener("pointermove", onMove, { passive: false });
      window.addEventListener("pointerup", onUp, { passive: false });
      window.addEventListener("pointercancel", onUp, { passive: false });
      window.addEventListener("blur", onBlur);
    },
    [draggable, fit, offsetX, offsetY, layerId, setLayerPhotoOffset, measureBoundsNow, applyImagePosition],
  );

  // Cleanup any in-flight drag on unmount.
  useEffect(() => {
    return () => {
      draggingRef.current = false;
      dragStateRef.current = null;
    };
  }, []);

  // canPan = cursor hint only; the actual gesture starts via measureBoundsNow.
  const canPan = fit !== "contain" && draggable;
  const canZoom = fit !== "contain" && !!src;

  // Keep latest zoom available without re-binding listeners.
  const zoomRef = useRef(zoom);
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  // Wheel-zoom: attach a non-passive listener so we can preventDefault.
  // React's synthetic onWheel is passive by default.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !canZoom) return;
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      ev.stopPropagation();
      // Use exponential scaling so each tick feels uniform.
      const factor = Math.exp(-ev.deltaY * 0.0015);
      const next = Math.max(1, Math.min(5, zoomRef.current * factor));
      if (next !== zoomRef.current) setLayerPhotoZoom(layerId, next);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [canZoom, layerId, setLayerPhotoZoom]);

  // Pinch-to-zoom (mobile/touch). Tracks two simultaneous touch pointers on
  // the container and updates zoom based on finger-distance ratio. When the
  // second finger lands we also abort any single-finger pan drag in progress
  // so the gestures don't fight each other.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !canZoom) return;
    const pointers = new Map<number, { x: number; y: number }>();
    let pinch: { startDist: number; startZoom: number } | null = null;
    const distance = () => {
      const pts = Array.from(pointers.values());
      if (pts.length < 2) return 0;
      const dx = pts[0]!.x - pts[1]!.x;
      const dy = pts[0]!.y - pts[1]!.y;
      return Math.hypot(dx, dy);
    };
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        pinch = { startDist: Math.max(1, distance()), startZoom: zoomRef.current };
        // Cancel an in-flight pan so the two gestures don't fight.
        if (dragStateRef.current) {
          dragStateRef.current = null;
          draggingRef.current = false;
          setDragging(false);
        }
      }
    };
    const onMove = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && pointers.size >= 2) {
        e.preventDefault();
        const d = distance();
        if (d <= 0) return;
        const next = Math.max(1, Math.min(5, pinch.startZoom * (d / pinch.startDist)));
        setLayerPhotoZoom(layerId, next);
      }
    };
    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
    };
    el.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [canZoom, layerId, setLayerPhotoZoom]);


  const measuredClip = box.w > 0 && box.h > 0 ? buildShapeClipPath(shape, box.w, box.h) : undefined;
  const clipPath = measuredClip ?? staticClipPath;

  // Single <img> kept mounted across the natural-unknown → known transition
  // so the browser doesn't reload the bitmap mid-interaction.
  const useCoverMath = fit !== "contain" && !!natural && box.w > 0 && box.h > 0;
  const imgStyle: React.CSSProperties = useCoverMath
    ? {
        position: "absolute",
        width: `${renderW}px`,
        height: `${renderH}px`,
        left: `${(box.w - renderW) / 2 + (renderOffsetX / 100) * box.w}px`,
        top: `${(box.h - renderH) / 2 + (renderOffsetY / 100) * box.h}px`,
        userSelect: "none",
        pointerEvents: "none",
        maxWidth: "none",
      }
    : {
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        objectFit: fit === "contain" ? "contain" : "cover",
        userSelect: "none",
        pointerEvents: "none",
      };

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 overflow-hidden"
      style={{
        clipPath,
        cursor: canPan ? (dragging ? "grabbing" : "grab") : "default",
        touchAction: canPan || canZoom ? "none" : undefined,
      }}
      onPointerDown={onPointerDown}
    >
      {src ? (
        <img
          ref={imgRef}
          src={src}
          alt=""
          onLoad={(e) => {
            const i = e.currentTarget;
            if (i.naturalWidth && i.naturalHeight) {
              setNatural({ w: i.naturalWidth, h: i.naturalHeight });
            }
          }}
          style={imgStyle}
          draggable={false}
        />
      ) : (
        <div
          className={`absolute inset-0 flex items-center justify-center bg-muted/40 text-[11px] text-muted-foreground text-center px-2${
            shape === "rect" ? " border-2 border-dashed border-foreground/30" : ""
          }`}
        >
          Ladda upp en bild
        </div>
      )}
    </div>
  );
}
