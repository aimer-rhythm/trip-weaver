"""精选顺序导出；内容哈希文件名保留历史图片，附模型审核和原始来源。"""
from __future__ import annotations

import hashlib
import io
from pathlib import Path
from PIL import Image, ImageOps
from app.photography.store import PhotoStore


def export_selected(city: str, root: Path, media_root: Path, *, dry_run: bool = False,
                    allowed_names: set[str] | None = None, catalog=None) -> list[dict]:
    store = PhotoStore(root, city)
    if not store.path('selected.json').exists():
        return []
    entries = []
    with store.locked():
        selected = store.read('selected.json')
        if selected['city'] != city:
            raise ValueError('精选城市与导出城市不一致')
        for group in selected['places'].values():
            place = group['place']
            if allowed_names is not None and place['name'] not in allowed_names:
                continue
            pid = hashlib.sha256(f'{city}{place["name"]}'.encode()).hexdigest()[:32]
            if catalog is not None:
                entity = catalog.resolve(place_id=place['id'])
                if not entity or entity['status'] != 'ACTIVE':
                    continue
                pid = entity['entity_id']
            for item in group['images'][:3]:
                if item['review'].get('status') != 'eligible' or item['place_id'] != place['id']:
                    continue
                try:
                    content = store.path(item['file']).read_bytes()
                    if hashlib.sha256(content).hexdigest() != item['sha256']:
                        continue
                    with Image.open(io.BytesIO(content)) as image:
                        rgb = ImageOps.exif_transpose(image).convert('RGB')
                        rgb.thumbnail((1600, 1600), Image.Resampling.LANCZOS)
                        encoded = io.BytesIO()
                        rgb.save(encoded, 'WEBP', quality=85, method=4)
                        width, height = rgb.size
                except (OSError, ValueError):
                    continue
                data = encoded.getvalue()
                digest = hashlib.sha256(data).hexdigest()
                key = f'xhs/photography/{pid}/{digest}.webp'
                if not dry_run:
                    destination = media_root / key
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    destination.write_bytes(data)
                entries.append({'placeId': pid, 'placeName': place['name'], 'key': key,
                    'width': width, 'height': height, 'bytes': len(data), 'sha256': digest,
                    'sourceSha256': item['sha256'], 'sourceUrl': item['source_url'],
                    'author': item['author'], 'authorId': item['author_id'], 'noteId': item['note_id'],
                    'imageIndex': item['image_index'], 'rights': item['rights'],
                    'reviewMethod': item['review_method'], 'model': item['model'],
                    'reviewVersion': item['review_version'], 'review': item['review']})
    return entries
