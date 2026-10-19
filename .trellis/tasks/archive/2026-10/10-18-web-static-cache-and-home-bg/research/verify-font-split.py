"""校验重切后的分片：每个码位的字形轮廓必须与原字体逐点一致，且原码位不能丢。"""
import sys

from fontTools.ttLib import TTFont


def outline(font, codepoint):
    """返回该码位对应字形的轮廓签名：轮廓数 + 每条轮廓的点坐标与标记。"""
    cmap = font.getBestCmap()
    name = cmap.get(codepoint)
    if name is None:
        return None
    glyf = font["glyf"]
    glyph = glyf[name]
    if glyph.isComposite():
        return ("composite", tuple((c.glyphName, c.x, c.y) for c in glyph.components))
    if glyph.numberOfContours == 0:
        return ("empty",)
    coords, end_pts, flags = glyph.getCoordinates(glyf)
    return (
        glyph.numberOfContours,
        tuple(end_pts),
        tuple((x, y, f) for (x, y), f in zip(coords, flags)),
    )


def main():
    source_path = sys.argv[1]
    pieces = sys.argv[2:]

    source = TTFont(source_path)
    source_cps = sorted(source.getBestCmap())
    pieces_fonts = [(p, TTFont(p)) for p in pieces]

    missing, mismatched, checked = [], [], 0
    for cp in source_cps:
        found = None
        for path, font in pieces_fonts:
            if cp in font.getBestCmap():
                found = (path, font)
                break
        if found is None:
            missing.append(cp)
            continue
        checked += 1
        if outline(source, cp) != outline(found[1], cp):
            mismatched.append(cp)

    print(f"原字体码位: {len(source_cps)}，分片数: {len(pieces)}")
    print(f"已比对: {checked}  缺失: {len(missing)}  轮廓不一致: {len(mismatched)}")
    if missing:
        print("  缺失示例:", ", ".join(f"U+{c:04X}({chr(c)})" for c in missing[:10]))
    if mismatched:
        print("  不一致示例:", ", ".join(f"U+{c:04X}({chr(c)})" for c in mismatched[:10]))
    sys.exit(0 if not missing and not mismatched else 1)


if __name__ == "__main__":
    main()
