"""第53批真实资料隔离验证：完整scope、历史审核保留、导出、幂等和逆序回滚。"""
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
assert hashlib.sha256((root/'all-cities/batch-53-source.json').read_bytes()).hexdigest()=='63f73a5c07c562769ed6413129bbabecdbade9ac7a569d6ae671d28280789392'
frozen=read('all-cities/batch-53-source.json');history=read('all-cities/batch-53-catalog.json')
scopes=read('all-cities/batch-53-scope-decisions.json');decisions=read('all-cities/batch-53-decisions.json')
expected={a['mentionId']:a for d in scopes for a in d['assignments']}
async def review_rows(s):
    return [{k:getattr(r,k) for k in ['id','city','fingerprint','status','detail']} for r in (await s.scalars(select(PlaceEntityReview).order_by(PlaceEntityReview.id))).all()]
async def main():
    url=os.environ['IDENTITY_TEST_DATABASE_URL'];assert re.fullmatch(r'postgresql\+asyncpg://postgres@127\.0\.0\.1:18798/place_identity_test_\d+',url)
    engine=create_async_engine(url);factory=async_sessionmaker(engine,expire_on_commit=False,autoflush=False)
    folder=root/'all-cities/batch-53'/f'scope-preview-{time.time_ns()}';folder.mkdir(parents=True,exist_ok=False)
    try:
        async with engine.begin() as c:await c.run_sync(Base.metadata.create_all)
        async with factory() as s:
            for n in frozen['notes']:
                m=next(m for m in frozen['mentions'] if m['raw_note_id']==n['id'])
                s.add(RawNote(id=n['id'],note_id=f"frozen-{n['id']}",city=n['note_city'],keyword='实城冻结',title=n['note_title'],desc=n['note_desc'],
                    img_analysis=n['note_images'],source_url=m['source_url'],status='EXTRACTED',created_at=datetime.fromisoformat(m['observed_at'])))
            await s.flush()
            for g in frozen['sources']:
                await s.execute(insert(CanonicalPlace).values(**g['source'],**g['derivedBefore']));s.add(PlaceSummary(**g['summary']))
            for e in history['entities']:await s.execute(insert(PlaceEntity).values(**{k:e[k] for k in ENTITY_FIELDS}))
            for m in history['members']:await s.execute(insert(PlaceEntityMember).values(**m))
            for r in history['reviews']:await s.execute(insert(PlaceEntityReview).values(**r))
            for m in frozen['mentions']:s.add(PlaceMention(**{k:m[k] for k in MENTION_FIELDS}))
            await s.commit()
        async with factory() as s:
            originals=copy.deepcopy(await load_mention_rows(s,'济南'));before=await load_catalog(s,'济南')
            assert {m['id']:mention_fingerprint(m) for m in originals}=={i:a['inputHash'] for i,a in expected.items()}
            for d in scopes:
                result=await apply_scope_decision(s,d);assert result==await apply_scope_decision(s,d)
            for d in decisions:
                result=await apply_decision(s,d);assert result==await apply_decision(s,d)
            cat=await load_mention_catalog(s,'济南');assert len(cat.assignments)==6 and len(cat.catalog.entities)==2
            for m in originals:
                result=cat.resolve(m)
                if m['id'] in [11708,12846,12890]:assert result['status']=='review'
                else:
                    assert result['status']=='resolved' and result['entity']['entity_id']==expected[m['id']]['entityId']
                    p=effective_mention(m,result)
                    assert p['reason']==m['reason'] and p['evidence_text']==m['evidence_text'] and p['fact_value']==(m['fact_value'] or {})
            for m in originals:
                future={**m,'id':m['id']+100000};assert cat.resolve(future)['status']=='review'
            reviews=await review_rows(s);assert [r for r in reviews if r['status']!='PENDING']==history['reviews']
            pending=[r for r in reviews if r['status']=='PENDING'];assert len(pending)==3 and {r['detail']['mentionId'] for r in pending}=={11708,12846,12890}
            assert originals==await load_mention_rows(s,'济南');await s.commit()
        exporter.SessionFactory=factory;output=folder/'xhs-places-济南.json'
        sys.argv=['export_to_tripweaver.py','--city','济南','--out',str(output)];await exporter.main()
        exported=json.loads(output.read_text(encoding='utf-8'));assert len(exported['places'])==2
        results=[]
        for p in exported['places']:
            group=next(g for g in frozen['groups'] if g['entity']['entity_id']==p['id'])
            entity=group['entity'];src=group['sources'][0]['source'];decision=next(d for d in decisions if d['entityId']==p['id'])
            mention_ids=sorted(i for i,a in expected.items() if a['entityId']==p['id'])
            assert p['verified'] is True and p['payload']['identity']['revision']==3
            assert p['name']==decision['canonicalName'] and p['category']=='美食' and p['payload']['xhsPlaceType']=='food'
            assert set(entity['aliases']).issubset(p['payload']['aliases']) and p['name'] in p['payload']['aliases']
            assert sorted(p['payload']['identity']['memberIds'])==sorted(set([*entity['legacy_ids'],legacy_id('济南',p['name'])]))
            assert sorted(m['mentionId'] for m in p['payload']['mentionSources'])==mention_ids
            assert (p['lat'],p['lng'])==(round(src['latitude'],6),round(src['longitude'],6)) and p['payload']['address']==src['address']
            assert p['payload']['mentionCount']==len(mention_ids) and p['payload'].get('typicalVisitMinutes') is None
            assert p['payload']['themes']==[] and p['payload']['imageIdentity']['approved']==[]
            serialized=json.dumps(p,ensure_ascii=False)
            for text in ['锅底收费17','口味太单调','乱收费','17元','蔬菜32']:
                assert text not in serialized,text
            texts={'cc3ebff96b9f814d82ef808324a42400':['锅底非常简单就是清水加葱姜','调料麻汁配特炸的辣椒油加韭花酱','到店每一桌上四菜加一盘羊肉'],
                '97c845bd4afbe220afe8545ed5030c95':['招牌菜有虾酱馒头片、各种烤串','纬九路烧烤，口碑好']}[p['id']]
            assert [h['text'] for h in p['payload']['content']['highlights']]==texts
            observed={m['observed_at'] for m in frozen['mentions'] if m['id'] in mention_ids}
            assert all(h['observedAt'] in observed for h in p['payload']['content']['highlights'])
            assert len(p['evidence'])==len(mention_ids)
            results.append({'entityId':p['id'],'name':p['name'],'mentions':len(mention_ids),'category':p['category'],'type':p['payload']['xhsPlaceType'],'locationPreservedNotNewlyVerified':True})
        async with factory() as s:
            for d in reversed([*scopes,*decisions]):await rollback_decision(s,d['key'])
            after=await load_catalog(s,'济南');assert before.entities==after.entities and before.members==after.members
            assert originals==await load_mention_rows(s,'济南') and await review_rows(s)==history['reviews']
            cat=await load_mention_catalog(s,'济南');assert not cat.scopes and not cat.assignments
            for g in frozen['sources']:
                actual=await s.get(CanonicalPlace,g['source']['id']);raw={**g['source'],**g['derivedBefore']}
                assert {k:getattr(actual,k) for k in raw}==raw
            await s.rollback()
        report={'batch':53,'isolated':True,'synthetic':False,'partialCityReconstruction':True,'sources':2,'historicalEntities':2,'mentions':6,'notes':6,
            'confirmed':3,'pendingAdded':3,'historicalReviewPreserved':True,'newEntities':0,'withdrawals':0,'results':results,'idempotent':True,'reverseRollback':True,
            'originalSourcesAndMentionsUnchanged':True,'imageComparison':'deferred_by_user','fullReviewPassed':False,'failures':[],
            'exportSha256':hashlib.sha256(output.read_bytes()).hexdigest()}
        with (folder/'report.json').open('x',encoding='utf-8') as f:json.dump(report,f,ensure_ascii=False,indent=2)
        print(json.dumps({'folder':str(folder.relative_to(root)),**report},ensure_ascii=False))
    finally:await engine.dispose()
asyncio.run(main())
