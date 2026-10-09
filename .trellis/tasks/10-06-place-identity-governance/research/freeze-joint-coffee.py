"""只读冻结两组咖啡饮品的完整来源、提及指纹和受影响图片；不产生治理决定。"""
from pathlib import Path
import asyncio
from datetime import datetime, timezone
import json
import sys
import time

sys.dont_write_bytecode = True
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, 'D:/Project/xhs-travel-pipeline')
from sqlalchemy import func, select, text
from app.db import SessionFactory, engine
from app.models import CanonicalPlace, PlaceEntityReview, PlaceIdentityScope, PlaceIdentityScopeSource, PlaceMentionAssignment
from app.aggregate.mention_identity import load_mention_catalog, load_mention_rows, source_input, source_keys
from app.aggregate.image_identity import load_image_rows
from app.clean.mention_identity import MENTION_FIELDS, NOTE_FIELDS, mention_fingerprint, source_fingerprint, scope_matches
from app.clean.image_identity import image_fingerprint

root = Path(__file__).resolve().parent


async def main():
    try:
        async with SessionFactory() as session:
            await session.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            await session.execute(text("SET LOCAL statement_timeout='30s'"))
            groups = []
            for city, requested_ids, review_id in [('厦门', [2720, 3213], 203), ('成都', [1716, 1821], 305)]:
                catalog = await load_mention_catalog(session, city)
                all_sources = (await session.scalars(select(CanonicalPlace).where(CanonicalPlace.city == city)
                    .order_by(CanonicalPlace.id))).all()
                selected = [p for p in all_sources if p.id in requested_ids]
                assert len(selected) == 2
                keys = {key for p in selected for key in source_keys(p)}
                sources = [p for p in all_sources if keys & source_keys(p)]
                source_ids = {p.id for p in sources}
                rows = [row for row in await load_mention_rows(session, city)
                        if scope_matches({'city': city, 'name_keys': keys}, row)]
                note_ids = {row['raw_note_id'] for row in rows}
                images = [row for row in await load_image_rows(session, city)
                          if row['source_place_id'] in source_ids or row['raw_note_id'] in note_ids]
                review = await session.get(PlaceEntityReview, review_id)
                groups.append({'city': city, 'requestedSourceIds': requested_ids, 'nameKeys': sorted(keys),
                    'sources': [{**source_input(p), 'sourceHash': source_fingerprint(source_input(p)),
                        'entity': catalog.catalog.resolve(place_id=p.id), 'address': p.address,
                        'latitude': p.latitude, 'longitude': p.longitude, 'place_type': p.place_type,
                        'geo_status': p.geo_status, 'is_active': p.is_active} for p in sources],
                    'mentions': [{**{key: row.get(key) for key in (*MENTION_FIELDS, *NOTE_FIELDS)},
                        'inputHash': mention_fingerprint(row)} for row in rows],
                    'images': [{**row, 'inputHash': image_fingerprint(row)} for row in images],
                    'existingScopes': list(catalog.scopes.values()),
                    'review': {'id': review.id, 'fingerprint': review.fingerprint, 'status': review.status, 'detail': review.detail}})
            counts = {model.__tablename__: await session.scalar(select(func.count()).select_from(model))
                      for model in [PlaceIdentityScope, PlaceIdentityScopeSource, PlaceMentionAssignment]}
            report = {'readOnly': True, 'capturedAt': datetime.now(timezone.utc).isoformat(), 'tableCounts': counts, 'groups': groups}
            file = root / f'joint-coffee-source-{time.time_ns()}.json'
            with file.open('x', encoding='utf-8') as stream:
                json.dump(report, stream, ensure_ascii=False, indent=2)
            print(json.dumps({'file': file.name, 'tableCounts': counts, 'groups': [{
                'city': group['city'], 'sourceIds': [s['id'] for s in group['sources']],
                'mentions': [{'id': m['id'], 'name': m['name'], 'noteId': m['raw_note_id']} for m in group['mentions']],
                'images': len(group['images']), 'existingScopes': len(group['existingScopes'])} for group in groups]}, ensure_ascii=False))
    finally:
        await engine.dispose()


asyncio.run(main())
