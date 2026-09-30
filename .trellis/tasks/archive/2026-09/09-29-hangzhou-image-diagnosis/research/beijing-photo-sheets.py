import json
from pathlib import Path
from PIL import Image, ImageOps, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[4]
BASE = ROOT / 'data/photo-pilot/beijing'
data = json.loads((BASE / 'candidates.json').read_text('utf-8'))
font = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 16)
for place in dict.fromkeys(p['place'] for p in data['candidates']):
    photos = [p for p in data['candidates'] if p['place'] == place and p.get('preview')]
    if not photos:
        continue
    sheet = Image.new('RGB', (1440, ((len(photos) + 2) // 3) * 320), '#edf2f6')
    draw = ImageDraw.Draw(sheet)
    for n, photo in enumerate(photos):
        image = ImageOps.exif_transpose(Image.open(BASE / photo['preview'])).convert('RGB')
        thumb = ImageOps.contain(image, (466, 265))
        x, y = n % 3 * 480, n // 3 * 320
        sheet.paste(thumb, (x + (480-thumb.width)//2, y+(270-thumb.height)//2))
        draw.text((x+7, y+273), f'{n+1}: {photo["id"]}', font=font, fill='#20334b')
        draw.text((x+7, y+296), str(photo['title'])[:47], font=font, fill='#485970')
    sheet.save(BASE / f'sheet-{place}.jpg', quality=92)
print(json.dumps({p: len([x for x in data['candidates'] if x['place'] == p and x.get('preview')]) for p in dict.fromkeys(x['place'] for x in data['candidates'])}, ensure_ascii=False))
