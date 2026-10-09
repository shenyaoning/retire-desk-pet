#!/usr/bin/env python3
"""Copy C6 stress assets into the app at 256px; never changes the source artwork."""
from pathlib import Path
from PIL import Image
import shutil

src = Path.home() / "Desktop/退休桌宠/素材/解压功能/成品"
dst = Path(__file__).resolve().parents[1] / "public/assets/stress"
dst.mkdir(parents=True, exist_ok=True)
names = ["怪兽-1.png", "怪兽-2.png", "怪兽-3.png", "怪兽-4.png", "怪兽-5.png", "怪兽-无头身体.png", "怪兽-一对角.png", "狼牙棒.png", "拍击闪光.png"]
for name in names:
    with Image.open(src / name) as image:
        image.convert("RGBA").resize((256, 256), Image.Resampling.LANCZOS).save(dst / name)
shutil.copyfile(src / "解压参数.json", dst / "params.json")
