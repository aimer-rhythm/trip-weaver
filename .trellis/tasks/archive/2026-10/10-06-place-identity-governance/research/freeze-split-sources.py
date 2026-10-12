"""只读冻结有明确分店名但混在旧泛名来源下的原文；不生成或应用决定。"""
from pathlib import Path
import asyncio
import argparse
from datetime import datetime, timezone
import json
import sys
import time
sys.dont_write_bytecode = True
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, 'D:/Project/xhs-travel-pipeline')
from sqlalchemy import select, text
from app.db import SessionFactory, engine
from app.models import CanonicalPlace, PlaceEntityReview
from app.aggregate.mention_identity import load_mention_catalog, load_mention_rows, source_input, source_keys
from app.aggregate.image_identity import load_image_rows
from app.clean.mention_identity import MENTION_FIELDS, NOTE_FIELDS, mention_fingerprint, source_fingerprint, scope_matches
from app.clean.image_identity import image_fingerprint

root = Path(__file__).resolve().parent


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--aihua-related', action='store_true')
    args = parser.parse_args()
    try:
        async with SessionFactory() as session:
            await session.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            await session.execute(text("SET LOCAL statement_timeout='30s'"))
            groups = []
            groups_to_read = [('西安', 5542, '爱骅')] if args.aihua_related else [('北京', 654, '方砖厂'), ('西安', 5627, '爱骅')]
            for city, source_id, keyword in groups_to_read:
                catalog = await load_mention_catalog(session, city)
                all_sources = (await session.scalars(select(CanonicalPlace).where(CanonicalPlace.city == city)
                    .order_by(CanonicalPlace.id))).all()
                anchor = next(p for p in all_sources if p.id == source_id)
                keys = source_keys(anchor)
                selected = [p for p in all_sources if keys & source_keys(p)]
                related = [p for p in all_sources if keyword in p.name or keyword in p.normalized_name]
                if args.aihua_related:
                    selected = related
                    keys = {key for p in selected for key in source_keys(p)}
                def freeze(p):
                    return {**source_input(p), 'sourceHash': source_fingerprint(source_input(p)),
                        'entity': catalog.catalog.resolve(place_id=p.id), 'address': p.address, 'latitude': p.latitude,
                        'longitude': p.longitude, 'place_type': p.place_type, 'geo_status': p.geo_status, 'is_active': p.is_active}
                rows = [r for r in await load_mention_rows(session, city) if scope_matches({'city': city, 'name_keys': keys}, r)]
                notes = {r['raw_note_id'] for r in rows}
                images = [r for r in await load_image_rows(session, city)
                          if r['source_place_id'] in {p.id for p in selected} or r['raw_note_id'] in notes]
                related_ids = {(catalog.catalog.resolve(place_id=p.id) or {}).get('entity_id') for p in related}
                reviews = (await session.scalars(select(PlaceEntityReview).where(PlaceEntityReview.city == city)
                    .order_by(PlaceEntityReview.id))).all()
                groups.append({'city': city, 'anchorId': source_id, 'sources': [freeze(p) for p in selected],
                    'relatedSources': [freeze(p) for p in related], 'existingScopes': list(catalog.scopes.values()),
                    'mentions': [{**{k: r.get(k) for k in (*MENTION_FIELDS, *NOTE_FIELDS)}, 'inputHash': mention_fingerprint(r)} for r in rows],
                    'images': [{**r, 'inputHash': image_fingerprint(r)} for r in images],
                    'reviews': [{'id': r.id, 'fingerprint': r.fingerprint, 'status': r.status, 'detail': r.detail}
                                for r in reviews if related_ids & set(r.detail.get('entityIds', []))]})
            file = root/f'split-sources-{time.time_ns()}.json'
            with file.open('x', encoding='utf-8') as stream:
                json.dump({'readOnly': True, 'capturedAt': datetime.now(timezone.utc).isoformat(), 'groups': groups},
                          stream, ensure_ascii=False, indent=2)
            print(json.dumps({'file': file.name, 'groups': [{'city': g['city'], 'sources': len(g['sources']),
                'relatedSources': len(g['relatedSources']), 'mentions': len(g['mentions']), 'images': len(g['images'])} for g in groups]}, ensure_ascii=False))
    finally:
        await engine.dispose()


asyncio.run(main())
