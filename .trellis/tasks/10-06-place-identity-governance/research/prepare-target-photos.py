"""从指定只读快照生成不可覆盖的图像核查副本；原媒体保持不变。"""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import argparse
import hashlib
import json
import re
import sys
import urllib.request
from PIL import Image, ImageOps, ImageDraw
sys.stdout.reconfigure(encoding='utf-8')
root = Path(__file__).resolve().parent
workspace = root.parents[3]
parser = argparse.ArgumentParser()
parser.add_argument('--source', required=True)
parser.add_argument('--out', required=True)
parser.add_argument('--prefix', required=True)
args = parser.parse_args()
assert re.fullmatch('[A-Z]', args.prefix)
source = (root / args.source).resolve()
folder = (root / args.out).resolve()
assert source.is_relative_to(root) and folder.is_relative_to(root)
report = json.loads(source.read_text(encoding='utf-8'))
assert report['readOnly'] and report['city'] != '云南'
folder.mkdir(exist_ok=False)
items = []
for entity in report['entities']:
    for photo in entity.get('independentSources', []):
        items.append({'label': f'{args.prefix}{len(items)+1:02}', 'entityId': entity['entityId'], 'name': entity['name'],
            'imageKey': photo['imageKey'], 'inputHash': photo['inputHash'], 'assetKey': photo['assetKey'],
            'eligible': photo['eligible'], 'entry': photo['entry']})

def fetch(item):
    url = item['entry']['photo']['url']
    try:
        if url.startswith('/media/'):
            path = (workspace / 'data' / url.lstrip('/')).resolve()
            assert path.is_relative_to(workspace / 'data' / 'media')
            raw = path.read_bytes()
            assert hashlib.sha256(raw).hexdigest() == item['entry']['sha256']
            item['sourcePath'] = str(path)
        else:
            assert url.startswith(('https://images.unsplash.com/', 'https://store.is.autonavi.com/'))
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'}), timeout=25) as response:
                raw = response.read(16 * 1024 * 1024 + 1)
            assert len(raw) <= 16 * 1024 * 1024
        original = folder / f"{item['label']}.original"
        original.write_bytes(raw)
        item['bytesSha256'] = hashlib.sha256(raw).hexdigest()
        with Image.open(original) as image:
            image = ImageOps.exif_transpose(image).convert('RGB')
            item['size'] = list(image.size)
            image.save(folder / f"{item['label']}.jpg", quality=94)
        item['imageFile'] = f"{item['label']}.jpg"
    except Exception as error:
        item['error'] = type(error).__name__ + ': ' + str(error)[:180]
    return item

with ThreadPoolExecutor(max_workers=4) as pool:
    results = list(pool.map(fetch, items))
width, height, cols = 360, 295, 3
sheet = Image.new('RGB', (width * cols, height * ((len(results) + cols - 1) // cols)), 'white')
draw = ImageDraw.Draw(sheet)
for idx, item in enumerate(results):
    x, y = idx % cols * width, idx // cols * height
    if item.get('imageFile'):
        with Image.open(folder / item['imageFile']) as image:
            thumb = ImageOps.contain(image, (width - 10, height - 30))
            sheet.paste(thumb, (x + (width - thumb.width)//2, y + 25))
    draw.text((x+6, y+5), item['label'] + (' eligible' if item['eligible'] else ' rejected') + (' ERROR' if item.get('error') else ''), fill='black')
sheet.save(folder / 'contact.jpg', quality=95)
(folder / 'manifest.json').write_text(json.dumps({'readOnlySources': True, 'sourceReport': args.source,
    'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(), 'images': results}, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
print(json.dumps({'folder': args.out, 'images': len(results),
    'errors': [{'label': r['label'], 'error': r['error']} for r in results if 'error' in r]}, ensure_ascii=False))
