import sys, os, glob
sys.stdout.reconfigure(encoding="utf-8")
from fontTools.ttLib import TTFont

def stats(path, label):
    f = TTFont(path)
    n = f["maxp"].numGlyphs
    sz = os.path.getsize(path)
    return sz, n, sz / n

print("=== Youran Handwriting 27 片 ===")
rows = []
for p in sorted(glob.glob("apps/web/public/fonts/handwriting/youran-*.woff2")):
    rows.append((os.path.basename(p),) + stats(p, ""))
rows.sort(key=lambda r: -r[1])
for name, sz, n, per in rows[:6]:
    print("  %-36s %4dKB  字形 %4d  每字形 %db" % (name, sz//1024, n, per))
print("  ... 合计 %d 片 %dKB，总字形 %d" % (len(rows), sum(r[1] for r in rows)//1024, sum(r[2] for r in rows)))

print("\n=== KingHwa OldSong 13 片 ===")
rows2 = []
for p in sorted(glob.glob("apps/web/public/fonts/kinghwa/part-*.woff2")):
    rows2.append((os.path.basename(p),) + stats(p, ""))
rows2.sort(key=lambda r: -r[1])
for name, sz, n, per in rows2:
    print("  %-20s %4dKB  字形 %4d  每字形 %db" % (name, sz//1024, n, per))
print("  合计 %d 片 %dKB，总字形 %d" % (len(rows2), sum(r[1] for r in rows2)//1024, sum(r[2] for r in rows2)))
