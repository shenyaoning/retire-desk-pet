#!/usr/bin/env python3
"""Downscale packaged pet PNGs only; source artwork is never touched."""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1] / "public" / "assets"
TARGET = 256

for path in list((ROOT / "animations").rglob("*.png")) + list((ROOT / "skins" / "default").rglob("*.png")):
    with Image.open(path) as source:
        if source.size[0] <= TARGET and source.size[1] <= TARGET:
            continue
        image = source.convert("RGBA")
        image.thumbnail((TARGET, TARGET), Image.Resampling.LANCZOS)
        image.save(path, "PNG", optimize=True)
        print(path.relative_to(ROOT), image.size)
