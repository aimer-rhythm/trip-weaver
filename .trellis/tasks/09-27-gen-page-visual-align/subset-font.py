# 京华老宋体子集化 + 分片（09-27 视觉对齐任务）
# 上游包只提供 35.7MB 整字库 TTF，网页用不了。做法与 @fontsource 一致：
# 把 GB2312 常用字按码点切成 N 片，每片一个 woff2 + 一条带 unicode-range 的 @font-face，
# 浏览器只会下载页面实际用到的片（标题十几个字 → 一两片，几十 KB）。
# 用法：python .trellis/tasks/09-27-gen-page-visual-align/subset-font.py
import os
import subprocess
import sys

SRC = 'node_modules/@fontpkg/king-hwa-old-song/京華老宋体v2.002.ttf'
FONT_DIR = 'apps/web/public/fonts/kinghwa'
CSS_OUT = 'apps/web/src/styles/kinghwa-font.css'
TMP_DIR = '.trellis/tasks/09-27-gen-page-visual-align/.subset'
CHUNK_SIZE = 600
FAMILY = 'KingHwa OldSong'


def gb2312_chars() -> list[str]:
    """GB2312 全部可编码字符：一级+二级汉字 6763 个，加 ASCII 与全角标点。"""
    chars: set[str] = set()
    for b1 in range(0xA1, 0xF8):
        for b2 in range(0xA1, 0xFF):
            try:
                chars.add(bytes([b1, b2]).decode('gb2312'))
            except UnicodeDecodeError:
                pass
    chars.update(chr(c) for c in range(0x20, 0x7F))
    chars.update('·—…“”‘’、。，；：？！（）《》〈〉【】「」')
    return sorted(chars)


def to_unicode_range(chars: list[str]) -> str:
    """码点列表 → CSS unicode-range（连续码点合并成区间）。"""
    codepoints = sorted({ord(c) for c in chars})
    parts: list[str] = []
    start = prev = codepoints[0]
    for cp in codepoints[1:]:
        if cp == prev + 1:
            prev = cp
            continue
        parts.append(f'U+{start:04X}' if start == prev else f'U+{start:04X}-{prev:04X}')
        start = prev = cp
    parts.append(f'U+{start:04X}' if start == prev else f'U+{start:04X}-{prev:04X}')
    return ', '.join(parts)


def subset(chars: list[str], out_path: str, text_path: str) -> None:
    with open(text_path, 'w', encoding='utf-8') as fh:
        fh.write(''.join(chars))
    result = subprocess.run(
        [
            sys.executable, '-m', 'fontTools.subset', SRC,
            f'--text-file={text_path}',
            '--flavor=woff2',
            '--no-hinting',
            '--desubroutinize',
            '--layout-features=kern',
            f'--output-file={out_path}',
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        print(result.stdout[-1500:])
        print(result.stderr[-1500:])
        raise SystemExit(f'subset failed: {out_path}')


def main() -> None:
    chars = gb2312_chars()
    chunks = [chars[i:i + CHUNK_SIZE] for i in range(0, len(chars), CHUNK_SIZE)]
    os.makedirs(FONT_DIR, exist_ok=True)
    os.makedirs(TMP_DIR, exist_ok=True)
    os.makedirs(os.path.dirname(CSS_OUT), exist_ok=True)

    faces: list[str] = [
        '/* 京華老宋体（KingHwa_OldSong，作者「特里王/活字攷古」，免费商用、禁止改字形）。',
        '   上游 npm 包只给 35.7MB 整字库 TTF，这里按 GB2312 常用字切成 N 片，',
        '   每片一条 @font-face + unicode-range —— 浏览器只下载页面用到的片。',
        '   由 .trellis/tasks/09-27-gen-page-visual-align/subset-font.py 生成，不要手改。 */',
        '',
    ]
    total = 0
    for index, chunk in enumerate(chunks):
        name = f'part-{index:02d}'
        out_path = f'{FONT_DIR}/{name}.woff2'
        subset(chunk, out_path, f'{TMP_DIR}/{name}.txt')
        size = os.path.getsize(out_path)
        total += size
        faces.append(
            '@font-face {\n'
            f"  font-family: '{FAMILY}';\n"
            '  font-style: normal;\n'
            '  font-weight: 400 900;\n'
            '  font-display: swap;\n'
            f"  src: url('/fonts/kinghwa/{name}.woff2') format('woff2');\n"
            f'  unicode-range: {to_unicode_range(chunk)};\n'
            '}'
        )
    with open(CSS_OUT, 'w', encoding='utf-8') as fh:
        fh.write('\n'.join(faces) + '\n')
    print(f'chunks: {len(chunks)}  total: {total / 1024 / 1024:.2f} MB  css: {CSS_OUT}')


if __name__ == '__main__':
    main()
