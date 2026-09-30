"""Display the bounded Openverse/Flickr sample, without approving search results."""
import html
import json
import shutil
from pathlib import Path
from PIL import Image, ImageOps, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[4]
BASE = ROOT / 'data/photo-pilot/openverse'
OUT = ROOT / 'data/photo-pilot/review'
ASSETS = OUT / 'assets/openverse'
ASSETS.mkdir(parents=True, exist_ok=True)
data = json.loads((BASE / 'candidates.json').read_text('utf-8'))
font = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 16)
sections = []
for place in ['西湖断桥', '九溪烟树', '飞来峰', '雷峰塔']:
    rows = [p for p in data['candidates'] if p['place'] == place and p.get('preview')]
    board = Image.new('RGB', (1020, max(1, (len(rows) + 2) // 3) * 290), '#f2f5fa')
    draw = ImageDraw.Draw(board)
    cards = []
    for i, photo in enumerate(rows):
        file = BASE / photo['preview']
        img = ImageOps.exif_transpose(Image.open(file)).convert('RGB')
        dest = ASSETS / file.name
        shutil.copyfile(file, dest)
        thumb = ImageOps.contain(img, (324, 230))
        x, y = (i % 3) * 340, (i // 3) * 290
        board.paste(thumb, (x + (340 - thumb.width) // 2, y + (230 - thumb.height) // 2))
        title = f'{i+1}. {photo["title"]}'
        draw.text((x + 8, y + 233), title[:34], font=font, fill='#26394c')
        draw.text((x + 8, y + 257), f'{img.width} x {img.height} / {photo["license"]}', font=font, fill='#52657a')
        esc = html.escape
        cards.append(f'''<article><a href="assets/openverse/{dest.name}" target="_blank" rel="noopener noreferrer"><img src="assets/openverse/{dest.name}" alt="{esc(photo['title'])}" width="{img.width}" height="{img.height}"></a><div><h3>{esc(title)}</h3><p>本地副本 {img.width} × {img.height} · {'横版' if img.width > img.height else '竖版或方形'}</p><p><a href="{esc(photo['sourceUrl'], quote=True)}" target="_blank" rel="noopener noreferrer">{esc(photo['photographer'] or '来源未提供作者')} · Flickr 原作品</a></p><p><a href="{esc(photo['licenseUrl'], quote=True)}" target="_blank" rel="noopener noreferrer">{esc(photo['license'])} {esc(photo['licenseVersion'] or '')}</a> · Openverse 收录</p><p>搜索候选 · 尚未核实逐图地点与摄影质量 · 未加入行程</p><details><summary>检索与记录</summary><p>{esc(photo['query'])}</p><code>{esc(photo['id'])}</code></details></div></article>''')
    board.save(BASE / f'sheet-{place}.jpg', quality=92)
    count = sum(p['place'] == place for p in data['candidates'])
    sections.append(f'<section><h2>{place}</h2><p>{count} 条记录 · {len(rows)} 张已保存预览</p><div class="grid">' + (''.join(cards) or '<p>本轮没有合适的横版结果，保留缺口。</p>') + '</div></section>')
page = '''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>新增来源 · Openverse / Flickr</title><style>*{box-sizing:border-box}body{background:#f4f7fb;color:#253750;font:15px/1.6 system-ui,'Microsoft YaHei',sans-serif;margin:0}main{max-width:1360px;margin:auto;padding:32px 24px}h1{font-size:30px}h2{margin:30px 0 6px}h3{font-size:16px;margin:0}p{color:#586b83}a{color:#315fab}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px}article{background:white;border:1px solid #d8e0ea;border-radius:12px;overflow:hidden;min-width:0}article img{display:block;width:100%;height:250px;object-fit:contain;background:#e9eef4}article>div{padding:16px}article p{font-size:13px}summary{min-height:44px;cursor:pointer}code{overflow-wrap:anywhere}a:focus-visible,summary:focus-visible{outline:3px solid #3866c6;outline-offset:3px}@media(max-width:700px){.grid{grid-template-columns:1fr}main{padding:20px 16px}}</style><main><p><a href="landscape.html">← 返回已复看的横版对比</a></p><h1>新增来源：Openverse 收录的 Flickr 摄影</h1><p>限量查询四个地点，筛选横向构图与 CC BY / BY-SA / CC0。这里是新取得的待审候选，地点仍须逐图核实；搜索命中不等于精选。每个地点最多下载六张预览，重复运行复用本地记录。</p>'''
(OUT / 'openverse.html').write_text(page + ''.join(sections) + '</main></html>', 'utf-8')
print(json.dumps({'records': len(data['candidates']), 'previews': sum(bool(p.get('preview')) for p in data['candidates']), 'page': str(OUT / 'openverse.html')}, ensure_ascii=False))
