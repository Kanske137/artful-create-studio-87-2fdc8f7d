"""Förhandsvisning av en mallayout i Python, för att kontrollera layouten
innan den laddas i editorn. Följer editorns tryckfilsrendering
(src/lib/template-snapshot.ts) så långt det går: procentrutor, pt mot
A4-kortsidan, spans för fet/kursiv, versaler, krympning till bredd,
contain/cover för bildlager och formlagrens tjockleksformel.
"""
from __future__ import annotations

import io
import os
import re

import cairosvg
from PIL import Image, ImageDraw, ImageFont

from svgkit import FONT_DIR

A4_SHORT_PT = 595.276

FONT_FILES = {
    ("Barlow Condensed", False, False): "BarlowCondensed-Regular",
    ("Barlow Condensed", True, False): "BarlowCondensed-Bold",
    ("Barlow Condensed", False, True): "BarlowCondensed-Italic",
    ("Barlow Condensed", True, True): "BarlowCondensed-BoldItalic",
    ("Barlow", False, False): "Barlow-Regular",
    ("Barlow", True, False): "Barlow-Bold",
    ("Barlow", False, True): "Barlow-Italic",
    ("Barlow", True, True): "Barlow-BoldItalic",
    ("Cormorant Garamond", False, False): "CormorantGaramond",
    ("Cormorant Garamond", True, False): "CormorantGaramond",
    ("Cormorant Garamond", False, True): "CormorantGaramond-Italic",
    ("Cormorant Garamond", True, True): "CormorantGaramond-Italic",
}

_font_cache: dict = {}


def font(family: str, bold: bool, italic: bool, px: float) -> ImageFont.FreeTypeFont:
    key = (family, bold, italic, round(px, 2))
    if key in _font_cache:
        return _font_cache[key]
    name = FONT_FILES[(family, bold, italic)]
    f = ImageFont.truetype(os.path.join(FONT_DIR, f"{name}.ttf"), size=max(1, round(px)))
    if family == "Cormorant Garamond":
        try:
            f.set_variation_by_axes([700 if bold else 400])
        except Exception:
            pass
    _font_cache[key] = f
    return f


def asset_name(url: str) -> str:
    return re.sub(r"\?.*$", "", url).rsplit("/", 1)[-1]


def draw_image(img: Image.Image, r, layer, assets: dict[str, str]):
    svg = assets[asset_name(layer["defaults"]["url"])]
    m = re.search(r'width="([\d.]+)" height="([\d.]+)"', svg)
    iw, ih = float(m.group(1)), float(m.group(2))
    x, y, w, h = r
    if layer["defaults"]["fit"] == "contain":
        s = min(w / iw, h / ih)
    else:
        s = max(w / iw, h / ih)
    dw, dh = max(1, round(iw * s)), max(1, round(ih * s))
    png = cairosvg.svg2png(bytestring=svg.encode(), output_width=dw, output_height=dh)
    tile = Image.open(io.BytesIO(png)).convert("RGBA")
    dx, dy = x + (w - dw) / 2, y + (h - dh) / 2
    if layer["defaults"]["fit"] == "cover":
        # Beskär till rutan.
        cx0, cy0 = round(x - dx), round(y - dy)
        tile = tile.crop((cx0, cy0, cx0 + round(w), cy0 + round(h)))
        dx, dy = x, y
    img.alpha_composite(tile, (round(dx), round(dy)))


def draw_shape(draw: ImageDraw.ImageDraw, r, d, short):
    x, y, w, h = r
    sw = max(1, d["strokeMm"] * 0.5 / 100 * short)
    c = d["color"]
    if d["kind"] == "line-horizontal":
        draw.rectangle([x, y, x + w, y + sw - 0.01], fill=c)
    elif d["kind"] == "line-vertical":
        draw.rectangle([x, y, x + sw - 0.01, y + h], fill=c)
    elif d["kind"] in ("frame-rect", "frame-double"):
        draw.rectangle([x + sw / 2, y + sw / 2, x + w - sw / 2, y + h - sw / 2], outline=c, width=round(sw))
    elif d["kind"] == "frame-oval":
        draw.ellipse([x + sw / 2, y + sw / 2, x + w - sw / 2, y + h - sw / 2], outline=c, width=round(sw))


def line_width(pieces, ls_px):
    w = 0.0
    for txt, f, _c in pieces:
        w += f.getlength(txt) + ls_px * len(txt)
    return w


def draw_text(img: Image.Image, r, layer, text: str, short: float, debug=False):
    d = layer["defaults"]
    if not text.strip():
        return
    if d.get("uppercase"):
        text = text.upper()
    base = d["fontSizePt"] / A4_SHORT_PT * short
    spans = d.get("spans") or []
    bold = any(s.get("bold") for s in spans)
    italic = any(s.get("italic") for s in spans)
    lh = d.get("lineHeight", 1.15)
    ls_em = d.get("letterSpacingEm", 0)
    x, y, w, h = r

    def seg_pieces(line: str, px: float):
        # Stöd för delspans med egen storlek/färg (statiska etiketter).
        out = []
        if spans and not (len(spans) == 1 and spans[0]["start"] == 0 and spans[0]["end"] >= len(text)):
            pos = 0
            for s in spans:
                if s["start"] > pos:
                    out.append((line[pos:s["start"]], px, d["color"], bold, italic))
                sub = line[s["start"]:s["end"]]
                spx = s.get("fontSizePt", None)
                out.append((sub, spx / A4_SHORT_PT * short if spx else px, s.get("color", d["color"]),
                            s.get("bold", False), s.get("italic", False)))
                pos = s["end"]
            if pos < len(line):
                out.append((line[pos:], px, d["color"], bold, italic))
        else:
            out.append((line, px, d["color"], bold, italic))
        return [(t, font(d["font"], b, it, p), c) for t, p, c, b, it in out if t]

    lines = text.split("\n")
    px = base
    if d.get("fitWidth"):
        widest = max(line_width(seg_pieces(l, base), ls_em * base) for l in lines)
        target = w * 0.94
        if widest > target:
            px = base * max(0.4, target / widest)
    ls_px = ls_em * px
    # Radbrytning på ord mot hela rutans bredd.
    wrapped: list[str] = []
    for l in lines:
        words = l.split(" ")
        cur = ""
        for word in words:
            cand = word if not cur else cur + " " + word
            if cur and line_width(seg_pieces(cand, px), ls_px) > w:
                wrapped.append(cur)
                cur = word
            else:
                cur = cand
        wrapped.append(cur)
    lh_px = round(px * lh)
    total = lh_px * len(wrapped)
    va = d.get("valign", "middle")
    cy = y if va == "top" else (y + h - total if va == "bottom" else y + h / 2 - total / 2)
    draw = ImageDraw.Draw(img)
    if debug:
        draw.rectangle([x, y, x + w, y + h], outline="#FF00FF")
    for l in wrapped:
        pieces = seg_pieces(l, px)
        lw = line_width(pieces, ls_px) - ls_px
        al = d["align"]
        cx = x if al == "left" else (x + w - lw if al == "right" else x + w / 2 - lw / 2)
        mid = cy + lh_px / 2
        for txt, f, c in pieces:
            for ch in txt:
                draw.text((cx, mid), ch, font=f, fill=c, anchor="lm")
                cx += f.getlength(ch) + ls_px
        cy += lh_px


def render(block: dict, assets: dict[str, str], W: int = 600, H: int = 800,
           values: dict[str, str] | None = None, tr: dict[str, str] | None = None,
           hidden: set[str] | None = None, debug: bool = False) -> Image.Image:
    lay = block["portrait"]
    img = Image.new("RGBA", (W, H), lay["background"]["color"])
    short = min(W, H)
    draw = ImageDraw.Draw(img)
    for layer in sorted(lay["layers"], key=lambda l: l["zIndex"]):
        if hidden and layer["id"] in hidden:
            continue
        r = (layer["xPct"] / 100 * W, layer["yPct"] / 100 * H, layer["wPct"] / 100 * W, layer["hPct"] / 100 * H)
        t = layer["type"]
        if t == "image":
            draw_image(img, r, layer, assets)
        elif t == "shape":
            draw_shape(draw, r, layer["defaults"], short)
        elif t == "text":
            txt = (values or {}).get(layer["id"], layer["defaults"]["text"])
            if tr:
                txt = tr.get(txt, txt)
            draw_text(img, r, layer, txt, short, debug)
    return img.convert("RGB")
