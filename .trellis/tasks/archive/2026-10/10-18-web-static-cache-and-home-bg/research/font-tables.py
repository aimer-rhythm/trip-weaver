import sys, os, glob
sys.stdout.reconfigure(encoding="utf-8")
from fontTools.ttLib import TTFont

for path in ["apps/web/public/fonts/handwriting/youran-00-a31d164ace.woff2",
             "apps/web/public/fonts/kinghwa/part-09.woff2"]:
    f = TTFont(path)
    print(os.path.basename(path), "表:", sorted(f.keys()))
    print("  GSUB:", "GSUB" in f, " GPOS:", "GPOS" in f, " gasp:", "gasp" in f,
          " 单位/em:", f["head"].unitsPerEm, " cmap 码位数:", len(f.getBestCmap()))
