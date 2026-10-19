import sys, os, io
sys.stdout.reconfigure(encoding="utf-8")
from fontTools.ttLib import TTFont

src = "apps/web/public/fonts/handwriting/youran-00-a31d164ace.woff2"
orig = os.path.getsize(src)

f = TTFont(src)
num = f["maxp"].numGlyphs
print("字体: %s" % os.path.basename(src))
print("原始 woff2: %dKB  字形数: %d" % (orig//1024, num))
print("表构成(解码后，取最大 8 个):")
for tag in f.reader.keys():
    pass
rows = []
for tag in f.keys():
    try:
        buf = io.BytesIO()
        f.saveXML
        rows.append((tag, len(f.getTableData(tag))))
    except Exception:
        pass
for t, sz in sorted(rows, key=lambda kv: -kv[1])[:8]:
    print("  %-6s %6dKB" % (t, sz//1024))
print("解码后合计: %dKB  (woff2 压缩率 %.1fx)" % (sum(r[1] for r in rows)//1024, sum(r[1] for r in rows)/orig))

g = TTFont(src)
removed = 0
for t in ("fpgm", "prep", "cvt ", "gasp", "hdmx", "LTSH", "VDMX"):
    if t in g:
        removed += len(g.getTableData(t)); del g[t]
g.flavor = "woff2"
buf = io.BytesIO(); g.save(buf)
new = len(buf.getvalue())
print("去 hinting 后: %dKB (省 %dKB, %.0f%%)  hinting 原占 %dKB" % (new//1024, (orig-new)//1024, (1-new/orig)*100, removed//1024))
