# Cutting the kana pictures out of the chart

These three scripts produced `import/assets/mnemonics` once, on 2026-09-16.
They are kept because the next person to touch the tiles should not have to
work the geometry out again — not because the import runs them. It does not:
it copies the finished files (`import/lib/kana-mnemonics.js` says why).

They are Python, unlike everything else here, because the work is image
processing: Pillow to read and write the PNG, SciPy to label connected
strokes. `import/` itself still has no dependencies.

```sh
pip install --target pylib pillow scipy      # not needed by the import
curl -o original.png "https://upload.wikimedia.org/wikipedia/commons/e/e7/Japanese_Kana_Mnemonic_Chart.png"
PYTHONPATH=pylib python3 cut.py              # → tiles/<code point>.png, tiles-sheet.png
PYTHONPATH=pylib python3 captions.py         # → captions-*.png, to transcribe into lib/kana-mnemonics.js
python3 export.py                            # → export/, 480 px wide, 16 greys — what is committed
```

`cut.py` is where the care went. The chart is ten pages in one 7600 × 4200
image, five to a row, each page a column of rows with a hiragana cell and a
katakana cell side by side:

- The page bands, the row boundaries and the split between the two cells are
  *measured* from the ink, not assumed: pages differ in width, and the ya and
  wa pages have three rows where the others have five.
- Each stroke is assigned to the cell it overlaps most, and a tile is drawn
  from its own strokes only. A drawing that leans into its neighbour (ぬ's
  noodles, ツ's wave over つ) is kept whole, and the neighbour's kana does not
  come with it.
- The captions are left out — they are typed into `lib/kana-mnemonics.js`
  instead — because on the chart a caption can overhang the cell next door
  (ム's "Moon looks down from above." starts above む), and because text drawn
  at chart size is unreadable at card size. Recognising them needs two rules:
  small shapes near the top of a cell, and small shapes that form a word
  beside the drawing (ら's "Rod and reel."). Lettering *inside* a drawing —
  the 30 on ロ's road sign, the room number on ほ's door — is kept.

Everything else is bookkeeping. If the tiles are ever recut, look at
`tiles-sheet.png` before committing: every earlier attempt failed visibly
there — clipped drawings, a neighbour's kana, captions in the wrong tile.
