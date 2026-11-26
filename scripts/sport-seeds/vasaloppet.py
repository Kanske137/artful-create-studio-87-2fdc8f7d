"""Vasaloppstavla: fyra layouter (A förvald). Varianterna Vasaloppet,
Öppet Spår och Nattvasan går samma bana, Sälen–Mora 90 km."""
from __future__ import annotations

from lib import BARLOW, BC, SERIF, Layout, asset, template
from svgkit import ski, svg, text_path

INK = "#14243F"
SKY = "#1D3557"
RED = "#B3261E"
SNOW = "#F7F9FB"
PAPER = "#F4F1EA"
PALE = "#DCE7F1"
GREY = "#5A6577"
WHITE = "#FFFFFF"

ABOUT, TIMES, RACE = "Om dig", "Tider", "Lopp"

# Kontrollerna längs banan (km från start).
CHECKPOINTS = [
    ("Smågan", 11, "0:52"),
    ("Mångsbodarna", 24, "1:49"),
    ("Risberg", 35, "2:35"),
    ("Evertsberg", 47, "3:28"),
    ("Oxberg", 62, "4:33"),
    ("Hökberg", 71, "5:10"),
    ("Eldris", 81, "5:52"),
]

FIELDS: dict[str, tuple[str, str, str, dict]] = {
    "vas-name": ("Namn", "Linnea Berg", ABOUT, {}),
    "vas-date": ("Datum", "7 mars 2027", ABOUT, {}),
    "vas-bib": ("Startnummer", "Startnummer 12345", ABOUT, {"toggle": True}),
    "vas-group": ("Startled", "Startled 5", ABOUT, {"toggle": True}),
    "vas-custom": ("Egen rad", "Mitt tredje Vasalopp", ABOUT, {"toggle": True}),
    "vas-time": ("Sluttid", "6:42:18", TIMES, {}),
    **{f"vas-cp{i + 1}": (name, t, TIMES, {"half": True}) for i, (name, _km, t) in enumerate(CHECKPOINTS)},
    "vas-title": ("Loppets namn", "Vasaloppet", RACE, {}),
    "vas-kicker": ("Sträcka", "Sälen – Mora · 90 km", RACE, {}),
    "vas-verb": ("Hyllningsrad", "som åkte Vasaloppet", RACE, {}),
}
ORDER = list(FIELDS)


def fld(L: Layout, id: str, x, y, w, h, **style):
    name, txt, group, extra = FIELDS[id]
    return L.text(id, name, x, y, w, h, txt, field={"group": group, **extra}, **style)


def lbl(L: Layout, id: str, txt: str, x, y, w, h, **style):
    return L.text(id, "Etikett", x, y, w, h, txt, **style)


def km_x(km: float, x0: float, x1: float) -> float:
    return x0 + km / 90 * (x1 - x0)


# ---------- grafik ----------

def assets() -> dict[str, str]:
    out: dict[str, str] = {}

    # A: vinterlandskap utan åkare (åkaren är ett eget lager som behåller sin
    # form i alla format). Viktigt innehåll hålls borta från kanterna, som
    # kan beskäras (cover).
    trees = "".join(
        f'<path d="M{x} {y} L{x + 13 * s} {y - 38 * s} L{x + 26 * s} {y}Z"/>'
        for x, y, s in ((318, 432, 1), (344, 436, 0.85), (498, 420, 1.1), (526, 416, 0.95),
                        (554, 412, 0.8), (14, 420, 1), (40, 414, 0.8))
    )
    scene = (
        f'<rect width="600" height="620" fill="{SKY}"/>'
        '<circle cx="455" cy="330" r="62" fill="#F2C14E"/>'
        '<path d="M0 360 Q90 300 190 340 Q300 385 400 330 Q500 280 600 335 V620 H0Z" fill="#8FAECB"/>'
        '<path d="M0 420 Q140 370 290 410 Q430 448 600 400 V620 H0Z" fill="#C9D9E8"/>'
        f'<g fill="#1E3B33">{trees}</g>'
        f'<path d="M0 500 Q180 460 360 492 Q480 512 600 480 V620 H0Z" fill="{SNOW}"/>'
        '<path d="M0 588 Q300 538 600 554" stroke="#DCE6F0" stroke-width="3" fill="none"/>'
        '<path d="M0 600 Q300 550 600 566" stroke="#DCE6F0" stroke-width="3" fill="none"/>'
    )
    out["vas-a-scene.svg"] = svg(600, 620, scene)
    out["vas-skier.svg"] = svg(100, 100, ski(INK, RED))

    # A: kontrollerna längs banan.
    x0, x1, base = 6, 490, 70
    tl = [f'<line x1="{x0}" y1="{base}" x2="{x1}" y2="{base}" stroke="{INK}" stroke-width="2"/>']
    stops = [("Sälen", 0)] + [(n, k) for n, k, _ in CHECKPOINTS] + [("Mora", 90)]
    for name, km in stops:
        x = km_x(km, x0, x1)
        last = km == 90
        tl.append(f'<circle cx="{x:.1f}" cy="{base}" r="{5 if last else 4}" fill="{RED if last else INK}"/>')
        if last:
            tl.append(text_path(f"{km} km", "Barlow-Regular", 11, x + 5, 89, anchor="end", fill=INK))
            tl.append(text_path(name, "Barlow-SemiBold", 12, x + 5, base - 12, anchor="end", fill=RED))
        else:
            tl.append(text_path(str(km), "Barlow-Regular", 11, x, 89, anchor="middle", fill=INK))
            tl.append(text_path(name, "Barlow-Regular", 11, x + 4, base - 10, fill=INK, rotate=-40))
    out["vas-a-timeline.svg"] = svg(504, 96, "".join(tl))

    # C: höjdprofil Sälen–Mora. Banan ritas mellan x 48 och 552 så att
    # kanterna kan beskäras utan att något viktigt försvinner.
    prof = [(0, 150), (12, 128), (24, 110), (40, 122), (66, 138), (100, 150), (138, 170), (170, 178), (199, 172),
            (230, 182), (265, 160), (290, 196), (318, 214), (340, 226), (372, 238), (392, 248), (406, 226),
            (420, 246), (452, 256), (480, 266), (520, 278), (560, 286), (600, 292)]
    px0, px1 = 64, 536

    def mx(x: float) -> float:
        return px0 + x / 600 * (px1 - px0)

    def y_at(km: float) -> float:
        x = km / 90 * 600
        for (ax, ay), (bx, by) in zip(prof, prof[1:]):
            if ax <= x <= bx:
                return ay + (by - ay) * (x - ax) / (bx - ax)
        return prof[-1][1]

    pts = [(0, prof[0][1])] + [(mx(x), y) for x, y in prof] + [(600, prof[-1][1])]
    line = " ".join(f"{x:.1f},{y:.1f}" for x, y in pts)
    c = [
        f'<polygon points="{line} 600,480 0,480" fill="{SKY}"/>',
        f'<polyline points="{line}" fill="none" stroke="{WHITE}" stroke-width="5" stroke-linejoin="round"/>',
        ski(INK, RED, "translate(70 66) scale(0.9)"),
    ]
    for name, km, _ in CHECKPOINTS:
        x = km_x(km, px0, px1)
        y = y_at(km)
        c.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="5" fill="{WHITE}"/>')
        c.append(text_path(f"{name} · {km}", "Barlow-Regular", 12, x + 4, y + 18, fill=WHITE, rotate=90))
    c.append(f'<circle cx="{px1}" cy="{y_at(90):.1f}" r="6" fill="{RED}"/>')
    out["vas-c-profile.svg"] = svg(600, 480, "".join(c))

    # D: medaljong.
    out["vas-d-medal.svg"] = svg(
        112, 112,
        '<circle cx="56" cy="56" r="54" fill="none" stroke="#9A7A34" stroke-width="2"/>'
        + ski("#2A2419", None, "translate(16 16) scale(0.8)", thin=0.9),
    )

    # Miniatyrer till loppväljaren.
    for key, bg, fg, head, extra in (
        ("vasaloppet", SNOW, INK, RED, ""),
        ("oppet-spar", "#DCE7F1", INK, "#1F5FA8", ""),
        ("nattvasan", "#14243F", "#F3EEE6", "#F2C14E",
         '<circle cx="226" cy="74" r="26" fill="#F2C14E"/><circle cx="238" cy="66" r="24" fill="#14243F"/>'
         '<circle cx="70" cy="60" r="2.5" fill="#F3EEE6"/><circle cx="120" cy="96" r="2" fill="#F3EEE6"/>'
         '<circle cx="180" cy="40" r="2" fill="#F3EEE6"/>'),
    ):
        body = (
            f'<rect width="300" height="400" fill="{bg}"/>{extra}'
            f'<path d="M0 300 Q150 260 300 300 V400 H0Z" fill="{"#22375A" if key == "nattvasan" else "#FFFFFF"}"/>'
            + ski(fg, head, "translate(60 110) scale(1.8)")
        )
        out[f"vas-v-{key}.svg"] = svg(300, 400, body)
    return out


# ---------- layouter ----------

def layout_a() -> Layout:
    L = Layout(SNOW, ORDER)
    L.image("vas-scene", "Landskap", 0, 0, 600, 600, "vas-a-scene.svg", fit="cover", z=1)
    L.image("vas-skier", "Åkare", 62, 292, 196, 196, "vas-skier.svg", z=2)
    fld(L, "vas-kicker", 48, 64, 504, 22, px=15, bold=True, ls=0.3, color=PALE, align="left", upper=True)
    fld(L, "vas-title", 48, 88, 504, 86, px=86, bold=True, lh=0.95, ls=0.01, color=WHITE, align="left", upper=True)
    fld(L, "vas-custom", 48, 178, 504, 24, px=17, font=BARLOW, italic=True, color=PALE, align="left")
    fld(L, "vas-name", 48, 510, 504, 50, px=46, bold=True, lh=1.0, color=INK, align="left", upper=True)
    fld(L, "vas-time", 48, 564, 270, 62, px=58, bold=True, lh=1.0, color=RED, align="left")
    fld(L, "vas-date", 320, 568, 232, 20, px=14, font=BARLOW, color=INK, align="right")
    fld(L, "vas-bib", 320, 588, 232, 20, px=14, font=BARLOW, color=INK, align="right")
    fld(L, "vas-group", 320, 608, 232, 20, px=14, font=BARLOW, color=INK, align="right")
    L.image("vas-timeline", "Kontroller", 48, 640, 504, 96, "vas-a-timeline.svg", z=3)
    return L


def layout_b() -> Layout:
    L = Layout(PAPER, ORDER)
    fld(L, "vas-kicker", 48, 64, 300, 22, px=15, bold=True, ls=0.3, color=INK, align="left", upper=True)
    fld(L, "vas-title", 352, 64, 200, 22, px=15, bold=True, ls=0.3, color=INK, align="right", upper=True)
    L.image("vas-skier", "Åkare", 186, 100, 118, 118, "vas-skier.svg")
    lbl(L, "vas-l-90", "90", 48, 206, 302, 240, px=285, bold=True, lh=0.82, ls=-0.03, color=RED, align="left")
    lbl(L, "vas-l-classic", "KILOMETER · KLASSISK STIL", 48, 452, 300, 22, px=16, bold=True, ls=0.3, color=INK,
        align="left")
    lbl(L, "vas-l-cp", "KONTROLL", 368, 124, 120, 18, px=13, bold=True, ls=0.2, color=INK, align="left")
    lbl(L, "vas-l-time", "TID", 470, 124, 82, 18, px=13, bold=True, ls=0.2, color=INK, align="right")
    L.hline("vas-rule-head", 368, 146, 184, 2, INK)
    small = round(12 * 595.276 / 600, 2)
    for i, (name, km, _t) in enumerate(CHECKPOINTS):
        top = 150 + i * 34
        txt = f"{name} {km} km"
        lbl(L, f"vas-l-cp{i + 1}", txt, 368, top, 122, 34, px=15, font=BARLOW, color=INK, align="left",
            spans=[{"start": len(name) + 1, "end": len(txt), "fontSizePt": small, "color": GREY}])
        fld(L, f"vas-cp{i + 1}", 490, top, 62, 34, px=18, bold=True, color=INK, align="right")
        L.hline(f"vas-rule-{i + 1}", 368, top + 33, 184, 1, "#B9C2CF")
    lbl(L, "vas-l-mora", "Mora 90 km", 368, 392, 100, 40, px=15, font=BARLOW, color=INK, align="left",
        spans=[{"start": 0, "end": 4, "bold": True}, {"start": 5, "end": 10, "fontSizePt": small, "color": GREY}])
    fld(L, "vas-time", 452, 390, 100, 44, px=34, bold=True, color=RED, align="right")
    L.hline("vas-rule-foot", 48, 560, 504, 2, INK)
    fld(L, "vas-name", 48, 574, 504, 60, px=56, bold=True, lh=1.0, color=INK, align="left", upper=True)
    fld(L, "vas-custom", 48, 640, 300, 24, px=17, font=BARLOW, italic=True, color=INK, align="left")
    fld(L, "vas-date", 352, 640, 200, 20, px=14, font=BARLOW, color="#3D4A5E", align="right")
    fld(L, "vas-bib", 352, 660, 200, 20, px=14, font=BARLOW, color="#3D4A5E", align="right")
    fld(L, "vas-group", 352, 680, 200, 20, px=14, font=BARLOW, color="#3D4A5E", align="right")
    return L


def layout_c() -> Layout:
    L = Layout(PAPER, ORDER)
    fld(L, "vas-title", 48, 64, 504, 22, px=15, bold=True, ls=0.3, color=RED, align="left", upper=True)
    fld(L, "vas-name", 48, 90, 504, 68, px=64, bold=True, lh=1.0, color=INK, align="left", upper=True)
    fld(L, "vas-time", 48, 160, 250, 76, px=72, bold=True, lh=1.0, color=RED, align="left")
    fld(L, "vas-date", 300, 170, 252, 20, px=15, font=BARLOW, color=INK, align="left")
    fld(L, "vas-bib", 300, 190, 252, 20, px=15, font=BARLOW, color=INK, align="left")
    fld(L, "vas-group", 300, 210, 252, 20, px=15, font=BARLOW, color=INK, align="left")
    fld(L, "vas-custom", 48, 244, 504, 24, px=16, font=BARLOW, italic=True, color=INK, align="left")
    L.image("vas-profile", "Höjdprofil", 0, 320, 600, 480, "vas-c-profile.svg", fit="cover", z=1)
    lbl(L, "vas-l-start", "SÄLEN", 48, 704, 200, 22, px=15, bold=True, ls=0.14, color=WHITE, align="left")
    lbl(L, "vas-l-finish-km", "MORA · 90 KM", 352, 704, 200, 22, px=15, bold=True, ls=0.14, color=WHITE, align="right")
    return L


def layout_d() -> Layout:
    gold, ink = "#9A7A34", "#2A2419"
    L = Layout("#F6EFDF", ORDER)
    L.frame("vas-frame-outer", 36, 36, 528, 728, 2, gold)
    L.frame("vas-frame-inner", 46, 46, 508, 708, 1, gold)
    L.image("vas-medal", "Medaljong", 244, 82, 112, 112, "vas-d-medal.svg")
    lbl(L, "vas-l-memory", "TILL MINNE AV", 72, 214, 456, 22, px=17, font=SERIF, bold=True, ls=0.4, color=ink)
    fld(L, "vas-name", 72, 240, 456, 76, px=66, font=SERIF, bold=True, italic=True, lh=1.0, color=ink)
    fld(L, "vas-verb", 72, 322, 456, 30, px=22, font=SERIF, italic=True, color=ink)
    lbl(L, "vas-l-route", "från Sälen till Mora,\n90 kilometer i klassisk stil", 72, 354, 456, 52, px=20, font=SERIF,
        lh=1.15, color=ink)
    L.hline("vas-rule-gold", 240, 428, 120, 1, gold)
    lbl(L, "vas-l-finish", "SLUTTID", 72, 446, 456, 20, px=15, font=SERIF, bold=True, ls=0.35, color=ink)
    fld(L, "vas-time", 72, 468, 456, 78, px=72, font=SERIF, bold=True, lh=1.05, color=ink)
    fld(L, "vas-date", 72, 550, 456, 28, px=21, font=SERIF, color=ink)
    fld(L, "vas-bib", 72, 690, 150, 20, px=13, font=BARLOW, ls=0.08, color="#5A4E3A", align="left")
    fld(L, "vas-custom", 200, 690, 200, 20, px=13, font=BARLOW, ls=0.08, color="#5A4E3A")
    fld(L, "vas-group", 378, 690, 150, 20, px=13, font=BARLOW, ls=0.08, color="#5A4E3A", align="right")
    return L


VARIANTS = [
    ("vasaloppet", "Vasaloppet", "som åkte Vasaloppet"),
    ("oppet-spar", "Öppet Spår", "som åkte Öppet Spår"),
    ("nattvasan", "Nattvasan", "som åkte Nattvasan"),
]


def variants() -> list[dict]:
    return [
        {
            "id": vid,
            "name": name,
            "thumbnailUrl": asset(f"vas-v-{vid}.svg"),
            "overrides": {"vas-title": {"text": name}, "vas-verb": {"text": verb}},
        }
        for vid, name, verb in VARIANTS
    ]


STRINGS = {
    "Vinteraffisch": ("Winter poster", "Vinterplakat", "Talvijuliste"),
    "90 och kontrollerna": ("90 and the checkpoints", "90 og kontrollerne", "90 ja tarkastuspisteet"),
    "Höjdprofilen": ("The elevation profile", "Højdeprofilen", "Korkeusprofiili"),
    "Minnestavlan": ("The keepsake", "Mindetavlen", "Muistotaulu"),
    "Lopp": ("Race", "Løb", "Kilpailu"),
    "Om dig": ("About you", "Om dig", "Sinusta"),
    "Tider": ("Times", "Tider", "Ajat"),
    "Namn": ("Name", "Navn", "Nimi"),
    "Datum": ("Date", "Dato", "Päivämäärä"),
    "Startnummer": ("Bib number", "Startnummer", "Kilpailunumero"),
    "Startled": ("Start group", "Startgruppe", "Lähtöryhmä"),
    "Egen rad": ("Your own line", "Egen linje", "Oma rivi"),
    "Sluttid": ("Finish time", "Sluttid", "Loppuaika"),
    "Loppets namn": ("Race name", "Løbets navn", "Kilpailun nimi"),
    "Sträcka": ("Course", "Rute", "Reitti"),
    "Hyllningsrad": ("Dedication line", "Hyldestlinje", "Omistusrivi"),
    "KONTROLL": ("CHECKPOINT", "KONTROL", "TARKASTUSPISTE"),
    "TID": ("TIME", "TID", "AIKA"),
    "KILOMETER · KLASSISK STIL": ("KILOMETRES · CLASSIC STYLE", "KILOMETER · KLASSISK STIL", "KILOMETRIÄ · PERINTEINEN TYYLI"),
    "TILL MINNE AV": ("IN HONOUR OF", "TIL ÆRE FOR", "KUNNIAKIRJA"),
    "SLUTTID": ("FINISH TIME", "SLUTTID", "LOPPUAIKA"),
    "från Sälen till Mora,\n90 kilometer i klassisk stil": (
        "from Sälen to Mora,\n90 kilometres in classic style",
        "fra Sälen til Mora,\n90 kilometer i klassisk stil",
        "Sälenistä Moraan,\n90 kilometriä perinteisellä tyylillä"),
    "7 mars 2027": ("7 March 2027", "7. marts 2027", "7. maaliskuuta 2027"),
    "Startnummer 12345": ("Bib 12345", "Startnummer 12345", "Numero 12345"),
    "Startled 5": ("Start group 5", "Startgruppe 5", "Lähtöryhmä 5"),
    "Mitt tredje Vasalopp": ("My third Vasaloppet", "Mit tredje Vasaløb", "Kolmas Vasaloppetini"),
    "som åkte Vasaloppet": ("who skied Vasaloppet", "som gennemførte Vasaloppet", "joka hiihti Vasaloppetin"),
    "som åkte Öppet Spår": ("who skied Öppet Spår", "som gennemførte Öppet Spår", "joka hiihti Öppet Spårin"),
    "som åkte Nattvasan": ("who skied Nattvasan", "som gennemførte Nattvasan", "joka hiihti Nattvasanin"),
    "Vasaloppet": ("Vasaloppet", "Vasaloppet", "Vasaloppet"),
    "Öppet Spår": ("Öppet Spår", "Öppet Spår", "Öppet Spår"),
    "Nattvasan": ("Nattvasan", "Nattvasan", "Nattvasan"),
    "SÄLEN": ("SÄLEN", "SÄLEN", "SÄLEN"),
    "MORA · 90 KM": ("MORA · 90 KM", "MORA · 90 KM", "MORA · 90 KM"),
    "Mora 90 km": ("Mora 90 km", "Mora 90 km", "Mora 90 km"),
    "Sälen – Mora · 90 km": ("Sälen – Mora · 90 km", "Sälen – Mora · 90 km", "Sälen – Mora · 90 km"),
    # Ortnamnen (fältnamn och etiketter) är desamma på alla språk.
    **{n: (n, n, n) for n, _k, _t in CHECKPOINTS},
    **{f"{n} {k} km": (f"{n} {k} km",) * 3 for n, k, _t in CHECKPOINTS},
}


def build() -> dict:
    layouts = [
        ("standard", "Vinteraffisch", layout_a()),
        ("vas-b", "90 och kontrollerna", layout_b()),
        ("vas-c", "Höjdprofilen", layout_c()),
        ("vas-d", "Minnestavlan", layout_d()),
    ]
    # Även texter som är likadana på ett språk listas, så att admin ser dem som översatta.
    i18n = {lang: {sv: t[i] for sv, t in STRINGS.items()} for i, lang in enumerate(("en", "da", "fi"))}
    return template(layouts, variants(), "Lopp", "vasaloppet", i18n)
