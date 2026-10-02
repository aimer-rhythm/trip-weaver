from pathlib import Path
from PIL import Image
import json
import shutil

ROOT = Path.cwd()
SOURCE = ROOT / '.trellis/tasks/09-29-trip-cover-reference/research/font-sizing'
REVIEW = ROOT / 'data/photo-pilot/review'
MEDIA = REVIEW / 'font-sizing'
MEDIA.mkdir(exist_ok=True)
for stage in ('before', 'after'):
    target = MEDIA / stage
    target.mkdir(exist_ok=True)
    for file in (SOURCE / stage).glob('*.png'):
        if file.name != 'failure.png':
            shutil.copyfile(file, target / file.name)
    data = json.loads((SOURCE / stage / 'metrics.json').read_text(encoding='utf-8'))
    for name in ('subtitle', 'overview-heading', 'overview-day'):
        sample = next(item for item in data if item['name'] == name)
        spacing = 0 if sample['letterSpacing'] == 'normal' else float(sample['letterSpacing'].removesuffix('px'))
        width = round(sample['advance'] + spacing * len(sample['text']) + 4)
        im = Image.open(target / f'{name}.png')
        cropped = im.crop((0, 0, min(width, im.width), im.height))
        cropped.save(target / ('subtitle-text.png' if name == 'subtitle' else f'{name}.png'))

for name in ('heading', 'hint', 'cover', 'subtitle'):
    shutil.copyfile(SOURCE / f'{name}-reference.png', MEDIA / f'{name}-reference.png')
shutil.copyfile(REVIEW / 'fonts/ui-caption-reference.png', MEDIA / 'caption-reference.png')
Image.open('C:/Users/Aimer/Downloads/行程生成2.png').crop((1343, 526, 1438, 590)).save(MEDIA / 'new-reference.png')

rows = [
    ('详情页 · 每日标题', 'heading', 'heading-reference.png', '约30 → 38px；手机26 → 30px。实际字形约22 → 28px，收紧字距并缩小行高。'),
    ('生成页 · 进行中状态', 'hint', 'hint-reference.png', '24 → 34px；手机18 → 28px。实际字形约18 → 24px，配合字距避免一句话过度分散。'),
    ('生成页 · 照片题字', 'caption', 'caption-reference.png', '24 → 30px；手机18 → 24px。实际字形约18 → 23px，长名称允许换行。'),
    ('行程封面 · 城市名', 'cover-city', 'cover-reference.png', '有插画短名称约35 → 48px；手机30 → 40px。长名称单独降字号，避免压到插画。'),
    ('我的行程 · 副标题', 'subtitle-text', 'subtitle-reference.png', '23 → 30px；手机21 → 26px。字距略收紧，手机在逗号处分为两行。'),
    ('生成页 · new 标记', 'new-mark', 'new-reference.png', '25 → 38px，补偿该字体较小的西文字面。'),
    ('详情总览 · 主标题', 'overview-heading', None, '与每日标题使用同一字号层级。'),
    ('详情总览 · 每日主题', 'overview-day', None, '26 → 32px，低于主标题一级；配合1.35行高。'),
    ('无插画封面 · 城市名', 'cover-plain', None, '短名称约43 → 54px；长名称收小并自然换行。'),
    ('空状态 · 旅', 'empty-mark', None, '60 → 72px，保持装饰字与提示正文的层级。'),
    ('生成页 · 题字占位', 'placeholder-caption', None, '没有实际文字；占位高度19 → 24个设计像素，与新题字高度同步。'),
]
blocks = []
for title, name, reference, note in rows:
    original = f'<img src="font-sizing/{reference}" alt="{title}参考">' if reference else '<span class="missing">原图没有独立样例<br>按同页文字层级校准</span>'
    blocks.append(f'<section><h2>{title}</h2><p>{note}</p><div class="comparison"><div>{original}</div><div><img src="font-sizing/before/{name}.png" alt="调整前"></div><div><img src="font-sizing/after/{name}.png" alt="调整后"></div></div></section>')
html = '''<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>悠然小楷 · 全部手写位置字号校准</title><style>
*{box-sizing:border-box}body{margin:0;background:#edf3fb;color:#243c61;font:15px/1.6 system-ui,sans-serif}main{width:1550px;max-width:100%;margin:auto;padding:28px}h1{margin:0 0 8px;font-size:27px}.intro{color:#687993;max-width:1150px}.labels,.comparison{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.labels{position:sticky;top:0;background:#edf3fbed;padding:12px 16px;z-index:1;border-radius:12px;font-weight:600}.labels span:last-child{color:#326b4d}section{background:white;border-radius:16px;padding:18px;margin-top:14px}h2{font-size:16px;margin:0}section p{font-size:12px;color:#75839c;margin:4px 0 14px}.comparison>div{min-width:0;min-height:92px;display:flex;align-items:center;justify-content:center;background:#f7faff;border-radius:10px;overflow:auto;padding:10px}.comparison img{max-width:100%;height:auto;display:block}.missing{font-size:12px;color:#8897ad;text-align:center}a{color:#416faf}.links{margin-top:22px}body.compact main{padding:22px}body.compact section{padding:14px}body.compact section p{margin-bottom:8px}@media(max-width:700px){main{padding:16px}.comparison,.labels{grid-template-columns:repeat(3,minmax(230px,1fr))}section{overflow:auto}.labels{position:static;overflow:auto}}
</style><main><h1>悠然小楷 · 全部手写位置字号校准</h1><p class="intro">按1672×941画布截取相同文案对比。原图与样张保留各自笔迹；主要样张按原像素展示。没有独立参考图的状态按同页层级处理。当前对比只评估字体大小与排版。</p><div class="labels"><span>原 UI 图</span><span>换字体后 · 调整前</span><span>本次调整后</span></div>''' + ''.join(blocks) + '''<p class="links">完整效果：<a href="font-sizing/after/editor-desktop.png">详情页</a> · <a href="font-sizing/after/collection-desktop.png">行程列表</a> · <a href="font-sizing/after/generation-desktop.png">生成页题字样张</a><br>手机：<a href="font-sizing/after/editor-mobile.png">详情页</a> · <a href="font-sizing/after/collection-mobile.png">行程列表</a> · <a href="font-sizing/after/generation-mobile.png">生成页</a> · <a href="font-sizing/after/empty-mobile.png">空状态</a></p></main></html>'''
(REVIEW / 'font-sizing.html').write_text(html, encoding='utf-8')
print('Built font-sizing.html with all handwriting positions')
