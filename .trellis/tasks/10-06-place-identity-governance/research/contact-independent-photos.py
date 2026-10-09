"""只读原选图，为首次独立图库身份批次生成带序号联系表。"""
import json
from pathlib import Path
from PIL import Image, ImageOps, ImageDraw, ImageFont

root = Path(__file__).resolve().parents[4]
research = Path(__file__).resolve().parent
freeze = json.loads((research / 'independent-photo-freeze-01.json').read_text(encoding='utf-8'))
groups = [c for c in freeze['results'][0]['catalogs'] if c['kind'] == 'selected' and c['name'] in ('北海公园', '八达岭长城')]
font = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 20)
sheet = Image.new('RGB', (1200, 4 * 330), 'white')
draw = ImageDraw.Draw(sheet)
items = []
for group in groups:
    for i, source in enumerate(group['images'], 1):
        image_path = (root / source['localPath']).resolve()
        assert image_path.is_relative_to(root / 'data/media')
        with Image.open(image_path) as original:
            picture = ImageOps.contain(original.convert('RGB'), (590, 280))
            n = len(items)
            x, y = n % 2 * 600, n // 2 * 330
            sheet.paste(picture, (x + (600 - picture.width) // 2, y))
            draw.text((x + 10, y + 285), f"{group['name']} {i}  {source['assetKey'][-64:-52]}", fill='black', font=font)
            items.append({'name': group['name'], 'position': i, 'imageKey': source['imageKey'], 'localPath': source['localPath'], 'dimensions': list(original.size)})
out = research / 'independent-photo-batch-01'
out.mkdir(exist_ok=True)
assert not (out / 'contact.jpg').exists()
sheet.save(out / 'contact.jpg', quality=92)
(out / 'contact.json').write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'photos': len(items), 'contact': str(out / 'contact.jpg')}, ensure_ascii=False))
