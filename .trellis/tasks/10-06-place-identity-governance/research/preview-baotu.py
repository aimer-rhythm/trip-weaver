"""第34批真实原文隔离SQL：趵突泉公园归属、裸名撤回、38待审及倒序回滚。"""
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
source = root/'all-cities/batch-34-source.json'
assert hashlib.sha256(source.read_bytes()).hexdigest() == 'a5b5330bcdd409296d2109f0cc27396afa9f56baa3c8f607c39d838c8aa57c5c'
frozen = json.loads(source.read_text(encoding='utf-8'))
scopes = json.loads((root/'all-cities/batch-34-scope-decisions.json').read_text(encoding='utf-8'))
decisions = json.loads((root/'all-cities/batch-34-decisions.json').read_text(encoding='utf-8'))
park = 'd14cc0c8a631defad91e60d475b7aedd'
mixed = '8808e16f1472d0df17bed729a2e54e83'
expected = {a['mentionId']:a['entityId'] for d in scopes for a in d['assignments']}


async def main():
    url = os.environ['IDENTITY_TEST_DATABASE_URL']
    assert re.fullmatch(r'postgresql\+asyncpg://postgres@127\.0\.0\.1:18798/place_identity_test_\d+', url)
    engine = create_async_engine(url)
    factory = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)
    folder = root/'all-cities/batch-34'/f'scope-preview-{time.time_ns()}'
    folder.mkdir(parents=True, exist_ok=False)
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
                source_row, entity = group['source'], group['entity']
                await session.execute(insert(CanonicalPlace).values(**source_row))
                await session.execute(insert(PlaceEntity).values(**{k:entity[k] for k in ENTITY_FIELDS}))
                await session.execute(insert(PlaceEntityMember).values(place_id=source_row['id'],entity_id=entity['entity_id']))
                session.add(PlaceSummary(**group['summary']))
                for row in group['mentions']:
                    session.add(PlaceMention(**{k:row[k] for k in MENTION_FIELDS}))
            for review in frozen['reviews']:
                await session.execute(insert(PlaceEntityReview).values(**review))
            await session.commit()
        async with factory() as session:
            originals = copy.deepcopy(await load_mention_rows(session, '济南'))
            assert {r['id']:mention_fingerprint(r) for r in originals} == {
                r['id']:r['inputHash'] for g in frozen['groups'] for r in g['mentions']}
            before = await load_catalog(session, '济南')
            for decision in scopes:
                after = await apply_scope_decision(session, decision)
                assert after == await apply_scope_decision(session, decision)
            for decision in decisions:
                after = await apply_decision(session, decision)
                assert after == await apply_decision(session, decision)
            catalog = await load_mention_catalog(session, '济南')
            assert len(catalog.assignments) == 60
            resolved, pending = [], []
            for row in originals:
                result = catalog.resolve(row)
                if expected[row['id']]:
                    assert result['status']=='resolved' and result['entity']['entity_id']==park
                    resolved.append(row['id'])
                else:
                    assert result['status']=='review' and result['reason']=='unassigned_target'
                    pending.append(row['id'])
            assert len(resolved)==22 and len(pending)==38
            assert originals == await load_mention_rows(session, '济南')
            reviews = (await session.scalars(select(PlaceEntityReview))).all()
            assert len(reviews)==39 and all(r.status=='PENDING' for r in reviews)
            retained=next(r for r in reviews if r.id==364)
            assert {k:getattr(retained,k) for k in frozen['reviews'][0]}==frozen['reviews'][0]
            assert len(catalog.catalog.entities)==2
            await session.commit()
        exporter.SessionFactory = factory
        file = folder/'xhs-places-济南.json'
        sys.argv = ['export_to_tripweaver.py','--city','济南','--out',str(file)]
        await exporter.main()
        data = json.loads(file.read_text(encoding='utf-8'))
        assert len(data['places'])==2
        by_id = {p['id']:p for p in data['places']}
        withdrawn = by_id[mixed]
        assert withdrawn['verified'] is False and withdrawn['payload']['identity']['revision']==3
        assert withdrawn['payload']['mentionSources']==withdrawn['payload']['imageIdentity']['approved']==[]
        assert withdrawn['payload']['identityWithdrawal']['candidateIds']==[park]
        assert withdrawn['payload']['recommendScore']==0 and withdrawn['evidence']==[]
        assert withdrawn['lat'] is None and withdrawn['lng'] is None
        current = by_id[park]
        assert current['verified'] is True and current['name']=='趵突泉公园'
        assert current['payload']['identity']['revision']==3 and current['category']=='自然'
        assert current['payload']['identity']['memberIds']==[park]
        assert '趵突泉' not in current['payload']['aliases']
        assert sorted(m['mentionId'] for m in current['payload']['mentionSources'])==sorted(resolved)
        assert current['payload']['imageIdentity']['approved']==[]
        original_park = next(g['source'] for g in frozen['groups'] if g['entity']['entity_id']==park)
        # 正式导出对原源坐标保留六位小数；不能把格式化误报成位置改写。
        assert (current['lat'],current['lng'])==(round(original_park['latitude'],6),round(original_park['longitude'],6))
        assert '泉水泡茶' not in json.dumps(current,ensure_ascii=False)
        assert '五龙潭西门出' not in json.dumps(current,ensure_ascii=False)
        graph = json.loads((folder/'xhs-place-relations-济南.json').read_text(encoding='utf-8'))
        assert graph['relations']==[]  # 仅重建本组，不能声称全济南没有关系。
        async with factory() as session:
            for decision in reversed([*scopes,*decisions]):
                await rollback_decision(session,decision['key'])
            after = await load_catalog(session,'济南')
            assert before.entities==after.entities and before.members==after.members
            assert originals==await load_mention_rows(session,'济南')
            catalog = await load_mention_catalog(session,'济南')
            assert not catalog.scopes and not catalog.assignments
            reviews = (await session.scalars(select(PlaceEntityReview))).all()
            assert [{k:getattr(r,k) for k in frozen['reviews'][0]} for r in reviews]==frozen['reviews']
            for group in frozen['groups']:
                current = await session.get(CanonicalPlace,group['source']['id'])
                assert {k:getattr(current,k) for k in group['source']}==group['source']
            await session.rollback()
        report = {'isolated':True,'synthetic':False,'partialCityReconstruction':True,'batch':'batch-34',
            'scopes':1,'sources':2,'mentions':60,'notes':51,'resolvedParkMentions':22,'pendingMentions':38,
            'withdrawals':1,'existingPairReviewUnchanged':True,'noNewCoreEntity':True,
            'noBareNameAlias':True,'noMisattributedFacts':True,'parkCoordinatesPreserved':True,'parkCategory':'自然',
            'idempotent':True,'reverseRollback':True,'originalMentionsUnchanged':True,'originalSourcesUnchanged':True,
            'files':[{'city':'济南','file':file.name,'sha256':hashlib.sha256(file.read_bytes()).hexdigest()}]}
        with (folder/'report.json').open('x',encoding='utf-8') as output:
            json.dump(report,output,ensure_ascii=False,indent=2)
        print(json.dumps({'folder':str(folder.relative_to(root)),**report},ensure_ascii=False))
    finally:
        await engine.dispose()


asyncio.run(main())
