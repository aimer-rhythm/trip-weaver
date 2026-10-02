from pathlib import Path
import json
import shutil
from fontTools.ttLib import TTFont
from fontTools import subset

ROOT = Path.cwd()
RESEARCH = ROOT / '.trellis/tasks/09-29-trip-cover-reference/research'
OUT = ROOT / 'data/photo-pilot/review'
(OUT / 'fonts').mkdir(parents=True, exist_ok=True)
samples = ['中轴宫苑漫步', '南麓泉塔听溪谷', '雍和宫与颐和园', '山水之间，慢游杭州', '北京', '杭州', '水榭花影']
fonts = [
    ('current', 'A · 当前千图笔锋', ROOT / 'node_modules/@fontpkg/qiantubifengshouxieti/千图笔锋手写体.ttf', '笔画洒脱，但收字不足。苑、麓等会回退成另一种字体。'),
    ('mashan', 'B · 马善政楷体', RESEARCH / 'MaShanZheng-Regular.ttf', '毛笔顿挫更明显，和当前笔锋气质接近；常用简体覆盖更完整。'),
    ('wenkai', 'C · 霞鹜文楷', RESEARCH / 'LXGWWenKai-Regular.ttf', '笔画清秀、比较文雅，毛笔感较弱；更适合长期减少缺字问题。'),
]
reports, css, cards = [], [], []
for key, label, file, note in fonts:
    font = TTFont(file)
    cmap = {cp: glyph for cp, glyph in font.getBestCmap().items() if font.getGlyphID(glyph) != 0}
    han = sum(0x3400 <= cp <= 0x4dbf or 0x4e00 <= cp <= 0x9fff for cp in cmap)
    missing = [c for c in '苑麓雍颐榭' if ord(c) not in cmap]
    reports.append(dict(key=key, label=label, source=str(file.relative_to(ROOT)), unicode_count=len(cmap), basic_and_ext_a_han=han, missing=missing))
    options = subset.Options()
    options.flavor = 'woff2'
    sub = subset.Subsetter(options=options)
    sub.populate(text=''.join(samples))
    sub.subset(font)
    font.flavor = 'woff2'
    font.save(OUT / f'fonts/{key}-preview.woff2')
    css.append(f"@font-face{{font-family:'Preview-{key}';src:url('fonts/{key}-preview.woff2');font-display:block}}")
    cards.append(f'<article><h2>{label}</h2><p>{note}</p><div class="samples" style="font-family:Preview-{key},SimSun,serif">' + ''.join(f'<div>{s}</div>' for s in samples[:4]) + f'</div><footer>基础汉字＋扩展 A：{han:,} 字<br>检测字：苑 麓 雍 颐 榭　' + ('缺：' + '、'.join(missing) if missing else '全部收录') + '</footer></article>')
for filename in ['MaShanZheng-OFL.txt', 'LXGWWenKai-OFL.txt']:
    shutil.copyfile(RESEARCH / filename, OUT / 'fonts' / filename)
(RESEARCH / 'font-coverage-comparison.json').write_text(json.dumps(reports, ensure_ascii=False, indent=2), encoding='utf-8')
html = '''<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>行程手写标题 · 字体对比</title><style>
*{box-sizing:border-box}body{margin:0;background:#f5f2e9;color:#27392f;font:16px/1.7 system-ui,sans-serif}main{max-width:1450px;margin:auto;padding:42px 24px}h1{margin:0 0 12px;font-size:28px}main>p{max-width:950px;color:#58655d}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:22px;margin-top:28px}article{padding:24px;background:#fffefa;border:1px solid #dedfd4;border-radius:18px}h2{font-size:19px;margin:0 0 12px}article p{font-size:14px;color:#697267;min-height:65px}.samples{font-size:34px;line-height:1.8;letter-spacing:1px}.samples div{margin:18px 0;white-space:nowrap}.samples div:nth-child(4){font-size:29px}footer{border-top:1px solid #e5e7db;padding-top:20px;font-size:13px;color:#5c695e}.links{font-size:13px;margin-top:26px}a{color:inherit}@media(max-width:1050px){.grid{grid-template-columns:1fr}.samples div{white-space:normal}}''' + ''.join(css) + '''</style><main><h1>同一句标题，三种手写风格</h1><p>“中轴宫苑漫步”保留原文对比。B、C 均读取实际字体字符映射表核对，包含“苑、麓、雍、颐、榭”。本页为选择预览，尚未替换应用字体。</p><div class="grid">''' + ''.join(cards) + '''</div><p class="links">来源及许可：<a href="https://github.com/google/fonts/tree/main/ofl/mashanzheng">Ma Shan Zheng / OFL 1.1</a> · <a href="https://github.com/lxgw/LxgwWenKai">霞鹜文楷 / OFL 1.1</a>。这里的数量按字体 cmap 中有效字形统计，仅计基本区与扩展 A，以便同口径比较。</p></main></html>'''
(OUT / 'font-comparison.html').write_text(html, encoding='utf-8')
print(json.dumps(reports, ensure_ascii=False))
