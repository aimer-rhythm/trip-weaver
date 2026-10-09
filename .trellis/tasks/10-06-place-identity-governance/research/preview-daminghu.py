"""第42批真实大明湖三源隔离SQL、48确认/17待审、游船时长排除与回滚。"""
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
from app.clean.mention_identity import MENTION_FIELDS, mention_fingerprint, effective_fact_value
from scripts import export_to_tripweaver as exporter

root = Path(__file__).resolve().parent
def frozen_json(path, digest=None):
    file = root/path
    if digest: assert hashlib.sha256(file.read_bytes()).hexdigest() == digest
    return json.loads(file.read_text(encoding='utf-8'))
frozen = frozen_json('all-cities/batch-42-source.json', '664f8e94744dcaee0cbadcce22245323327f5cf9eea7d857a30377c5f90b8f22')
history = frozen_json('all-cities/batch-42-catalog.json', 'a500d36f2b543d89430c7b27e16cc473008e4fa802554ee66f18ba3a16b01345')
scopes = frozen_json('all-cities/batch-42-scope-decisions.json')
assert frozen_json('all-cities/batch-42-decisions.json') == []
eid = '550d6810857b4487aae8ce39c9ee093b'
expected = {a['mentionId']:a['entityId'] for d in scopes for a in d['assignments']}

async def main():
    url = os.environ['IDENTITY_TEST_DATABASE_URL']
    assert re.fullmatch(r'postgresql\+asyncpg://postgres@127\.0\.0\.1:18798/place_identity_test_\d+', url)
    engine = create_async_engine(url)
    factory = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)
    folder = root/'all-cities/batch-42'/f'scope-preview-{time.time_ns()}'
    folder.mkdir(parents=True, exist_ok=False)
    try:
        async with engine.begin() as conn: await conn.run_sync(Base.metadata.create_all)
        async with factory() as session:
            for n in frozen['notes']:
                m = next(m for m in frozen['mentions'] if m['raw_note_id'] == n['id'])
                session.add(RawNote(id=n['id'], note_id=f"frozen-{n['id']}", city=n['note_city'], keyword='实城冻结',
                    title=n['note_title'], desc=n['note_desc'], img_analysis=n['note_images'], source_url=m['source_url'], status='EXTRACTED'))
            await session.flush()
            for g in frozen['sources']:
                await session.execute(insert(CanonicalPlace).values(**g['source'], **g['derivedBefore']))
                session.add(PlaceSummary(**g['summary']))
            for e in sorted(history['entities'], key=lambda e: e['redirect_to'] is not None):
                await session.execute(insert(PlaceEntity).values(**{k:e[k] for k in ENTITY_FIELDS}))
            for m in history['members']: await session.execute(insert(PlaceEntityMember).values(**m))
            for r in history['reviews']: await session.execute(insert(PlaceEntityReview).values(**r))
            for m in frozen['mentions']: session.add(PlaceMention(**{k:m[k] for k in MENTION_FIELDS}))
            await session.commit()
        async with factory() as session:
            originals = copy.deepcopy(await load_mention_rows(session, '济南'))
            assert {m['id']:mention_fingerprint(m) for m in originals} == {a['mentionId']:a['inputHash'] for d in scopes for a in d['assignments']}
            before = await load_catalog(session, '济南')
            for d in scopes:
                result = await apply_scope_decision(session, d)
                assert result == await apply_scope_decision(session, d)
            catalog = await load_mention_catalog(session, '济南')
            assert len(catalog.assignments) == 65 and len(catalog.catalog.entities) == 3
            resolved, pending = [], []
            for m in originals:
                result = catalog.resolve(m)
                if expected[m['id']]:
                    assert result['status'] == 'resolved' and result['entity']['entity_id'] == eid
                    resolved.append(m['id'])
                else:
                    assert result['status'] == 'review' and result['reason'] == 'unassigned_target'
                    pending.append(m['id'])
            assert len(resolved) == 48 and len(pending) == 17
            for name in ['大明湖', '大明湖公园', '大明湖景区']:
                assert catalog.catalog.resolve(name)['entity_id'] == eid
            for member in history['members']:
                assert catalog.catalog.resolve(place_id=member['place_id'])['entity_id'] == eid
            for name in ['大明湖南门', '大明湖景区(南门)', '超然楼', '湖畔雨荷', '大明湖南丰祠码头旁机位', '尚泉尚水茶馆']:
                assert catalog.catalog.resolve(name) is None
            boat = next(m for m in originals if m['id'] == 12700)
            assert boat['fact_value']['minutes'] == 30
            # 消费投影排除船上时长，原提及仍为景区归属。
            assert 'minutes' not in effective_fact_value(boat, catalog.resolve(boat))
            assert originals == await load_mention_rows(session, '济南')
            reviews = (await session.scalars(select(PlaceEntityReview))).all()
            assert len(reviews) == 20 and sum(r.status == 'PENDING' for r in reviews) == 17
            for r in history['reviews']:
                actual = next(x for x in reviews if x.id == r['id'])
                assert {k:getattr(actual,k) for k in r} == r
            await session.commit()
        exporter.SessionFactory = factory
        output = folder/'xhs-places-济南.json'
        sys.argv = ['export_to_tripweaver.py', '--city', '济南', '--out', str(output)]
        await exporter.main()
        exported = json.loads(output.read_text(encoding='utf-8'))
        assert len(exported['places']) == 1
        p = exported['places'][0]
        assert p['id'] == eid and p['name'] == '大明湖' and p['verified'] is True
        assert p['category'] == '自然' and p['payload']['identity']['revision'] == 3
        assert sorted(p['payload']['aliases']) == sorted(frozen['entity']['aliases'])
        assert sorted(p['payload']['identity']['memberIds']) == sorted(frozen['entity']['legacy_ids'])
        assert sorted(m['mentionId'] for m in p['payload']['mentionSources']) == sorted(resolved)
        assert p['payload']['mentionCount'] == 48 and 'identityWithdrawal' not in p['payload']
        assert p['payload']['typicalVisitMinutes'] == 120
        assert p['payload']['imageIdentity']['approved'] == []
        primary = next(g['source'] for g in frozen['sources'] if g['source']['id'] == 5348)
        assert (p['lat'], p['lng']) == (round(primary['latitude'],6), round(primary['longitude'],6))
        assert p['payload']['topReasons'] and p['payload']['content']
        async with factory() as session:
            for d in reversed(scopes): await rollback_decision(session, d['key'])
            after = await load_catalog(session, '济南')
            assert before.entities == after.entities and before.members == after.members
            assert originals == await load_mention_rows(session, '济南')
            catalog = await load_mention_catalog(session, '济南')
            assert not catalog.scopes and not catalog.assignments
            reviews = (await session.scalars(select(PlaceEntityReview).order_by(PlaceEntityReview.id))).all()
            assert [{k:getattr(r,k) for k in history['reviews'][0]} for r in reviews] == history['reviews']
            for g in frozen['sources']:
                actual = await session.get(CanonicalPlace, g['source']['id'])
                raw = {**g['source'], **g['derivedBefore']}
                assert {k:getattr(actual,k) for k in raw} == raw
            await session.rollback()
        report = {'isolated':True, 'synthetic':False, 'partialCityReconstruction':True, 'batch':'batch-42',
            'sources':3, 'mentions':65, 'notes':54, 'confirmed':48, 'pendingAdded':17, 'withdrawals':0, 'newEntities':0,
            'subjectDurationExclusions':1, 'effectiveMinutes':120, 'threeAliasesPreserved':True,
            'historicalEntitiesAndMembersPreserved':True, 'existingReviewsPreserved':3, 'coordinatesPreserved':True,
            'idempotent':True, 'reverseRollback':True, 'originalMentionsUnchanged':True, 'originalSourcesUnchanged':True,
            'imageComparison':'deferred_by_user', 'fullReviewPassed':False, 'failures':[],
            'exportSha256':hashlib.sha256(output.read_bytes()).hexdigest()}
        with (folder/'report.json').open('x', encoding='utf-8') as out: json.dump(report, out, ensure_ascii=False, indent=2)
        print(json.dumps({'folder':str(folder.relative_to(root)), **report}, ensure_ascii=False))
    finally: await engine.dispose()

asyncio.run(main())
