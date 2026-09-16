# The caption text the tiles leave out, as strips for transcription.
import sys, runpy
sys.path.insert(0, __file__.rsplit("/", 1)[0] + "/pylib")
from PIL import Image, ImageDraw
import numpy as np

d = __file__.rsplit("/", 1)[0] + "/"
g = runpy.run_path(d + "cut.py")
captions, objs, lab, a, order = g["captions"], g["objs"], g["lab"], g["a"], g["order"]

rows = []
for kana in order:
    idxs = captions.get(kana, [])
    if not idxs:
        rows.append((kana, None))
        continue
    ys = [objs[i - 1][0] for i in idxs]
    xs = [objs[i - 1][1] for i in idxs]
    y0, y1 = max(0, min(s.start for s in ys) - 6), min(a.shape[0], max(s.stop for s in ys) + 6)
    x0, x1 = max(0, min(s.start for s in xs) - 6), min(a.shape[1], max(s.stop for s in xs) + 6)
    mine = np.isin(lab[y0:y1, x0:x1], idxs)
    rows.append((kana, Image.fromarray(np.where(mine, a[y0:y1, x0:x1], 255).astype(np.uint8))))

print("with caption:", sum(1 for _, s in rows if s), "of", len(rows))
print("without:", "".join(k for k, s in rows if not s))
have = [(k, s) for k, s in rows if s]
W, ROW = 1600, 60
for page in range(0, len(have), 24):
    chunk = have[page : page + 24]
    sheet = Image.new("L", (W, ROW * len(chunk)), 255)
    drw = ImageDraw.Draw(sheet)
    for i, (kana, strip) in enumerate(chunk):
        if strip.width > W - 140:
            strip = strip.resize((W - 140, max(1, round(strip.height * (W - 140) / strip.width))))
        sheet.paste(strip, (130, i * ROW + 6))
        drw.text((10, i * ROW + 18), f"{ord(kana):05x}", fill=0)
    sheet.save(f"{d}captions-{page // 24}.png")
print("sheets", (len(have) + 23) // 24)
