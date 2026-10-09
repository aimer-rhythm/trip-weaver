"""用37条真实提及隔离预演错城撤回、幂等、原文不变和倒序回滚。"""
from pathlib import Path
import asyncio
import copy
import hashlib
import json
import os
import sys
import time
sys.dont_write_bytecode=True
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0,'D:/Project/xhs-travel-pipeline')
from sqlalchemy import insert, select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from app.models import Base, CanonicalPlace, PlaceEntity, PlaceEntityMember, PlaceEntityReview, PlaceMention, PlaceSummary, RawNote
from app.aggregate.place_identity import ENTITY_FIELDS, load_catalog, rollback_decision
from app.aggregate.mention_identity import apply_scope_decision, load_mention_rows, load_mention_catalog
from app.clean.mention_identity import MENTION_FIELDS, mention_fingerprint
from scripts import export_to_tripweaver as exporter
root=Path(__file__).resolve().parent
read=lambda file:json.loads((root/file).read_text(encoding='utf-8'))
snapshot=read('cleaning-scope/run-1791371057197/wrongcity-scope-source-01.json')
scopes=read('all-cities/batch-29-scope-decisions.json')

async def main():
    url=os.environ['IDENTITY_TEST_DATABASE_URL']
    assert '127.0.0.1:18798/place_identity_test_' in url
    engine=create_async_engine(url)
    factory=async_sessionmaker(engine,expire_on_commit=False,autoflush=False)
    folder=root/'all-cities/batch-29'/f'scope-preview-{time.time_ns()}'
    folder.mkdir(parents=True,exist_ok=False)
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        async with factory() as session:
            note=snapshot['groups'][0]['mentions'][0]
            session.add(RawNote(id=759,note_id='frozen-759',city='成都',keyword='实城冻结',title=note['note_title'],
                desc=note['note_desc'],img_analysis=note['note_images'],status='EXTRACTED'))
            await session.flush()
            for g in snapshot['groups']:
                s=g['sources'][0]
                await session.execute(insert(CanonicalPlace).values(**{k:s[k] for k in [
                    'id','city','name','normalized_name','is_active','geo_status','longitude','latitude','address','place_type']}))
                await session.execute(insert(PlaceEntity).values(**{k:s['entity'][k] for k in ENTITY_FIELDS}))
                await session.execute(insert(PlaceEntityMember).values(place_id=s['id'],entity_id=s['entity']['entity_id']))
                session.add(PlaceSummary(canonical_place_id=s['id'],mention_count_30d=1,recommend_score=7.5))
                session.add(PlaceMention(**{k:g['mentions'][0][k] for k in MENTION_FIELDS}))
            await session.commit()
        async with factory() as session:
            originals=copy.deepcopy(await load_mention_rows(session,'成都'))
            assert {m['id']:mention_fingerprint(m) for m in originals}=={
                m['id']:m['inputHash'] for g in snapshot['groups'] for m in g['mentions']}
            before=await load_catalog(session,'成都')
            for d in scopes:
                after=await apply_scope_decision(session,d)
                assert after==await apply_scope_decision(session,d)
            catalog=await load_mention_catalog(session,'成都')
            assert all(catalog.resolve(m)['status']=='review' for m in originals)
            assert originals==await load_mention_rows(session,'成都')
            pending=(await session.scalars(select(PlaceEntityReview).where(PlaceEntityReview.status=='PENDING'))).all()
            assert len(pending)==37 and all(r.detail['reason']=='mention_scope' for r in pending)
            await session.commit()
        exporter.SessionFactory=factory
        file=folder/'xhs-places-成都.json'
        sys.argv=['export_to_tripweaver.py','--city','成都','--out',str(file)]
        await exporter.main()
        data=json.loads(file.read_text(encoding='utf-8'))
        assert len(data['places'])==37
        for p in data['places']:
            assert p['verified'] is False and p['payload']['identity']['revision']==2
            assert p['payload']['mentionSources']==p['payload']['imageIdentity']['approved']==[]
            assert p['payload']['identityWithdrawal']['candidateIds']==[]
            assert p['lat'] is None and p['lng'] is None
        async with factory() as session:
            for d in reversed(scopes):
                await rollback_decision(session,d['key'])
            after=await load_catalog(session,'成都')
            assert before.entities==after.entities and before.members==after.members
            assert originals==await load_mention_rows(session,'成都')
            assert not (await session.scalars(select(PlaceEntityReview))).all()
            await session.rollback()
        report={'isolated':True,'synthetic':False,'partialCityReconstruction':True,'batch':'batch-29',
            'scopes':37,'withdrawals':37,'pendingMentions':37,'idempotent':True,'reverseRollback':True,
            'originalMentionsUnchanged':True,'files':[{'city':'成都','file':file.name,'sha256':hashlib.sha256(file.read_bytes()).hexdigest()}]}
        (folder/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
        print(json.dumps({'folder':str(folder.relative_to(root)),**report},ensure_ascii=False))
    finally:
        await engine.dispose()

asyncio.run(main())
