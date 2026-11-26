// Renders a text layer in the customer/admin editor preview.
// Uses pt-based font sizing (A4 reference), supports rich-text spans,
// linked-token placeholders, multiline (\n), and decoration ("box" /
// "side-rules" — auto-fits to text bbox, not the layer rect).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { TemplateLayer } from "@/lib/template-schema";
import type { TextSpan } from "@/lib/template-schema";
import {
  resolveFontPx,
  resolveLineHeight,
  resolveLetterSpacingEm,
  resolveSpans,
  decorationDefaults,
  mmToPx,
  displayText,
  fitWidthScale,
  piecesByLine,
} from "@/lib/text-typography";

let measureCtx: CanvasRenderingContext2D | null = null;
function measureText(text: string, cssFont: string): number {
  if (typeof document === "undefined") return 0;
  if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d");
  if (!measureCtx) return 0;
  measureCtx.font = cssFont;
  return measureCtx.measureText(text).width;
}

/** Räknar upp när webbtypsnitt har laddats, så att mätningen för
 *  krympning till bredd görs om med rätt typsnitt. */
function useFontsVersion(enabled: boolean): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!enabled || typeof document === "undefined" || !document.fonts) return;
    let alive = true;
    const bump = () => {
      if (alive) setV((x) => x + 1);
    };
    document.fonts.ready.then(bump).catch(() => undefined);
    document.fonts.addEventListener?.("loadingdone", bump);
    return () => {
      alive = false;
      document.fonts.removeEventListener?.("loadingdone", bump);
    };
  }, [enabled]);
  return v;
}

/** Lagrets bredd i px (för krympning till bredd). */
function useBoxWidth(enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    if (!enabled) return;
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [enabled]);
  return { ref, width: w };
}

type TextLayer = Extract<TemplateLayer, { type: "text" }>;

interface Props {
  layer: TextLayer;
  /** Effective text after linked-token substitution. */
  effectiveText: string;
  /** Customer-overridable font (falls back to layer default). */
  effectiveFont: string;
  /** Optional spans remapped from template tokens to the rendered text. */
  effectiveSpans?: TextSpan[];
  /** Canvas SHORT side in px — used to size pt and mm against A4. */
  canvasShortPx: number;
  /** Layer height in px — fallback only for legacy fontSizePct templates. */
  layerHeightPx: number;
  /** Customer-overridden font size in pt (Skapa själv). Wins over defaults. */
  effectiveFontSizePt?: number;
}

export function TextLayerView({
  layer,
  effectiveText,
  effectiveFont,
  effectiveSpans,
  canvasShortPx,
  layerHeightPx,
  effectiveFontSizePt,
}: Props) {
  const d = layer.defaults;
  const fitEnabled = !!d.fitWidth;
  const box = useBoxWidth(fitEnabled);
  const fontsVersion = useFontsVersion(fitEnabled);
  const unscaledPx =
    typeof effectiveFontSizePt === "number" && effectiveFontSizePt > 0
      ? resolveFontPx({ fontSizePt: effectiveFontSizePt }, canvasShortPx)
      : resolveFontPx(d, canvasShortPx, layerHeightPx);
  const lineH = resolveLineHeight(d);
  const letterSp = resolveLetterSpacingEm(d);
  const dec = decorationDefaults(d.decoration);

  // Versaler ändrar bara visningen (samma som tryckfilen).
  const shownText = displayText(d, effectiveText);
  const segments = resolveSpans(shownText, effectiveSpans ?? d.spans);
  // Krymp till bredd: samma beräkning som tryckfilen (template-snapshot).
  const fit = useMemo(
    () =>
      fitEnabled && box.width > 0
        ? fitWidthScale(
            piecesByLine(segments, unscaledPx, canvasShortPx, effectiveFont),
            unscaledPx,
            letterSp,
            box.width,
            measureText,
          )
        : 1,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fitEnabled, box.width, shownText, effectiveFont, unscaledPx, letterSp, canvasShortPx, fontsVersion, effectiveSpans, d.spans],
  );
  const fontPx = unscaledPx * fit;
  const padPx = dec ? mmToPx(dec.paddingMm, canvasShortPx) : 0;
  const thickPx = dec ? Math.max(1, mmToPx(dec.thicknessMm, canvasShortPx)) : 0;

  const justify =
    d.align === "left" ? "flex-start" : d.align === "right" ? "flex-end" : "center";
  // Lodrät placering (d.valign) — samma som tryckfilen.
  const alignV = d.valign === "top" ? "flex-start" : d.valign === "bottom" ? "flex-end" : "center";

  const renderText = (
    <span
      style={{
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        textAlign: d.align,
        display: "block",
      }}
    >
      {segments.map((s, i) => {
        const segFontPx = s.fontSizePt
          ? resolveFontPx({ fontSizePt: s.fontSizePt }, canvasShortPx) * fit
          : undefined;
        return (
          <span
            key={i}
            style={{
              fontFamily: `"${s.font || effectiveFont}", system-ui, sans-serif`,
              fontSize: segFontPx ? `${segFontPx}px` : undefined,
              color: s.color || undefined,
              fontWeight: s.bold ? 700 : undefined,
              fontStyle: s.italic ? "italic" : undefined,
              textDecoration: s.underline ? "underline" : undefined,
            }}
          >
            {s.text}
          </span>
        );
      })}
    </span>
  );

  // No decoration → simple flexbox alignment in the layer rect.
  if (!dec) {
    return (
      <div
        ref={box.ref}
        className="absolute inset-0 flex items-center"
        style={{
          alignItems: alignV,
          background: d.backgroundColor || "transparent",
          justifyContent: justify,
          fontFamily: `"${effectiveFont}", system-ui, sans-serif`,
          color: d.color,
          fontSize: `${fontPx}px`,
          lineHeight: lineH,
          letterSpacing: `${letterSp}em`,
          padding: "0 4px",
          pointerEvents: "none",
          // multiply låter underliggande tyg/skuggor lysa igenom (tröjnummer).
          mixBlendMode: d.blendMode === "multiply" ? "multiply" : undefined,
        }}
      >
        <span style={{ width: "100%" }}>{renderText}</span>
      </div>
    );
  }

  // "box": border around a fit-to-content wrapper.
  if (dec.kind === "box") {
    return (
      <div
        className="absolute inset-0 flex items-center"
        style={{
          alignItems: alignV,
          background: d.backgroundColor || "transparent",
          justifyContent: justify,
          pointerEvents: "none",
          padding: "0 4px",
        }}
      >
        <span
          style={{
            display: "inline-block",
            border: `${thickPx}px solid ${dec.color}`,
            padding: `${padPx}px ${padPx * 1.4}px`,
            fontFamily: `"${effectiveFont}", system-ui, sans-serif`,
            color: d.color,
            fontSize: `${fontPx}px`,
            lineHeight: lineH,
            letterSpacing: `${letterSp}em`,
            maxWidth: "100%",
          }}
        >
          {renderText}
        </span>
      </div>
    );
  }

  // "side-rules": [— text —]. Two horizontal rules flank the text content.
  // When `ruleLengthMm` is set, each rule has a fixed length in mm and the
  // text-wrapper expands the middle (rules get pushed outward as text grows).
  // Otherwise rules expand elastically to fill the layer width.
  const ruleLenPx = dec.ruleLengthMm ? mmToPx(dec.ruleLengthMm, canvasShortPx) : null;
  const ruleStyle: React.CSSProperties = ruleLenPx
    ? { width: `${ruleLenPx}px`, height: `${thickPx}px`, background: dec.color, flex: "0 0 auto" }
    : { flex: 1, height: `${thickPx}px`, background: dec.color, minWidth: 0 };

  return (
    <div
      className="absolute inset-0 flex items-center"
      style={{
        alignItems: alignV,
        background: d.backgroundColor || "transparent",
        justifyContent: ruleLenPx ? "center" : justify,
        pointerEvents: "none",
        gap: `${padPx}px`,
        padding: "0 4px",
      }}
    >
      <span style={ruleStyle} />
      <span
        style={{
          fontFamily: `"${effectiveFont}", system-ui, sans-serif`,
          color: d.color,
          fontSize: `${fontPx}px`,
          lineHeight: lineH,
          letterSpacing: `${letterSp}em`,
          flex: "0 0 auto",
          whiteSpace: "pre-wrap",
        }}
      >
        {renderText}
      </span>
      <span style={ruleStyle} />
    </div>
  );
}
