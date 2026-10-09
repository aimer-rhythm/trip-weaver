"""冻结三组地点独立图库的视觉核查副本，原目录不变。"""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import sys
import urllib.request
from PIL import Image, ImageOps, ImageDraw
sys.stdout.reconfigure(encoding='utf-8')
root = Path(__file__).resolve().parent
workspace = root.parents[3]
report_path = root / 'priority-cities/济南/cultural-downstream-check-02.json'
report = json.loads(report_path.read_text(encoding='utf-8'))
folder = root / 'priority-cities/济南/cultural-photos-01'
folder.mkdir(exist_ok=False)
items = []
for entity in report['entities']:
    prefix = 'M' if entity['name'] == '山东博物馆' else 'C'
    for i, photo in enumerate(entity.get('independentSources', []), 1):
        items.append({'label': f'{prefix}{i:02}', 'entityId': entity['entityId'], 'name': entity['name'],
            'imageKey': photo['imageKey'], 'inputHash': photo['inputHash'], 'assetKey': photo['assetKey'],
            'eligible': photo['eligible'], 'entry': photo['entry']})

def fetch(item):
    url = item['entry']['photo']['url']
    try:
        if url.startswith('/media/'):
            source = (workspace / 'data' / url.lstrip('/')).resolve()
            assert source.is_relative_to(workspace / 'data' / 'media')
            raw = source.read_bytes()
            assert hashlib.sha256(raw).hexdigest() == item['entry']['sha256']
            item['sourcePath'] = str(source)
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
for prefix in ['M', 'C']:
    photos = [item for item in results if item['label'].startswith(prefix)]
    width, height, cols = 340, 275, 3
    sheet = Image.new('RGB', (width * cols, height * ((len(photos) + cols - 1) // cols)), 'white')
    draw = ImageDraw.Draw(sheet)
    for idx, item in enumerate(photos):
        x, y = idx % cols * width, idx // cols * height
        if item.get('imageFile'):
            with Image.open(folder / item['imageFile']) as image:
                thumb = ImageOps.contain(image, (width - 10, height - 30))
                sheet.paste(thumb, (x + (width - thumb.width)//2, y + 25))
        draw.text((x + 6, y + 5), item['label'] + (' eligible' if item['eligible'] else ' rejected') + (' ERROR' if item.get('error') else ''), fill='black')
    sheet.save(folder / f'{prefix}-contact.jpg', quality=95)
(folder / 'manifest.json').write_text(json.dumps({'readOnlySources': True,
    'sourceReport': str(report_path.relative_to(root)), 'images': results}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'folder': str(folder.relative_to(root)), 'images': len(results),
    'downloadOrReadErrors': [{'label': r['label'], 'error': r['error']} for r in results if 'error' in r]}, ensure_ascii=False))
