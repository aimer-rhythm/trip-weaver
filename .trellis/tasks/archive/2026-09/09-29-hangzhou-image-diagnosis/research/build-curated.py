"""固化人工选片、下载源哈希和可复查的本地 WebP；不批准搜索结果。"""
import hashlib
import html
import json
from pathlib import Path
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[4]
BASE = ROOT / 'data/photo-pilot'
DECISIONS = json.loads(Path(__file__).with_name('curated-decisions.json').read_text('utf-8'))
FEEDBACK = json.loads(Path(__file__).with_name('photo-style-feedback.json').read_text('utf-8'))
TARGETS = json.loads((ROOT / 'apps/server/src/data/photography/hangzhou-targets.json').read_text('utf-8'))
CANDIDATES = json.loads((BASE / 'candidates.json').read_text('utf-8'))
MEDIA = ROOT / 'data/media/photography'
MEDIA.mkdir(exist_ok=True, parents=True)
library = {'version': 1, 'city': '杭州', 'places': []}
provenance = []
for target in TARGETS:
    place = {'name': target['name'], 'aliases': target['aliases'], 'photos': []}
    for id, evidence, quality in DECISIONS['places'][target['name']]:
        candidate = next(p for p in CANDIDATES if p['id'] == id and p['place'] == target['name'])
        candidate = {**candidate, 'imageUrl': DECISIONS.get('sourceOverrides', {}).get(id, candidate['imageUrl'])}
        source = BASE / ('full' if candidate['source'] == 'pexels' else 'previews') / (id + '.jpg')
        raw = source.read_bytes()
        image = ImageOps.exif_transpose(Image.open(source)).convert('RGB')
        assert max(image.size) >= 1400 and min(image.size) >= 800, (id, image.size)
        image.thumbnail((1600, 1600), Image.Resampling.LANCZOS)
        destination = MEDIA / (id + '.webp')
        image.save(destination, 'WEBP', quality=88, method=6)
        license_url = candidate['licenseUrl']
        # Commons 的 CC0 历史元数据为 HTTP；同一权威资源规范化为 HTTPS。
        if license_url.startswith('http://creativecommons.org/'):
            license_url = 'https://' + license_url[len('http://'):]
        photo = {
            'id': id, 'key': f'photography/{id}.webp',
            'sha256': hashlib.sha256(destination.read_bytes()).hexdigest(),
            'attribution': {
                'source': candidate['source'], 'photographer': html.unescape(candidate['photographer']),
                'sourceUrl': candidate['sourceUrl'], 'license': candidate['license'],
                'licenseUrl': license_url, 'changes': '已调整尺寸与裁切',
            },
            'review': {
                'status': 'rejected' if id in FEEDBACK['withdrawn'] else 'approved',
                'identity': 'verified', 'reviewer': DECISIONS['reviewer'],
                'reviewedAt': FEEDBACK['reviewedAt'] if id in FEEDBACK['withdrawn'] else DECISIONS['reviewedAt'],
                'evidence': evidence, 'quality': FEEDBACK['withdrawn'].get(id, quality),
            },
        }
        place['photos'].append(photo)
        provenance.append({**candidate, 'sourceSha256': hashlib.sha256(raw).hexdigest(),
                           'sourceFile': str(source.relative_to(ROOT)),
                           'outputSha256': photo['sha256'], 'outputSize': list(image.size),
                           'outputBytes': destination.stat().st_size, 'review': photo['review']})
    library['places'].append(place)
(ROOT / 'apps/server/src/data/photography/hangzhou-curated.json').write_text(json.dumps(library, ensure_ascii=False, indent=2) + '\n', 'utf-8')
(BASE / 'provenance.json').write_text(json.dumps(provenance, ensure_ascii=False, indent=2) + '\n', 'utf-8')
# 随代码保留可复现的来源与转换参数；完整上游描述仍只留本地审阅目录。
sources = [{k: p[k] for k in ['id', 'title', 'sourceUrl', 'imageUrl', 'sourceSha256', 'outputSha256', 'outputSize', 'outputBytes']} for p in provenance]
(ROOT / 'apps/server/src/data/photography/hangzhou-provenance.json').write_text(json.dumps(sources, ensure_ascii=False, indent=2) + '\n', 'utf-8')
print(json.dumps({'places': sum(any(photo['review']['status'] == 'approved' for photo in p['photos']) for p in library['places']),
                  'approvedPhotos': sum(p['review']['status'] == 'approved' for p in provenance), 'catalogPhotos': len(provenance),
                  'bytes': sum(p['outputBytes'] for p in provenance)}, ensure_ascii=False))
