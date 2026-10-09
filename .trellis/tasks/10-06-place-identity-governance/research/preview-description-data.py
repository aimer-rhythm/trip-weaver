"""第40批真实资料隔离验证：描述字段排除、有效提及保留、原文不变及倒序回滚。"""
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
sys.path.insert(0,'D:/Project/xhs-travel-pipeline')
from sqlalchemy import insert, select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from app.models import Base, CanonicalPlace, PlaceEntity, PlaceEntityMember, PlaceEntityReview, PlaceMention, PlaceSummary, RawNote
from app.aggregate.place_identity import ENTITY_FIELDS, apply_decision, load_catalog, rollback_decision
from app.aggregate.mention_identity import apply_scope_decision, load_mention_rows, load_mention_catalog
from app.clean.mention_identity import MENTION_FIELDS, mention_fingerprint, effective_mention
from scripts import export_to_tripweaver as exporter

root = Path(__file__).resolve().parent
read = lambda f: json.loads((root/f).read_text(encoding='utf-8'))
assert hashlib.sha256((root/'all-cities/batch-40-source.json').read_bytes()).hexdigest()=='6fa96486cc111d8624dc1e0643bff485ad8b2a6f8cafab91d23a9afb3c5d17e9'
frozen = read('all-cities/batch-40-source.json')
scopes = read('all-cities/batch-40-scope-decisions.json')
decisions = read('all-cities/batch-40-decisions.json')

async def main():
    url = os.environ['IDENTITY_TEST_DATABASE_URL']
    assert re.fullmatch(r'postgresql\+asyncpg://postgres@127\.0\.0\.1:18798/place_identity_test_\d+',url)
    engine = create_async_engine(url)
    factory = async_sessionmaker(engine,expire_on_commit=False,autoflush=False)
    folder = root/'all-cities/batch-40'/f'scope-preview-{time.time_ns()}'
    folder.mkdir(parents=True,exist_ok=False)
    try:
        async with engine.begin() as conn: await conn.run_sync(Base.metadata.create_all)
        async with factory() as session:
            for n in frozen['notes']:
                m = next(m for g in frozen['groups'] for m in g['mentions'] if m['raw_note_id']==n['id'])
                session.add(RawNote(id=n['id'],note_id=f"frozen-{n['id']}",city=n['note_city'],keyword='实城冻结',
                    title=n['note_title'],desc=n['note_desc'],img_analysis=n['note_images'],source_url=m['source_url'],status='EXTRACTED'))
            await session.flush()
            for g in frozen['groups']:
                await session.execute(insert(CanonicalPlace).values(**g['source'],**g['derivedBefore']))
                await session.execute(insert(PlaceEntity).values(**{k:g['entity'][k] for k in ENTITY_FIELDS}))
                await session.execute(insert(PlaceEntityMember).values(place_id=g['source']['id'],entity_id=g['entity']['entity_id']))
                session.add(PlaceSummary(**g['summary']))
                for m in g['mentions']: session.add(PlaceMention(**{k:m[k] for k in MENTION_FIELDS}))
            await session.commit()
        async with factory() as session:
            originals = copy.deepcopy(await load_mention_rows(session,'济南'))
            assert {m['id']:mention_fingerprint(m) for m in originals}=={a['mentionId']:a['inputHash'] for d in scopes for a in d['assignments']}
            before = await load_catalog(session,'济南')
            for d in scopes:
                result = await apply_scope_decision(session,d)
                assert result==await apply_scope_decision(session,d)
            for d in decisions:
                result = await apply_decision(session,d)
                assert result==await apply_decision(session,d)
            catalog = await load_mention_catalog(session,'济南')
            assert len(catalog.assignments)==4 and len(catalog.catalog.entities)==2
            for row in originals:
                resolved = catalog.resolve(row)
                assert resolved['status']=='resolved'
                projected = effective_mention(row,resolved)
                if row['id']==12581:
                    assert projected['reason'] is None and projected['evidence_text'] is None
                    assert 'placeContent' not in projected['fact_value']
                elif row['id']==12787:
                    assert projected['reason'] is None and projected['evidence_text']==row['evidence_text']
                else: assert projected['reason']==row['reason'] and projected['evidence_text']==row['evidence_text']
            assert originals==await load_mention_rows(session,'济南')
            assert not (await session.scalars(select(PlaceEntityReview))).all()
            await session.commit()
        exporter.SessionFactory = factory
        output = folder/'xhs-places-济南.json'
        sys.argv = ['export_to_tripweaver.py','--city','济南','--out',str(output)]
        await exporter.main()
        exported = json.loads(output.read_text(encoding='utf-8'))
        assert len(exported['places'])==2
        for p in exported['places']:
            g = next(g for g in frozen['groups'] if g['entity']['entity_id']==p['id'])
            assert p['name']==g['source']['name'] and p['verified'] is True and p['category']=='娱乐'
            assert p['payload']['identity']['revision']==3 and p['payload']['identity']['memberIds']==[p['id']]
            assert sorted(m['mentionId'] for m in p['payload']['mentionSources'])==sorted(m['id'] for m in g['mentions'])
            assert p['payload']['mentionCount']==len(g['mentions']) and 'identityWithdrawal' not in p['payload']
            assert p['payload'].get('typicalVisitMinutes') is None
            assert p['payload']['imageIdentity']['approved']==[]
            assert (p['lat'],p['lng'])==(round(g['source']['latitude'],6),round(g['source']['longitude'],6))
            assert not any(word in json.dumps(p,ensure_ascii=False) for word in ['泉水茶','登高怀古','千年文脉','济南动物园'])
            if p['name']=='明水古城':
                assert '济南章丘古城，适合拍照' in p['payload']['topReasons']
            else:
                assert p['payload']['topReasons']==[] and p['evidence']==[] and p['payload']['content']['intro']==''
        async with factory() as session:
            for d in reversed([*scopes,*decisions]): await rollback_decision(session,d['key'])
            after = await load_catalog(session,'济南')
            assert before.entities==after.entities and before.members==after.members
            assert originals==await load_mention_rows(session,'济南')
            catalog = await load_mention_catalog(session,'济南')
            assert not catalog.scopes and not catalog.assignments
            for g in frozen['groups']:
                actual = await session.get(CanonicalPlace,g['source']['id'])
                expected = {**g['source'],**g['derivedBefore']}
                assert {k:getattr(actual,k) for k in expected}==expected
            await session.rollback()
        report = {'isolated':True,'synthetic':False,'partialCityReconstruction':True,'batch':'batch-40',
            'sources':2,'mentions':4,'notes':3,'excludedFields':4,'pendingAdded':0,'withdrawals':0,'newEntities':0,
            'badDescriptionsNotConsumed':True,'independentFieldsPreserved':True,'coordinatesAndCategoriesPreserved':True,
            'idempotent':True,'reverseRollback':True,'originalMentionsUnchanged':True,'originalSourcesUnchanged':True,
            'imageComparison':'deferred_by_user','fullReviewPassed':False,'failures':[]}
        with (folder/'report.json').open('x',encoding='utf-8') as out: json.dump(report,out,ensure_ascii=False,indent=2)
        print(json.dumps({'folder':str(folder.relative_to(root)),**report},ensure_ascii=False))
    finally: await engine.dispose()

asyncio.run(main())
