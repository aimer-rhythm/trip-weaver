"""Build a local comparison proposal from reviewed, cached photos; never update the catalog."""
import json
import shutil
from pathlib import Path
from urllib.parse import urlparse

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[4]
RESEARCH = Path(__file__).parent
BASE = ROOT / 'data/photo-pilot'
OUT = BASE / 'review'
ASSETS = OUT / 'assets/landscape'
ASSETS.mkdir(parents=True, exist_ok=True)

plan = json.loads((RESEARCH / 'landscape-selections.json').read_text('utf-8'))
catalog = json.loads((ROOT / 'apps/server/src/data/photography/hangzhou-curated.json').read_text('utf-8'))
curated = {photo['id']: photo for place in catalog['places'] for photo in place['photos']}
sources = {photo['id']: photo for photo in json.loads((BASE / 'candidates.json').read_text('utf-8'))}
xhs = {photo['id']: photo for place in json.loads((BASE / 'xhs/sample.json').read_text('utf-8')) for photo in place['photos']}

for place in plan['places']:
    for photo in place['photos']:
        key = photo['id']
        if key.startswith('xhs-'):
            source = xhs[key]
            file = BASE / 'xhs/previews' / (key + '.webp')
            credit = dict(source='小红书', photographer=source['author'], sourceUrl=source['sourceUrl'],
                          license='风格参考 · 授权待核实', licenseUrl=source['sourceUrl'])
            status = '仅作参考 · 未接入行程'
            evidence = photo['identity']
        else:
            source = sources[key]
            record = curated.get(key)
            credit = record['attribution'].copy() if record else {field: source[field] for field in
                      ['source', 'photographer', 'sourceUrl', 'license', 'licenseUrl']}
            credit['source'] = 'Wikimedia Commons' if source['source'] == 'commons' else 'Pexels'
            status = ('已撤回精选' if record['review']['status'] == 'rejected' else '已有图库候选') if record else '本轮复看 · 未入图库'
            evidence = record['review']['evidence'] if record else source['evidence']
            file = ROOT / 'data/media' / record['key'] if record else BASE / 'full' / (key + '.jpg')
        for field in ['sourceUrl', 'licenseUrl']:
            assert urlparse(credit[field]).scheme == 'https', (key, field)
        with Image.open(file) as original:
            img = ImageOps.exif_transpose(original).convert('RGB')
            photo['inputSize'] = list(img.size)
            if photo.get('rotate'):
                assert photo['rotate'] == 90
                img = img.transpose(Image.Transpose.ROTATE_90)
            photo['width'], photo['height'] = img.size
            photo['orientation'] = '横版' if img.width > img.height else '竖版' if img.width < img.height else '方形'
            photo['ratio'] = ('16:9' if abs(img.width / img.height - 16 / 9) < .01 else
                              '3:2' if abs(img.width / img.height - 1.5) < .01 else
                              '4:3' if abs(img.width / img.height - 4 / 3) < .01 else
                              '2:3' if abs(img.width / img.height - 2 / 3) < .01 else f'{img.width}:{img.height}')
            dest = ASSETS / (key + '.webp')
            if file.suffix == '.webp' and not photo.get('rotate'):
                shutil.copyfile(file, dest)
            else:
                img.save(dest, 'WEBP', quality=93)
        photo.update(src='assets/landscape/' + dest.name, credit=credit, status=status, evidence=evidence,
                     sourceTitle=source['title'], sourceSize=[source.get('width'), source.get('height')])

payload = json.dumps(plan, ensure_ascii=False).replace('<', '\\u003c')
template = (RESEARCH / 'landscape-comparison.html').read_text('utf-8')
(OUT / 'landscape.html').write_text(template.replace('__PHOTO_DATA__', payload), 'utf-8')
print(json.dumps(dict(page=str(OUT / 'landscape.html'), places=len(plan['places']),
                     photos=sum(len(p['photos']) for p in plan['places'])), ensure_ascii=False))
