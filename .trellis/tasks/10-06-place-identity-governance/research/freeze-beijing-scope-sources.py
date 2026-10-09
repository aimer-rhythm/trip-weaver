"""只读冻结北京范围混淆的完整来源、图片与下游状态；不生成治理决定。"""
from pathlib import Path
import asyncio
from datetime import datetime, timezone
import hashlib
import json
import sys
import time

sys.dont_write_bytecode = True
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, 'D:/Project/xhs-travel-pipeline')
from dotenv import dotenv_values
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import create_async_engine
from app.db import SessionFactory, engine
from app.models import CanonicalPlace, PlaceEntityReview
from app.aggregate.mention_identity import load_mention_catalog, load_mention_rows, source_input, source_keys
from app.aggregate.image_identity import load_image_rows
from app.clean.mention_identity import mention_fingerprint, source_fingerprint, scope_matches
from app.clean.image_identity import image_fingerprint

ROOT = Path(__file__).resolve().parent
WORKSPACE = ROOT.parents[3]


def safe_url(value):
    from urllib.parse import urlsplit, urlunsplit
    url = urlsplit(value or '')
    return urlunsplit((url.scheme, url.netloc, url.path, '', ''))


async def main():
    config = dotenv_values(WORKSPACE / 'apps/server/.env')
    database_url = config['DATABASE_URL'].replace('postgres:', 'postgresql+asyncpg:', 1).replace('postgresql:', 'postgresql+asyncpg:', 1)
    downstream = create_async_engine(database_url)
    try:
        async with SessionFactory() as session, downstream.connect() as down:
            await session.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            await session.execute(text("SET LOCAL statement_timeout='30s'"))
            await down.execute(text('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            await down.execute(text("SET LOCAL statement_timeout='30s'"))
            city = '北京'
            catalog = await load_mention_catalog(session, city)
            sources = (await session.scalars(select(CanonicalPlace).where(CanonicalPlace.city == city)
                .order_by(CanonicalPlace.id))).all()
            mentions = await load_mention_rows(session, city)
            images = await load_image_rows(session, city)
            reviews = (await session.scalars(select(PlaceEntityReview).where(PlaceEntityReview.city == city)
                .order_by(PlaceEntityReview.id))).all()
            groups = []
            for label, anchors, keywords, legacy_ids in [
                ('西海湿地与什刹海', [668], ['什刹海', '后海', '前海', '西海'],
                 ['770c2fad56e7d878820a282f8632e72d', 'cb7d1579c76f7cc2fcaef84a9d09b1fe']),
                ('鼓楼与钟楼组合', [2419, 662], ['钟楼', '鼓楼'], ['1e08c9d3a956b6858dc5f77f0998e79d']),
            ]:
                selected = [p for p in sources if p.id in anchors]
                assert len(selected) == len(anchors)
                keys = {key for p in selected for key in source_keys(p)}
                while True:
                    expanded = [p for p in sources if keys & source_keys(p)]
                    expanded_keys = {key for p in expanded for key in source_keys(p)}
                    if expanded_keys == keys:
                        selected = expanded
                        break
                    keys |= expanded_keys
                related = [p for p in sources if any(k in p.name or k in p.normalized_name for k in keywords)]
                def freeze(p):
                    return {**source_input(p), 'sourceHash': source_fingerprint(source_input(p)),
                        'entity': catalog.catalog.resolve(place_id=p.id),
                        **{k: getattr(p, k) for k in ('address', 'latitude', 'longitude', 'amap_poi_id',
                            'place_type', 'geo_status', 'is_active', 'content_profile', 'theme_tags')}}
                rows = [r for r in mentions if scope_matches({'city': city, 'name_keys': keys}, r)]
                context = [r for r in mentions if any(k in (r.get('name') or '') or k in (r.get('normalized_name') or '') for k in keywords)]
                note_ids = {r['raw_note_id'] for r in [*rows, *context]}
                source_ids = {p.id for p in [*selected, *related]}
                photos = [r for r in images if r['source_place_id'] in source_ids or r['raw_note_id'] in note_ids]
                entity_ids = {(catalog.catalog.resolve(place_id=p.id) or {}).get('entity_id') for p in [*selected, *related]}
                def freeze_mention(r):
                    return {**r, 'source_url': safe_url(r.get('source_url')), 'inputHash': mention_fingerprint(r),
                        'currentResolution': catalog.resolve(r)}
                groups.append({'label': label, 'city': city, 'anchorIds': anchors, 'sourceKeys': sorted(keys),
                    'sources': [freeze(p) for p in selected], 'relatedSources': [freeze(p) for p in related],
                    'mentions': [freeze_mention(r) for r in rows], 'contextMentions': [freeze_mention(r) for r in context],
                    'images': [{**r, 'inputHash': image_fingerprint(r)} for r in photos],
                    'legacyIds': legacy_ids,
                    'reviews': [{'id': r.id, 'fingerprint': r.fingerprint, 'status': r.status, 'detail': r.detail}
                        for r in reviews if entity_ids & set(r.detail.get('entityIds', []))]})
            # 保存整个城市知识状态，避免只冻结当前候选而漏掉旧ID/同名独立行；不读取用户行程内容。
            stored = (await down.execute(text('SELECT id,city,name,category,source,verified,lat,lng,payload, '
                'embedding IS NOT NULL AS has_embedding FROM canonical_places WHERE city=:city ORDER BY id'), {'city': city})).mappings().all()
            relations = (await down.execute(text('SELECT * FROM place_relation_snapshots WHERE city=:city'), {'city': city})).mappings().all()
            bindings = (await down.execute(text('SELECT * FROM independent_photo_assignments WHERE city=:city ORDER BY image_key'), {'city': city})).mappings().all()
            trips = (await down.execute(text("SELECT count(*) AS count, md5(string_agg(row_to_json(t)::text, '' ORDER BY id)) AS hash FROM trips t"))).mappings().one()
            result = {'readOnly': True, 'capturedAt': datetime.now(timezone.utc).isoformat(), 'groups': groups,
                'existingScopes': list(catalog.scopes.values()), 'downstream': {'places': [dict(r) for r in stored],
                'relationSnapshots': [dict(r) for r in relations], 'independentPhotos': [dict(r) for r in bindings],
                'tripsDigest': dict(trips)}}
            file = ROOT / f'beijing-scope-sources-{time.time_ns()}.json'
            content = json.dumps(result, ensure_ascii=False, indent=2, default=str)
            with file.open('x', encoding='utf-8', newline='\n') as stream:
                stream.write(content)
            print(json.dumps({'file': file.name, 'sha256': hashlib.sha256(content.encode()).hexdigest(),
                'groups': [{'label': g['label'], 'sources': len(g['sources']), 'relatedSources': len(g['relatedSources']),
                    'mentions': len(g['mentions']), 'contextMentions': len(g['contextMentions']), 'images': len(g['images'])} for g in groups],
                'downstreamPlaces': len(stored), 'independentPhotos': len(bindings), 'trips': dict(trips)}, ensure_ascii=False))
    finally:
        await downstream.dispose()
        await engine.dispose()


asyncio.run(main())
