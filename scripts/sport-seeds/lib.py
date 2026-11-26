"""Lagerhjälpare för sporttavlornas startmallar.

Allt ritas på en referensduk på 600 x 800 px (3:4, standardstorleken 30x40)
och sparas i procent. Textstorlek anges i px på referensduken och räknas om
till pt (A4-kortsidan, samma formel som editorn: px = pt / 595.276 * kortsida).
"""
from __future__ import annotations

W, H = 600, 800
PX_TO_PT = 595.276 / W
ASSET_BASE = "https://artful-create-studio-87.lovable.app/sport/"
ASSET_VERSION = "1"

# Typsnitt (finns i editorns typsnittskatalog och index.html).
BC = "Barlow Condensed"
BARLOW = "Barlow"
SERIF = "Cormorant Garamond"

FULL = 200  # stilavsnitt som täcker hela texten (kortas till textens längd)


def rect(x: float, y: float, w: float, h: float) -> dict:
    return {
        "xPct": round(x / W * 100, 4),
        "yPct": round(y / H * 100, 4),
        "wPct": round(w / W * 100, 4),
        "hPct": round(h / H * 100, 4),
    }


def locks(**over) -> dict:
    base = dict(position=True, move=True, size=True, shape=True, font=True, content=False, visibility=True, style=True)
    base.update(over)
    return base


def asset(name: str) -> str:
    return f"{ASSET_BASE}{name}?v={ASSET_VERSION}"


class Layout:
    """Samlar lagren för en layout. Kundfält läggs i den ordning de ska
    visas i panelen; z styr ritordningen."""

    def __init__(self, bg: str, field_order: list[str]):
        self.bg = bg
        self.field_order = field_order
        self.layers: list[dict] = []

    def _add(self, layer: dict) -> dict:
        ids = {l["id"] for l in self.layers}
        assert layer["id"] not in ids, f"dubbelt lager-id {layer['id']}"
        self.layers.append(layer)
        return layer

    def image(self, id: str, name: str, x, y, w, h, file: str, fit: str = "contain", z: int = 2) -> dict:
        return self._add({
            "id": id, "name": name, "type": "image", **rect(x, y, w, h), "rotation": 0, "zIndex": z,
            "locks": locks(content=True),
            "defaults": {"url": asset(file), "fit": fit, "shape": "rect"},
        })

    def hline(self, id: str, x, y, w, px: float, color: str, z: int = 6) -> dict:
        return self._add({
            "id": id, "name": "Linje", "type": "shape", **rect(x, y, w, max(px, 1)), "rotation": 0, "zIndex": z,
            "locks": locks(content=True),
            # Formens tjocklek: px = strokeMm * 0.5 % av kortsidan.
            "defaults": {"kind": "line-horizontal", "strokeMm": round(px / (0.005 * W), 4), "color": color},
        })

    def vline(self, id: str, x, y, h, px: float, color: str, z: int = 6) -> dict:
        return self._add({
            "id": id, "name": "Linje", "type": "shape", **rect(x, y, max(px, 1), h), "rotation": 0, "zIndex": z,
            "locks": locks(content=True),
            "defaults": {"kind": "line-vertical", "strokeMm": round(px / (0.005 * W), 4), "color": color},
        })

    def frame(self, id: str, x, y, w, h, px: float, color: str, kind: str = "frame-rect", z: int = 6) -> dict:
        return self._add({
            "id": id, "name": "Ram", "type": "shape", **rect(x, y, w, h), "rotation": 0, "zIndex": z,
            "locks": locks(content=True),
            "defaults": {"kind": kind, "strokeMm": round(px / (0.005 * W), 4), "color": color},
        })

    def text(
        self,
        id: str,
        name: str,
        x, y, w, h,
        txt: str,
        *,
        px: float,
        color: str,
        font: str = BC,
        bold: bool = False,
        italic: bool = False,
        align: str = "center",
        valign: str = "middle",
        ls: float = 0.0,
        lh: float = 1.15,
        upper: bool = False,
        field: dict | None = None,
        rotation: float = 0,
        spans: list | None = None,
        fit: bool = True,
        z: int = 10,
    ) -> dict:
        """field=None ⇒ fast etikett (låst innehåll). field={group, half,
        toggle, sum, fit} ⇒ kundfält i panelens formulär."""
        d: dict = {
            "text": txt,
            "font": font,
            "fontSizePt": round(px * PX_TO_PT, 2),
            "align": align,
            "valign": valign,
            "color": color,
            "letterSpacingEm": ls,
            "lineHeight": lh,
        }
        if spans is not None:
            d["spans"] = spans
        elif bold or italic:
            sp = {"start": 0, "end": FULL}
            if bold:
                sp["bold"] = True
            if italic:
                sp["italic"] = True
            d["spans"] = [sp]
        if upper:
            d["uppercase"] = True
        lk = locks(content=True)
        if fit:
            # Fast etikett vars översättning kan bli längre än svenskan.
            d["fitWidth"] = True
        if field is not None:
            lk = locks(visibility=not field.get("toggle", False))
            d["formGroup"] = field["group"]
            if field.get("half"):
                d["formHalf"] = True
            if field.get("fit", True):
                d["fitWidth"] = True
            if field.get("sum"):
                d["sumTimesOf"] = field["sum"]
        return self._add({
            "id": id, "name": name, "type": "text", **rect(x, y, w, h), "rotation": rotation, "zIndex": z,
            "locks": lk, "defaults": d,
        })

    def ordered(self) -> list[dict]:
        """Grafik först, sedan kundfälten i panelordning, sist fasta etiketter.
        Panelen listar textfälten i lagerordning; z styr ritordningen."""
        order = {fid: i for i, fid in enumerate(self.field_order)}

        def key(l: dict):
            if l["type"] != "text":
                return (0, 0)
            if "formGroup" in l["defaults"]:
                assert l["id"] in order, f"fält {l['id']} saknas i fältordningen"
                return (1, order[l["id"]])
            return (2, 0)

        return sorted(self.layers, key=key)

    def block(self) -> dict:
        layers = self.ordered()
        portrait = {"aspect": "3:4", "background": {"color": self.bg}, "layers": layers}
        # Mallen är bara stående; liggande block krävs av schemat men används
        # inte (orientations = ["portrait"]), så det lämnas tomt.
        landscape = {"aspect": "4:3", "background": {"color": self.bg}, "layers": []}
        return {"portrait": portrait, "landscape": landscape}


def template(layouts: list[tuple[str, str, Layout]], variants: list[dict], variant_label: str,
             default_variant: str, i18n: dict) -> dict:
    (std_id, std_name, std), *extra = layouts
    return {
        "orientations": ["portrait"],
        "defaultOrientation": "portrait",
        "defaultLayoutName": std_name,
        "defaultLayout": std.block(),
        "extraLayouts": [
            {"id": lid, "name": name, "defaultLayout": lay.block()} for lid, name, lay in extra
        ],
        "contentVariants": variants,
        "contentVariantLabel": variant_label,
        "defaultContentVariantId": default_variant,
        "i18n": i18n,
    }
