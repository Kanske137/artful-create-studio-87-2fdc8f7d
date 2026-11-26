"""Triathlontavla: fyra layouter (A förvald) och fyra distanser."""
from __future__ import annotations

from lib import BARLOW, BC, Layout, template
from svgkit import bike, run, solid, svg, swim, text_path

INK = "#1B1B1B"
MUTED = "#4A4A4A"
CREAM = "#F3EEE6"
RUST = "#B4441B"
BLUE = "#1F5FA8"
WHITE = "#FFFFFF"

ABOUT, TIMES, DIST = "Om dig", "Tider", "Distans"

# id: (namn i panelen, förvald text, grupp, extra)
FIELDS: dict[str, tuple[str, str, str, dict]] = {
    "tri-name": ("Namn", "Anna Lindqvist", ABOUT, {}),
    "tri-place": ("Ort och datum", "Kalmar · augusti 2026", ABOUT, {}),
    "tri-custom": ("Egen rad", "Mitt första långdistanstriathlon", ABOUT, {"toggle": True}),
    "tri-bib": ("Startnummer", "1482", ABOUT, {"toggle": True}),
    "tri-swim": ("Simning", "1:12:45", TIMES, {"half": True}),
    "tri-t1": ("Växling T1", "4:12", TIMES, {"half": True}),
    "tri-bike": ("Cykel", "5:41:10", TIMES, {"half": True}),
    "tri-t2": ("Växling T2", "2:48", TIMES, {"half": True}),
    "tri-run": ("Löpning", "3:58:02", TIMES, {"half": True}),
    "tri-total": ("Totaltid", "10:58:57", TIMES,
                  {"half": True, "sum": ["tri-swim", "tri-t1", "tri-bike", "tri-t2", "tri-run"]}),
    "tri-kicker": ("Rubrik", "Triathlon · Långdistans", DIST, {}),
    "tri-swimdist": ("Sträcka simning", "3,8 km", DIST, {"half": True}),
    "tri-bikedist": ("Sträcka cykel", "180 km", DIST, {"half": True}),
    "tri-rundist": ("Sträcka löpning", "42,2 km", DIST, {"half": True}),
    "tri-totaldist": ("Total sträcka", "226 km", DIST, {"half": True}),
}
ORDER = list(FIELDS)


def fld(L: Layout, id: str, x, y, w, h, **style):
    name, txt, group, extra = FIELDS[id]
    return L.text(id, name, x, y, w, h, txt, field={"group": group, **extra}, **style)


def lbl(L: Layout, id: str, txt: str, x, y, w, h, **style):
    return L.text(id, "Etikett", x, y, w, h, txt, **style)


# ---------- grafik ----------

def assets() -> dict[str, str]:
    out: dict[str, str] = {}
    # A: piktogramraden med växlingarna.
    row = []
    s = 128 / 100
    row.append(swim(INK, f"translate(0 2) scale({s})"))
    row.append(bike(INK, f"translate(188 2) scale({s})"))
    row.append(run(INK, f"translate(376 2) scale({s})"))
    for cx, label in ((158, "T1"), (346, "T2")):
        row.append(f'<line x1="{cx - 14}" y1="62" x2="{cx + 14}" y2="62" stroke="{RUST}" stroke-width="2.5" stroke-dasharray="4 3.5"/>')
        row.append(text_path(label, "BarlowCondensed-Bold", 15, cx, 86, anchor="middle", fill=RUST))
    out["tri-a-row.svg"] = svg(504, 132, "".join(row))

    # B: färgblock + vita piktogram.
    out["tri-b-swim-bg.svg"] = solid(BLUE)
    out["tri-b-bike-bg.svg"] = solid("#2F2F2F")
    out["tri-b-run-bg.svg"] = solid(RUST)
    out["tri-b-swim.svg"] = svg(100, 100, swim(WHITE))
    out["tri-b-bike.svg"] = svg(100, 100, bike(WHITE))
    out["tri-b-run.svg"] = svg(100, 100, run(WHITE))

    # C: medaljen. Ringen har en prickrad i stället för text (texten ligger i
    # textlager så att den kan översättas och ändras).
    import math
    dots = "".join(
        f'<circle cx="{220 + 189 * math.cos(a):.2f}" cy="{220 + 189 * math.sin(a):.2f}" r="3.2" fill="{CREAM}"/>'
        for a in (2 * math.pi * i / 48 for i in range(48))
    )
    medal = (
        f'<circle cx="220" cy="220" r="212" fill="{BLUE}"/>'
        f'<circle cx="220" cy="220" r="203" fill="none" stroke="{CREAM}" stroke-opacity="0.45" stroke-width="1.5"/>'
        f'{dots}'
        f'<circle cx="220" cy="220" r="175" fill="none" stroke="{CREAM}" stroke-opacity="0.45" stroke-width="1.5"/>'
        f'<circle cx="220" cy="220" r="166" fill="{CREAM}"/>'
        + swim(INK, "translate(112 98) scale(0.66)")
        + bike(INK, "translate(187 84) scale(0.66)")
        + run(INK, "translate(262 98) scale(0.66)")
    )
    out["tri-c-medal.svg"] = svg(440, 440, medal)

    # D: nummerlappen byggs av enfärgade ytor (cover, följer formatet) och
    # små hål (contain, förblir runda) i stället för en enda bild, så att
    # texten ligger rätt på nummerlappen i alla format.
    out["tri-d-white.svg"] = solid(WHITE)
    out["tri-d-head.svg"] = solid(RUST)
    out["tri-d-strip.svg"] = solid(INK)
    out["tri-d-hole.svg"] = svg(16, 16, '<circle cx="8" cy="8" r="6.5" fill="#FFFFFF" stroke="#9A9A9A" stroke-width="2"/>')

    # Miniatyrer till distansväljaren (språkneutrala: siffror + km).
    for key, num in (("sprint", "25,75"), ("olympisk", "51,5"), ("medel", "113"), ("lang", "226")):
        size = 92 if len(num) > 4 else 118
        body = (
            f'<rect width="300" height="400" fill="{CREAM}"/>'
            + swim(INK, "translate(40 56) scale(0.62)")
            + bike(INK, "translate(119 50) scale(0.62)")
            + run(INK, "translate(198 56) scale(0.62)")
            + text_path(num, "BarlowCondensed-ExtraBold", size, 150, 262, anchor="middle", fill=RUST)
            + text_path("km", "BarlowCondensed-SemiBold", 34, 150, 318, anchor="middle", fill=INK)
        )
        out[f"tri-v-{key}.svg"] = svg(300, 400, body)
    return out


# ---------- layouter ----------

def layout_a() -> Layout:
    L = Layout(CREAM, ORDER)
    fld(L, "tri-kicker", 48, 64, 504, 24, px=15, bold=True, ls=0.32, color=RUST, upper=True)
    L.image("tri-art", "Grafik", 48, 98, 504, 132, "tri-a-row.svg")
    fld(L, "tri-name", 48, 244, 504, 76, px=64, bold=True, lh=1.0, ls=0.01, color=INK, upper=True)
    fld(L, "tri-place", 48, 322, 504, 24, px=17, font=BARLOW, color=INK)
    fld(L, "tri-custom", 48, 347, 504, 22, px=15, font=BARLOW, italic=True, color=MUTED)
    L.hline("tri-rule-1", 48, 390, 504, 2, INK)
    L.hline("tri-rule-2", 48, 498, 504, 2, INK)
    L.vline("tri-div-1", 216, 392, 106, 1, INK)
    L.vline("tri-div-2", 384, 392, 106, 1, INK)
    for i, (key, label) in enumerate((("swim", "SIM"), ("bike", "CYKEL"), ("run", "LÖPNING"))):
        x = 48 + i * 168
        lbl(L, f"tri-l-{key}", label, x, 404, 168, 20, px=14, bold=True, ls=0.2, color=RUST)
        fld(L, f"tri-{key}dist", x, 425, 168, 20, px=15, font=BARLOW, color=INK)
        fld(L, f"tri-{key}", x + 6, 446, 156, 44, px=34, bold=True, lh=1.05, color=INK)
    for cx, key, label in ((240, "t1", "VÄXLING T1"), (360, "t2", "VÄXLING T2")):
        lbl(L, f"tri-l-{key}", label, cx - 60, 512, 120, 18, px=12, bold=True, ls=0.2, color=MUTED)
        fld(L, f"tri-{key}", cx - 60, 530, 120, 22, px=16, font=BARLOW, color=INK)
    lbl(L, "tri-l-total", "TOTALTID", 48, 584, 504, 20, px=14, bold=True, ls=0.32, color=INK)
    fld(L, "tri-total", 48, 604, 504, 82, px=76, bold=True, lh=1.0, color=RUST)
    for cx, key, label in ((240, "totaldist", "DISTANS"), (360, "bib", "STARTNUMMER")):
        lbl(L, f"tri-l-{key}", label, cx - 60, 692, 120, 16, px=12, bold=True, ls=0.2, color=MUTED)
        fld(L, f"tri-{key}", cx - 60, 708, 120, 24, px=15, font=BARLOW, color=INK)
    return L


def layout_b() -> Layout:
    L = Layout(CREAM, ORDER)
    fld(L, "tri-kicker", 48, 64, 504, 22, px=15, bold=True, ls=0.32, color=MUTED, align="left", upper=True)
    fld(L, "tri-name", 48, 88, 504, 64, px=60, bold=True, lh=1.0, color=INK, align="left", upper=True)
    fld(L, "tri-place", 48, 154, 504, 24, px=17, font=BARLOW, color=INK, align="left")
    blocks = (("swim", "SIM", 196, 104, 84), ("bike", "CYKEL", 332, 136, 100), ("run", "LÖPNING", 500, 116, 92))
    for key, label, top, h, pic in blocks:
        cy = top + h / 2
        L.image(f"tri-bg-{key}", "Färgblock", 48, top, 504, h, f"tri-b-{key}-bg.svg", fit="cover", z=1)
        L.image(f"tri-pic-{key}", "Piktogram", 70, cy - pic / 2, pic, pic, f"tri-b-{key}.svg", z=3)
        lbl(L, f"tri-l-{key}", label, 70 + pic + 16, cy - 28, 200, 30, px=26, bold=True, ls=0.08, color=WHITE, align="left")
        fld(L, f"tri-{key}dist", 70 + pic + 16, cy + 2, 160, 22, px=15, font=BARLOW, color=WHITE, align="left")
        fld(L, f"tri-{key}", 330, cy - 28, 198, 56, px=44, bold=True, lh=1.0, color=WHITE, align="right")
    for top, key, label in ((304, "t1", "VÄXLING T1"), (472, "t2", "VÄXLING T2")):
        L.hline(f"tri-rule-{key}a", 48, top, 504, 1, "#8A8A8A")
        L.hline(f"tri-rule-{key}b", 48, top + 24, 504, 1, "#8A8A8A")
        lbl(L, f"tri-l-{key}", label, 70, top + 3, 260, 20, px=12, bold=True, ls=0.2, color=MUTED, align="left")
        fld(L, f"tri-{key}", 330, top + 3, 198, 20, px=14, font=BARLOW, color=MUTED, align="right")
    lbl(L, "tri-l-total", "TOTALTID", 48, 636, 260, 18, px=14, bold=True, ls=0.32, color=INK, align="left")
    fld(L, "tri-total", 48, 654, 300, 68, px=64, bold=True, lh=1.0, color=INK, align="left")
    fld(L, "tri-totaldist", 352, 650, 200, 22, px=15, font=BARLOW, color=MUTED, align="right")
    lbl(L, "tri-l-bib", "STARTNUMMER", 352, 676, 200, 16, px=12, bold=True, ls=0.2, color=MUTED, align="right")
    fld(L, "tri-bib", 352, 692, 200, 24, px=15, font=BARLOW, color=MUTED, align="right")
    return L


def layout_c() -> Layout:
    L = Layout(CREAM, ORDER)
    L.image("tri-art", "Medalj", 80, 64, 440, 440, "tri-c-medal.svg")
    lbl(L, "tri-l-total", "TOTALTID", 150, 266, 300, 20, px=15, bold=True, ls=0.3, color=INK)
    fld(L, "tri-total", 150, 292, 300, 66, px=64, bold=True, lh=1.0, color=INK)
    fld(L, "tri-totaldist", 150, 362, 300, 24, px=16, font=BARLOW, ls=0.18, color=INK, upper=True)
    fld(L, "tri-kicker", 48, 520, 504, 22, px=15, bold=True, ls=0.32, color=BLUE, upper=True)
    fld(L, "tri-name", 48, 544, 504, 62, px=56, bold=True, lh=1.0, color=INK, upper=True)
    fld(L, "tri-place", 48, 608, 504, 24, px=17, font=BARLOW, color=INK)
    L.hline("tri-rule-1", 48, 646, 504, 2, INK)
    for i, (key, label) in enumerate((("swim", "SIM"), ("bike", "CYKEL"), ("run", "LÖPNING"))):
        x = 48 + i * 168
        lbl(L, f"tri-l-{key}", label, x, 658, 168, 18, px=13, bold=True, ls=0.2, color=INK)
        fld(L, f"tri-{key}", x + 6, 676, 156, 40, px=30, bold=True, lh=1.05, color=INK)
    return L


def layout_d() -> Layout:
    L = Layout("#E7E3DB", ORDER)
    L.image("tri-card", "Nummerlapp", 60, 64, 480, 496, "tri-d-white.svg", fit="cover", z=1)
    L.image("tri-card-head", "Nummerlapp", 60, 64, 480, 96, "tri-d-head.svg", fit="cover", z=2)
    L.image("tri-card-strip", "Nummerlapp", 60, 490, 480, 70, "tri-d-strip.svg", fit="cover", z=2)
    for i, (hx, hy) in enumerate(((74, 76), (510, 76), (74, 464), (510, 464))):
        L.image(f"tri-hole-{i}", "Hål", hx, hy, 16, 16, "tri-d-hole.svg", z=3)
    L.vline("tri-div-1", 220, 500, 50, 1, "#555555")
    L.vline("tri-div-2", 380, 500, 50, 1, "#555555")
    lbl(L, "tri-l-sport", "TRIATHLON", 60, 84, 480, 44, px=40, bold=True, ls=0.14, lh=1.0, color=WHITE)
    fld(L, "tri-place", 96, 128, 408, 20, px=15, bold=True, ls=0.2, color=WHITE, upper=True)
    fld(L, "tri-bib", 84, 170, 432, 182, px=190, bold=True, lh=0.95, ls=-0.02, color=INK)
    fld(L, "tri-name", 84, 354, 432, 42, px=38, bold=True, lh=1.1, color=INK, upper=True)
    fld(L, "tri-totaldist", 84, 398, 432, 22, px=14, font=BARLOW, color=MUTED)
    for i, (key, label) in enumerate((("swim", "SIM"), ("bike", "CYKEL"), ("run", "LÖPNING"))):
        x = 60 + i * 160
        lbl(L, f"tri-l-{key}", label, x, 500, 160, 16, px=13, bold=True, ls=0.2, color=WHITE)
        fld(L, f"tri-{key}", x + 12, 516, 136, 36, px=28, bold=True, lh=1.05, color=WHITE)
    lbl(L, "tri-l-total", "TOTALTID", 48, 600, 504, 18, px=14, bold=True, ls=0.32, color=INK)
    fld(L, "tri-total", 48, 618, 504, 68, px=64, bold=True, lh=1.0, color=INK)
    fld(L, "tri-custom", 48, 690, 504, 22, px=15, font=BARLOW, italic=True, color=INK)
    return L


VARIANTS = [
    ("sprint", "Sprint", "Triathlon · Sprintdistans", "750 m", "20 km", "5 km", "25,75 km"),
    ("olympisk", "Olympisk", "Triathlon · Olympisk distans", "1,5 km", "40 km", "10 km", "51,5 km"),
    ("medel", "Medel", "Triathlon · Medeldistans", "1,9 km", "90 km", "21,1 km", "113 km"),
    ("lang", "Lång", "Triathlon · Långdistans", "3,8 km", "180 km", "42,2 km", "226 km"),
]


def variants() -> list[dict]:
    from lib import asset
    out = []
    for vid, name, kicker, s, b, r, tot in VARIANTS:
        out.append({
            "id": vid,
            "name": name,
            "thumbnailUrl": asset(f"tri-v-{vid}.svg"),
            "overrides": {
                "tri-kicker": {"text": kicker},
                "tri-swimdist": {"text": s},
                "tri-bikedist": {"text": b},
                "tri-rundist": {"text": r},
                "tri-totaldist": {"text": tot},
            },
        })
    return out


# sv → (en, da, fi)
STRINGS = {
    # layouter, varianter
    "Tre discipliner": ("Three disciplines", "Tre discipliner", "Kolme lajia"),
    "Dagen i tre färger": ("The day in three colours", "Dagen i tre farver", "Päivä kolmessa värissä"),
    "Medaljen": ("The medal", "Medaljen", "Mitali"),
    "Nummerlappen": ("The race bib", "Startnummeret", "Kilpailunumero"),
    "Distans": ("Distance", "Distance", "Matka"),
    "Sprint": ("Sprint", "Sprint", "Sprintti"),
    "Olympisk": ("Olympic", "Olympisk", "Olympia"),
    "Medel": ("Middle", "Mellem", "Puolimatka"),
    "Lång": ("Long", "Lang", "Pitkä"),
    # fältnamn och grupper
    "Om dig": ("About you", "Om dig", "Sinusta"),
    "Tider": ("Times", "Tider", "Ajat"),
    "Namn": ("Name", "Navn", "Nimi"),
    "Ort och datum": ("Place and date", "Sted og dato", "Paikka ja päivämäärä"),
    "Egen rad": ("Your own line", "Egen linje", "Oma rivi"),
    "Startnummer": ("Bib number", "Startnummer", "Kilpailunumero"),
    "Simning": ("Swim", "Svømning", "Uinti"),
    "Cykel": ("Bike", "Cykling", "Pyöräily"),
    "Löpning": ("Run", "Løb", "Juoksu"),
    "Växling T1": ("Transition T1", "Skift T1", "Vaihto T1"),
    "Växling T2": ("Transition T2", "Skift T2", "Vaihto T2"),
    "Totaltid": ("Total time", "Samlet tid", "Kokonaisaika"),
    "Rubrik": ("Heading", "Overskrift", "Otsikko"),
    "Sträcka simning": ("Swim distance", "Distance svømning", "Uintimatka"),
    "Sträcka cykel": ("Bike distance", "Distance cykling", "Pyöräilymatka"),
    "Sträcka löpning": ("Run distance", "Distance løb", "Juoksumatka"),
    "Total sträcka": ("Total distance", "Samlet distance", "Kokonaismatka"),
    # fasta etiketter
    "SIM": ("SWIM", "SVØM", "UINTI"),
    "CYKEL": ("BIKE", "CYKEL", "PYÖRÄILY"),
    "LÖPNING": ("RUN", "LØB", "JUOKSU"),
    "TOTALTID": ("TOTAL TIME", "SAMLET TID", "KOKONAISAIKA"),
    "VÄXLING T1": ("TRANSITION T1", "SKIFT T1", "VAIHTO T1"),
    "VÄXLING T2": ("TRANSITION T2", "SKIFT T2", "VAIHTO T2"),
    "DISTANS": ("DISTANCE", "DISTANCE", "MATKA"),
    "STARTNUMMER": ("BIB", "STARTNUMMER", "NUMERO"),
    "TRIATHLON": ("TRIATHLON", "TRIATLON", "TRIATHLON"),
    # förvalda texter
    "Kalmar · augusti 2026": ("Kalmar · August 2026", "Kalmar · august 2026", "Kalmar · elokuu 2026"),
    "Mitt första långdistanstriathlon": (
        "My first long-distance triathlon", "Min første langdistancetriatlon", "Ensimmäinen pitkän matkan triathlonini"),
    "Triathlon · Sprintdistans": ("Triathlon · Sprint distance", "Triatlon · Sprintdistance", "Triathlon · Sprinttimatka"),
    "Triathlon · Olympisk distans": ("Triathlon · Olympic distance", "Triatlon · Olympisk distance", "Triathlon · Olympiamatka"),
    "Triathlon · Medeldistans": ("Triathlon · Middle distance", "Triatlon · Mellemdistance", "Triathlon · Puolimatka"),
    "Triathlon · Långdistans": ("Triathlon · Long distance", "Triatlon · Langdistance", "Triathlon · Pitkä matka"),
    "3,8 km": ("3.8 km", "3,8 km", "3,8 km"),
    "42,2 km": ("42.2 km", "42,2 km", "42,2 km"),
    "1,5 km": ("1.5 km", "1,5 km", "1,5 km"),
    "1,9 km": ("1.9 km", "1,9 km", "1,9 km"),
    "21,1 km": ("21.1 km", "21,1 km", "21,1 km"),
    "25,75 km": ("25.75 km", "25,75 km", "25,75 km"),
    "51,5 km": ("51.5 km", "51,5 km", "51,5 km"),
    "750 m": ("750 m", "750 m", "750 m"),
}


def build() -> dict:
    layouts = [
        ("standard", "Tre discipliner", layout_a()),
        ("tri-b", "Dagen i tre färger", layout_b()),
        ("tri-c", "Medaljen", layout_c()),
        ("tri-d", "Nummerlappen", layout_d()),
    ]
    # Även texter som är likadana på ett språk listas, så att admin ser dem som översatta.
    i18n = {lang: {sv: t[i] for sv, t in STRINGS.items()} for i, lang in enumerate(("en", "da", "fi"))}
    return template(layouts, variants(), "Distans", "lang", i18n)
