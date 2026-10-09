#!/usr/bin/env python3
"""Reject small near-white holes surrounded by dark pixels near a sticker's head."""
from __future__ import annotations
from collections import deque
from pathlib import Path
import sys
from PIL import Image

ROOT = Path(__file__).resolve().parents[1] / "public" / "assets"
MAX_AREA = 1500
MIN_AREA = 40  # Lanczos 缩放会产生单像素高光；发丝白块远大于此阈值。

def near_white(pixel): return pixel[3] > 220 and min(pixel[:3]) > 235
def dark(pixel): return pixel[3] > 180 and max(pixel[:3]) < 115

def scan(path: Path):
    image = Image.open(path).convert("RGBA")
    width, height, pixels = image.width, image.height, image.load()
    seen, failures = set(), []
    for y in range(min(240, height)):
        for x in range(width):
            if (x, y) in seen or not near_white(pixels[x, y]): continue
            queue, component = deque([(x, y)]), []; seen.add((x, y))
            while queue:
                px, py = queue.popleft(); component.append((px, py))
                for nx, ny in ((px - 1, py), (px + 1, py), (px, py - 1), (px, py + 1)):
                    if 0 <= nx < width and 0 <= ny < min(240, height) and (nx, ny) not in seen and near_white(pixels[nx, ny]):
                        seen.add((nx, ny)); queue.append((nx, ny))
            if len(component) < MIN_AREA or len(component) >= MAX_AREA: continue
            component_set, boundary, dark_boundary = set(component), 0, 0
            for px, py in component:
                for nx, ny in ((px - 1, py), (px + 1, py), (px, py - 1), (px, py + 1)):
                    if 0 <= nx < width and 0 <= ny < height and (nx, ny) not in component_set:
                        boundary += 1; dark_boundary += dark(pixels[nx, ny])
            if boundary and dark_boundary / boundary >= .55:
                failures.append(f"{path.relative_to(ROOT)}: area={len(component)} dark-boundary={dark_boundary}/{boundary}")
    return failures

def main():
    failures = [failure for path in ROOT.rglob("*.png") for failure in scan(path)]
    if failures:
        print("发现疑似发丝缝隙白点：", *failures, sep="\n"); return 1
    print("白点扫描通过。"); return 0

if __name__ == "__main__": sys.exit(main())
