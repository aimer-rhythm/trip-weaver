"""第66批三源、两全文的真实隔离重建；不改业务库，不查看图片。"""
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
from app.clean.mention_identity import MENTION_FIELDS, mention_fingerprint, effective_mention
from scripts import export_to_tripweaver as exporter
root = Path(__file__).resolve().parent
def read(p): return json.loads((root/p).read_text(encoding='utf-8'))
assert hashlib.sha256((root/'all-cities/batch-66-source.json').read_bytes()).hexdigest() == '48b103da9bc061fb7c4a179864b5bad9fdee0b23fc7580718247a31fc8fee4c2'
frozen = read('all-cities/batch-66-source.json')
scopes = read('all-cities/batch-66-scope-decisions.json')
decisions = read('all-cities/batch-66-decisions.json')
def stable(p):
    p = copy.deepcopy(p)
    if p['payload'].get('content'): p['payload']['content'].pop('compiledAt', None)
    return p
async def main():
    database = os.environ['IDENTITY_TEST_DATABASE_URL']
    assert re.fullmatch(r'postgresql\+asyncpg://postgres@127\.0\.0\.1:18798/place_identity_test_\d+', database)
    engine = create_async_engine(database)
    factory = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)
    folder = root/'all-cities/batch-66'/f'scope-preview-{time.time_ns()}'
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
        assert len(before['places']) == 3
        async with factory() as s:
            original = copy.deepcopy(await load_mention_rows(s, '成都'))
            original_catalog = await load_catalog(s, '成都')
            assert {m['id']:mention_fingerprint(m) for m in original} == {m['id']:m['inputHash'] for m in frozen['mentions']}
            for d in [*scopes, *decisions]:
                action = apply_scope_decision if 'sourcePlaceId' in d else apply_decision
                result = await action(s,d)
                assert result == await action(s,d)
            catalog = await load_mention_catalog(s,'成都')
            assert len(catalog.assignments) == 2 and len(catalog.scopes) == 2
            for m in original:
                result = catalog.resolve(m)
                assert result['status'] == 'resolved'
                current = effective_mention(m,result)
                assert all(current[k] == m[k] for k in ['reason','evidence_text'])
                assert current['fact_value'] == (m['fact_value'] or {})
                if m['id'] in [4139,4141]: assert catalog.resolve({**m,'id':m['id']+100000})['status'] == 'review'
            assert not (await s.scalars(select(PlaceEntityReview))).all()
            assert original == await load_mention_rows(s,'成都')
            await s.commit()
        after = await export('xhs-places-成都.json')
        assert len(after['places']) == 3
        results=[]
        for p in after['places']:
            old = next(v for v in before['places'] if v['id']==p['id'])
            decision = next((d for d in decisions if d['entityId']==p['id']),None)
            if decision is None:
                assert stable(p)==stable(old)
                continue
            assert p['name']==decision['canonicalName'] and p['verified'] and p['payload']['identity']['revision']==3
            assert p['lat'] is None and p['lng'] is None and p['payload']['geoStatus']=='unresolvable'
            assert p['payload']['address']=='黄龙溪欢乐田园内' and p['payload'].get('adcode')==''
            assert p['category']==old['category']=='文化' and p['payload']['xhsPlaceType']==old['payload']['xhsPlaceType']=='attraction'
            assert p['payload']['aliases']==sorted(decision['aliases'],key=lambda n:(len(n),n)) or set(p['payload']['aliases'])==set(decision['aliases'])
            assert old['id'] in p['payload']['identity']['memberIds']
            assert p['payload']['content']['highlights']==old['payload']['content']['highlights']
            assert p['payload']['topReasons']==old['payload']['topReasons']
            assert p['evidence']==old['evidence']
            for key in ['typicalVisitMinutes','reservation','reservationNote','reservationConflict','reservationEvidence','price','tips']:
                assert p['payload'].get(key)==old['payload'].get(key),key
            hours=copy.deepcopy(old['payload']['openHours']);hours['subject']=p['name']
            assert p['payload']['openHours']==hours
            assignment=next(s['assignments'][0] for s in scopes if p['id'] in s['expectedRevisions'])
            assert p['payload']['mentionCount']==1 and len(p['payload']['mentionSources'])==1
            assert p['payload']['mentionSources'][0]['mentionId']==assignment['mentionId']
            assert not p['payload'].get('typicalVisitMinutes')
            results.append({'id':p['id'],'name':p['name'],'confirmed':1,'coordinatesCleared':True,'oldAdcodeCleared':True,
                'originalHighlightDatePreserved':True,'originalOpinionPreserved':True,'durationMinutes':None})
        async with factory() as s:
            for d in reversed([*scopes,*decisions]): await rollback_decision(s,d['key'])
            restored = await load_catalog(s,'成都');catalog=await load_mention_catalog(s,'成都')
            assert original_catalog.entities==restored.entities and original_catalog.members==restored.members
            assert not catalog.assignments and not catalog.scopes
            assert original==await load_mention_rows(s,'成都')
            assert not (await s.scalars(select(PlaceEntityReview))).all()
            for source in frozen['sources']:
                p=await s.get(CanonicalPlace,source['source']['id']);values={**source['source'],**source['derivedBefore'],**source['supplement']}
                assert {k:getattr(p,k) for k in values}==values
            for n in frozen['noteDetails']:
                actual=await s.get(RawNote,n['id'])
                assert (actual.title,actual.desc,actual.img_analysis,actual.created_at.isoformat(),actual.publish_time.isoformat()) == (n['title'],n['desc'],n['images'],n['observedAt'],n['publishedAt'])
            await s.commit()
        restored=await export('xhs-places-restored.json')
        assert [stable(p) for p in restored['places']]==[stable(p) for p in before['places']]
        report={'batch':66,'isolated':True,'synthetic':False,'partialCityReconstruction':True,'sources':3,'mentions':3,'fullNotes':2,
            'scopes':2,'assignments':2,'confirmed':2,'pendingAdded':0,'newEntities':0,'withdrawals':0,'readOnlyParentPreserved':True,
            'idempotent':True,'reverseRollback':True,'originalSourcesAndMentionsUnchanged':True,'sourceDatesAndAnalysisUnchanged':True,
            'results':results,'imageComparison':'deferred_by_user','fullReviewPassed':False,'failures':[]}
        with (folder/'report.json').open('x',encoding='utf-8') as handle: json.dump(report,handle,ensure_ascii=False,indent=2)
        print(json.dumps({'folder':str(folder.relative_to(root)),**report},ensure_ascii=False))
    finally: await engine.dispose()
asyncio.run(main())
