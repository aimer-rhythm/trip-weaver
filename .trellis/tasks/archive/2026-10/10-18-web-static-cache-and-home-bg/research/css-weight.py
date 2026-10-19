import re, io, sys
sys.stdout.reconfigure(encoding="utf-8")
css = open("apps/web/src/styles/tailwind.css", encoding="utf-8").read()
def blk(fam):
    return re.findall(r"@font-face\s*\{[^}]*font-family:\s*'?" + fam + r"'?[^}]*\}", css)
tot = len(css.encode())
for fam in ["Youran Handwriting", "KingHwa OldSong", "Noto Sans SC Variable", "Noto Serif SC Variable"]:
    b = blk(fam)
    size = sum(len(x.encode()) for x in b)
    print("%-26s 块数=%-4d 声明字节=%6dKB  占比=%.1f%%" % (fam, len(b), size//1024, size/tot*100))
print("tailwind.css 总字节: %dKB" % (tot//1024))
