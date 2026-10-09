"""第36批真实四泉资料在专用库预演，保留四实体并清错误单点时长。"""
from pathlib import Path
import asyncio
import copy
import hashlib
import json
import os
import re
import sys
import time
sys.dont_write_bytecode = True
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, 'D:/Project/xhs-travel-pipeline')
from sqlalchemy import insert, select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from app.models import Base, CanonicalPlace, PlaceEntity, PlaceEntityMember, PlaceEntityReview, PlaceMention, PlaceSummary, RawNote
from app.aggregate.place_identity import ENTITY_FIELDS, load_catalog, rollback_decision
from app.aggregate.mention_identity import apply_scope_decision, load_mention_rows, load_mention_catalog
from app.aggregate.summary import mention_groups
from app.clean.mention_identity import MENTION_FIELDS, mention_fingerprint
from scripts import export_to_tripweaver as exporter
root = Path(__file__).resolve().parent
source = root / 'all-cities/batch-36-source.json'
assert hashlib.sha256(source.read_bytes()).hexdigest() == 'a190876abe15758195d146c395a0313f1e6619b2c422b11eb18a9d39359face6'
frozen = json.loads(source.read_bytes())
scopes = json.loads((root / 'all-cities/batch-36-scope-decisions.json').read_bytes())
packet = json.loads((root / 'priority-cities/济南/spring-source-packet-01.json').read_bytes())

async def main():
    db_url = os.environ['IDENTITY_TEST_DATABASE_URL']
    assert re.fullmatch(r'postgresql\+asyncpg://postgres@127\.0\.0\.1:18798/place_identity_test_\d+', db_url)
    engine = create_async_engine(db_url); factory = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)
    folder = root / 'all-cities/batch-36' / f'scope-preview-{time.time_ns()}'
    folder.mkdir(parents=True, exist_ok=False)
    try:
        async with engine.begin() as conn: await conn.run_sync(Base.metadata.create_all)
        async with factory() as session:
            for note in frozen['notes']:
                source_row = next(r for g in frozen['groups'] for r in g['mentions'] if r['raw_note_id'] == note['id'])
                session.add(RawNote(id=note['id'], note_id=f"frozen-{note['id']}", city='济南', keyword='真实冻结',
                    title=note['note_title'], desc=note['note_desc'], img_analysis=note['note_images'],
                    source_url=source_row['source_url'], status='EXTRACTED'))
            await session.flush()
            for g in frozen['groups']:
                old = next(p for p in packet['sources'] if p['id'] == g['source']['id'])
                assert old['typicalVisitMinutes'] == 30
                await session.execute(insert(CanonicalPlace).values(**g['source'], typical_visit_minutes=old['typicalVisitMinutes'],
                    typical_visit_source=old['typicalVisitSource'], theme_tags=old['themeTags']))
                await session.execute(insert(PlaceEntity).values(**{k: g['entity'][k] for k in ENTITY_FIELDS}))
                await session.execute(insert(PlaceEntityMember).values(place_id=g['source']['id'], entity_id=g['entity']['entity_id']))
                session.add(PlaceSummary(**g['summary']))
                for row in g['mentions']: session.add(PlaceMention(**{k: row[k] for k in MENTION_FIELDS}))
            await session.commit()
        async with factory() as session:
            originals = copy.deepcopy(await load_mention_rows(session, '济南'))
            assert {r['id']: mention_fingerprint(r) for r in originals} == {r['id']: r['inputHash'] for g in frozen['groups'] for r in g['mentions']}
            baseline = copy.deepcopy((await load_catalog(session, '济南')).entities)
            for d in scopes:
                after = await apply_scope_decision(session, d); assert after == await apply_scope_decision(session, d)
            catalog = await load_mention_catalog(session, '济南')
            assert len(catalog.assignments) == 11
            for row in originals:
                result = catalog.resolve(row)
                assert result['status'] == ('review' if row['id'] == 12692 else 'resolved')
                if row['id'] in {12941,12942,12943,12944}: assert result['factExclusions']['visit_duration']['reason'] == 'group_duration'
            groups = mention_groups('济南', catalog, originals)
            assert len(groups) == 4 and sum(g['mentions'] for g in groups.values()) == 10
            assert all(g['durations'] == [] for g in groups.values())
            pending = (await session.scalars(select(PlaceEntityReview).where(PlaceEntityReview.status == 'PENDING'))).all()
            assert [r.detail['mentionId'] for r in pending] == [12692]
            await session.commit()
        exporter.SessionFactory = factory
        file = folder / 'xhs-places-济南.json'
        sys.argv = ['export_to_tripweaver.py', '--city', '济南', '--out', str(file)]
        await exporter.main(); data = json.loads(file.read_bytes())
        assert len(data['places']) == 4 and all(p['verified'] for p in data['places'])
        for p in data['places']:
            g = next(g for g in frozen['groups'] if g['entity']['entity_id'] == p['id'])
            assert p['payload']['identity']['revision'] == 2 and p['category'] == '文化'
            assert 'typicalVisitMinutes' not in p['payload'] and 'identityWithdrawal' not in p['payload']
            assert p['payload']['mentionCount'] == len(g['mentions']) - (1 if p['name'] == '刘氏泉' else 0)
            assert (p['lat'], p['lng']) == (round(g['source']['latitude'], 6), round(g['source']['longitude'], 6))
            assert p['payload']['imageIdentity']['approved'] == []
            assert '簪花少女' not in json.dumps(p['payload']['content'], ensure_ascii=False)
        assert next(p for p in data['places'] if p['name'] == '起凤泉')['payload']['mentionCount'] == 1
        async with factory() as session:
            for d in reversed(scopes): await rollback_decision(session, d['key'])
            assert (await load_catalog(session, '济南')).entities == baseline
            assert await load_mention_rows(session, '济南') == originals
            assert not (await load_mention_catalog(session, '济南')).assignments
            assert not (await session.scalars(select(PlaceEntityReview))).all()
            for g in frozen['groups']:
                current = await session.get(CanonicalPlace, g['source']['id'])
                assert {k: getattr(current, k) for k in g['source']} == g['source']
                assert current.typical_visit_minutes == 30
        report = {'isolated': True, 'synthetic': False, 'partialCityReconstruction': True, 'batch': 'batch-36',
            'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(), 'sources': 4, 'mentions': 11,
            'resolved': 10, 'pending': [12692], 'durationFieldsExcluded': 4, 'withdrawals': 0, 'newEntities': 0,
            'idempotent': True, 'reverseRollback': True, 'originalMentionsUnchanged': True, 'originalSourcesUnchanged': True,
            'files': [{'city': '济南', 'file': file.name, 'sha256': hashlib.sha256(file.read_bytes()).hexdigest()}]}
        with (folder / 'report.json').open('x', encoding='utf-8') as out: json.dump(report, out, ensure_ascii=False, indent=2)
        print(json.dumps({'folder': str(folder.relative_to(root)), **report}, ensure_ascii=False))
    finally:
        await engine.dispose()

asyncio.run(main())
