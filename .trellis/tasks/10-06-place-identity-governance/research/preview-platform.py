"""第41批真实正文隔离预演；验证平台身份、细分类、原源不变、幂等与倒序回滚。"""
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
from app.aggregate.place_identity import ENTITY_FIELDS, apply_decision, load_catalog, rollback_decision
from app.aggregate.mention_identity import apply_scope_decision, load_mention_rows, load_mention_catalog
from app.clean.mention_identity import MENTION_FIELDS, mention_fingerprint
from scripts import export_to_tripweaver as exporter

root = Path(__file__).resolve().parent
read = lambda f: json.loads((root/f).read_text(encoding='utf-8'))
assert hashlib.sha256((root/'all-cities/batch-41-source.json').read_bytes()).hexdigest() == '3057bcbe346a412949cda3ffad1845f96a2d52bb0060988a31d9e25b95fb695b'
frozen = read('all-cities/batch-41-source.json')
scopes = read('all-cities/batch-41-scope-decisions.json')
decisions = read('all-cities/batch-41-decisions.json')
g = frozen['groups'][0]
eid = g['entity']['entity_id']

async def main():
    url = os.environ['IDENTITY_TEST_DATABASE_URL']
    assert re.fullmatch(r'postgresql\+asyncpg://postgres@127\.0\.0\.1:18798/place_identity_test_\d+', url)
    engine = create_async_engine(url)
    factory = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)
    folder = root/'all-cities/batch-41'/f'scope-preview-{time.time_ns()}'
    folder.mkdir(parents=True, exist_ok=False)
    try:
        async with engine.begin() as conn: await conn.run_sync(Base.metadata.create_all)
        async with factory() as session:
            for n in frozen['notes']:
                m = next(m for m in g['mentions'] if m['raw_note_id'] == n['id'])
                session.add(RawNote(id=n['id'], note_id=f"frozen-{n['id']}", city=n['note_city'], keyword='实城冻结',
                    title=n['note_title'], desc=n['note_desc'], img_analysis=n['note_images'], source_url=m['source_url'], status='EXTRACTED'))
            await session.flush()
            await session.execute(insert(CanonicalPlace).values(**g['source'], **g['derivedBefore']))
            await session.execute(insert(PlaceEntity).values(**{k:g['entity'][k] for k in ENTITY_FIELDS}))
            await session.execute(insert(PlaceEntityMember).values(place_id=g['source']['id'], entity_id=eid))
            session.add(PlaceSummary(**g['summary']))
            for m in g['mentions']: session.add(PlaceMention(**{k:m[k] for k in MENTION_FIELDS}))
            await session.commit()
        async with factory() as session:
            originals = copy.deepcopy(await load_mention_rows(session, '济南'))
            assert {m['id']:mention_fingerprint(m) for m in originals} == {a['mentionId']:a['inputHash'] for d in scopes for a in d['assignments']}
            before = await load_catalog(session, '济南')
            for d in scopes:
                result = await apply_scope_decision(session, d)
                assert result == await apply_scope_decision(session, d)
            for d in decisions:
                result = await apply_decision(session, d)
                assert result == await apply_decision(session, d)
            catalog = await load_mention_catalog(session, '济南')
            assert len(catalog.assignments) == 1 and len(catalog.catalog.entities) == 1
            assert catalog.resolve(originals[0])['status'] == 'resolved'
            assert catalog.catalog.resolve('尚泉尚水茶馆') is None
            assert catalog.catalog.resolve('尚泉尚水茶馆前平台')['entity_id'] == eid
            assert catalog.catalog.resolve(place_id=5945)['entity_id'] == eid
            assert originals == await load_mention_rows(session, '济南')
            assert not (await session.scalars(select(PlaceEntityReview))).all()
            await session.commit()
        exporter.SessionFactory = factory
        output = folder/'xhs-places-济南.json'
        sys.argv = ['export_to_tripweaver.py', '--city', '济南', '--out', str(output)]
        await exporter.main()
        exported = json.loads(output.read_text(encoding='utf-8'))
        assert len(exported['places']) == 1
        p = exported['places'][0]
        assert p['id'] == eid and p['name'] == '尚泉尚水茶馆前平台' and p['verified'] is True
        assert p['category'] == '自然' and p['payload']['xhsPlaceType'] == 'photo_spot'
        assert p['payload']['identity']['revision'] == 4 and eid in p['payload']['identity']['memberIds']
        assert p['payload']['aliases'] == ['尚泉尚水茶馆前平台']
        assert p['payload']['identity']['memberNames'] == ['尚泉尚水茶馆前平台']
        assert [m['mentionId'] for m in p['payload']['mentionSources']] == [12653]
        assert p['payload']['mentionCount'] == 1 and 'identityWithdrawal' not in p['payload']
        assert p['payload'].get('typicalVisitMinutes') is None
        assert p['payload']['imageIdentity']['approved'] == []
        assert p['lat'] is None and p['lng'] is None and p['payload']['geoStatus'] == 'unresolvable'
        assert p['payload']['topReasons'] == ['前面平台可拍摄湖面与楼阁全景']
        assert '前面平台可拍摄湖面与楼阁全景' in json.dumps(p['payload']['content'], ensure_ascii=False)
        async with factory() as session:
            for d in reversed([*scopes, *decisions]): await rollback_decision(session, d['key'])
            after = await load_catalog(session, '济南')
            assert before.entities == after.entities and before.members == after.members
            assert originals == await load_mention_rows(session, '济南')
            catalog = await load_mention_catalog(session, '济南')
            assert not catalog.scopes and not catalog.assignments
            actual = await session.get(CanonicalPlace, g['source']['id'])
            expected = {**g['source'], **g['derivedBefore']}
            assert {k:getattr(actual, k) for k in expected} == expected
            await session.rollback()
        report = {'isolated':True, 'synthetic':False, 'partialCityReconstruction':True, 'batch':'batch-41',
            'sources':1, 'mentions':1, 'notes':1, 'pendingAdded':0, 'withdrawals':0, 'newEntities':0,
            'fineType':'photo_spot', 'bareCafeNameNotAlias':True, 'stableIdPreserved':True, 'coordinatesRemainNull':True,
            'validDescriptionPreserved':True, 'idempotent':True, 'reverseRollback':True,
            'originalMentionsUnchanged':True, 'originalSourcesUnchanged':True,
            'imageComparison':'deferred_by_user', 'fullReviewPassed':False, 'failures':[]}
        with (folder/'report.json').open('x', encoding='utf-8') as out: json.dump(report, out, ensure_ascii=False, indent=2)
        print(json.dumps({'folder':str(folder.relative_to(root)), **report}, ensure_ascii=False))
    finally: await engine.dispose()

asyncio.run(main())
