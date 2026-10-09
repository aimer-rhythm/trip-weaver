"""只读冻结459的现行来源、逐提及指纹和图片目录；不生成或应用治理请求。"""
from pathlib import Path
import asyncio
import hashlib
import json
import sys
import time
sys.dont_write_bytecode = True
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, 'D:/Project/xhs-travel-pipeline')
from sqlalchemy import func, select, text
from app.db import SessionFactory, engine
from app.aggregate.mention_identity import load_mention_catalog, load_mention_rows
from app.clean.mention_identity import MENTION_FIELDS, NOTE_FIELDS, mention_fingerprint, source_fingerprint, scope_matches
from app.clean.identity import name_key
from app.models import CanonicalPlace, NoteImage, PlaceEntityReview, PlaceIdentityScope, PlaceMentionAssignment, PlaceImageAssignment
from app.photography.store import PhotoStore

root = Path(__file__).resolve().parent
upstream = Path('D:/Project/xhs-travel-pipeline')

async def main():
    async with SessionFactory() as session:
        await session.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
        city = '重庆'
        catalog = await load_mention_catalog(session, city)
        sources = (await session.scalars(select(CanonicalPlace).where(CanonicalPlace.id.in_([176, 215]))
            .order_by(CanonicalPlace.id))).all()
        assert len(sources) == 2 and all(p.city == city for p in sources)
        keys = {name_key(n) for p in sources for n in [p.name, p.normalized_name]}
        rows = [row for row in await load_mention_rows(session, city)
                if scope_matches({'city': city, 'name_keys': keys}, row)]
        notes = {row['raw_note_id'] for row in rows}
        photos = (await session.scalars(select(NoteImage).where(NoteImage.city == city,
            (NoteImage.canonical_place_id.in_([176, 215])) | (NoteImage.raw_note_id.in_(notes)))
            .order_by(NoteImage.id))).all()
        images = []
        for photo in photos:
            item = {key: getattr(photo, key) for key in ['id', 'raw_note_id', 'img_index', 'canonical_place_id', 'img_type', 'assignment', 'file_path']}
            path = (upstream / photo.file_path).resolve()
            item['sha256'] = hashlib.sha256(path.read_bytes()).hexdigest() if path.is_relative_to(upstream) and path.is_file() else None
            images.append(item)
        review = await session.get(PlaceEntityReview, 459)
        counts = {model.__tablename__: await session.scalar(select(func.count()).select_from(model))
                  for model in [PlaceIdentityScope, PlaceMentionAssignment, PlaceImageAssignment]}
        selected_file = PhotoStore(upstream / 'data' / 'photography', city).path('selected.json')
        curated = []
        selected_hash = None
        if selected_file.exists():
            raw = selected_file.read_bytes()
            selected_hash = hashlib.sha256(raw).hexdigest()
            selected = json.loads(raw)
            assert selected['city'] == city
            curated = [item for group in selected['places'].values() for item in group['images'] if item['place_id'] in [176, 215]]
            assert hashlib.sha256(selected_file.read_bytes()).hexdigest() == selected_hash
        report = {'readOnly': True, 'city': city, 'review': {'id': review.id, 'fingerprint': review.fingerprint, 'status': review.status, 'detail': review.detail},
            'curatedImages': curated, 'curatedManifestHash': selected_hash,
            'scopeTableCounts': counts, 'sources': [], 'mentions': [], 'images': images}
        for source in sources:
            row = {k: getattr(source, k) for k in ['id', 'city', 'name', 'normalized_name', 'is_active', 'geo_status',
                'longitude', 'latitude', 'address', 'place_type']}
            report['sources'].append({**row, 'sourceHash': source_fingerprint(row), 'entity': catalog.catalog.resolve(place_id=source.id)})
        for row in rows:
            report['mentions'].append({**{key: row.get(key) for key in (*MENTION_FIELDS, *NOTE_FIELDS)}, 'inputHash': mention_fingerprint(row)})
        file = root / f'scope-source-459-{time.time_ns()}.json'
        with file.open('x', encoding='utf-8') as stream:
            json.dump(report, stream, ensure_ascii=False, indent=2)
        print(json.dumps({'file': file.name, 'scopeTableCounts': counts, 'sources': [p.id for p in sources],
            'mentions': [{'id': row['id'], 'noteId': row['raw_note_id'], 'name': row['name'],
                          'reason': row['reason'], 'evidence': row['evidence_text']} for row in rows],
            'images': len(images), 'curatedImages': len(curated)}, ensure_ascii=False))
    await engine.dispose()

asyncio.run(main())
