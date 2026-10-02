"""生成试点精选联系表与分布统计，供人工视觉核对。"""
import json
from collections import Counter
from pathlib import Path
from PIL import Image, ImageOps, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
city_root = next((HERE / 'live' / 'photography').iterdir())
library = json.loads((city_root / 'selected.json').read_text('utf-8'))
groups = list(library['places'].values())
items = [(group['place']['name'], image) for group in groups for image in group['images']]
sheet = Image.new('RGB', (1260, ((len(items) + 2) // 3) * 360), '#f7f5f0')
draw = ImageDraw.Draw(sheet)
font = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 19)
for index, (name, item) in enumerate(items):
    x, y = (index % 3) * 420, (index // 3) * 360
    with Image.open(city_root / item['file']) as opened:
        image = ImageOps.exif_transpose(opened).convert('RGB')
        image.thumbnail((404, 280))
        sheet.paste(image, (x + (420 - image.width) // 2, y))
    draw.text((x + 8, y + 286), f'{index + 1}. {name} · {item["review"].get("quality")}分', fill='#25312e', font=font)
    draw.text((x + 8, y + 316), item['review'].get('view', '')[:20], fill='#25312e', font=font)
out = HERE / 'verification'
out.mkdir(exist_ok=True)
sheet.save(out / 'beijing-selected.jpg', quality=90)
candidates = json.loads((out / 'final-candidates.json').read_text('utf-8'))
stats = {'selected': len(items), 'places': {g['place']['name']: len(g['images']) for g in groups},
         'candidates': sum(map(len, candidates.values())),
         'statuses': dict(Counter(item['review']['status'] for pool in candidates.values() for item in pool)),
         'selected_sources': [{'place': name, 'source': item['source_url'], 'index': item['image_index'],
                              'evidence': item['review']['evidence']} for name, item in items]}
(out / 'selection-stats.json').write_text(json.dumps(stats, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({key: val for key, val in stats.items() if key != 'selected_sources'}, ensure_ascii=False))
