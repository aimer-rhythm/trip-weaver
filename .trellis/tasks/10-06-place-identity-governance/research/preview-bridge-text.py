"""第65批真实两源/六全文隔离重建、完整范围与逆序回滚。"""
from pathlib import Path
from datetime import datetime
import asyncio,copy,hashlib,json,os,re,sys,time
sys.dont_write_bytecode=True
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0,'D:/Project/xhs-travel-pipeline')
from sqlalchemy import insert,select
from sqlalchemy.ext.asyncio import create_async_engine,async_sessionmaker
from app.models import Base,CanonicalPlace,PlaceEntity,PlaceEntityMember,PlaceEntityReview,PlaceMention,PlaceSummary,RawNote
from app.aggregate.place_identity import ENTITY_FIELDS,apply_decision,load_catalog,rollback_decision
from app.aggregate.mention_identity import apply_scope_decision,load_mention_rows,load_mention_catalog
from app.clean.mention_identity import MENTION_FIELDS,mention_fingerprint,effective_mention
from scripts import export_to_tripweaver as exporter
root=Path(__file__).resolve().parent
def read(p):return json.loads((root/p).read_text(encoding='utf-8'))
assert hashlib.sha256((root/'all-cities/batch-65-source.json').read_bytes()).hexdigest()=='ce6f15d58a65edea700548c0cc8d2da477147dcbe1a5f6bdb23c4eea1b02bd4f'
frozen=read('all-cities/batch-65-source.json');history=frozen['catalog']
scopes=read('all-cities/batch-65-scope-decisions.json');decisions=read('all-cities/batch-65-decisions.json')
expected={a['mentionId']:a for d in scopes for a in d['assignments']}
async def reviews(s):return [{k:getattr(r,k) for k in ['id','city','fingerprint','status','detail']} for r in (await s.scalars(select(PlaceEntityReview).order_by(PlaceEntityReview.id))).all()]
def stable(p):
    p=copy.deepcopy(p)
    if p['payload'].get('content'):p['payload']['content'].pop('compiledAt',None)
    return p
async def main():
    url=os.environ['IDENTITY_TEST_DATABASE_URL'];assert re.fullmatch(r'postgresql\+asyncpg://postgres@127\.0\.0\.1:18798/place_identity_test_\d+',url)
    engine=create_async_engine(url);factory=async_sessionmaker(engine,expire_on_commit=False,autoflush=False)
    folder=root/'all-cities/batch-65'/f'scope-preview-{time.time_ns()}';folder.mkdir(parents=True,exist_ok=False)
    try:
        async with engine.begin() as c:await c.run_sync(Base.metadata.create_all)
        async with factory() as s:
            for n in frozen['noteDetails']:
                m=next(m for m in frozen['mentions'] if m['raw_note_id']==n['id'])
                s.add(RawNote(id=n['id'],note_id=f"frozen-{n['id']}",city=n['city'],keyword='实城冻结',title=n['title'],desc=n['desc'],
                    img_analysis=m['note_images'],source_url=n['sourceUrl'],status=n['status'],created_at=datetime.fromisoformat(n['observedAt']),publish_time=datetime.fromisoformat(n['publishedAt'])))
            await s.flush()
            for g in frozen['sources']:
                await s.execute(insert(CanonicalPlace).values(**g['source'],**g['derivedBefore'],**g['supplement']));s.add(PlaceSummary(**g['summary']))
            for e in history['entities']:await s.execute(insert(PlaceEntity).values(**{k:e[k] for k in ENTITY_FIELDS}))
            for m in history['members']:await s.execute(insert(PlaceEntityMember).values(**m))
            for r in history['reviews']:await s.execute(insert(PlaceEntityReview).values(**r))
            for m in frozen['mentions']:s.add(PlaceMention(**{k:m[k] for k in MENTION_FIELDS}))
            await s.commit()
        exporter.SessionFactory=factory
        async def export(name):
            output=folder/name;sys.argv=['export_to_tripweaver.py','--city','济南','--out',str(output)];await exporter.main()
            return json.loads(output.read_text(encoding='utf-8'))
        before_export=await export('xhs-places-before.json');assert len(before_export['places'])==2
        async with factory() as s:
            original=copy.deepcopy(await load_mention_rows(s,'济南'));before=await load_catalog(s,'济南')
            assert {m['id']:mention_fingerprint(m) for m in original}=={m['id']:m['inputHash'] for m in frozen['mentions']}
            for d in scopes:
                result=await apply_scope_decision(s,d);assert result==await apply_scope_decision(s,d)
            for d in decisions:
                result=await apply_decision(s,d);assert result==await apply_decision(s,d)
            cat=await load_mention_catalog(s,'济南');assert len(cat.assignments)==2 and len(cat.scopes)==1
            for m in original:
                result=cat.resolve(m)
                if False:assert result['status']=='review'
                else:
                    assert result['status']=='resolved'
                    if m['id'] in expected:assert result['entity']['entity_id']==expected[m['id']]['entityId']
                    value=effective_mention(m,result)
                    assert all(value[k]==m[k] for k in ['reason','evidence_text']) and value['fact_value']==(m['fact_value'] or {})
                if m['id'] in expected:assert cat.resolve({**m,'id':m['id']+100000})['status']=='review'
            audit=await reviews(s);pending=[r for r in audit if r['status']=='PENDING']
            assert pending==[]
            assert [r for r in audit if r['status']!='PENDING']==history['reviews']
            assert original==await load_mention_rows(s,'济南');await s.commit()
        after=await export('xhs-places-济南.json');assert len(after['places'])==2
        results=[]
        for p in after['places']:
            old=next(v for v in before_export['places'] if v['id']==p['id'])
            group=next(g for g in frozen['groups'] if g['entity']['entity_id']==p['id']);sid=group['entity']['primary_place_id']
            if sid==5479:assert stable(p)==stable(old);continue
            d=next(d for d in decisions if d['entityId']==p['id'])
            assert p['verified'] and p['name']==d['canonicalName'] and p['payload']['identity']['revision']==3
            assert p['category']==old['category']=='文化' and p['payload']['xhsPlaceType']==old['payload']['xhsPlaceType']=='photo_spot'
            for k in ['typicalVisitMinutes','reservation','price','tips']:assert p['payload'].get(k)==old['payload'].get(k),k
            hours=copy.deepcopy(old['payload']['openHours']);hours['subject']=p['name'];assert p['payload']['openHours']==hours
            assert p['lat']==old['lat'] and p['lng']==old['lng'] and p['payload'].get('geoStatus')==old['payload'].get('geoStatus')
            assert p['payload']['address']==d['overrides'].get('address',old['payload']['address'])
            mids=sorted(i for i,a in expected.items() if a['entityId']==p['id'])
            assert sorted(m['mentionId'] for m in p['payload']['mentionSources'])==mids and p['payload']['mentionCount']==len(mids)
            assert p['payload']['themes']==[] and p['payload']['imageIdentity']['approved']==[]
            highlights=p['payload']['content']['highlights'];old_highlights=old['payload']['content']['highlights']
            assert highlights==old_highlights and p['payload']['typicalVisitMinutes']==30
            assert p['payload']['aliases']==['起凤桥八号门洞'] and p['payload']['identity']['memberNames']==['起凤桥八号门洞']
            assert old['id'] in p['payload']['identity']['memberIds']
            assert len(p['evidence'])==2
            assert sorted((e['content'],e['sourceUrl']) for e in p['evidence'])==sorted({(m['reason'],m['source_url']) for m in frozen['mentions'] if m['id'] in mids})
            results.append({'id':p['id'],'name':p['name'],'confirmed':len(mids),'highlightsBefore':len(old_highlights),'highlightsAfter':len(highlights),
                'evidenceBefore':len(old['evidence']),'evidenceAfter':len(p['evidence']),'coordinatesCleared':False})
        async with factory() as s:
            for d in reversed([*scopes,*decisions]):await rollback_decision(s,d['key'])
            restored=await load_catalog(s,'济南');cat=await load_mention_catalog(s,'济南')
            assert before.entities==restored.entities and before.members==restored.members and not cat.scopes and not cat.assignments
            assert original==await load_mention_rows(s,'济南') and await reviews(s)==history['reviews']
            for g in frozen['sources']:
                actual=await s.get(CanonicalPlace,g['source']['id']);raw={**g['source'],**g['derivedBefore'],**g['supplement']}
                assert {k:getattr(actual,k) for k in raw}==raw
            for n in frozen['noteDetails']:
                m=next(m for m in frozen['mentions'] if m['raw_note_id']==n['id'])
                actual=await s.get(RawNote,n['id']);assert (actual.title,actual.desc,actual.img_analysis,actual.created_at.isoformat(),actual.publish_time.isoformat())==(n['title'],n['desc'],m['note_images'],n['observedAt'],n['publishedAt'])
            await s.commit()
        restored=await export('xhs-places-restored.json');assert [stable(p) for p in restored['places']]==[stable(p) for p in before_export['places']]
        report={'batch':65,'isolated':True,'synthetic':False,'partialCityReconstruction':True,'sources':2,'governedSources':1,'mentions':9,'fullNotes':6,
            'assignments':2,'confirmed':2,'pendingAdded':0,'readOnlySources':1,'readOnlyBridgePreserved':True,'results':results,'newEntities':0,'withdrawals':0,
            'idempotent':True,'reverseRollback':True,'originalSourcesAndMentionsUnchanged':True,'sourceDatesAndAnalysisUnchanged':True,
            'confirmedOpinionsAndDatesPreserved':True,'imageComparison':'deferred_by_user','fullReviewPassed':False,'failures':[]}
        with (folder/'report.json').open('x',encoding='utf-8') as f:json.dump(report,f,ensure_ascii=False,indent=2)
        print(json.dumps({'folder':str(folder.relative_to(root)),**report},ensure_ascii=False))
    finally:await engine.dispose()
asyncio.run(main())
