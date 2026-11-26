"""Bygger sporttavlornas startmallar och grafik.

  python3 -I scripts/sport-seeds/build.py [--preview DIR]

Skriver public/sport/*.svg och src/lib/sport/seeds/<produkt>.json. Med
--preview ritas också varje layout i tre format (3:4, 4:5, 2:3) till DIR.
Kräver fontTools, cairosvg och Pillow samt Barlow-filerna i SPORT_FONT_DIR
(standard /tmp/fonts) för konturerna i grafiken.
"""
from __future__ import annotations

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))

import triathlon  # noqa: E402

PRODUCTS = {"triathlon": triathlon}
try:
    import vasaloppet  # noqa: E402

    PRODUCTS["vasaloppet"] = vasaloppet
except ImportError:
    pass
try:
    import klassiker  # noqa: E402

    PRODUCTS["klassiker"] = klassiker
except ImportError:
    pass


def main(argv: list[str]) -> None:
    preview = None
    if "--preview" in argv:
        preview = argv[argv.index("--preview") + 1]
    only = [a for a in argv if a in PRODUCTS]
    out_assets = os.path.join(ROOT, "public", "sport")
    out_seeds = os.path.join(ROOT, "src", "lib", "sport", "seeds")
    os.makedirs(out_assets, exist_ok=True)
    os.makedirs(out_seeds, exist_ok=True)
    for key, mod in PRODUCTS.items():
        if only and key not in only:
            continue
        assets = mod.assets()
        for name, body in assets.items():
            with open(os.path.join(out_assets, name), "w", encoding="utf-8") as fh:
                fh.write(body)
        tpl = mod.build()
        with open(os.path.join(out_seeds, f"{key}.json"), "w", encoding="utf-8") as fh:
            json.dump(tpl, fh, ensure_ascii=False, indent=1)
            fh.write("\n")
        print(f"{key}: {len(assets)} grafikfiler, {1 + len(tpl['extraLayouts'])} layouter")
        if preview:
            from PIL import Image

            from render import render

            os.makedirs(preview, exist_ok=True)
            blocks = [(tpl["defaultLayoutName"], tpl["defaultLayout"])] + [
                (x["name"], x["defaultLayout"]) for x in tpl["extraLayouts"]
            ]
            for fmt, (w, h) in {"34": (600, 800), "45": (600, 750), "23": (600, 900)}.items():
                tiles = [render(b, assets, w, h, debug="--debug" in argv) for _, b in blocks]
                sheet = Image.new("RGB", (len(tiles) * (w + 24) + 24, h + 48), "#9A9A9A")
                for i, t in enumerate(tiles):
                    sheet.paste(t, (24 + i * (w + 24), 24))
                sheet.save(os.path.join(preview, f"{key}-{fmt}.png"))


if __name__ == "__main__":
    main(sys.argv[1:])
