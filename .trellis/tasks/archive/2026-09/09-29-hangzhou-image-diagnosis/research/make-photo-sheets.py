"""将实拍候选排成联系表供逐张复核，不产生自动景点判定。"""
import json
from pathlib import Path
from PIL import Image, ImageOps, ImageDraw, ImageFont

ROOT = Path('D:/Project/tripweaver')
BASE = ROOT / 'data/photo-pilot'
targets = json.loads((ROOT / 'apps/server/src/data/photography/hangzhou-targets.json').read_text('utf-8'))
photos = json.loads((BASE / 'candidates.json').read_text('utf-8'))
font = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 16)
(BASE / 'sheets').mkdir(exist_ok=True)
for index, target in enumerate(targets):
    selected = [p for p in photos if p['place'] == target['name'] and (BASE / 'previews' / (p['id'] + '.jpg')).exists() and p['width'] >= 1400 and p['height'] >= 800]
    for page in range((len(selected) + 11)//12):
        items = selected[page*12:(page+1)*12]
        sheet = Image.new('RGB', (1280, 330*((len(items)+3)//4)), '#eeeeee')
        draw = ImageDraw.Draw(sheet)
        for i, p in enumerate(items):
            image = Image.open(BASE / 'previews' / (p['id'] + '.jpg')).convert('RGB')
            tile = ImageOps.contain(image, (310, 230))
            x, y = (i%4)*320, (i//4)*330
            sheet.paste(tile, (x+(320-tile.width)//2, y))
            label = f"{p['id']}\n{p['title'][:25]}\n{p['width']}×{p['height']} {p['license']}"
            draw.text((x+5,y+234), label, font=font, fill='black')
        sheet.save(BASE / 'sheets' / f'{index:02}-{page}.jpg', quality=91)
    print(target['name'], len(selected))
