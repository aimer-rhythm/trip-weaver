"""第68批真实资料隔离预演：仅公园类别变化，两源全文/网页简介/评价/导出可回滚。"""
from pathlib import Path
from datetime import datetime
import asyncio, copy, hashlib, json, os, re, sys, time
sys.dont_write_bytecode = True
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, 'D:/Project/xhs-travel-pipeline')
from sqlalchemy import insert, select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from app.models import Base, CanonicalPlace, PlaceEntity, PlaceEntityMember, PlaceEntityReview, PlaceMention, PlaceSummary, RawNote
from app.aggregate.place_identity import ENTITY_FIELDS, apply_decision, load_catalog, rollback_decision
from app.aggregate.mention_identity import apply_scope_decision, load_mention_rows, load_mention_catalog
from app.clean.identity import legacy_id
from app.clean.mention_identity import MENTION_FIELDS, mention_fingerprint
from scripts import export_to_tripweaver as exporter
root = Path(__file__).resolve().parent
def read(p): return json.loads((root/p).read_text(encoding='utf-8'))
assert hashlib.sha256((root/'all-cities/batch-68-source.json').read_bytes()).hexdigest() == 'c78061c733a251c204053588d4c56a86639f3e01d79cf77b0f58a311d7755125'
frozen = read('all-cities/batch-68-source.json')
decisions = read('all-cities/batch-68-decisions.json')
def stable(p):
    p = copy.deepcopy(p)
    if p['payload'].get('content'): p['payload']['content'].pop('compiledAt', None)
    return p

async def main():
    database = os.environ['IDENTITY_TEST_DATABASE_URL']
    assert re.fullmatch(r'postgresql\+asyncpg://postgres@127\.0\.0\.1:18798/place_identity_test_\d+', database)
    engine = create_async_engine(database)
    factory = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)
    folder = root/'all-cities/batch-68'/f'category-preview-{time.time_ns()}'
    folder.mkdir(parents=True, exist_ok=False)
    try:
        async with engine.begin() as conn: await conn.run_sync(Base.metadata.create_all)
        async with factory() as s:
            for n in frozen['noteDetails']:
                s.add(RawNote(id=n['id'], note_id=f"frozen-{n['id']}", city=n['city'], keyword='实城冻结', title=n['title'], desc=n['desc'],
                    img_analysis=n['images'], source_url=n['sourceUrl'], status=n['status'], created_at=datetime.fromisoformat(n['observedAt']),
                    publish_time=datetime.fromisoformat(n['publishedAt']) if n['publishedAt'] else None))
            await s.flush()
            for source in frozen['sources']:
                await s.execute(insert(CanonicalPlace).values(**source['source'], **source['derivedBefore'], **source['supplement']))
                if source['summary']: s.add(PlaceSummary(**source['summary']))
            for e in frozen['catalog']['entities']: await s.execute(insert(PlaceEntity).values(**{k:e[k] for k in ENTITY_FIELDS}))
            for m in frozen['catalog']['members']: await s.execute(insert(PlaceEntityMember).values(**m))
            for r in frozen['catalog']['reviews']: await s.execute(insert(PlaceEntityReview).values(**r))
            for m in frozen['mentions']: s.add(PlaceMention(**{k:m[k] for k in MENTION_FIELDS}))
            await s.commit()
        exporter.SessionFactory = factory
        async def export(name):
            target = folder/name
            sys.argv = ['export_to_tripweaver.py', '--city', '成都', '--out', str(target)]
            await exporter.main()
            return json.loads(target.read_text(encoding='utf-8'))
        before = await export('xhs-places-before.json')
        assert len(before['places']) == 2
        async with factory() as s:
            original = copy.deepcopy(await load_mention_rows(s, '成都'))
            original_catalog = await load_catalog(s, '成都')
            assert {m['id']:mention_fingerprint(m) for m in original} == {m['id']:m['inputHash'] for m in frozen['mentions']}
            for d in decisions:
                result = await apply_decision(s, d)
                assert result == await apply_decision(s, d)
            catalog = await load_mention_catalog(s, '成都')
            assert not catalog.assignments and not catalog.scopes
            assert original == await load_mention_rows(s, '成都')
            assert not (await s.scalars(select(PlaceEntityReview))).all()
            await s.commit()
        after = await export('xhs-places-成都.json')
        assert len(after['places']) == 2
        results = []
        for p in after['places']:
            old = next(v for v in before['places'] if v['id'] == p['id'])
            d = next((d for d in decisions if d['entityId'] == p['id']), None)
            if d is None:
                assert stable(p) == stable(old)
                continue
            expected = stable(old)
            expected['category'] = '自然'
            expected['payload']['identity']['revision'] = 2
            expected_ids = [old['id'], *sorted(set(legacy_id('成都', alias) for alias in d['aliases']) - {old['id']})]
            assert expected_ids == ['c59fb8b0967139fdc1bbf231b57283b1','bff6ba292c6b9b100d70ed00fde2f96f','dd173f010b9176ae48bae1a5cbc329ae']
            expected['payload']['identity']['memberIds'] = expected_ids
            assert stable(p) == expected, p['name']
            assert not p['payload'].get('mentionSources')
            results.append({'id':p['id'], 'name':p['name'], 'categoryCorrected':True, 'allNonCategoryConsumptionPreserved':True, 'identityMembersPreserved':True, 'existingAliasLegacyIdsAdded':2})
        async with factory() as s:
            for d in reversed(decisions): await rollback_decision(s, d['key'])
            restored = await load_catalog(s, '成都')
            assert original_catalog.entities == restored.entities and original_catalog.members == restored.members
            assert original == await load_mention_rows(s, '成都')
            assert not (await s.scalars(select(PlaceEntityReview))).all()
            for source in frozen['sources']:
                p = await s.get(CanonicalPlace, source['source']['id'])
                values = {**source['source'], **source['derivedBefore'], **source['supplement']}
                assert {k:getattr(p,k) for k in values} == values
            for n in frozen['noteDetails']:
                actual = await s.get(RawNote, n['id'])
                assert (actual.title,actual.desc,actual.img_analysis,actual.created_at.isoformat(),(actual.publish_time.isoformat() if actual.publish_time else None)) == (n['title'],n['desc'],n['images'],n['observedAt'],n['publishedAt'])
            await s.commit()
        restored = await export('xhs-places-restored.json')
        assert [stable(p) for p in restored['places']] == [stable(p) for p in before['places']]
        # 仅在隔离库复现直接套用scope的损失；假设分配未通过业务审核，禁止应用实库。
        hypothetical=[]
        async with factory() as s:
            for group in frozen['groups']:
                eid=group['entity']['entity_id'];sid=group['entity']['primary_place_id']
                hypothetical.append({'key':f'isolated-batch68-loss-demonstration-{sid}','city':'成都','sourcePlaceId':sid,
                    'expectedSourceHash':next(v['sourceHash'] for v in frozen['sources'] if v['source']['id']==sid),
                    'expectedScopeRevision':0,'expectedRevisions':{eid:1},
                    'assignments':[{'mentionId':m['id'],'inputHash':m['inputHash'],'entityId':eid} for m in frozen['mentions'] if m['id'] in group['mentionIds']],
                    'evidence':[{'kind':'isolated_unadopted_hypothesis','conclusion':'仅复现直接scope对既有内容的影响，分配未通过业务审核，禁止应用实库。'}]})
                await apply_scope_decision(s,hypothetical[-1])
            await s.commit()
        scoped=await export('hypothetical-scope-loss-not-adopted.json')
        park=next(p for p in scoped['places'] if p['name']=='人民公园')
        tea=next(p for p in scoped['places'] if p['name']=='鹤鸣茶社')
        old_park=next(p for p in before['places'] if p['name']=='人民公园')
        old_tea=next(p for p in before['places'] if p['name']=='鹤鸣茶社')
        assert old_park['payload']['content']['method']=='web_research_with_model_knowledge'
        assert park['payload']['content']!=old_park['payload']['content']
        assert any('可不去' in t and '鹤鸣茶社' in t for t in old_tea['payload']['tips'])
        assert '可不去' not in json.dumps(tea,ensure_ascii=False)
        for warning in ['周末人满为患且吵热，需10点前到抢位','餐食口味普通，想吃地道成都吃食不建议在此解决正餐']:
            assert warning in json.dumps(tea,ensure_ascii=False)
        async with factory() as s:
            for h in reversed(hypothetical):await rollback_decision(s,h['key'])
            await s.commit()
        restored_again=await export('hypothesis-restored.json')
        assert [stable(p) for p in restored_again['places']]==[stable(p) for p in before['places']]
        report = {'batch':68, 'isolated':True, 'synthetic':False, 'partialCityReconstruction':True,
            'sources':2, 'mentions':25, 'fullNotes':22, 'entityChanges':1, 'scopeChanges':0, 'assignmentChanges':0,
            'newEntities':0, 'withdrawals':0, 'readOnlyTeahousePreserved':True,
            'idempotent':True, 'reverseRollback':True, 'originalSourcesAndMentionsUnchanged':True,
            'sourceDatesAndAnalysisUnchanged':True, 'results':results,
            'hypotheticalScopeNotAdopted':True,'webProfileLossReproduced':True,'originalMultilineWarningLossReproduced':True,'hypothesisRolledBack':True,
            'imageComparison':'deferred_by_user', 'fullReviewPassed':False, 'failures':[]}
        with (folder/'report.json').open('x', encoding='utf-8') as handle: json.dump(report,handle,ensure_ascii=False,indent=2)
        print(json.dumps({'folder':str(folder.relative_to(root)),**report},ensure_ascii=False))
    finally: await engine.dispose()

asyncio.run(main())
