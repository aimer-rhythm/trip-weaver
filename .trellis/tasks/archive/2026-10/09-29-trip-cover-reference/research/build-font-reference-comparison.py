"""Compare real fonts against the user's two UI references; never changes app fonts."""
from pathlib import Path
import json
import hashlib
import shutil
from fontTools.ttLib import TTFont
from fontTools import subset

ROOT = Path.cwd()
RESEARCH = ROOT / '.trellis/tasks/09-29-trip-cover-reference/research'
OUT = ROOT / 'data/photo-pilot/review'
fonts = [
    ('D', '演示夏行楷', 'Yanshi-Xiaxingkai.ttf', '笔锋飘逸、字距疏朗，适合喜欢明显行书感的标题。', 'https://mp.weixin.qq.com/s/CRnRsYu8ymlG9_oK6wmBag'),
    ('E', '演示悠然小楷', 'Yanshi-Youran.ttf', '风格首选：细笔中保留行楷笔锋，最接近这两张参考图的感觉。', 'https://mp.weixin.qq.com/s/Q1lAIre4yJ-Zlf2CD82EPA'),
    ('F', '沐瑶随心手写体', 'Muyao-Suixin.ttf', '圆润、跳跃的日常笔迹；比参考图更活泼。', 'https://www.zcool.com.cn/work/ZMzYwMzk2MjA=.html'),
    ('G', '悠哉字体', 'Yozai-Regular.ttf', '细笔自然、带随手书写的起伏；这组里汉字覆盖最多。', 'https://github.com/lxgw/yozai-font'),
    ('H', '沐瑶软笔手写体', 'Muyao-Softbrush.ttf', '比随心版笔画更饱满，适合偏圆润、温和的手写感觉。', 'https://www.zcool.com.cn/work/ZMjg5MjAwMDQ=.html'),
    ('I', '江西拙楷', 'Jiangxi-Zhuokai.ttf', '有手写的不规则感，但本次实测仍缺“簋”，作为补充对照。', 'https://www.zcool.com.cn/work/ZNDE4MzY4Mjg=.html'),
]
texts = ['沿着中轴线，走进老北京', '中轴宫苑漫步', '雍和宫与颐和园', '故宫 · 角楼黄昏', '南锣鼓巷 · 老北京风情', '天坛 · 祈年殿', '颐和园 · 昆明湖', '簋街 · Citywalk', '苑麓雍颐榭锣祈簋']
report, faces, cards = [], [], []
for label, name, filename, note, source in fonts:
    file = RESEARCH / filename
    font = TTFont(file)
    cmap = {cp: glyph for cp, glyph in font.getBestCmap().items() if font.getGlyphID(glyph) != 0}
    han = sum(0x3400 <= cp <= 0x4dbf or 0x4e00 <= cp <= 0x9fff for cp in cmap)
    missing = [char for char in texts[-1] if ord(char) not in cmap]
    missing_sample = sorted({char for char in ''.join(texts) if not char.isspace() and ord(char) not in cmap})
    report.append(dict(label=label, name=name, filename=filename, sha256=hashlib.sha256(file.read_bytes()).hexdigest(), unicode_count=len(cmap), basic_and_ext_a_han=han, missing=missing, missing_sample_characters=missing_sample, source=source))
    options = subset.Options()
    options.flavor = 'woff2'
    sub = subset.Subsetter(options=options)
    sub.populate(text=''.join(texts) + '\u3000')
    sub.subset(font)
    # Preview-only subset name: retain author/license records without claiming to be an installable original font.
    family = f'TW Preview {label}'
    for entry in font['name'].names:
        if entry.nameID in (1, 3, 4, 6, 16):
            entry.string = family.replace(' ', '-').encode(entry.getEncoding())
    font.flavor = 'woff2'
    font.save(OUT / f'fonts/reference-{label}.woff2')
    faces.append(f"@font-face{{font-family:'{family}';src:url('fonts/reference-{label}.woff2');font-display:block}}")
    cards.append(f'''<article id="option-{label}" style="--hand:'{family}',SimSun,serif"><header><b>{label} · {name}</b><span>{han:,} 汉字</span></header><p class="description">{note}</p>
    <section class="scene"><nav><span>总览</span><strong>第1天</strong><span>第2天</span><span>第3天</span></nav><h2 class="hand title">{texts[0]}</h2><p class="date">10月16日 · 第1天</p><p class="hand extra">{texts[1]} · {texts[2]}</p></section>
    <section class="caption-scene"><figure><img src="fonts/ui-photo-scene.png" alt="参考图中的相片局部"><figcaption class="hand">{texts[3]}</figcaption></figure><div class="hand caption-lines">{''.join(f'<p>{text}</p>' for text in texts[4:8])}</div></section>
    <footer>缺字复核：<span class="hand probe">苑 麓 雍 颐 榭 锣 祈 簋</span><br>{'缺：' + '、'.join(missing) if missing else '这8个字全部收录'} · <a href="{source}" target="_blank" rel="noopener">来源与发布说明</a></footer></article>''')

shutil.copyfile(RESEARCH / 'Yozai-OFL.txt', OUT / 'fonts/Yozai-OFL.txt')
html = '''<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>参考图里的手写感 · 新候选</title><style>
*{box-sizing:border-box}body{margin:0;color:#233c66;background:#eef4ff;font:15px/1.6 system-ui,sans-serif}main{max-width:1470px;margin:auto;padding:30px 26px}h1{font-size:26px;margin:0 0 8px}.intro{color:#586d90;max-width:1050px}.references{display:grid;grid-template-columns:1.2fr 1fr;gap:20px;margin:22px 0;background:#fff;padding:18px;border-radius:20px}.references img{max-width:100%;height:auto;display:block}.references p{font-size:13px;color:#6d7f9b;margin:0 0 8px}.references img.caption-ref{max-height:118px;width:auto}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px}article{background:#fff;padding:23px;border:1px solid #dfe7f3;border-radius:20px;min-width:0}article header{display:flex;justify-content:space-between;gap:8px;align-items:baseline}article header b{font-size:20px}article header span{font-size:12px;color:#74849e}.description{min-height:44px;font-size:13px;color:#6b7c98}.hand{font-family:var(--hand);font-weight:400}.scene{border-radius:15px;padding:16px 18px;background:linear-gradient(120deg,#eef5ff,#fbfcff)}nav{display:flex;gap:22px;font-size:12px;color:#8495b4}nav strong{background:#6988ff;border-radius:20px;padding:4px 14px;color:white;font-weight:400}nav span{padding-top:4px}.title{font-size:32px;line-height:1.5;letter-spacing:2px;margin:15px 0 5px}.date{font-size:13px;color:#92a1bb;margin:0}.extra{font-size:22px;margin:14px 0 0}.caption-scene{display:flex;gap:24px;align-items:center;margin:20px 0;background:#f5f6fc;padding:20px;border-radius:15px}figure{margin:0;background:white;padding:10px 10px 14px;box-shadow:0 5px 14px #7185ae24;transform:rotate(-4deg);width:236px;flex:none}figure img{width:216px;height:132px;object-fit:cover;display:block}figcaption{text-align:center;margin-top:10px;font-size:22px;line-height:1.4;color:#667091}.caption-lines{font-size:21px;line-height:1.6;color:#667091;min-width:0}.caption-lines p{margin:8px 0;overflow-wrap:anywhere}footer{border-top:1px solid #e8edf5;padding-top:14px;font-size:12px;color:#73829a}a{color:inherit}.probe{font-size:20px;color:#344e73}.reference-links{margin:20px 0;font-size:13px}@media(max-width:1100px){.grid{grid-template-columns:1fr}}@media(max-width:650px){main{padding:20px 12px}.references{grid-template-columns:1fr}article{padding:15px}.title{font-size:27px;letter-spacing:1px}.scene{padding:12px}.caption-scene{padding:16px;flex-wrap:wrap;justify-content:center}.caption-lines{width:100%;font-size:22px}.description{min-height:0}}
''' + ''.join(faces) + '''</style><main><h1>参考图里的手写感 · 6 款新候选</h1><p class="intro">上面保留你发来的原图局部，下面每款都按“详情页标题＋照片题字”两种大小展示。截图只能判断风格接近程度，不能确认原稿使用的确切字体。</p><section class="references"><div><p>详情页参考 · 原图裁取</p><img src="fonts/ui-title-reference.png" alt="沿着中轴线，走进老北京的参考笔迹"></div><div><p>生成页参考 · 原图裁取</p><img class="caption-ref" src="fonts/ui-writing-reference.png" alt="正在搜罗胡同里的隐藏咖啡馆的参考笔迹"><img class="caption-ref" src="fonts/ui-caption-reference.png" alt="照片下方故宫角楼黄昏的参考笔迹"></div></section><div class="grid">''' + ''.join(cards) + '''</div><p class="reference-links">字数以实际文件 cmap 的基本区＋扩展 A 汉字统计，不把ASCII等混入。实测“苑、麓、雍、颐、榭、锣、祈、簋”；I仍缺“簋”，其余本组测试字均有收录。G遵循OFL 1.1，其余保留原发布资料。这里是字体选择预览，未替换应用字体。<a href="font-comparison.html">查看上一轮 A/B/C</a></p></main></html>'''
(OUT / 'font-reference-comparison.html').write_text(html, encoding='utf-8')
(RESEARCH / 'font-reference-coverage.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(report, ensure_ascii=False))
