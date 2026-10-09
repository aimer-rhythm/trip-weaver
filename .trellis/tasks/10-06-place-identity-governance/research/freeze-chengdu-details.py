"""补充成都固定范围原始日期、分析形态及派生基线；只读，不查看或下载图片。"""
from pathlib import Path
from datetime import datetime, timezone
import asyncio, hashlib, json, sys
sys.dont_write_bytecode = True
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, 'D:/Project/xhs-travel-pipeline')
from sqlalchemy import select, text
from app.db import SessionFactory, engine
from app.models import CanonicalPlace, PlaceSummary, RawNote
from app.aggregate.mention_identity import load_mention_catalog, load_mention_rows, source_input
from app.clean.mention_identity import mention_fingerprint, source_fingerprint
root = Path(__file__).resolve().parent
folder = root / 'priority-cities/成都/run-1791504271958861000'
def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
async def main():
    target = folder / 'details.json'
    assert not target.exists()
    source_bytes = (folder / 'sources.json').read_bytes()
    assert hashlib.sha256(source_bytes).hexdigest() == 'bce267716acbb85759556b8ab51a868d1e32128a8556c66de0b69a39914ffd53'
    frozen = json.loads(source_bytes)
    try:
        async with SessionFactory() as session:
            await session.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            catalog = await load_mention_catalog(session, '成都')
            rows = await load_mention_rows(session, '成都')
            ids = {m['id'] for m in frozen['mentions']}
            mentions = [{**m, 'inputHash': mention_fingerprint(m)} for m in rows if m['id'] in ids]
            assert {m['id']: m['inputHash'] for m in mentions} == {m['id']: m['inputHash'] for m in frozen['mentions']}
            sources = []
            for p in (await session.scalars(select(CanonicalPlace).where(CanonicalPlace.id.in_([s['id'] for s in frozen['sources']])).order_by(CanonicalPlace.id))).all():
                original = next(s for s in frozen['sources'] if s['id'] == p.id)
                assert source_fingerprint(source_input(p)) == original['sourceHash']
                summary = await session.scalar(select(PlaceSummary).where(PlaceSummary.canonical_place_id == p.id))
                fields = ['id', 'city', 'name', 'normalized_name', 'address', 'latitude', 'longitude', 'place_type', 'geo_status', 'amap_poi_id', 'is_active', 'quality_score']
                source = {k: getattr(p, k) for k in fields}
                assert source == {k: original[k] for k in fields}
                sources.append({'source': source, 'sourceHash': original['sourceHash'],
                    'derivedBefore': {k: getattr(p, k) for k in ['typical_visit_minutes', 'typical_visit_source', 'theme_tags', 'content_profile']},
                    'supplement': {'adcode': p.adcode},
                    'summary': {k: getattr(summary, k) for k in ['canonical_place_id', 'mention_count_30d', 'recommend_score', 'top_reasons']} if summary else None})
            notes = []
            for n in (await session.scalars(select(RawNote).where(RawNote.id.in_([n['id'] for n in frozen['notes']])).order_by(RawNote.id))).all():
                old = next(v for v in frozen['notes'] if v['id'] == n.id)
                assert (n.city, n.title, n.desc, n.img_analysis) == (old['note_city'], old['note_title'], old['note_desc'], old['note_images'])
                notes.append({'id': n.id, 'city': n.city, 'title': n.title, 'desc': n.desc, 'images': n.img_analysis,
                    'status': n.status, 'sourceUrl': n.source_url, 'publishedAt': n.publish_time.isoformat() if n.publish_time else None,
                    'observedAt': n.created_at.isoformat(), 'analysisSha256': digest(n.img_analysis), 'rawJsonSha256': digest(n.raw_json),
                    'rawNotePublishedMilliseconds': (n.raw_json or {}).get('note_card', {}).get('time')})
            assert len(sources) == 127 and len(mentions) == 490 and len(notes) == 85
            for g in frozen['groups']:
                assert catalog.catalog.entities[g['entity']['entity_id']] == g['entity']
            source_ids = {s['source']['id'] for s in sources}
            root_ids = {g['entity']['entity_id'] for g in frozen['groups']}
            history = [e for eid, e in catalog.catalog.entities.items() if (catalog.catalog.root(eid) or {}).get('entity_id') in root_ids]
            payload = {'readOnly': True, 'city': '成都', 'entityBatch': 65, 'capturedAt': datetime.now(timezone.utc).isoformat(),
                'originalFile': str((folder/'sources.json').relative_to(root)), 'originalSha256': hashlib.sha256(source_bytes).hexdigest(),
                'sources': sources, 'mentions': mentions, 'noteDetails': notes,
                'catalog': {'entities': history, 'members': [{'place_id': pid, 'entity_id': eid} for pid, eid in catalog.catalog.members.items() if pid in source_ids],
                    'reviews': frozen['reviews']},
                'imageComparison': 'deferred_by_user', 'imagesViewed': 0, 'businessMutations': False}
            with target.open('x', encoding='utf-8') as handle:
                json.dump(payload, handle, ensure_ascii=False, indent=2)
            print(json.dumps({'file': str(target.relative_to(root)), 'sha256': hashlib.sha256(target.read_bytes()).hexdigest(),
                'sources': len(sources), 'mentions': len(mentions), 'notes': len(notes), 'nullAnalysisNotes': sum(n['images'] is None for n in notes)}, ensure_ascii=False))
    finally:
        await engine.dispose()
asyncio.run(main())
