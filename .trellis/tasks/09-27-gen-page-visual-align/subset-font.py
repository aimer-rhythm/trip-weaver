# 中文字体子集化 + 分片（09-27 视觉对齐任务）
# 上游 npm 包只提供整字库 TTF（京華老宋体 35.7MB、千图笔锋 2MB），网页直接引用不可行。
# 做法与 @fontsource 一致：按字符切成 N 片 woff2，每片配一条带 unicode-range 的 @font-face，
# 浏览器只下载页面实际用到的片（标题十几个字 → 一两片，几十 KB）。
# 用法：python .trellis/tasks/09-27-gen-page-visual-align/subset-font.py [family-key]
#   不带参数 = 处理下面所有字体；带参数 = 只处理指定 family-key。
import os
import subprocess
import sys

TMP_DIR = '.trellis/tasks/09-27-gen-page-visual-align/.subset'
CHUNK_SIZE = 600

FONTS = [
    {
        'key': 'kinghwa',
        'src': 'node_modules/@fontpkg/king-hwa-old-song/京華老宋体v2.002.ttf',
        'family': 'KingHwa OldSong',
        'weight': '400 900',
        'out_dir': 'apps/web/public/fonts/kinghwa',
        'css': 'apps/web/src/styles/kinghwa-font.css',
        'note': '京華老宋体（KingHwa_OldSong，作者「特里王 / 活字攷古」，免费商用、禁止改字形）。用于生成页标题与里程碑标题。',
    },
    {
        'key': 'handwriting',
        'src': 'node_modules/@fontpkg/qiantubifengshouxieti/千图笔锋手写体.ttf',
        'family': 'QianTuBiFeng Handwriting',
        'weight': '400',
        'out_dir': 'apps/web/public/fonts/handwriting',
        'css': 'apps/web/src/styles/handwriting-font.css',
        'note': '千图笔锋手写体（免费商用）。用于生成页拍立得卡片的说明文字（设计稿是手写体）。',
    },
]


def common_chars() -> set[str]:
    """GB2312 全部可编码字符 + ASCII + 中文排版常用标点。"""
    chars: set[str] = set()
    for b1 in range(0xA1, 0xF8):
        for b2 in range(0xA1, 0xFF):
            try:
                chars.add(bytes([b1, b2]).decode('gb2312'))
            except UnicodeDecodeError:
                pass
    chars.update(chr(c) for c in range(0x20, 0x7F))
    chars.update('·—…“”‘’、。，；：？！（）《》〈〉【】「」')
    return chars


def font_chars(src: str) -> list[str]:
    """字体自身 cmap ∩ 常用字集：既不会请求字体没有的字，也不把整字库全带上。"""
    from fontTools.ttLib import TTFont

    cmap = TTFont(src, lazy=True).getBestCmap()
    allowed_codes = {ord(c) for c in common_chars()}
    return sorted({chr(cp) for cp in cmap if cp in allowed_codes})


def to_unicode_range(chars: list[str]) -> str:
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


def subset(src: str, chars: list[str], out_path: str, text_path: str) -> None:
    with open(text_path, 'w', encoding='utf-8') as fh:
        fh.write(''.join(chars))
    result = subprocess.run(
        [
            sys.executable, '-m', 'fontTools.subset', src,
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


def process(font: dict, chars: list[str]) -> None:
    chunks = [chars[i:i + CHUNK_SIZE] for i in range(0, len(chars), CHUNK_SIZE)]
    out_dir = font['out_dir']
    os.makedirs(out_dir, exist_ok=True)
    os.makedirs(TMP_DIR, exist_ok=True)

    faces = [
        f'/* {font["note"]}',
        f'   字符集：字体自身 cmap ∩ GB2312 常用字，共 {len(chars)} 字，切成 {len(chunks)} 片；',
        '   由 .trellis/tasks/09-27-gen-page-visual-align/subset-font.py 生成，不要手改。 */',
        '',
    ]
    total = 0
    for index, chunk in enumerate(chunks):
        name = f'part-{index:02d}'
        out_path = f'{out_dir}/{name}.woff2'
        subset(font['src'], chunk, out_path, f'{TMP_DIR}/{font["key"]}-{name}.txt')
        total += os.path.getsize(out_path)
        faces.append(
            '@font-face {\n'
            f"  font-family: '{font['family']}';\n"
            '  font-style: normal;\n'
            f"  font-weight: {font['weight']};\n"
            '  font-display: swap;\n'
            f"  src: url('/fonts/{os.path.basename(out_dir)}/{name}.woff2') format('woff2');\n"
            f'  unicode-range: {to_unicode_range(chunk)};\n'
            '}'
        )
    with open(font['css'], 'w', encoding='utf-8') as fh:
        fh.write('\n'.join(faces) + '\n')
    print(f"{font['key']}: {len(chars)} chars -> {len(chunks)} chunks, {total / 1024 / 1024:.2f} MB, css {font['css']}")


def main() -> None:
    only = sys.argv[1] if len(sys.argv) > 1 else None
    for font in FONTS:
        if only and font['key'] != only:
            continue
        if not os.path.exists(font['src']):
            print(f"skip {font['key']}: {font['src']} not found")
            continue
        process(font, font_chars(font['src']))


if __name__ == '__main__':
    main()
