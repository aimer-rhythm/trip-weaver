"""五泉类别修订隔离预演，带入第36批真实字段排除与null待审。"""
from pathlib import Path
import asyncio
import copy
import hashlib
import json
import os
import re
import sys
import time
sys.dont_write_bytecode=True
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0,'D:/Project/xhs-travel-pipeline')
from sqlalchemy import insert, select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from app.models import Base, CanonicalPlace, PlaceEntity, PlaceEntityMember, PlaceEntityReview, PlaceMention, PlaceSummary, RawNote
from app.aggregate.place_identity import ENTITY_FIELDS, load_catalog, apply_decision, rollback_decision
from app.aggregate.mention_identity import load_mention_rows, load_mention_catalog, apply_scope_decision
from app.clean.mention_identity import MENTION_FIELDS, mention_fingerprint
from scripts import export_to_tripweaver as exporter
root=Path(__file__).resolve().parent
def read(f):return json.loads((root/f).read_bytes())
source=root/'all-cities/batch-37-source.json'
assert hashlib.sha256(source.read_bytes()).hexdigest()=='61ed5f6adc5391bee0707a2ca967018086e7a06f1389d134a7e34f2403765cd5'
data=json.loads(source.read_bytes())
previous=read('all-cities/batch-36-source.json')
scopes=read('all-cities/batch-36-scope-decisions.json')
decisions=read('all-cities/batch-37-decisions.json')

async def main():
    db_url=os.environ['IDENTITY_TEST_DATABASE_URL']
    assert re.fullmatch(r'postgresql\+asyncpg://postgres@127\.0\.0\.1:18798/place_identity_test_\d+',db_url)
    engine=create_async_engine(db_url);factory=async_sessionmaker(engine,expire_on_commit=False,autoflush=False)
    folder=root/'all-cities/batch-37'/f'category-preview-{time.time_ns()}';folder.mkdir(parents=True,exist_ok=False)
    try:
        async with engine.begin() as conn:await conn.run_sync(Base.metadata.create_all)
        async with factory() as session:
            for note in data['notes']:
                row=next(m for g in data['groups'] for m in g['mentions'] if m['raw_note_id']==note['id'])
                session.add(RawNote(id=note['id'],note_id=f"frozen-{note['id']}",city='济南',keyword='真实冻结',
                    title=note['note_title'],desc=note['note_desc'],img_analysis=note['note_images'],source_url=row['source_url'],status='EXTRACTED'))
            await session.flush()
            for g in data['groups']:
                old=next((r for r in previous['groups'] if r['entity']['entity_id']==g['entity']['entity_id']),None)
                entity=old['entity'] if old else g['entity']
                await session.execute(insert(CanonicalPlace).values(**g['source'],**g['sourceDerived']))
                await session.execute(insert(PlaceEntity).values(**{k:entity[k] for k in ENTITY_FIELDS}))
                await session.execute(insert(PlaceEntityMember).values(place_id=g['source']['id'],entity_id=entity['entity_id']))
                session.add(PlaceSummary(**g['summary']))
                for m in g['mentions']:session.add(PlaceMention(**{k:m[k] for k in MENTION_FIELDS}))
            await session.flush()
            # 仅在此新建专用库重建已应用scope，绝不重放实城决定。
            for d in scopes:await apply_scope_decision(session,d)
            await session.commit()
        async with factory() as session:
            original_mentions=copy.deepcopy(await load_mention_rows(session,'济南'))
            assert {m['id']:mention_fingerprint(m) for m in original_mentions}=={m['id']:m['inputHash'] for g in data['groups'] for m in g['mentions']}
            baseline=copy.deepcopy((await load_catalog(session,'济南')).entities)
            for g in data['groups']:assert baseline[g['entity']['entity_id']]==g['entity']
            before_assignments=copy.deepcopy((await load_mention_catalog(session,'济南')).assignments)
            for d in decisions:
                after=await apply_decision(session,d);assert after==await apply_decision(session,d)
            current=await load_mention_catalog(session,'济南')
            assert current.assignments==before_assignments
            assert len(current.assignments)==11
            for m in original_mentions:
                result=current.resolve(m)
                assert result['status']==('review' if m['id']==12692 else 'resolved')
                if m['id'] in {12941,12942,12943,12944}:assert result['factExclusions']['visit_duration']['reason']=='group_duration'
            await session.commit()
        exporter.SessionFactory=factory
        file=folder/'xhs-places-济南.json';sys.argv=['export_to_tripweaver.py','--city','济南','--out',str(file)]
        await exporter.main();published=json.loads(file.read_bytes())
        assert len(published['places'])==5
        for p in published['places']:
            g=next(g for g in data['groups'] if g['entity']['entity_id']==p['id'])
            assert p['category']=='自然' and p['verified']
            assert p['payload']['identity']['revision']==g['entity']['revision']+1
            assert p['payload']['identity']['memberIds']==[p['id']]
            assert (p['lat'],p['lng'])==(round(g['source']['latitude'],6),round(g['source']['longitude'],6))
            assert 'typicalVisitMinutes' not in p['payload']
            assert p['payload']['content']['intro']
            assert '簪花少女' not in json.dumps(p['payload'],ensure_ascii=False)
            if p['name']!='玛瑙泉':
                expected=sorted(m['id'] for m in g['mentions'] if m['id']!=12692)
                assert sorted(m['mentionId'] for m in p['payload']['mentionSources'])==expected
        async with factory() as session:
            for d in reversed(decisions):await rollback_decision(session,d['key'])
            assert (await load_catalog(session,'济南')).entities==baseline
            assert (await load_mention_catalog(session,'济南')).assignments==before_assignments
            assert await load_mention_rows(session,'济南')==original_mentions
            pending=(await session.scalars(select(PlaceEntityReview).where(PlaceEntityReview.status=='PENDING'))).all()
            assert [r.detail['mentionId'] for r in pending]==[12692]
            for g in data['groups']:
                p=await session.get(CanonicalPlace,g['source']['id'])
                assert {k:getattr(p,k) for k in g['source']}==g['source']
                assert {k:getattr(p,k) for k in g['sourceDerived']}==g['sourceDerived']
        report={'isolated':True,'synthetic':False,'partialCityReconstruction':True,'batch':'batch-37',
            'sources':5,'mentions':12,'resolved':11,'pending':[12692],'categoriesChanged':5,
            'previousFactExclusionsPreserved':4,'previousAssignmentsPreserved':11,'idempotent':True,'reverseRollback':True,
            'originalMentionsUnchanged':True,'originalSourcesUnchanged':True,
            'files':[{'city':'济南','file':file.name,'sha256':hashlib.sha256(file.read_bytes()).hexdigest()}]}
        with (folder/'report.json').open('x',encoding='utf-8') as out:json.dump(report,out,ensure_ascii=False,indent=2)
        print(json.dumps({'folder':str(folder.relative_to(root)),**report},ensure_ascii=False))
    finally:await engine.dispose()
asyncio.run(main())
