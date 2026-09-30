import hashlib
import html
import json
from pathlib import Path
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[4]
BASE = ROOT / 'data/photo-pilot/beijing'
decisions = json.loads(Path(__file__).with_name('beijing-selections.json').read_text('utf-8'))
candidates = json.loads((BASE / 'candidates.json').read_text('utf-8'))['candidates']
media = ROOT / 'data/media/photography'
library = dict(version=1, city='北京', places=[])
provenance = []
for choice in decisions['places']:
    place = dict(name=choice['name'], aliases=choice['aliases'], photos=[])
    for id, evidence, quality in choice['photos']:
        candidate = next(p for p in candidates if p['place'] == choice['name'] and p['id'] == id)
        source = BASE / candidate['preview']
        raw = source.read_bytes()
        img = ImageOps.exif_transpose(Image.open(source)).convert('RGB')
        # 两张既有Pexels竖图保留1300px图源版本，不插值放大；其他均为1600px以上来源。
        assert max(img.size) >= 1200 and min(img.size) >= 800, (id, img.size)
        img.thumbnail((1600,1600), Image.Resampling.LANCZOS)
        dest = media / (id + '.webp')
        img.save(dest, 'WEBP', quality=88, method=6)
        digest = hashlib.sha256(dest.read_bytes()).hexdigest()
        credit = {k: html.unescape(candidate[k]) for k in ['source','photographer','sourceUrl','license','licenseUrl']}
        credit['changes'] = '已等比缩放并转为WebP，未裁切'
        review = dict(status='approved', identity='verified', reviewer=decisions['reviewer'], reviewedAt=decisions['reviewedAt'], evidence=evidence, quality=quality)
        place['photos'].append(dict(id=id,key=f'photography/{id}.webp',sha256=digest,attribution=credit,review=review))
        provenance.append({**{k:candidate[k] for k in ['id','title','sourceUrl','imageUrl']}, 'sourceSha256':hashlib.sha256(raw).hexdigest(),
                           'outputSha256':digest,'outputSize':list(img.size),'outputBytes':dest.stat().st_size})
    library['places'].append(place)
catalog = ROOT / 'apps/server/src/data/photography'
(catalog / 'beijing-curated.json').write_text(json.dumps(library,ensure_ascii=False,indent=2)+'\n','utf-8')
(catalog / 'beijing-provenance.json').write_text(json.dumps(provenance,ensure_ascii=False,indent=2)+'\n','utf-8')
print(json.dumps({'places':sum(bool(p['photos']) for p in library['places']),'photos':len(provenance)},ensure_ascii=False))
