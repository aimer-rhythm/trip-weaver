"""第55批真实资料隔离验证：完整scope、历史审核保留、导出、幂等和逆序回滚。"""
from pathlib import Path
from datetime import datetime
import asyncio,copy,hashlib,json,os,re,sys,time
sys.dont_write_bytecode=True
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0,'D:/Project/xhs-travel-pipeline')
from sqlalchemy import insert,select,text
from sqlalchemy.ext.asyncio import create_async_engine,async_sessionmaker
from app.models import Base,CanonicalPlace,PlaceEntity,PlaceEntityMember,PlaceEntityReview,PlaceMention,PlaceSummary,RawNote
from app.aggregate.place_identity import ENTITY_FIELDS,apply_decision,load_catalog,rollback_decision
from app.aggregate.mention_identity import apply_scope_decision,load_mention_rows,load_mention_catalog
from app.clean.identity import legacy_id
from app.clean.mention_identity import MENTION_FIELDS,mention_fingerprint,effective_mention
from scripts import export_to_tripweaver as exporter
root=Path(__file__).resolve().parent
def read(p):return json.loads((root/p).read_text(encoding='utf-8'))
assert hashlib.sha256((root/'all-cities/batch-55-v2-source.json').read_bytes()).hexdigest()=='00cbcfdf8598983e1c49be46f173d3f3b429795796c01deb19f6ce7bc041c883'
frozen=read('all-cities/batch-55-v2-source.json');history=read('all-cities/batch-55-v2-catalog.json')
scopes=read('all-cities/batch-55-v2-scope-decisions.json');decisions=read('all-cities/batch-55-v2-decisions.json')
expected={a['mentionId']:a for d in scopes for a in d['assignments']}
supplement={r['sourceId']:r for r in read('priority-cities/济南/laoshe-summary-supplement-01.json')['rows']}
async def review_rows(s):
    return [{k:getattr(r,k) for k in ['id','city','fingerprint','status','detail']} for r in (await s.scalars(select(PlaceEntityReview).order_by(PlaceEntityReview.id))).all()]
async def main():
    url=os.environ['IDENTITY_TEST_DATABASE_URL'];assert re.fullmatch(r'postgresql\+asyncpg://postgres@127\.0\.0\.1:18798/place_identity_test_\d+',url)
    engine=create_async_engine(url);factory=async_sessionmaker(engine,expire_on_commit=False,autoflush=False)
    folder=root/'all-cities/batch-55-v2'/f'scope-preview-{time.time_ns()}';folder.mkdir(parents=True,exist_ok=False)
    try:
        async with engine.begin() as c:await c.run_sync(Base.metadata.create_all)
        async with factory() as s:
            for n in frozen['notes']:
                m=next(m for m in frozen['mentions'] if m['raw_note_id']==n['id'])
                s.add(RawNote(id=n['id'],note_id=f"frozen-{n['id']}",city=n['note_city'],keyword='实城冻结',title=n['note_title'],desc=n['note_desc'],
                    img_analysis=n['note_images'],source_url=m['source_url'],status='EXTRACTED',created_at=datetime.fromisoformat(m['observed_at'])))
            await s.flush()
            for g in frozen['sources']:
                await s.execute(insert(CanonicalPlace).values(**g['source'],**g['derivedBefore'],adcode=supplement[g['source']['id']]['adcode']));s.add(PlaceSummary(**g['summary'],top_reasons=supplement[g['source']['id']]['top_reasons']))
            for e in history['entities']:await s.execute(insert(PlaceEntity).values(**{k:e[k] for k in ENTITY_FIELDS}))
            for m in history['members']:await s.execute(insert(PlaceEntityMember).values(**m))
            for r in history['reviews']:await s.execute(insert(PlaceEntityReview).values(**r))
            for m in frozen['mentions']:s.add(PlaceMention(**{k:m[k] for k in MENTION_FIELDS}))
            await s.commit()
        async with factory() as s:
            originals=copy.deepcopy(await load_mention_rows(s,'济南'));before=await load_catalog(s,'济南')
            assert {m['id']:mention_fingerprint(m) for m in originals}=={m['id']:m['inputHash'] for m in frozen['mentions']}
            for d in scopes:
                result=await apply_scope_decision(s,d);assert result==await apply_scope_decision(s,d)
            for d in decisions:
                result=await apply_decision(s,d);assert result==await apply_decision(s,d)
            cat=await load_mention_catalog(s,'济南');assert len(cat.assignments)==1 and len(cat.catalog.entities)==2
            for m in originals:
                result=cat.resolve(m);eid=next(g['entity']['entity_id'] for g in frozen['groups'] if m['id'] in g['mentionIds'])
                assert result['status']=='resolved' and result['entity']['entity_id']==eid
                p=effective_mention(m,result)
                assert p['reason']==m['reason'] and p['evidence_text']==m['evidence_text'] and p['fact_value']==(m['fact_value'] or {})
                if m['id']==12694:
                    future={**m,'id':m['id']+100000};assert cat.resolve(future)['status']=='review'
            assert await review_rows(s)==history['reviews']==[]
            assert originals==await load_mention_rows(s,'济南');await s.commit()
        exporter.SessionFactory=factory;output=folder/'xhs-places-济南.json'
        sys.argv=['export_to_tripweaver.py','--city','济南','--out',str(output)];await exporter.main()
        exported=json.loads(output.read_text(encoding='utf-8'));assert len(exported['places'])==2
        results=[]
        for p in exported['places']:
            group=next(g for g in frozen['groups'] if g['entity']['entity_id']==p['id'])
            entity=group['entity'];src=group['sources'][0]['source'];decision=next(d for d in decisions if d['entityId']==p['id'])
            mention_ids=sorted(i for i,a in expected.items() if a['entityId']==p['id'])
            is_wall=p['id']=='c5a3fae3d839ec359cb0521d957e56df'
            assert p['verified'] is True and p['payload']['identity']['revision']==(3 if is_wall else 2)
            assert p['name']==decision['canonicalName'] and p['category']=='文化' and p['payload']['xhsPlaceType']==('photo_spot' if is_wall else 'attraction')
            assert set(p['payload']['aliases'])==set(decision['aliases'])
            assert sorted(p['payload']['identity']['memberIds'])==sorted(set([*entity['legacy_ids'],*[legacy_id('济南',name) for name in decision['aliases']]]))
            assert p['payload']['address']==decision['overrides']['address'] and p['payload'].get('typicalVisitMinutes') is None
            if is_wall:
                assert [m['mentionId'] for m in p['payload']['mentionSources']]==[12694]
                assert p['lat'] is None and p['lng'] is None and p['payload']['geoStatus']=='unresolvable'
                assert p['payload']['imageIdentity']['approved']==[] and p['payload']['themes']==[]
                assert p['payload']['mentionCount']==1
                assert p['payload']['topReasons']==['文化打卡点，与老舍相关']
                assert len(p['payload']['content']['highlights'])==1 and p['payload']['content']['highlights'][0]['observedAt']==next(m for m in frozen['mentions'] if m['id']==12694)['observed_at']
            else:
                assert 'mentionSources' not in p['payload'] and 'imageIdentity' not in p['payload']
                assert (p['lat'],p['lng'])==(round(src['latitude'],6),round(src['longitude'],6))
                assert p['payload']['mentionCount']==3 and p['payload']['themes']==['历史人文']
                assert sorted(p['payload']['topReasons'])==sorted(m['reason'] for m in frozen['mentions'] if m['id'] in group['mentionIds'])
                assert '五龙潭南门' in p['payload']['content']['intro']
                assert len(p['payload']['content']['highlights'])==3 and len(p['evidence'])==3
            results.append({'entityId':p['id'],'name':p['name'],'mentions':p['payload']['mentionCount'],'category':p['category'],'type':p['payload']['xhsPlaceType'],'coordinatesCleared':is_wall,'museumScopeDeferred':not is_wall})
        async with factory() as s:
            for d in reversed([*scopes,*decisions]):await rollback_decision(s,d['key'])
            after=await load_catalog(s,'济南');assert before.entities==after.entities and before.members==after.members
            assert originals==await load_mention_rows(s,'济南') and await review_rows(s)==history['reviews']
            cat=await load_mention_catalog(s,'济南');assert not cat.scopes and not cat.assignments
            for g in frozen['sources']:
                actual=await s.get(CanonicalPlace,g['source']['id']);raw={**g['source'],**g['derivedBefore']}
                assert {k:getattr(actual,k) for k in raw}==raw
                assert (await s.scalar(select(PlaceSummary).where(PlaceSummary.canonical_place_id==g['source']['id']))).top_reasons==supplement[g['source']['id']]['top_reasons']
            await s.rollback()
        report={'batch':55,'variant':'v2','isolated':True,'synthetic':False,'partialCityReconstruction':True,'sources':2,'historicalEntities':2,'mentions':4,'notes':3,'supplementalNotesRead':1,
            'confirmedScoped':1,'ordinaryMentionsPreserved':3,'pendingAdded':0,'historicalReviewPreserved':True,'newEntities':0,'withdrawals':0,'results':results,'idempotent':True,'reverseRollback':True,
            'originalSourcesAndMentionsUnchanged':True,'imageComparison':'deferred_by_user','fullReviewPassed':False,'failures':[],
            'exportSha256':hashlib.sha256(output.read_bytes()).hexdigest()}
        with (folder/'report.json').open('x',encoding='utf-8') as f:json.dump(report,f,ensure_ascii=False,indent=2)
        print(json.dumps({'folder':str(folder.relative_to(root)),**report},ensure_ascii=False))
    finally:await engine.dispose()
asyncio.run(main())
