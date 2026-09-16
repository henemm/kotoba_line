# The tiles as the app will carry them: grey line art, 480 px wide at most.
from PIL import Image
import os, json

d = __file__.rsplit("/", 1)[0] + "/"
src, out = d + "tiles/", d + "export/"
os.makedirs(out, exist_ok=True)
total = 0
sizes = {}
for name in sorted(os.listdir(src)):
    im = Image.open(src + name).convert("L")
    if im.width > 480:
        im = im.resize((480, max(1, round(im.height * 480 / im.width))), Image.LANCZOS)
    im = im.quantize(colors=16, method=Image.MEDIANCUT)
    im.save(out + name, optimize=True)
    n = os.path.getsize(out + name)
    total += n
    sizes[name] = (im.size, n)
print("files", len(sizes), "total KB", round(total / 1024), "biggest", sorted(sizes.items(), key=lambda kv: -kv[1][1])[:3])
json.dump({k: v[0] for k, v in sizes.items()}, open(d + "export.json", "w"))
