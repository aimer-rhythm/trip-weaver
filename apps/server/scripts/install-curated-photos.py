"""校验精选媒体；--download 时根据已审核清单恢复缺失文件（需要 Pillow）。"""
import argparse
import hashlib
import io
import json
import re
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[3]
CATALOG = ROOT / 'apps/server/src/data/photography'
MEDIA = ROOT / 'data/media'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--download', action='store_true', help='下载已审核原图并重建 WebP，默认仅校验')
parser.add_argument('--city', choices=['hangzhou', 'beijing'], default='hangzhou', help='需要校验或恢复的城市，默认杭州')
args = parser.parse_args()
library = json.loads((CATALOG / f'{args.city}-curated.json').read_text('utf-8'))
origins = {p['id']: p for p in json.loads((CATALOG / f'{args.city}-provenance.json').read_text('utf-8'))}

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

opener = urllib.request.build_opener(NoRedirect)
failures = []
count = 0
skipped = 0
for place in library['places']:
    for photo in place['photos']:
        try:
            if photo['review']['status'] in ('pending', 'rejected'):
                skipped += 1
                continue
            id = photo['id']
            assert re.fullmatch(r'(pexels|commons)-[0-9]+', id), '无效图片ID'
            assert photo['key'] == f'photography/{id}.webp', '无效媒体路径'
            assert photo['review']['status'] == 'approved' and photo['review']['identity'] == 'verified', '未通过复核'
            target = MEDIA / photo['key']
            expected = photo['sha256']
            if target.is_file() and hashlib.sha256(target.read_bytes()).hexdigest() == expected:
                count += 1
                continue
            assert args.download, '缺少文件或哈希不匹配；可使用 --download 恢复'
            from PIL import Image, ImageOps
            origin = origins[id]
            url = urlparse(origin['imageUrl'])
            assert url.scheme == 'https' and url.hostname in ('images.pexels.com', 'upload.wikimedia.org', 'thumb.wikimedia.org'), '无效图源域名'
            assert not url.username and not url.password and not url.port, '无效图源URL'
            request = urllib.request.Request(origin['imageUrl'], headers={'User-Agent': 'TripweaverCuratedPhotos/1.0'})
            with opener.open(request, timeout=20) as response:
                assert response.headers.get_content_type().startswith('image/'), '不是图片响应'
                raw = response.read(8 * 1024 * 1024 + 1)
            assert len(raw) <= 8 * 1024 * 1024, '图源超过8MiB'
            assert hashlib.sha256(raw).hexdigest() == origin['sourceSha256'], '上游图片已变化，需重新审核'
            image = ImageOps.exif_transpose(Image.open(io.BytesIO(raw))).convert('RGB')
            image.thumbnail((1600, 1600), Image.Resampling.LANCZOS)
            result = io.BytesIO()
            image.save(result, 'WEBP', quality=88, method=6)
            output = result.getvalue()
            assert hashlib.sha256(output).hexdigest() == expected == origin['outputSha256'], '转换结果不同，检查 Pillow/libwebp 版本'
            target.parent.mkdir(parents=True, exist_ok=True)
            temporary = target.with_suffix('.webp.tmp')
            temporary.write_bytes(output)
            temporary.replace(target)
            count += 1
        except Exception as error:
            failures.append({'id': photo.get('id'), 'error': str(error)})
print(json.dumps({'verified': count, 'skippedUnapproved': skipped, 'failures': failures}, ensure_ascii=False))
raise SystemExit(bool(failures))
