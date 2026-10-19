"""对比改动前的分片（取自 git HEAD）与重切后的分片：每个码位的轮廓点必须完全一致，且旧码位一个不缺。"""
import glob
import os
import subprocess
import sys
import tempfile

from fontTools.ttLib import TTFont


def outline(font, glyf, codepoint):
    name = font.getBestCmap().get(codepoint)
    if name is None:
        return None
    glyph = glyf[name]
    if glyph.isComposite():
        return ("composite", tuple((c.componentName if hasattr(c, 'componentName') else c.glyphName, c.x, c.y) for c in glyph.components))
    if glyph.numberOfContours == 0:
        return ("empty",)
    coords, end_pts, flags = glyph.getCoordinates(glyf)
    return (glyph.numberOfContours, tuple(end_pts), tuple((x, y, f) for (x, y), f in zip(coords, flags)))


def tracked_woff2(directory):
    result = subprocess.run(["git", "ls-tree", "HEAD", "-r", "--name-only", "--", directory], capture_output=True, text=True)
    return [line.strip() for line in result.stdout.splitlines() if line.strip().endswith(".woff2")]


def export(path, workdir):
    out = os.path.join(workdir, os.path.basename(path))
    with open(out, "wb") as handle:
        result = subprocess.run(["git", "show", f"HEAD:{path}"], stdout=handle, stderr=subprocess.PIPE)
    if result.returncode != 0:
        raise SystemExit(f"git show 失败: {path}")
    return out


def check(directory, label):
    new_files = sorted(glob.glob(os.path.join(directory, "*.woff2")))
    index = {}
    for path in new_files:
        font = TTFont(path, lazy=True)
        glyf = font["glyf"]
        for cp in font.getBestCmap():
            index.setdefault(cp, (font, glyf))

    workdir = tempfile.mkdtemp(prefix="fontcmp-")
    old_files = tracked_woff2(directory)
    total = missing = mismatch = 0
    for old_path in old_files:
        old = TTFont(export(old_path, workdir), lazy=True)
        old_glyf = old["glyf"]
        for cp in old.getBestCmap():
            total += 1
            hit = index.get(cp)
            if hit is None:
                missing += 1
                if missing <= 5:
                    print(f"  缺失 U+{cp:04X} {chr(cp)}")
                continue
            if outline(old, old_glyf, cp) != outline(hit[0], hit[1], cp):
                mismatch += 1
                if mismatch <= 5:
                    print(f"  轮廓不一致 U+{cp:04X} {chr(cp)}")

    print(f"{label}: 旧分片 {len(old_files)} 个 / {total} 码位 → 新分片 {len(new_files)} 个")
    print(f"  缺失 {missing}  轮廓不一致 {mismatch}")
    return 0 if not missing and not mismatch else 1


if __name__ == "__main__":
    code = check("apps/web/public/fonts/handwriting", "Youran 手写体")
    code |= check("apps/web/public/fonts/kinghwa", "KingHwa 老宋体")
    sys.exit(code)
