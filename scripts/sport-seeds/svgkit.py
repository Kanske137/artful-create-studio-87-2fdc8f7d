"""Små byggstenar för sporttavlornas SVG-grafik.

SVG som ritas som <img>/canvas-bild kan inte ladda webbfonter, så all fast
text i grafiken (ortnamn, månadsbokstäver, T1/T2) görs om till konturer
(paths) här med fontTools. Text som kunden ser och som ska översättas ligger
aldrig i grafiken utan i mallens textlager.
"""
from __future__ import annotations

import os
import re
from functools import lru_cache

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

FONT_DIR = os.environ.get("SPORT_FONT_DIR", "/tmp/fonts")


@lru_cache(maxsize=None)
def _font(name: str) -> TTFont:
    return TTFont(os.path.join(FONT_DIR, f"{name}.ttf"))


def text_width(text: str, font: str, size: float, ls_em: float = 0.0) -> float:
    f = _font(font)
    upm = f["head"].unitsPerEm
    cmap = f.getBestCmap()
    hmtx = f["hmtx"]
    w = 0.0
    for i, ch in enumerate(text):
        g = cmap.get(ord(ch))
        if g is None:
            continue
        w += hmtx[g][0] * size / upm
        if i < len(text) - 1:
            w += ls_em * size
    return w


def text_path(
    text: str,
    font: str,
    size: float,
    x: float,
    y: float,
    anchor: str = "start",
    ls_em: float = 0.0,
    fill: str = "#000000",
    rotate: float | None = None,
) -> str:
    """En <path> med texten som konturer. (x, y) = baslinjens startpunkt
    (eller mitt/slut enligt anchor). rotate roterar runt (x, y)."""
    f = _font(font)
    upm = f["head"].unitsPerEm
    cmap = f.getBestCmap()
    gs = f.getGlyphSet()
    hmtx = f["hmtx"]
    width = text_width(text, font, size, ls_em)
    start = x - (width / 2 if anchor == "middle" else width if anchor == "end" else 0)
    pen = SVGPathPen(gs)
    s = size / upm
    cx = start
    for i, ch in enumerate(text):
        g = cmap.get(ord(ch))
        if g is None:
            continue
        tp = TransformPen(pen, (s, 0, 0, -s, cx, y))
        gs[g].draw(tp)
        cx += hmtx[g][0] * s + (ls_em * size if i < len(text) - 1 else 0)
    # Två decimaler räcker gott (grafiken ritas som mest några hundra px
    # bred) och håller filerna små.
    d = re.sub(r"-?\d+\.\d+", lambda m: f"{float(m.group()):.2f}".rstrip("0").rstrip("."), pen.getCommands())
    tr = f' transform="rotate({rotate:.2f} {x:.2f} {y:.2f})"' if rotate is not None else ""
    return f'<path d="{d}" fill="{fill}"{tr}/>'


def svg(w: float, h: float, body: str, view: str | None = None) -> str:
    vb = view or f"0 0 {w:g} {h:g}"
    # width/height krävs: utan inneboende storlek ritar vissa webbläsare inte
    # SVG:n i canvas (tryckfilen).
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{w:g}" height="{h:g}" viewBox="{vb}">'
        f"{body}</svg>\n"
    )


# ---------- piktogram (viewBox 0 0 100 100) ----------

def _g(color: str, inner: str, transform: str = "") -> str:
    tr = f' transform="{transform}"' if transform else ""
    return (
        f'<g{tr} fill="none" stroke="{color}" stroke-linecap="round" '
        f'stroke-linejoin="round">{inner}</g>'
    )


def swim(color: str, transform: str = "", wave: float = 3) -> str:
    return _g(
        color,
        f'<circle cx="76" cy="46" r="7" fill="{color}" stroke="none"/>'
        '<polyline points="68,52 40,57" stroke-width="9"/>'
        '<polyline points="64,51 74,34 90,40" stroke-width="6"/>'
        '<polyline points="60,54 52,66" stroke-width="6"/>'
        '<polyline points="40,57 16,53" stroke-width="7"/>'
        '<polyline points="40,58 18,65" stroke-width="7"/>'
        f'<path d="M6 78 q8 -6 16 0 t16 0 t16 0 t16 0 t16 0 t16 0" stroke-width="{wave}"/>',
        transform,
    )


def bike(color: str, transform: str = "", frame: float = 4) -> str:
    return _g(
        color,
        f'<circle cx="24" cy="74" r="15" stroke-width="{frame}"/>'
        f'<circle cx="78" cy="74" r="15" stroke-width="{frame}"/>'
        f'<polyline points="24,74 46,74 40,52 70,52 78,74" stroke-width="{frame}"/>'
        f'<polyline points="46,74 70,52" stroke-width="{frame}"/>'
        f'<polyline points="70,52 72,44 80,44" stroke-width="{frame}"/>'
        f'<circle cx="67" cy="21" r="7" fill="{color}" stroke="none"/>'
        '<polyline points="42,46 62,30" stroke-width="9"/>'
        '<polyline points="61,31 76,44" stroke-width="6"/>'
        '<polyline points="42,46 56,58 47,72" stroke-width="7"/>',
        transform,
    )


def run(color: str, transform: str = "") -> str:
    return _g(
        color,
        f'<circle cx="58" cy="14" r="7" fill="{color}" stroke="none"/>'
        '<polyline points="55,25 48,51" stroke-width="9"/>'
        '<polyline points="54,30 64,40 73,33" stroke-width="6"/>'
        '<polyline points="52,31 42,39 36,31" stroke-width="6"/>'
        '<polyline points="48,51 63,62 60,80" stroke-width="7"/>'
        '<polyline points="48,51 41,69 27,75" stroke-width="7"/>',
        transform,
    )


def ski(color: str, head: str | None = None, transform: str = "", thin: float = 1.0) -> str:
    h = head or color
    return _g(
        color,
        f'<circle cx="54" cy="13" r="7" fill="{h}" stroke="none"/>'
        f'<polyline points="53,24 46,48" stroke-width="{9 * thin:g}"/>'
        f'<polyline points="46,48 58,62 57,78" stroke-width="{7 * thin:g}"/>'
        f'<polyline points="46,48 36,63 22,72" stroke-width="{7 * thin:g}"/>'
        f'<polyline points="52,28 62,36 70,30" stroke-width="{6 * thin:g}"/>'
        f'<polyline points="50,29 40,37 30,40" stroke-width="{6 * thin:g}"/>'
        f'<line x1="70" y1="30" x2="62" y2="80" stroke-width="{2.5 * thin:g}"/>'
        f'<line x1="30" y1="40" x2="10" y2="70" stroke-width="{2.5 * thin:g}"/>'
        f'<line x1="42" y1="80" x2="84" y2="80" stroke-width="{3 * thin:g}"/>'
        f'<line x1="4" y1="73" x2="38" y2="75" stroke-width="{3 * thin:g}"/>',
        transform,
    )


PICTOS = {"swim": swim, "bike": bike, "run": run, "ski": ski}


def solid(color: str) -> str:
    """Enfärgad yta. Läggs som bildlager med fit=cover och fyller då hela
    lagrets ruta oavsett tavlans format."""
    return svg(100, 100, f'<rect width="100" height="100" fill="{color}"/>')
