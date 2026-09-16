# Cuts the 92 tiles by connected strokes: every ink component of the chart is
# assigned to the cell its centre falls in, and a tile is drawn from its own
# components only — so a drawing that runs past its cell is kept whole and no
# neighbour bleeds in.
import sys
sys.path.insert(0, __file__.rsplit("/", 1)[0] + "/pylib")  # see README.md
from PIL import Image, ImageDraw
import numpy as np
from scipy import ndimage
import json, os

d = __file__.rsplit("/", 1)[0] + "/"
im = Image.open(d + "original.png").convert("L")
a = np.array(im)
ink = a < 200
RULES = [212, 1750, 3252, 4763, 6275]
HALVES = [(150, 2020), (2170, 4040)]
PAGES = [
    (0, 0, "あいうえお", "アイウエオ"), (1, 0, "かきくけこ", "カキクケコ"), (2, 0, "さしすせそ", "サシスセソ"),
    (3, 0, "たちつてと", "タチツテト"), (4, 0, "なにぬねの", "ナニヌネノ"), (0, 1, "はひふへほ", "ハヒフヘホ"),
    (1, 1, "まみむめも", "マミムメモ"), (2, 1, "やゆよ", "ヤユヨ"), (3, 1, "らりるれろ", "ラリルレロ"),
    (4, 1, "わをん", "ワヲン"),
]

def runs_of_zero(v, min_len):
    out, run = [], None
    for i, x in enumerate(v):
        if x == 0 and run is None:
            run = i
        elif x != 0 and run is not None:
            if i - run >= min_len:
                out.append((run, i))
            run = None
    if run is not None and len(v) - run >= min_len:
        out.append((run, len(v)))
    return out

# ── the cell rectangles, measured page by page (as in cut2.py) ────────────────
cells = {}
for rule, half, hira, kata in PAGES:
    x_limit = RULES[rule + 1] if rule + 1 < len(RULES) else im.width - 40
    y0, y1 = HALVES[half]
    cols = ink[y0:y1, RULES[rule]:x_limit].sum(0)
    gaps = runs_of_zero(cols, 20)
    cx0 = RULES[rule] + (gaps[0][1] if gaps and gaps[0][0] == 0 else 0)
    wide = [g for g in gaps if g[0] > (x_limit - RULES[rule]) * 0.6 and g[1] - g[0] >= 40]
    cx1 = RULES[rule] + (wide[0][0] if wide else x_limit - RULES[rule])
    rows = len(hira)
    prof = ink[y0:y1, cx0:cx1].sum(1)
    rgaps = sorted((g for g in runs_of_zero(prof, 12) if g[0] > 0 and g[1] < y1 - y0), key=lambda g: g[1] - g[0], reverse=True)
    cuts = sorted(y0 + (g[0] + g[1]) // 2 for g in rgaps[: rows - 1])
    if len(cuts) != rows - 1:
        cuts = [int(y0 + (y1 - y0) / rows * (i + 1)) for i in range(rows - 1)]
    bounds = [y0] + cuts + [y1]
    for i in range(rows):
        ry0, ry1 = bounds[i], bounds[i + 1]
        colprof = ink[ry0:ry1, cx0:cx1].sum(0)
        mid = sorted((g for g in runs_of_zero(colprof, 8) if 0.3 < (g[0] + g[1]) / 2 / (cx1 - cx0) < 0.72), key=lambda g: g[1] - g[0], reverse=True)
        split = cx0 + (mid[0][0] + mid[0][1]) // 2 if mid else (cx0 + cx1) // 2
        cells[hira[i]] = (cx0, ry0, split, ry1)
        cells[kata[i]] = (split, ry0, cx1, ry1)

# ── components, dilated so a drawing's separate strokes travel together ───────
lab, n = ndimage.label(ndimage.binary_dilation(ink, np.ones((3, 3), bool)))
print("components", n)
objs = ndimage.find_objects(lab)
centres = ndimage.center_of_mass(ink, lab, range(1, n + 1))

# A stroke belongs to the cell it overlaps most, not the one its centre happens
# to fall in: a drawing that leans into the neighbouring cell (ぬ's noodles, ツ's
# wave) would otherwise drag the whole tile across the page.
CELL_H = max(y1 - y0 for _, y0, _, y1 in cells.values())
CELL_W = max(x1 - x0 for x0, _, x1, _ in cells.values())
owner = {}
for idx in range(1, n + 1):
    sy, sx = objs[idx - 1]
    # The page furniture is not a drawing: the rules between the pages are
    # taller than any cell, and nothing in a cell is wider than the cell.
    if sy.stop - sy.start > CELL_H * 1.1 or sx.stop - sx.start > CELL_W * 1.1:
        continue
    piece = lab[sy, sx] == idx
    ys, xs = np.nonzero(piece)
    ys = ys + sy.start
    xs = xs + sx.start
    best, bestCount = None, 0
    for kana, (x0, y0, x1, y1) in cells.items():
        count = int(np.count_nonzero((xs >= x0) & (xs < x1) & (ys >= y0) & (ys < y1)))
        if count > bestCount:
            best, bestCount = kana, count
    if not best:
        continue
    owner.setdefault(best, []).append(idx)

# The captions are left out of the tiles and transcribed into the app as text,
# so a caption that overhangs its neighbour (ム's "Moon looks" above む) cannot
# land on the wrong kana. A caption is recognised as a *line*: several small
# shapes sharing a baseline across the cell. Size alone would also delete ミ's
# three dashes, which are the drawing — they sit one under the other, so they
# are three lines of one shape each, and stay.
SMALL = 70
captions = {}
CAPTION_H = 45  # the caption type is 26 px tall; the smallest drawn part is bigger
# The same ink with the gaps between letters closed: one shape per caption word.
wlab, _ = ndimage.label(ndimage.binary_dilation(ink, np.ones((1, 17), bool)))
wobjs = ndimage.find_objects(wlab)
for kana, idxs in list(owner.items()):
    cy0, cy1 = cells[kana][1], cells[kana][3]
    # The caption is the highest row of small shapes sharing a baseline, in the
    # top third of the cell: several letters, side by side. Judged by baseline
    # rather than by size alone, because ミ's drawing is three short strokes —
    # they sit one under the other, each its own row, and stay.
    band = cy0 + (cy1 - cy0) * 0.55
    tall = [objs[i - 1] for i in idxs if objs[i - 1][0].stop - objs[i - 1][0].start > SMALL]
    drop = set()
    for i in idxs:
        sy, sx = objs[i - 1]
        if sy.stop - sy.start > CAPTION_H:
            continue
        # Words, not letters: closing the gaps sideways makes each caption word
        # one shape, so a whole word is judged at once — ら's "Rod and reel."
        # beside the drawing as much as か's "Cod." above it.
        py, px = np.argwhere(lab[sy, sx] == i)[0]
        wy, wx = wobjs[wlab[sy.start + py, sx.start + px] - 1]
        wide = wx.stop - wx.start >= 90
        if not (wide or wy.stop <= band):
            continue
        # Lettering inside a drawing stays: the 30 on ロ's speed limit sign, the
        # room number on ほ's hotel door.
        if any(t[0].start <= sy.start and t[0].stop >= sy.stop and t[1].start <= sx.start and t[1].stop >= sx.stop for t in tall):
            continue
        drop.add(i)
    kept = [i for i in idxs if i not in drop]
    # A letter left over from a caption the rules above cut in two (the "r." of
    # ラ's "Robber.") is a small shape on its own, well away from the drawing.
    def near_drawing(i):
        sy, sx = objs[i - 1]
        return any(
            sy.start - 60 < t[0].stop and t[0].start - 60 < sy.stop and sx.start - 60 < t[1].stop and t[1].start - 60 < sx.stop
            for t in tall
        )
    owner[kana] = [i for i in kept if objs[i - 1][0].stop - objs[i - 1][0].start > CAPTION_H or near_drawing(i)]
    captions[kana] = [i for i in idxs if i not in owner[kana]]

os.makedirs(d + "tiles", exist_ok=True)
tiles, sizes = {}, {}
for kana, idxs in owner.items():
    ys = [objs[i - 1][0] for i in idxs]
    xs = [objs[i - 1][1] for i in idxs]
    y0, y1 = min(s.start for s in ys), max(s.stop for s in ys)
    x0, x1 = min(s.start for s in xs), max(s.stop for s in xs)
    pad = 10
    y0, y1, x0, x1 = max(0, y0 - pad), min(a.shape[0], y1 + pad), max(0, x0 - pad), min(a.shape[1], x1 + pad)
    # Dilation can weld a drawing to its neighbour's (つ's wave to ツ's), and the
    # welded component then drags the neighbour's kana into the tile. A drawing
    # never reaches a quarter of a cell past its own, so clip there.
    ex0, ey0, ex1, ey1 = cells[kana]
    mx, my = (ex1 - ex0) * 0.25, (ey1 - ey0) * 0.25
    x0, x1 = int(max(x0, ex0 - mx)), int(min(x1, ex1 + mx))
    y0, y1 = int(max(y0, ey0 - my)), int(min(y1, ey1 + my))
    mine = np.isin(lab[y0:y1, x0:x1], idxs)
    tile = np.where(mine, a[y0:y1, x0:x1], 255).astype(np.uint8)
    img = Image.fromarray(tile)
    tiles[kana] = img
    sizes[kana] = img.size
    img.save(f"{d}tiles/{ord(kana):05x}.png")

print("tiles", len(tiles), "min", min(sizes.values()), "max", max(sizes.values()))
order = "".join(p[2] for p in PAGES) + "".join(p[3] for p in PAGES)
missing = [k for k in order if k not in tiles]
print("missing", missing)
cols, tw, th = 8, 440, 330
sheet = Image.new("RGB", (cols * tw, ((len(order) + cols - 1) // cols) * th), "white")
drw = ImageDraw.Draw(sheet)
for i, k in enumerate(order):
    if k not in tiles:
        continue
    t = tiles[k].convert("RGB").copy()
    t.thumbnail((tw - 10, th - 24))
    sheet.paste(t, ((i % cols) * tw + 5, (i // cols) * th + 20))
    drw.text(((i % cols) * tw + 5, (i // cols) * th + 4), k, fill=(200, 0, 0))
sheet.save(d + "tiles-sheet.png")
json.dump({k: list(v) for k, v in sizes.items()}, open(d + "tiles.json", "w"), ensure_ascii=False)
