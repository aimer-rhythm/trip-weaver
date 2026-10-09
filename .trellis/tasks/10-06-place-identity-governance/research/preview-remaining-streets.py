"""第62批真实资料隔离验证：街道类别、明确30分钟停留及品牌分店待审、幂等和逆序回滚。"""
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
from app.clean.identity import legacy_id
from app.clean.mention_identity import MENTION_FIELDS,mention_fingerprint,effective_mention
from scripts import export_to_tripweaver as exporter
root=Path(__file__).resolve().parent
def read(p):return json.loads((root/p).read_text(encoding='utf-8'))
assert hashlib.sha256((root/'all-cities/batch-62-source.json').read_bytes()).hexdigest()=='4a9b3d7ed4789bc055ec5c27596e2286c572be528cd1cb390c7a1e03708fbd1a'
frozen=read('all-cities/batch-62-source.json');history=read('all-cities/batch-62-catalog.json')
scopes=read('all-cities/batch-62-scope-decisions.json');decisions=read('all-cities/batch-62-decisions.json')
expected={a['mentionId']:a for d in scopes for a in d['assignments']}
async def review_rows(s):
    return [{k:getattr(r,k) for k in ['id','city','fingerprint','status','detail']} for r in (await s.scalars(select(PlaceEntityReview).order_by(PlaceEntityReview.id))).all()]
async def main():
    url=os.environ['IDENTITY_TEST_DATABASE_URL'];assert re.fullmatch(r'postgresql\+asyncpg://postgres@127\.0\.0\.1:18798/place_identity_test_\d+',url)
    engine=create_async_engine(url);factory=async_sessionmaker(engine,expire_on_commit=False,autoflush=False)
    folder=root/'all-cities/batch-62'/f'scope-preview-{time.time_ns()}';folder.mkdir(parents=True,exist_ok=False)
    try:
        async with engine.begin() as c:await c.run_sync(Base.metadata.create_all)
        async with factory() as s:
            for n in frozen['notes']:
                m=next(m for m in frozen['mentions'] if m['raw_note_id']==n['id']);t=next(t for t in frozen['noteTimes'] if t['noteId']==n['id'])
                s.add(RawNote(id=n['id'],note_id=f"frozen-{n['id']}",city=n['note_city'],keyword='实城冻结',title=n['note_title'],desc=n['note_desc'],
                    img_analysis=n['note_images'],source_url=m['source_url'],status='EXTRACTED',created_at=datetime.fromisoformat(m['observed_at']),publish_time=datetime.fromisoformat(t['publishTime'])))
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
        old_export=await export('before-places.json');assert len(old_export['places'])==4
        old_by_id={p['id']:p for p in old_export['places']}
        assert all(p['verified'] for p in old_by_id.values())
        async with factory() as s:
            originals=copy.deepcopy(await load_mention_rows(s,'济南'));before=await load_catalog(s,'济南')
            assert {m['id']:mention_fingerprint(m) for m in originals}=={m['id']:m['inputHash'] for m in frozen['mentions']}
            for d in scopes:
                result=await apply_scope_decision(s,d);assert result==await apply_scope_decision(s,d)
            for d in decisions:
                result=await apply_decision(s,d);assert result==await apply_decision(s,d)
            cat=await load_mention_catalog(s,'济南');assert len(cat.assignments)==6 and len(cat.catalog.entities)==4
            for m in originals:
                if m['id'] not in expected:continue
                result=cat.resolve(m)
                if expected[m['id']]['entityId'] is None:assert result['status']=='review'
                else:
                    assert result['status']=='resolved' and result['entity']['entity_id']==expected[m['id']]['entityId']
                    p=effective_mention(m,result)
                    assert p['reason']==m['reason'] and p['evidence_text']==m['evidence_text'] and p['fact_value']==(m['fact_value'] or {})
                assert cat.resolve({**m,'id':m['id']+100000})['status']=='review'
            reviews=await review_rows(s);assert [r for r in reviews if r['status']!='PENDING']==history['reviews']
            pending=[r for r in reviews if r['status']=='PENDING'];assert len(pending)==3 and {r['detail']['mentionId'] for r in pending}=={mid for mid,a in expected.items() if a['entityId'] is None}
            assert originals==await load_mention_rows(s,'济南');await s.commit()
        exported=await export('xhs-places-济南.json');assert len(exported['places'])==4
        withdrawn=[]
        for p in exported['places']:
            e=next(g['entity'] for g in frozen['groups'] if g['entity']['entity_id']==p['id']);sid=e['primary_place_id'];old=old_by_id[p['id']]
            assert p['name']==e['canonical_name'] and p['payload']['identity']['memberIds']==e['legacy_ids']
            assert p['payload']['identity']['revision']==e['revision']+(2 if sid==5393 else 1)
            assert p['payload']['aliases']==e['aliases']
            if sid==5382:
                assert not p['verified'] and p['category']=='其他' and p.get('lat') is None and p.get('lng') is None
                assert p['payload']['identityWithdrawal']=={'version':1,'revision':2,'reason':'unavailable_source','candidateIds':[]}
                assert p['payload']['mentionSources']==[] and p['payload']['imageIdentity']['approved']==[] and p['evidence']==[]
                for k in ['content','topReasons','address','openHours','reservation','price','tips','themes','typicalVisitMinutes','xhsPlaceType']:assert not p['payload'].get(k),(sid,k)
                withdrawn.append(p['id']);continue
            assert p['verified'] and p['lat']==old['lat'] and p['lng']==old['lng']
            assert p['category']==('自然' if sid==5403 else '文化')
            assert p['payload']['xhsPlaceType']==('attraction' if sid==5403 else 'other')
            assert p['payload'].get('address')==old['payload'].get('address') and p['payload'].get('geoStatus')==old['payload'].get('geoStatus')
            if sid==5393:
                assert sorted(m['mentionId'] for m in p['payload']['mentionSources'])==[11460,12690,12726]
                assert p['payload']['typicalVisitMinutes']==old['payload']['typicalVisitMinutes']==30
                assert p['payload']['mentionCount']==3 and p['payload']['content']['highlights']==old['payload']['content']['highlights']
                assert {(x['kind'],x['content']) for x in p['evidence']}=={('xhs_reason','有济南府大字墙，适合拍照'),('xhs_reason','有簪花济南文字墙，热门打卡点'),('xhs_reason','可拍济南府大字墙')}
                assert p['payload']['imageIdentity']['approved']==[]
                for k in ['openHours','reservation','price','tips']:assert p['payload'].get(k)==old['payload'].get(k),(sid,k)
            else:
                assert 'mentionSources' not in p['payload']
                before_payload=copy.deepcopy(old['payload']);after_payload=copy.deepcopy(p['payload'])
                for v in [before_payload,after_payload]:
                    for k in ['identity','xhsPlaceType']:v.pop(k,None)
                    if v.get('content'):v['content'].pop('compiledAt',None)
                assert before_payload==after_payload,(sid,before_payload,after_payload)
                assert p['evidence']==old['evidence']
        assert len(withdrawn)==1
        async with factory() as s:
            for d in reversed([*scopes,*decisions]):await rollback_decision(s,d['key'])
            after=await load_catalog(s,'济南');assert before.entities==after.entities and before.members==after.members
            assert originals==await load_mention_rows(s,'济南') and await review_rows(s)==history['reviews']
            cat=await load_mention_catalog(s,'济南');assert not cat.scopes and not cat.assignments
            for g in frozen['sources']:
                actual=await s.get(CanonicalPlace,g['source']['id']);raw={**g['source'],**g['derivedBefore'],**g['supplement']}
                assert {k:getattr(actual,k) for k in raw}==raw
            for t in frozen['noteTimes']:
                n=await s.get(RawNote,t['noteId']);assert n.publish_time.isoformat()==t['publishTime'] and n.created_at.isoformat()==t['collectedAt']
            await s.rollback()
        report={'batch':62,'isolated':True,'synthetic':False,'partialCityReconstruction':True,'sources':4,'historicalEntities':4,'mentions':37,'notes':28,
            'confirmed':3,'pendingAdded':3,'historicalReviewPreserved':True,'newEntities':0,'withdrawals':1,'withdrawnIds':withdrawn,
            'explicitPointCleared':0,'withdrawnCoordinatesRemoved':1,'categoryDecisions':3,'preciseLocationResolved':False,'confirmedFactsAndDatesPreserved':True,'idempotent':True,'reverseRollback':True,
            'originalSourcesAndMentionsUnchanged':True,'publicationDatesPreserved':True,'imageComparison':'deferred_by_user','fullReviewPassed':False,'failures':[],
            'exportSha256':hashlib.sha256((folder/'xhs-places-济南.json').read_bytes()).hexdigest()}
        with (folder/'report.json').open('x',encoding='utf-8') as f:json.dump(report,f,ensure_ascii=False,indent=2)
        print(json.dumps({'folder':str(folder.relative_to(root)),**report},ensure_ascii=False))
    finally:await engine.dispose()
asyncio.run(main())
