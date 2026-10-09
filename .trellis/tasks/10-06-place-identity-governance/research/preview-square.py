"""第35批真实资料隔离SQL：同一广场保留30提及，隔离3条污染事实，验证逆序回滚。"""
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
source = root/'all-cities/batch-35-source.json'
assert hashlib.sha256(source.read_bytes()).hexdigest() == '6713c3bcb99ed198d39659dd86692d9dc97288123c43654dce9c852a09c90034'
frozen = json.loads(source.read_text(encoding='utf-8'))
scopes = json.loads((root/'all-cities/batch-35-scope-decisions.json').read_text(encoding='utf-8'))
decisions = json.loads((root/'all-cities/batch-35-decisions.json').read_text(encoding='utf-8'))
eid = '8cc25e536e67519c958ee54248ead04f'
expected = {a['mentionId']:a['entityId'] for d in scopes for a in d['assignments']}
bad_ids = {11420, 12580, 12913}

async def main():
    url = os.environ['IDENTITY_TEST_DATABASE_URL']
    assert re.fullmatch(r'postgresql\+asyncpg://postgres@127\.0\.0\.1:18798/place_identity_test_\d+', url)
    engine = create_async_engine(url)
    factory = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)
    folder = root/'all-cities/batch-35'/f'scope-preview-{time.time_ns()}'
    folder.mkdir(parents=True, exist_ok=False)
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        async with factory() as session:
            for note in frozen['notes']:
                session.add(RawNote(id=note['id'],note_id=f"frozen-{note['id']}",city=note['note_city'],
                    keyword='实城冻结',title=note['note_title'],desc=note['note_desc'],img_analysis=note['note_images'],status='EXTRACTED'))
            await session.flush()
            for group in frozen['groups']:
                await session.execute(insert(CanonicalPlace).values(**group['source']))
                await session.execute(insert(PlaceEntity).values(**{k:group['entity'][k] for k in ENTITY_FIELDS}))
                await session.execute(insert(PlaceEntityMember).values(place_id=group['source']['id'],entity_id=eid))
                session.add(PlaceSummary(**group['summary']))
                for row in group['mentions']:
                    session.add(PlaceMention(**{k:row[k] for k in MENTION_FIELDS}))
            await session.commit()
        async with factory() as session:
            originals = copy.deepcopy(await load_mention_rows(session,'济南'))
            assert {r['id']:mention_fingerprint(r) for r in originals} == {r['id']:r['inputHash'] for g in frozen['groups'] for r in g['mentions']}
            before = await load_catalog(session,'济南')
            for decision in scopes:
                after = await apply_scope_decision(session,decision)
                assert after == await apply_scope_decision(session,decision)
            for decision in decisions:
                after = await apply_decision(session,decision)
                assert after == await apply_decision(session,decision)
            catalog = await load_mention_catalog(session,'济南')
            assert len(catalog.assignments)==33 and len(catalog.catalog.entities)==1
            for row in originals:
                result = catalog.resolve(row)
                if row['id'] in bad_ids:
                    assert result['status']=='review' and result['reason']=='unassigned_target'
                else:
                    assert result['status']=='resolved' and result['entity']['entity_id']==eid
            assert sum(bool(e) for e in expected.values())==30
            assert {i for i,e in expected.items() if e is None}==bad_ids
            assert originals == await load_mention_rows(session,'济南')
            reviews = (await session.scalars(select(PlaceEntityReview))).all()
            assert len(reviews)==3 and all(r.status=='PENDING' for r in reviews)
            await session.commit()
        exporter.SessionFactory = factory
        file = folder/'xhs-places-济南.json'
        sys.argv = ['export_to_tripweaver.py','--city','济南','--out',str(file)]
        await exporter.main()
        data = json.loads(file.read_text(encoding='utf-8'))
        assert len(data['places'])==1
        current = data['places'][0]
        assert current['id']==eid and current['verified'] is True and current['name']=='泉城广场'
        assert current['category']=='娱乐' and current['payload']['identity']['revision']==3
        assert current['payload']['identity']['memberIds']==[eid]
        assert current['payload']['aliases']==['泉城广场']
        assert 'identityWithdrawal' not in current['payload']
        assert {m['mentionId'] for m in current['payload']['mentionSources']}==set(expected)-bad_ids
        assert current['payload']['mentionCount']==30 and current['payload']['themes']==[]
        assert current['payload']['imageIdentity']['approved']==[]
        old = frozen['groups'][0]['source']
        assert (current['lat'],current['lng'])==(round(old['latitude'],6),round(old['longitude'],6))
        consumed = json.dumps(current,ensure_ascii=False)
        for wrong in ['住宿推荐区域','性价比高','从五龙潭东门出']:
            assert wrong not in consumed, wrong
        graph = json.loads((folder/'xhs-place-relations-济南.json').read_text(encoding='utf-8'))
        assert graph['relations']==[]  # 此处仅重建一个主体，完整城市关系另行验证。
        async with factory() as session:
            for decision in reversed([*scopes,*decisions]): await rollback_decision(session,decision['key'])
            after = await load_catalog(session,'济南')
            assert before.entities==after.entities and before.members==after.members
            assert originals==await load_mention_rows(session,'济南')
            catalog = await load_mention_catalog(session,'济南')
            assert not catalog.scopes and not catalog.assignments
            assert not (await session.scalars(select(PlaceEntityReview))).all()
            for group in frozen['groups']:
                current = await session.get(CanonicalPlace,group['source']['id'])
                assert {k:getattr(current,k) for k in group['source']}==group['source']
            await session.rollback()
        report = {'isolated':True,'synthetic':False,'partialCityReconstruction':True,'batch':'batch-35',
            'scopes':1,'sources':1,'mentions':33,'notes':27,'confirmedSquareMentions':30,'pendingMentions':3,
            'pendingIds':sorted(bad_ids),'withdrawals':0,'newEntities':0,'noMisattributedFacts':True,
            'coordinatesPreserved':True,'category':'娱乐','idempotent':True,'reverseRollback':True,
            'originalMentionsUnchanged':True,'originalSourcesUnchanged':True,
            'files':[{'city':'济南','file':file.name,'sha256':hashlib.sha256(file.read_bytes()).hexdigest()}]}
        with (folder/'report.json').open('x',encoding='utf-8') as out: json.dump(report,out,ensure_ascii=False,indent=2)
        print(json.dumps({'folder':str(folder.relative_to(root)),**report},ensure_ascii=False))
    finally:
        await engine.dispose()

asyncio.run(main())
