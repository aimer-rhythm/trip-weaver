"""按码位把一个字体分片重切成 N 个更小的分片，保留字形轮廓与 layout 表。"""
import io
import math
import os
import sys

from fontTools import subset
from fontTools.ttLib import TTFont


def load(path):
    return TTFont(path)


def chunk_codepoints(cps, parts):
    """交错分配：相邻码位的字形复杂度差异大，交错能让各片大小更接近。"""
    return [cps[i::parts] for i in range(parts)]


def make_options():
    opts = subset.Options()
    opts.layout_features = ["*"]     # 保留 GSUB/GPOS 特性，避免竖排/连字行为变化
    opts.hinting = False
    opts.desubroutinize = True
    opts.recalc_bounds = True
    opts.recalc_timestamp = False
    opts.canonical_order = False
    opts.prune_unicode_ranges = True
    opts.drop_tables += ["vhea", "vmtx"]  # 网页排版不用竖排度量
    opts.name_IDs = ["*"]
    opts.name_languages = ["*"]
    return opts


def subset_bytes(path, unicodes):
    opts = make_options()
    font = subset.load_font(path, opts, lazy=False)
    sub = subset.Subsetter(options=opts)
    sub.populate(unicodes=unicodes)
    sub.subset(font)
    buf = io.BytesIO()
    opts.flavor = "woff2"
    subset.save_font(font, buf, opts)
    return buf.getvalue()


def to_ranges(cps):
    """码位列表 → CSS unicode-range 字面量（自动压缩连续区间）。"""
    cps = sorted(cps)
    out, start, prev = [], None, None
    for cp in cps:
        if start is None:
            start = prev = cp
        elif cp == prev + 1:
            prev = cp
        else:
            out.append((start, prev))
            start = prev = cp
    if start is not None:
        out.append((start, prev))
    return ",".join(f"U+{a:X}" if a == b else f"U+{a:X}-{b:X}" for a, b in out)


def split_font(path, out_dir, base_name, target_bytes):
    font = load(path)
    cmap = font.getBestCmap()
    cps = sorted(cmap)
    total = os.path.getsize(path)
    parts = max(1, math.ceil(total / target_bytes))
    chunks = chunk_codepoints(cps, parts)

    os.makedirs(out_dir, exist_ok=True)
    results = []
    for index, chunk in enumerate(chunks):
        data = subset_bytes(path, chunk)
        name = f"{base_name}-{index:02d}.woff2"
        with open(os.path.join(out_dir, name), "wb") as handle:
            handle.write(data)
        results.append({"file": name, "bytes": len(data), "codepoints": chunk, "css": to_ranges(chunk)})
    return results


def main():
    path, out_dir, prefix, target_kb = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
    results = split_font(path, out_dir, prefix, target_kb * 1024)
    original = os.path.getsize(path)
    print(f"{os.path.basename(path)}: {original // 1024}KB / {len(TTFont(path).getBestCmap())} 字 → {len(results)} 片")
    for row in results:
        print(f"  {row['file']:<28} {row['bytes'] / 1024:6.1f}KB  {len(row['codepoints']):4d} 字")
    print(f"  合计 {sum(r['bytes'] for r in results) / 1024:.0f}KB（原 {original / 1024:.0f}KB）")


if __name__ == "__main__":
    main()
