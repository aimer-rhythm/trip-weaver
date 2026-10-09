"""第39批真实资料隔离验证：有效地点保留、错误派生时长停止消费、幂等及倒序回滚。"""
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
from scripts import export_to_tripweaver as exporter, build_visit_duration as builder

root = Path(__file__).resolve().parent
source = root/'all-cities/batch-39-source.json'
assert hashlib.sha256(source.read_bytes()).hexdigest()=='de65bd66014062f038771f0d26449c2d4356e64b807174d4dadecdb4face0cf2'
read = lambda f: json.loads((root/f).read_text(encoding='utf-8'))
frozen = read('all-cities/batch-39-source.json')
scopes = read('all-cities/batch-39-scope-decisions.json')
decisions = read('all-cities/batch-39-decisions.json')
eid = '29f4a4b260878eb8d9143b15b8fca54f'

async def main():
    url = os.environ['IDENTITY_TEST_DATABASE_URL']
    assert re.fullmatch(r'postgresql\+asyncpg://postgres@127\.0\.0\.1:18798/place_identity_test_\d+',url)
    engine = create_async_engine(url)
    factory = async_sessionmaker(engine,expire_on_commit=False,autoflush=False)
    folder = root/'all-cities/batch-39'/f'scope-preview-{time.time_ns()}'
    folder.mkdir(parents=True,exist_ok=False)
    try:
        async with engine.begin() as conn: await conn.run_sync(Base.metadata.create_all)
        async with factory() as session:
            for n in frozen['notes']:
                provenance = next(m for g in frozen['groups'] for m in g['mentions'] if m['raw_note_id']==n['id'])
                session.add(RawNote(id=n['id'],note_id=f"frozen-{n['id']}",city=n['note_city'],keyword='实城冻结',
                    title=n['note_title'],desc=n['note_desc'],img_analysis=n['note_images'],
                    source_url=provenance['source_url'],status='EXTRACTED'))
            await session.flush()
            for g in frozen['groups']:
                await session.execute(insert(CanonicalPlace).values(**g['source'],**g['derivedBefore']))
                await session.execute(insert(PlaceEntity).values(**{k:g['entity'][k] for k in ENTITY_FIELDS}))
                await session.execute(insert(PlaceEntityMember).values(place_id=5475,entity_id=eid))
                session.add(PlaceSummary(**g['summary']))
                for m in g['mentions']: session.add(PlaceMention(**{k:m[k] for k in MENTION_FIELDS}))
            await session.commit()
        async with factory() as session:
            originals = copy.deepcopy(await load_mention_rows(session,'济南'))
            assert {m['id']:mention_fingerprint(m) for m in originals}=={11686:scopes[0]['assignments'][0]['inputHash']}
            before = await load_catalog(session,'济南')
            for d in scopes:
                result = await apply_scope_decision(session,d)
                assert result==await apply_scope_decision(session,d)
            for d in decisions:
                result = await apply_decision(session,d)
                assert result==await apply_decision(session,d)
            catalog = await load_mention_catalog(session,'济南')
            assert len(catalog.assignments)==1 and len(catalog.catalog.entities)==1
            assert catalog.resolve(originals[0])['entity']['entity_id']==eid
            assert catalog.resolve(originals[0])['status']=='resolved'
            assert originals==await load_mention_rows(session,'济南')
            assert not (await session.scalars(select(PlaceEntityReview))).all()
            await session.commit()
        # 真正调用已安装抽取入口，只连临时库；受控旧canonical不被批量写入。
        builder.SessionFactory = factory
        await builder.build_city('济南')
        exporter.SessionFactory = factory
        output = folder/'xhs-places-济南.json'
        sys.argv = ['export_to_tripweaver.py','--city','济南','--out',str(output)]
        await exporter.main()
        exported = json.loads(output.read_text(encoding='utf-8'))
        assert len(exported['places'])==1
        p = exported['places'][0]
        assert p['id']==eid and p['name']=='灵岩寺' and p['verified'] is True
        assert p['category']=='文化' and p['payload']['identity']['revision']==3
        assert p['payload']['identity']['memberIds']==[eid]
        assert p['payload']['aliases']==['灵岩寺'] and 'identityWithdrawal' not in p['payload']
        assert [m['mentionId'] for m in p['payload']['mentionSources']]==[11686]
        assert p['payload'].get('typicalVisitMinutes') is None
        assert p['payload']['themes']==[] and p['payload']['mentionCount']==1
        assert '宋代彩塑' in json.dumps(p['payload']['content'],ensure_ascii=False)
        assert p['payload']['imageIdentity']['approved']==[]
        original = frozen['groups'][0]['source']
        assert (p['lat'],p['lng'])==(round(original['latitude'],6),round(original['longitude'],6))
        assert p['payload']['address']==original['address']
        graph = json.loads((folder/'xhs-place-relations-济南.json').read_text(encoding='utf-8'))
        assert graph['relations']==[]
        async with factory() as session:
            for d in reversed([*scopes,*decisions]): await rollback_decision(session,d['key'])
            after = await load_catalog(session,'济南')
            assert before.entities==after.entities and before.members==after.members
            assert originals==await load_mention_rows(session,'济南')
            catalog = await load_mention_catalog(session,'济南')
            assert not catalog.scopes and not catalog.assignments
            actual = await session.get(CanonicalPlace,5475)
            for g in frozen['groups']:
                expected = {**g['source'],**g['derivedBefore']}
                assert {k:getattr(actual,k) for k in expected}==expected
            await session.rollback()
        report = {'isolated':True,'synthetic':False,'partialCityReconstruction':True,'batch':'batch-39',
            'sources':1,'mentions':1,'notes':1,'pendingAdded':0,'withdrawals':0,'newEntities':0,
            'badDurationNotConsumed':True,'validDescriptionPreserved':True,'coordinatesPreserved':True,
            'category':'文化','installedBuilderExecuted':True,'idempotent':True,'reverseRollback':True,
            'originalMentionsUnchanged':True,'originalSourcesAndDerivedCacheUnchanged':True,
            'files':[{'city':'济南','file':output.name,'sha256':hashlib.sha256(output.read_bytes()).hexdigest()}]}
        with (folder/'report.json').open('x',encoding='utf-8') as out: json.dump(report,out,ensure_ascii=False,indent=2)
        print(json.dumps({'folder':str(folder.relative_to(root)),**report},ensure_ascii=False))
    finally: await engine.dispose()

asyncio.run(main())
