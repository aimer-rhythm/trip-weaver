"""第31批真实原文隔离预演：四主体八提及排除、实际撤回导出及倒序回滚。"""
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
from app.aggregate.place_identity import ENTITY_FIELDS, load_catalog, rollback_decision
from app.aggregate.mention_identity import apply_scope_decision, load_mention_rows, load_mention_catalog
from app.clean.mention_identity import MENTION_FIELDS, mention_fingerprint
from scripts import export_to_tripweaver as exporter

root = Path(__file__).resolve().parent
source = root/'all-cities/batch-31-source.json'
assert hashlib.sha256(source.read_bytes()).hexdigest()=='a9c00bf3bb22dc34cc4fa29d351d0165ff9f87eac43a7b3a7faa53cb73d1cdab'
frozen = json.loads(source.read_text(encoding='utf-8'))
scopes = json.loads((root/'all-cities/batch-31-scope-decisions.json').read_text(encoding='utf-8'))


async def main():
    url = os.environ['IDENTITY_TEST_DATABASE_URL']
    assert re.fullmatch(r'postgresql\+asyncpg://postgres@127\.0\.0\.1:18798/place_identity_test_\d+',url)
    engine = create_async_engine(url)
    factory = async_sessionmaker(engine,expire_on_commit=False,autoflush=False)
    folder = root/'all-cities/batch-31'/f'scope-preview-{time.time_ns()}'
    folder.mkdir(parents=True,exist_ok=False)
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        async with factory() as session:
            for note in frozen['notes']:
                session.add(RawNote(id=note['id'],note_id=f"frozen-{note['id']}",city=note['note_city'],
                    keyword='实城冻结',title=note['note_title'],desc=note['note_desc'],
                    img_analysis=note['note_images'],status='EXTRACTED'))
            await session.flush()
            for group in frozen['groups']:
                source_row,entity=group['source'],group['entity']
                await session.execute(insert(CanonicalPlace).values(**source_row))
                await session.execute(insert(PlaceEntity).values(**{k:entity[k] for k in ENTITY_FIELDS}))
                await session.execute(insert(PlaceEntityMember).values(place_id=source_row['id'],entity_id=entity['entity_id']))
                session.add(PlaceSummary(**group['summary']))
                for row in group['mentions']:
                    session.add(PlaceMention(**{k:row[k] for k in MENTION_FIELDS}))
            await session.commit()
        async with factory() as session:
            originals=copy.deepcopy(await load_mention_rows(session,'济南'))
            assert {r['id']:mention_fingerprint(r) for r in originals}=={
                r['id']:r['inputHash'] for g in frozen['groups'] for r in g['mentions']}
            before=await load_catalog(session,'济南')
            for decision in scopes:
                after=await apply_scope_decision(session,decision)
                assert after==await apply_scope_decision(session,decision)
            catalog=await load_mention_catalog(session,'济南')
            assert len(catalog.assignments)==8
            assert all(catalog.resolve(row)['status']=='excluded' and
                catalog.resolve(row)['reason']=='reviewed_non_place' for row in originals)
            assert originals==await load_mention_rows(session,'济南')
            assert not (await session.scalars(select(PlaceEntityReview))).all()
            await session.commit()
        exporter.SessionFactory=factory
        file=folder/'xhs-places-济南.json'
        sys.argv=['export_to_tripweaver.py','--city','济南','--out',str(file)]
        await exporter.main()
        data=json.loads(file.read_text(encoding='utf-8'))
        assert len(data['places'])==4
        for place in data['places']:
            assert place['verified'] is False and place['payload']['identity']['revision']==2
            assert place['payload']['mentionSources']==place['payload']['imageIdentity']['approved']==[]
            assert place['payload']['identityWithdrawal']['candidateIds']==[]
            assert place['payload']['recommendScore']==0 and place['evidence']==[]
            assert place['lat'] is None and place['lng'] is None
        graph=json.loads((folder/'xhs-place-relations-济南.json').read_text(encoding='utf-8'))
        assert graph['relations']==[]
        async with factory() as session:
            for decision in reversed(scopes):
                await rollback_decision(session,decision['key'])
            after=await load_catalog(session,'济南')
            assert before.entities==after.entities and before.members==after.members
            assert originals==await load_mention_rows(session,'济南')
            catalog=await load_mention_catalog(session,'济南')
            assert not catalog.scopes and not catalog.assignments
            assert not (await session.scalars(select(PlaceEntityReview))).all()
            for group in frozen['groups']:
                current=await session.get(CanonicalPlace,group['source']['id'])
                assert {k:getattr(current,k) for k in group['source']}==group['source']
            await session.rollback()
        report={'isolated':True,'synthetic':False,'partialCityReconstruction':True,'batch':'batch-31',
            'scopes':4,'excludedMentions':8,'withdrawals':4,'pendingMentions':0,
            'idempotent':True,'reverseRollback':True,'originalMentionsUnchanged':True,'originalSourcesUnchanged':True,
            'files':[{'city':'济南','file':file.name,'sha256':hashlib.sha256(file.read_bytes()).hexdigest()}]}
        with (folder/'report.json').open('x',encoding='utf-8') as output:
            json.dump(report,output,ensure_ascii=False,indent=2)
        print(json.dumps({'folder':str(folder.relative_to(root)),**report},ensure_ascii=False))
    finally:
        await engine.dispose()


asyncio.run(main())
