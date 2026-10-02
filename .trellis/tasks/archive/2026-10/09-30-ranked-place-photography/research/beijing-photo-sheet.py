"""汇总真实浏览器截取的北京行程景点封面，供逐图验收。"""
from pathlib import Path
import argparse
import json
from PIL import Image, ImageDraw, ImageFont, ImageOps

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--days', type=int, choices=(3, 7), default=3)
args = parser.parse_args()
root = Path(__file__).resolve().parent / 'verification' / f"beijing-{'seven' if args.days == 7 else 'three'}-days"
trip = json.loads((root / 'trip.json').read_text('utf-8'))
places = [p for p in trip['overview'] if p['category'] == 'attraction']
entries = [(i, p) for i, p in enumerate(places) if (root / f'photo-{i}.png').exists()]
assert entries, '尚无真实浏览器图片证据'
font = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 22)
small = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 17)
columns, width, height, gap = 3, 430, 318, 16
sheet = Image.new('RGB', (columns * (width + gap) + gap, ((len(entries) + columns - 1) // columns) * (height + gap) + 90), '#f4f2ed')
draw = ImageDraw.Draw(sheet)
draw.text((gap, 16), f"{trip['title']} · 实际景点封面", font=font, fill='#273e3a')
for position, (index, poi) in enumerate(entries):
    x, y = gap + (position % columns) * (width + gap), 70 + (position // columns) * (height + gap)
    draw.rounded_rectangle((x, y, x + width, y + height), radius=12, fill='white')
    with Image.open(root / f'photo-{index}.png') as raw:
        image = ImageOps.contain(raw.convert('RGB'), (width - 20, height - 85))
        sheet.paste(image, (x + (width - image.width) // 2, y + 10 + (height - 85 - image.height) // 2))
    draw.text((x + 12, y + height - 64), poi['name'], font=font, fill='#253b38')
    source = poi.get('coverAttribution', {}).get('source', '未标注来源')
    count = len(poi.get('photos') or ([poi['coverUrl']] if poi.get('coverUrl') else []))
    draw.text((x + 12, y + height - 33), f"封面 {source} · 共 {count} 张", font=small, fill='#596a62')
sheet.save(root / 'photo-sheet.jpg', quality=93)
print(f'已生成封面总览：{len(entries)} 个景点')
