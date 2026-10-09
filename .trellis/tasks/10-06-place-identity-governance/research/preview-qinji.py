"""第52批真实资料隔离验证：完整scope、历史审核保留、导出、幂等和逆序回滚。"""
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
from app.clean.mention_identity import MENTION_FIELDS,mention_fingerprint,effective_mention
from scripts import export_to_tripweaver as exporter
root=Path(__file__).resolve().parent
def read(p):return json.loads((root/p).read_text(encoding='utf-8'))
assert hashlib.sha256((root/'all-cities/batch-52-source.json').read_bytes()).hexdigest()=='98cb83f0f63097059936a3b7257c34222c8b8e8bde96cb5fd88fa4a2e1e6099c'
frozen=read('all-cities/batch-52-source.json');history=read('all-cities/batch-52-catalog.json')
scopes=read('all-cities/batch-52-scope-decisions.json');decisions=read('all-cities/batch-52-decisions.json')
expected={a['mentionId']:a for d in scopes for a in d['assignments']}
async def review_rows(s):
    return [{k:getattr(r,k) for k in ['id','city','fingerprint','status','detail']} for r in (await s.scalars(select(PlaceEntityReview).order_by(PlaceEntityReview.id))).all()]
async def main():
    url=os.environ['IDENTITY_TEST_DATABASE_URL'];assert re.fullmatch(r'postgresql\+asyncpg://postgres@127\.0\.0\.1:18798/place_identity_test_\d+',url)
    engine=create_async_engine(url);factory=async_sessionmaker(engine,expire_on_commit=False,autoflush=False)
    folder=root/'all-cities/batch-52'/f'scope-preview-{time.time_ns()}';folder.mkdir(parents=True,exist_ok=False)
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
            cat=await load_mention_catalog(s,'济南');assert len(cat.assignments)==4 and len(cat.catalog.entities)==1
            for m in originals:
                result=cat.resolve(m)
                if m['id'] in [11664,12892]:assert result['status']=='review'
                else:
                    assert result['status']=='resolved' and result['entity']['entity_id']==expected[m['id']]['entityId']
                    p=effective_mention(m,result)
                    assert p['reason']==m['reason'] and p['evidence_text']==m['evidence_text'] and p['fact_value']==(m['fact_value'] or {})
            reviews=await review_rows(s);assert [r for r in reviews if r['id']==369]==history['reviews']
            pending=[r for r in reviews if r['status']=='PENDING'];assert len(pending)==2 and {r['detail']['mentionId'] for r in pending}=={11664,12892}
            assert originals==await load_mention_rows(s,'济南');await s.commit()
        exporter.SessionFactory=factory;output=folder/'xhs-places-济南.json'
        sys.argv=['export_to_tripweaver.py','--city','济南','--out',str(output)];await exporter.main()
        exported=json.loads(output.read_text(encoding='utf-8'));assert len(exported['places'])==1
        results=[]
        for p in exported['places']:
            entity=frozen['groups'][0]['entity'];src=frozen['sources'][0]['source']
            assert p['verified'] is True and p['payload']['identity']['revision']==2
            assert p['name']=='秦记火烧' and p['category']=='美食' and p['payload']['xhsPlaceType']=='food'
            assert p['payload']['aliases']==entity['aliases'] and sorted(p['payload']['identity']['memberIds'])==sorted(entity['legacy_ids'])
            assert sorted(m['mentionId'] for m in p['payload']['mentionSources'])==[11364,12605]
            assert (p['lat'],p['lng'])==(round(src['latitude'],6),round(src['longitude'],6)) and p['payload']['address']==src['address']
            assert p['payload']['mentionCount']==2 and p['payload'].get('typicalVisitMinutes') is None
            assert p['payload']['themes']==[] and p['payload']['imageIdentity']['approved']==[]
            assert p['payload']['topReasons']==['本地人推荐，有特色且味道好']
            assert p['payload']['content']['intro']=='本地人推荐，有特色且味道好。'
            assert len(p['payload']['content']['highlights'])==1
            assert p['payload']['content']['highlights'][0]['observedAt']==next(m for m in frozen['mentions'] if m['id']==11364)['observed_at']
            assert len(p['evidence'])==1 and p['evidence'][0]['content']=='本地人推荐，有特色且味道好'
            serialized=json.dumps(p,ensure_ascii=False)
            assert '肉火烧去制锦市' not in serialized and '其他去河边' not in serialized and '具体菜品未详述' not in serialized
            results.append({'entityId':p['id'],'name':p['name'],'mentions':2,'category':p['category'],'type':p['payload']['xhsPlaceType'],'locationPreservedNotNewlyVerified':True})
        async with factory() as s:
            for d in reversed([*scopes,*decisions]):await rollback_decision(s,d['key'])
            after=await load_catalog(s,'济南');assert before.entities==after.entities and before.members==after.members
            assert originals==await load_mention_rows(s,'济南') and await review_rows(s)==history['reviews']
            cat=await load_mention_catalog(s,'济南');assert not cat.scopes and not cat.assignments
            for g in frozen['sources']:
                actual=await s.get(CanonicalPlace,g['source']['id']);raw={**g['source'],**g['derivedBefore']}
                assert {k:getattr(actual,k) for k in raw}==raw
            await s.rollback()
        report={'batch':52,'isolated':True,'synthetic':False,'partialCityReconstruction':True,'sources':1,'historicalEntities':1,'mentions':4,'notes':3,
            'confirmed':2,'pendingAdded':2,'historicalReviewPreserved':True,'newEntities':0,'withdrawals':0,'results':results,'idempotent':True,'reverseRollback':True,
            'originalSourcesAndMentionsUnchanged':True,'imageComparison':'deferred_by_user','fullReviewPassed':False,'failures':[],
            'exportSha256':hashlib.sha256(output.read_bytes()).hexdigest()}
        with (folder/'report.json').open('x',encoding='utf-8') as f:json.dump(report,f,ensure_ascii=False,indent=2)
        print(json.dumps({'folder':str(folder.relative_to(root)),**report},ensure_ascii=False))
    finally:await engine.dispose()
asyncio.run(main())
