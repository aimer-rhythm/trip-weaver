import sys
sys.stdout.reconfigure(encoding="utf-8")
from pathlib import Path
from fontTools.ttLib import TTFont

SRC = Path("node_modules/@fontpkg/king-hwa-old-song/京華老宋体v2.002.ttf")
f = TTFont(SRC, lazy=True)
print("cmap 子表:", [(t.platformID, t.platEncID, t.format) for t in f["cmap"].tables])
def cps(font):
    return {cp for table in font["cmap"].tables if table.isUnicode()
            for cp, g in table.cmap.items() if font.getGlyphID(g) != 0}
allc = cps(f)
best = set(f.getBestCmap())
print("全部 Unicode 子表并集:", len(allc), " bestCmap:", len(best), " 差集:", len(allc - best))

# 复现 part-02 的 expected
import importlib.util
spec = importlib.util.spec_from_file_location("btf", "scripts/build-title-font.py")
mod = importlib.util.module_from_spec(spec)
sys.argv = ["x"]
spec.loader.exec_module(mod)
allowed = {ord(c) for c in mod.common_chars()}
selected = sorted(cp for cp in allc if cp in allowed)
print("selected:", len(selected))
for i in range(0, 3):
    chunk = selected[i * 96:(i + 1) * 96]
    print("chunk", i, "size", len(chunk))
dep = TTFont("apps/web/public/fonts/kinghwa/part-02-6fe8fcb96e.woff2")
actual = cps(dep)
chunk2 = selected[2 * 96:3 * 96]
print("expected", len(chunk2), "actual", len(actual))
print("缺失:", [hex(c) for c in sorted(set(chunk2) - actual)][:12])
print("多余:", [hex(c) for c in sorted(actual - set(chunk2))][:12])
