"""Klassikertavla: fyra layouter (B "Året runt" förvald) och fem
klassiker: hela, med Engelbrektsloppet, Halva, Tjej och Korta
(lopp och sträckor enligt ensvenskklassiker.se, nov 2026)."""
from __future__ import annotations

import math

from lib import BARLOW, BC, Layout, asset, template
from svgkit import PICTOS, solid, svg, text_path

NIGHT = "#1F2A3A"
LIGHT = "#F3EEE6"
GOLD = "#E2A33B"
MUTED_L = "#C9C2B6"
INK = "#1B1F27"

DISC = [  # (nyckel, grupp, etikett i ruta, ord i D, piktogram)
    ("ski", "Skidor", "SKIDOR", "SKIDOR", "ski"),
    ("bike", "Cykel", "CYKEL", "CYKEL", "bike"),
    ("swim", "Simning", "SIMNING", "SIM", "swim"),
    ("run", "Löpning", "LÖPNING", "LÖP", "run"),
]
DEFAULTS = {
    "ski": ("Vasaloppet", "90 km", "7:15:40", "mars 2026"),
    "bike": ("Vätternrundan", "315 km", "10:48:00", "juni 2026"),
    "swim": ("Vansbrosimningen", "3 km", "0:58:31", "juli 2026"),
    "run": ("Lidingöloppet", "30 km", "2:41:09", "september 2026"),
}

ABOUT, TOTAL = "Om dig", "Totalt"
FIELDS: dict[str, tuple[str, str, str, dict]] = {
    "ksk-name": ("Namn", "Johan Ek", ABOUT, {}),
    "ksk-kicker": ("Rubrik", "En svensk klassiker · 2026", ABOUT, {}),
    "ksk-custom": ("Egen rad", "Fyra lopp, fyra årstider", ABOUT, {"toggle": True}),
}
for key, group, *_ in DISC:
    race, dist, time, when = DEFAULTS[key]
    FIELDS[f"ksk-{key}-time"] = ("Tid", time, group, {"half": True})
    FIELDS[f"ksk-{key}-when"] = ("Månad", when, group, {"half": True})
    FIELDS[f"ksk-{key}-race"] = ("Lopp", race, group, {"half": True})
    FIELDS[f"ksk-{key}-dist"] = ("Sträcka", dist, group, {"half": True})
FIELDS["ksk-total"] = ("Sammanlagd tid", "21:43:20", TOTAL,
                       {"half": True, "sum": [f"ksk-{k}-time" for k, *_ in DISC]})
FIELDS["ksk-totaldist"] = ("Total sträcka (km)", "438", TOTAL, {"half": True})
ORDER = list(FIELDS)


def fld(L: Layout, id: str, x, y, w, h, **style):
    name, txt, group, extra = FIELDS[id]
    return L.text(id, name, x, y, w, h, txt, field={"group": group, **extra}, **style)


def lbl(L: Layout, id: str, txt: str, x, y, w, h, **style):
    return L.text(id, "Etikett", x, y, w, h, txt, **style)


# ---------- grafik ----------

def assets() -> dict[str, str]:
    out: dict[str, str] = {}
    for key, _g, _l, _w, picto in DISC:
        out[f"ksk-{key}-ink.svg"] = svg(100, 100, PICTOS[picto](INK))
    for key, color in (("ski", "#DCE6F0"), ("bike", "#F1E3B3"), ("swim", "#CFE6E4"), ("run", "#EBCFB6")):
        out[f"ksk-a-{key}-bg.svg"] = solid(color)

    # B: året som en ring med månaderna och loppen där de går.
    cx = cy = 220
    parts = [f'<circle cx="{cx}" cy="{cy}" r="168" fill="none" stroke="{LIGHT}" stroke-opacity="0.3" stroke-width="2"/>']
    ticks = []
    for i in range(12):
        a = math.radians(-90 + 30 * i)
        ticks.append(f'<line x1="{cx + 160 * math.cos(a):.1f}" y1="{cy + 160 * math.sin(a):.1f}" '
                     f'x2="{cx + 176 * math.cos(a):.1f}" y2="{cy + 176 * math.sin(a):.1f}"/>')
    parts.append(f'<g stroke="{LIGHT}" stroke-opacity="0.55" stroke-width="2">{"".join(ticks)}</g>')
    for i, m in enumerate("JFMAMJJASOND"):
        a = math.radians(-75 + 30 * i)
        parts.append(text_path(m, "BarlowCondensed-SemiBold", 15, cx + 196 * math.cos(a), cy + 196 * math.sin(a) + 5,
                               anchor="middle", fill=LIGHT))

    def pt(deg: float, r: float = 168) -> tuple[float, float]:
        a = math.radians(deg)
        return cx + r * math.cos(a), cy + r * math.sin(a)

    sx, sy = pt(-15)
    ex, ey = pt(165)
    parts.append(f'<path d="M{sx:.1f} {sy:.1f} A168 168 0 0 1 {ex:.1f} {ey:.1f}" stroke="{GOLD}" stroke-width="6" '
                 'stroke-linecap="round" fill="none"/>')
    for deg, (_k, _g, _l, _w, picto) in zip((-15, 75, 105, 165), DISC):
        x, y = pt(deg)
        parts.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="34" fill="{NIGHT}" stroke="{GOLD}" stroke-width="3"/>')
        parts.append(PICTOS[picto](LIGHT, transform=f"translate({x - 24:.1f} {y - 24:.1f}) scale(0.48)"))
    out["ksk-b-ring.svg"] = svg(440, 440, "".join(parts))

    # C: fyra medaljer med band från överkanten.
    ribbons, medals, icons = [], [], []
    for i, (_k, _g, _l, _w, picto) in enumerate(DISC):
        mx = 64 + i * 126
        ribbons.append(f'<path d="M{mx - 26} 0 H{mx - 2} L{mx + 12} 294 H{mx - 12} Z"/>'
                       f'<path d="M{mx + 26} 0 H{mx + 50} L{mx + 12} 294 H{mx - 12} Z" opacity="0.8"/>')
        medals.append(f'<circle cx="{mx}" cy="346" r="54"/>')
        icons.append(PICTOS[picto]("#2A2419", transform=f"translate({mx - 30} 316) scale(0.6)"))
    body = (
        f'<g fill="#C9483A">{"".join(ribbons)}</g>'
        f'<g fill="#D9B45A" stroke="{LIGHT}" stroke-opacity="0.35" stroke-width="2">{"".join(medals)}</g>'
        + "".join(icons)
    )
    out["ksk-c-medals.svg"] = svg(504, 424, body)

    # Miniatyrer till klassikerväljaren.
    for vid, num in (("klassiker", "438"), ("engelbrekt", "408"), ("halva", "211,5"), ("tjej", "141"), ("korta", "141")):
        size = 92 if len(num) > 4 else 118
        icons = "".join(
            PICTOS[p](LIGHT, transform=f"translate({34 + i * 62} 70) scale(0.5)") for i, (*_x, p) in enumerate(DISC)
        )
        tag = {"tjej": "TJEJ", "korta": "KORTA", "halva": "HALVA"}.get(vid)
        extra = text_path(tag, "BarlowCondensed-SemiBold", 26, 150, 352, anchor="middle", ls_em=0.2, fill=GOLD) if tag else ""
        body = (
            f'<rect width="300" height="400" fill="{NIGHT}"/>{icons}'
            + text_path(num, "BarlowCondensed-ExtraBold", size, 150, 252, anchor="middle", fill=LIGHT)
            + text_path("km", "BarlowCondensed-SemiBold", 30, 150, 300, anchor="middle", fill=MUTED_L)
            + extra
        )
        out[f"ksk-v-{vid}.svg"] = svg(300, 400, body)
    return out


# ---------- layouter ----------

def layout_a() -> Layout:
    accent = "#9C3B1B"
    L = Layout("#F6F3EC", ORDER)
    fld(L, "ksk-kicker", 48, 64, 504, 22, px=15, bold=True, ls=0.3, color=accent, align="left", upper=True)
    fld(L, "ksk-name", 48, 88, 504, 62, px=58, bold=True, lh=1.0, color=INK, align="left", upper=True)
    fld(L, "ksk-custom", 48, 152, 504, 22, px=16, font=BARLOW, color=INK, align="left")
    for i, (key, _g, label, _w, _p) in enumerate(DISC):
        tx, ty = 48 + (i % 2) * 255, 192 + (i // 2) * 204
        L.image(f"ksk-bg-{key}", "Ruta", tx, ty, 249, 198, f"ksk-a-{key}-bg.svg", fit="cover", z=1)
        L.image(f"ksk-pic-{key}", "Piktogram", tx + 16, ty + 14, 64, 64, f"ksk-{key}-ink.svg", z=2)
        lbl(L, f"ksk-l-{key}", label, tx + 20, ty + 104, 110, 18, px=13, bold=True, ls=0.22, color=INK, align="left")
        fld(L, f"ksk-{key}-when", tx + 120, ty + 104, 109, 18, px=13, bold=True, ls=0.1, color=INK, align="right",
            upper=True)
        fld(L, f"ksk-{key}-race", tx + 20, ty + 124, 209, 32, px=26, bold=True, lh=1.1, color=INK, align="left")
        fld(L, f"ksk-{key}-dist", tx + 20, ty + 158, 100, 32, px=16, font=BARLOW, color=INK, align="left")
        fld(L, f"ksk-{key}-time", tx + 96, ty + 152, 133, 40, px=34, bold=True, lh=1.05, color=INK, align="right")
    L.hline("ksk-rule", 48, 616, 504, 2, INK)
    lbl(L, "ksk-l-km", "KILOMETER", 48, 630, 220, 18, px=13, bold=True, ls=0.3, color=INK, align="left")
    fld(L, "ksk-totaldist", 48, 648, 240, 56, px=50, bold=True, lh=1.0, color=accent, align="left")
    lbl(L, "ksk-l-sum", "SAMMANLAGD TID", 300, 630, 252, 18, px=13, bold=True, ls=0.3, color=INK, align="right")
    fld(L, "ksk-total", 280, 648, 272, 56, px=50, bold=True, lh=1.0, color=INK, align="right")
    return L


def layout_b() -> Layout:
    L = Layout(NIGHT, ORDER)
    fld(L, "ksk-kicker", 48, 64, 504, 22, px=15, bold=True, ls=0.32, color=LIGHT, upper=True)
    L.image("ksk-ring", "Året", 80, 96, 440, 440, "ksk-b-ring.svg")
    lbl(L, "ksk-l-four", "FYRA LOPP", 150, 254, 300, 18, px=13, bold=True, ls=0.3, color=MUTED_L)
    fld(L, "ksk-totaldist", 150, 274, 300, 84, px=92, bold=True, lh=0.95, color=LIGHT)
    lbl(L, "ksk-l-km", "KILOMETER", 150, 360, 300, 22, px=18, bold=True, ls=0.3, color=LIGHT)
    fld(L, "ksk-name", 48, 552, 504, 58, px=54, bold=True, lh=1.0, color=LIGHT, upper=True)
    fld(L, "ksk-custom", 48, 612, 504, 22, px=16, font=BARLOW, italic=True, color=MUTED_L)
    L.hline("ksk-rule", 48, 648, 504, 1, "#6B7486")
    for i, (key, *_r) in enumerate(DISC):
        x = 48 + i * 126
        fld(L, f"ksk-{key}-race", x, 660, 118, 20, px=14, font=BARLOW, bold=True, color=LIGHT, align="left")
        fld(L, f"ksk-{key}-dist", x, 680, 118, 18, px=13, font=BARLOW, color=MUTED_L, align="left")
        fld(L, f"ksk-{key}-time", x, 698, 118, 30, px=24, bold=True, color=LIGHT, align="left")
    return L


def layout_c() -> Layout:
    L = Layout(NIGHT, ORDER)
    L.image("ksk-medals", "Medaljer", 48, 0, 504, 424, "ksk-c-medals.svg")
    for i, (key, *_r) in enumerate(DISC):
        x = 112 + i * 126 - 60
        fld(L, f"ksk-{key}-race", x, 430, 120, 20, px=14, font=BARLOW, bold=True, color=LIGHT)
        fld(L, f"ksk-{key}-dist", x, 450, 120, 18, px=13, font=BARLOW, color="#CFC8BB")
        fld(L, f"ksk-{key}-time", x, 468, 120, 34, px=26, bold=True, color=LIGHT)
    fld(L, "ksk-kicker", 48, 580, 504, 22, px=15, bold=True, ls=0.32, color="#D9B45A", upper=True)
    fld(L, "ksk-name", 48, 604, 504, 66, px=64, bold=True, lh=1.0, color=LIGHT, upper=True)
    for cx, lid, label, fid in ((220, "ksk-l-km", "KILOMETER", "ksk-totaldist"), (380, "ksk-l-sum", "SAMMANLAGD TID", "ksk-total")):
        lbl(L, lid, label, cx - 80, 680, 160, 16, px=12, bold=True, ls=0.2, color="#CFC8BB")
        fld(L, fid, cx - 80, 696, 160, 32, px=26, bold=True, color=LIGHT)
    return L


def layout_d() -> Layout:
    colors = ["#2F5E8C", "#B8860B", "#2B7A78", "#A8452A"]
    L = Layout("#F2EFE8", ORDER)
    fld(L, "ksk-kicker", 48, 64, 504, 22, px=15, bold=True, ls=0.3, color=INK, align="left", upper=True)
    fld(L, "ksk-name", 48, 88, 504, 58, px=54, bold=True, lh=1.0, color=INK, align="left", upper=True)
    fld(L, "ksk-custom", 48, 150, 504, 22, px=16, font=BARLOW, italic=True, color=INK, align="left")
    L.hline("ksk-rule-top", 48, 186, 504, 2, INK)
    for i, ((key, _g, _l, word, _p), color) in enumerate(zip(DISC, colors)):
        top = 188 + i * 108
        lbl(L, f"ksk-w-{key}", word, 48, top + 2, 296, 104, px=104, bold=True, lh=1.0, color=color, align="left")
        fld(L, f"ksk-{key}-race", 330, top + 16, 222, 20, px=15, font=BARLOW, bold=True, color=INK, align="right")
        fld(L, f"ksk-{key}-time", 330, top + 36, 222, 40, px=32, bold=True, lh=1.1, color=INK, align="right")
        fld(L, f"ksk-{key}-dist", 330, top + 76, 222, 18, px=13, font=BARLOW, color="#4A4F58", align="right")
        L.hline(f"ksk-rule-{key}", 48, top + 106, 504, 2, INK)
    lbl(L, "ksk-l-km", "KILOMETER", 48, 640, 220, 18, px=13, bold=True, ls=0.3, color=INK, align="left")
    fld(L, "ksk-totaldist", 48, 658, 240, 52, px=46, bold=True, lh=1.0, color=INK, align="left")
    lbl(L, "ksk-l-sum", "SAMMANLAGD TID", 300, 640, 252, 18, px=13, bold=True, ls=0.3, color=INK, align="right")
    fld(L, "ksk-total", 260, 658, 292, 52, px=46, bold=True, lh=1.0, color=INK, align="right")
    return L


# (id, namn, rubrik, {disciplin: (lopp, sträcka)}, total km)
CLASSICS = [
    ("klassiker", "En svensk klassiker", "En svensk klassiker · 2026",
     {k: DEFAULTS[k][:2] for k in DEFAULTS}, "438"),
    ("engelbrekt", "Med Engelbrektsloppet", "En svensk klassiker · 2026",
     {**{k: DEFAULTS[k][:2] for k in DEFAULTS}, "ski": ("Engelbrektsloppet", "60 km")}, "408"),
    ("halva", "Halva", "En svensk klassiker Halva · 2026",
     {"ski": ("Vasaloppet 45", "45 km"), "bike": ("Halvvättern", "150 km"),
      "swim": ("Vansbro Halvsim", "1,5 km"), "run": ("Lidingöloppet 15", "15 km")}, "211,5"),
    ("tjej", "Tjej", "En svensk klassiker Tjej · 2026",
     {"ski": ("Tjejvasan", "30 km"), "bike": ("Tjejvättern", "100 km"),
      "swim": ("Vansbro Tjejsim", "1 km"), "run": ("Rosa Bandet-loppet", "10 km")}, "141"),
    ("korta", "Korta", "En svensk klassiker Korta · 2026",
     {"ski": ("Vasaloppet 30", "30 km"), "bike": ("Vätternrundan 100", "100 km"),
      "swim": ("Vansbro Kortsim", "1 km"), "run": ("Lidingöloppet 10", "10 km")}, "141"),
]


def variants() -> list[dict]:
    out = []
    for vid, name, kicker, races, total in CLASSICS:
        ov = {"ksk-kicker": {"text": kicker}, "ksk-totaldist": {"text": total}}
        for key, (race, dist) in races.items():
            ov[f"ksk-{key}-race"] = {"text": race}
            ov[f"ksk-{key}-dist"] = {"text": dist}
        out.append({"id": vid, "name": name, "thumbnailUrl": asset(f"ksk-v-{vid}.svg"), "overrides": ov})
    return out


STRINGS = {
    "Året runt": ("All year round", "Året rundt", "Ympäri vuoden"),
    "Fyra lopp": ("Four races", "Fire løb", "Neljä kilpailua"),
    "Fyra medaljer": ("Four medals", "Fire medaljer", "Neljä mitalia"),
    "Fyra ord": ("Four words", "Fire ord", "Neljä sanaa"),
    "Klassiker": ("Classic", "Klassiker", "Klassikko"),
    "En svensk klassiker": ("A Swedish Classic", "En svensk klassiker", "En svensk klassiker"),
    "Med Engelbrektsloppet": ("With Engelbrektsloppet", "Med Engelbrektsloppet", "Engelbrektsloppet"),
    "Halva": ("Half", "Halv", "Puolikas"),
    "Tjej": ("Women's", "Kvinder", "Naiset"),
    "Korta": ("Short", "Korte", "Lyhyt"),
    "Om dig": ("About you", "Om dig", "Sinusta"),
    "Skidor": ("Skiing", "Skiløb", "Hiihto"),
    "Cykel": ("Cycling", "Cykling", "Pyöräily"),
    "Simning": ("Swimming", "Svømning", "Uinti"),
    "Löpning": ("Running", "Løb", "Juoksu"),
    "Totalt": ("Total", "I alt", "Yhteensä"),
    "Namn": ("Name", "Navn", "Nimi"),
    "Rubrik": ("Heading", "Overskrift", "Otsikko"),
    "Egen rad": ("Your own line", "Egen linje", "Oma rivi"),
    "Tid": ("Time", "Tid", "Aika"),
    "Månad": ("Month", "Måned", "Kuukausi"),
    "Lopp": ("Race", "Løb", "Kilpailu"),
    "Sträcka": ("Distance", "Distance", "Matka"),
    "Sammanlagd tid": ("Combined time", "Samlet tid", "Yhteisaika"),
    "Total sträcka (km)": ("Total distance (km)", "Samlet distance (km)", "Kokonaismatka (km)"),
    "SKIDOR": ("SKIING", "SKILØB", "HIIHTO"),
    "CYKEL": ("CYCLING", "CYKLING", "PYÖRÄILY"),
    "SIMNING": ("SWIMMING", "SVØMNING", "UINTI"),
    "LÖPNING": ("RUNNING", "LØB", "JUOKSU"),
    "SIM": ("SWIM", "SVØM", "UINTI"),
    "LÖP": ("RUN", "LØB", "JUOKSU"),
    "KILOMETER": ("KILOMETRES", "KILOMETER", "KILOMETRIÄ"),
    "SAMMANLAGD TID": ("COMBINED TIME", "SAMLET TID", "YHTEISAIKA"),
    "FYRA LOPP": ("FOUR RACES", "FIRE LØB", "NELJÄ KILPAILUA"),
    "En svensk klassiker · 2026": ("A Swedish Classic · 2026", "En svensk klassiker · 2026", "En svensk klassiker · 2026"),
    "En svensk klassiker Halva · 2026": ("A Swedish Classic Half · 2026", "En svensk klassiker Halva · 2026",
                                         "En svensk klassiker Halva · 2026"),
    "En svensk klassiker Tjej · 2026": ("A Swedish Classic Women's · 2026", "En svensk klassiker Tjej · 2026",
                                        "En svensk klassiker Tjej · 2026"),
    "En svensk klassiker Korta · 2026": ("A Swedish Classic Short · 2026", "En svensk klassiker Korta · 2026",
                                         "En svensk klassiker Korta · 2026"),
    "mars 2026": ("March 2026", "marts 2026", "maaliskuu 2026"),
    "juni 2026": ("June 2026", "juni 2026", "kesäkuu 2026"),
    "juli 2026": ("July 2026", "juli 2026", "heinäkuu 2026"),
    "september 2026": ("September 2026", "september 2026", "syyskuu 2026"),
    "Fyra lopp, fyra årstider": ("Four races, four seasons", "Fire løb, fire årstider", "Neljä kilpailua, neljä vuodenaikaa"),
    "1,5 km": ("1.5 km", "1,5 km", "1,5 km"),
    # Loppens namn är desamma på alla språk.
    **{race: (race,) * 3 for _v, _n, _k, races, _t in CLASSICS for race, _d in races.values()},
}


def build() -> dict:
    layouts = [
        ("standard", "Året runt", layout_b()),
        ("ksk-a", "Fyra lopp", layout_a()),
        ("ksk-c", "Fyra medaljer", layout_c()),
        ("ksk-d", "Fyra ord", layout_d()),
    ]
    # Även texter som är likadana på ett språk listas, så att admin ser dem som översatta.
    i18n = {lang: {sv: t[i] for sv, t in STRINGS.items()} for i, lang in enumerate(("en", "da", "fi"))}
    return template(layouts, variants(), "Klassiker", "klassiker", i18n)
