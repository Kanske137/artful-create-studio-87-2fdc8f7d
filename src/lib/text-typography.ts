// Pure helpers for text rendering: pt-based font sizing (A4 reference),
// linked tokens, span resolution and decoration sizing.
//
// Reference: A4 short side = 210 mm = 595.276 pt (1 pt = 0.3528 mm). When a
// template defines `fontSizePt`, the renderer must size the text so that
// `12 pt` measures 12 pt on an A4 print. We use the canvas SHORT side as
// the proxy for A4 short side. For non-A4 aspects this still gives the user
// a Word-like mental model on the standard portrait/landscape canvas.
import type {
  TextDefaults,
  TextSpan,
  LinkedTextToken,
  TextDecoration,
} from "@/lib/template-schema";

export const A4_SHORT_PT = 595.276;
export const A4_SHORT_MM = 210;
export const PT_PER_MM = 1 / 0.3528;

/** Resolve effective font size in PIXELS for a given canvas short side (px).
 *  Prefers `fontSizePt` (A4-relative). Falls back to legacy `fontSizePct`
 *  (% of layer HEIGHT, callers must pass `layerHeightPx`). */
export function resolveFontPx(
  d: Pick<TextDefaults, "fontSizePt" | "fontSizePct">,
  canvasShortPx: number,
  layerHeightPx?: number,
): number {
  if (typeof d.fontSizePt === "number" && d.fontSizePt > 0) {
    return Math.max(4, (d.fontSizePt / A4_SHORT_PT) * canvasShortPx);
  }
  const pct = d.fontSizePct ?? 8;
  const ref = layerHeightPx ?? canvasShortPx * 0.1;
  return Math.max(4, (pct / 100) * ref);
}

/** Convert mm to pixels for a given canvas short side (px). */
export function mmToPx(mm: number, canvasShortPx: number): number {
  return (mm / A4_SHORT_MM) * canvasShortPx;
}

export function resolveLineHeight(d: Pick<TextDefaults, "lineHeight">): number {
  return typeof d.lineHeight === "number" && d.lineHeight > 0 ? d.lineHeight : 1.15;
}

export function resolveLetterSpacingEm(d: Pick<TextDefaults, "letterSpacingEm">): number {
  return typeof d.letterSpacingEm === "number" ? d.letterSpacingEm : 0;
}

// ---------- linked tokens ----------

const PLACEHOLDER_RX: Record<LinkedTextToken, RegExp> = {
  city: /\[\[city\]\]/g,
  country: /\[\[country\]\]/g,
  coordinates: /\[\[coords?\]\]/g,
  date: /\[\[date\]\]/g,
};

export interface LinkedPlace {
  placeName?: string;
  city?: string | null;
  country?: string | null;
  center?: [number, number];
  /** "YYYY-MM-DD" — sätts bara när källan är ett starmap-lager. */
  dateISO?: string;
}

export function tokenValue(place: LinkedPlace, token: LinkedTextToken): string {
  if (token === "city") {
    return (place.city ?? place.placeName?.split(",")[0] ?? "").trim().toUpperCase();
  }
  if (token === "country") return (place.country ?? "").trim();
  if (token === "coordinates" && place.center) {
    const [lng, lat] = place.center;
    return `${lat.toFixed(3)}°N · ${lng.toFixed(3)}°E`;
  }
  if (token === "date" && place.dateISO) {
    const [y, m, d] = place.dateISO.split("-");
    if (y && m && d) return `${d.padStart(2, "0")}.${m.padStart(2, "0")}.${y}`;
  }
  return "";
}

/** Migrate legacy `linkedMapFields` → array of tokens in canonical order. */
export function tokensFromLegacyFields(
  fields: { city?: boolean; country?: boolean; coordinates?: boolean } | undefined,
): LinkedTextToken[] {
  if (!fields) return ["city", "country", "coordinates"];
  const out: LinkedTextToken[] = [];
  if (fields.city ?? true) out.push("city");
  if (fields.country ?? true) out.push("country");
  if (fields.coordinates ?? true) out.push("coordinates");
  return out;
}

/** Effective tokens list (new field, then legacy fallback). */
export function resolveLinkedTokens(d: TextDefaults): LinkedTextToken[] {
  if (d.linkedTokens && d.linkedTokens.length > 0) return d.linkedTokens;
  return tokensFromLegacyFields(d.linkedMapFields);
}

/** Build the auto-text string for a linked text layer.
 *  - If `template` (the admin-stored text) contains placeholders, those are
 *    substituted and the surrounding literal text/whitespace is preserved.
 *  - Otherwise, the tokens are joined by `\n` in the given order.
 *
 *  Returns the resolved text. Empty token values yield an empty string and
 *  collapse any standalone line they were on. */
export function buildLinkedText(
  template: string | undefined,
  tokens: LinkedTextToken[],
  place: LinkedPlace,
): string {
  const hasPlaceholder = template ? /\[\[(city|country|coords?|date)\]\]/.test(template) : false;
  if (template && hasPlaceholder) {
    let out = template;
    (Object.keys(PLACEHOLDER_RX) as LinkedTextToken[]).forEach((tok) => {
      out = out.replace(PLACEHOLDER_RX[tok], tokenValue(place, tok));
    });
    // Drop lines that became empty after substitution (so a missing country
    // doesn't leave a blank middle row).
    return out
      .split("\n")
      .filter((line, i, arr) => line.trim() !== "" || (i > 0 && arr[i - 1].trim() !== ""))
      .join("\n");
  }
  return tokens
    .map((t) => tokenValue(place, t))
    .filter((s) => s.trim().length > 0)
    .join("\n");
}

/** Substitute placeholders and remap rich-text spans authored against the raw
 * template text so a span on `[[coords]]` applies to the full rendered
 * coordinate string instead of the same numeric character offsets. */
export function substituteTokensWithSpans(
  d: Pick<TextDefaults, "text" | "linkedMapLayerId" | "linkedTokens" | "linkedMapFields" | "spans">,
  place: LinkedPlace | null,
): { text: string; spans?: TextSpan[] } {
  const raw = d.text ?? "";
  const safePlace = place ?? FALLBACK_PLACE;
  const hasPlaceholder = PLACEHOLDER_TEST_RX.test(raw);
  const text = substituteTokens(d, safePlace);
  if (!hasPlaceholder || !d.spans?.length) return { text, spans: d.spans };

  const segments: Array<{ rawStart: number; rawEnd: number; outStart: number; outEnd: number; token: boolean }> = [];
  const rx = /\[\[(city|country|coords?|date)\]\]/g;
  let outPos = 0;
  let rawPos = 0;
  for (const m of raw.matchAll(rx)) {
    const rawStart = m.index ?? 0;
    if (rawStart > rawPos) {
      const len = rawStart - rawPos;
      segments.push({ rawStart: rawPos, rawEnd: rawStart, outStart: outPos, outEnd: outPos + len, token: false });
      outPos += len;
    }
    const tok = m[1] === "coords" || m[1] === "coord" ? "coordinates" : (m[1] as LinkedTextToken);
    const replacement = tokenValue(safePlace, tok);
    const rawEnd = rawStart + m[0].length;
    segments.push({ rawStart, rawEnd, outStart: outPos, outEnd: outPos + replacement.length, token: true });
    outPos += replacement.length;
    rawPos = rawEnd;
  }
  if (rawPos < raw.length) {
    segments.push({ rawStart: rawPos, rawEnd: raw.length, outStart: outPos, outEnd: outPos + (raw.length - rawPos), token: false });
  }

  const mapPoint = (pos: number, side: "start" | "end") => {
    for (const seg of segments) {
      if (pos < seg.rawStart) return seg.outStart;
      if (pos <= seg.rawEnd) {
        if (seg.token) return side === "start" ? seg.outStart : seg.outEnd;
        return seg.outStart + Math.max(0, Math.min(seg.rawEnd - seg.rawStart, pos - seg.rawStart));
      }
    }
    return text.length;
  };

  const spans = d.spans
    .map((s) => ({ ...s, start: mapPoint(s.start, "start"), end: mapPoint(s.end, "end") }))
    .filter((s) => s.end > s.start && s.start < text.length)
    .map((s) => ({ ...s, start: Math.max(0, s.start), end: Math.min(text.length, s.end) }));
  return { text, spans };
}

/** Build the effective rendered text + spans, taking customer override into
 * account.
 *
 * Model:
 *  - The auto-text is `substituteTokensWithSpans(d, place)` — what the layer
 *    would show without any customer edit. Each character is associated with
 *    either a token (city/country/coordinates) or literal admin text, and any
 *    admin-authored spans (rich-text overrides) follow the substituted output.
 *  - When the customer typed something into the field, that override REPLACES
 *    the rendered text. Lines are aligned greedily against the auto-text so
 *    deleted lines drop their token style and modified lines INHERIT the
 *    style of the auto-line they replaced (so a span that admin set on
 *    `[[coords]]` keeps applying to the customer's new text on that row).
 *  - If override is null, returns the auto output unchanged.
 *  - If the layer is not linked to a map AND has no placeholders, override
 *    just replaces the text and no spans are inherited (admin spans apply
 *    only when text matches exactly).
 */
export function buildEffectiveTextWithSpans(
  d: Pick<TextDefaults, "text" | "linkedMapLayerId" | "linkedTokens" | "linkedMapFields" | "spans">,
  place: LinkedPlace | null,
  overrideText: string | null,
): { text: string; spans?: TextSpan[] } {
  const auto = substituteTokensWithSpans(d, place);
  if (overrideText === null) return auto;

  const isLinked = !!d.linkedMapLayerId || /\[\[(city|country|coords?|date)\]\]/.test(d.text ?? "");
  if (!isLinked) {
    // Non-linked: override is just the customer's free text. Keep admin spans
    // only if they still fit inside the new length.
    const spans = (d.spans ?? [])
      .map((s) => ({ ...s, end: Math.min(s.end, overrideText.length), start: Math.min(s.start, overrideText.length) }))
      .filter((s) => s.end > s.start);
    return { text: overrideText, spans: spans.length ? spans : undefined };
  }

  const autoLines = auto.text.split("\n");
  // Per-auto-line spans (offsets relative to that line).
  const autoLineSpans: Array<TextSpan[]> = [];
  {
    let cursor = 0;
    for (const line of autoLines) {
      const lineStart = cursor;
      const lineEnd = cursor + line.length;
      const spans = (auto.spans ?? [])
        .filter((s) => s.end > lineStart && s.start < lineEnd)
        .map((s) => ({
          ...s,
          start: Math.max(0, s.start - lineStart),
          end: Math.min(line.length, s.end - lineStart),
        }))
        .filter((s) => s.end > s.start);
      autoLineSpans.push(spans);
      cursor = lineEnd + 1; // +1 for the "\n"
    }
  }

  const overrideLines = overrideText.split("\n");
  // Greedy line alignment with single-line skip detection.
  type Emit = { text: string; lineSpans: TextSpan[]; inherited: boolean };
  const emits: Emit[] = [];
  let i = 0;
  let j = 0;
  while (j < overrideLines.length) {
    const ol = overrideLines[j];
    if (i < autoLines.length && ol === autoLines[i]) {
      emits.push({ text: ol, lineSpans: autoLineSpans[i] ?? [], inherited: false });
      i++;
      j++;
      continue;
    }
    // Detect a deleted auto line: if the override line matches a later auto
    // line, advance i without emitting (the in-between auto lines were
    // removed by the customer).
    let skipped = false;
    for (let k = i + 1; k < autoLines.length && k <= i + 3; k++) {
      if (ol === autoLines[k]) {
        i = k;
        skipped = true;
        break;
      }
    }
    if (skipped) continue;
    // Modified line: inherit spans from autoLines[i] (apply the first span's
    // style to the entire override line so a single token-styled line keeps
    // its style across the customer's new text).
    const inheritFrom = autoLineSpans[i] ?? [];
    const inheritedSpan = inheritFrom[0];
    const lineSpans: TextSpan[] = inheritedSpan && ol.length > 0
      ? [{ ...inheritedSpan, start: 0, end: ol.length }]
      : [];
    emits.push({ text: ol, lineSpans, inherited: true });
    i++;
    j++;
  }

  // Stitch back into a single string + global spans.
  const outLines: string[] = [];
  const outSpans: TextSpan[] = [];
  let cursor = 0;
  for (const e of emits) {
    outLines.push(e.text);
    for (const s of e.lineSpans) {
      outSpans.push({ ...s, start: cursor + s.start, end: cursor + s.end });
    }
    cursor += e.text.length + 1; // +1 for the "\n"
  }
  return { text: outLines.join("\n"), spans: outSpans.length ? outSpans : undefined };
}

// ---------- spans ----------

export interface ResolvedSpan {
  start: number;
  end: number;
  text: string;
  font?: string;
  fontSizePt?: number;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}

/** Slice the text into contiguous segments, applying spans on top.
 *  Spans are clipped to text length, sorted, and gaps become unstyled
 *  segments. Overlapping spans take the LAST one's style for the overlap. */
export function resolveSpans(text: string, spans?: TextSpan[]): ResolvedSpan[] {
  if (!spans || spans.length === 0 || text.length === 0) {
    return [{ start: 0, end: text.length, text }];
  }
  const cleaned = spans
    .map((s) => ({
      ...s,
      start: Math.max(0, Math.min(text.length, s.start)),
      end: Math.max(0, Math.min(text.length, s.end)),
    }))
    .filter((s) => s.end > s.start)
    .sort((a, b) => a.start - b.start);

  const out: ResolvedSpan[] = [];
  let cursor = 0;
  for (const s of cleaned) {
    if (s.start > cursor) {
      out.push({ start: cursor, end: s.start, text: text.slice(cursor, s.start) });
    }
    const startNow = Math.max(s.start, cursor);
    if (startNow < s.end) {
      out.push({
        start: startNow,
        end: s.end,
        text: text.slice(startNow, s.end),
        font: s.font,
        fontSizePt: s.fontSizePt,
        color: s.color,
        bold: s.bold,
        italic: s.italic,
        underline: s.underline,
      });
      cursor = s.end;
    }
  }
  if (cursor < text.length) {
    out.push({ start: cursor, end: text.length, text: text.slice(cursor) });
  }
  return out;
}

// ---------- decoration helpers ----------

export function decorationDefaults(d: TextDecoration | undefined): TextDecoration | null {
  if (!d || d.kind === "none") return null;
  return {
    kind: d.kind,
    thicknessMm: d.thicknessMm > 0 ? d.thicknessMm : 0.5,
    color: d.color || "#000000",
    paddingMm: d.paddingMm ?? 2,
    gapMm: d.gapMm,
    ruleLengthMm: d.ruleLengthMm,
    ruleAlign: d.ruleAlign ?? "text-edge",
  };
}

// ---------- token substitution (display) ----------

const PLACEHOLDER_TEST_RX = /\[\[(city|country|coords?|date)\]\]/;

/** Default fallback used by admin previews when no real place is available. */
export const FALLBACK_PLACE: LinkedPlace = {
  city: "STOCKHOLM",
  country: "SVERIGE",
  center: [18.0686, 59.3293],
};

/** Resolve the text shown to the user/admin: substitutes [[city]] etc. and,
 *  for layers linked to a map (linkedMapLayerId), builds the auto-text from
 *  tokens when no explicit placeholders exist. Falls back to FALLBACK_PLACE
 *  when called from admin previews without a real place. */
export function substituteTokens(
  d: Pick<TextDefaults, "text" | "linkedMapLayerId" | "linkedTokens" | "linkedMapFields">,
  place: LinkedPlace | null,
): string {
  const raw = d.text ?? "";
  const hasPlaceholder = PLACEHOLDER_TEST_RX.test(raw);
  const isLinked = !!d.linkedMapLayerId;
  if (!hasPlaceholder && !isLinked) return raw;
  const safePlace = place ?? FALLBACK_PLACE;
  const tokens = resolveLinkedTokens(d as TextDefaults);
  return buildLinkedText(raw, tokens, safePlace);
}
