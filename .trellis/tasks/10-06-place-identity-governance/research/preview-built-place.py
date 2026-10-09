"""第61批真实资料隔离验证：通用墙名提示串入、商店分店待审、幂等和逆序回滚。"""
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
assert hashlib.sha256((root/'all-cities/batch-61-source.json').read_bytes()).hexdigest()=='f446be273e56ced83f9a1fb78022875ba968638b1372d8e953409ecf167bd334'
frozen=read('all-cities/batch-61-source.json');history=read('all-cities/batch-61-catalog.json')
scopes=read('all-cities/batch-61-scope-decisions.json');decisions=read('all-cities/batch-61-decisions.json')
expected={a['mentionId']:a for d in scopes for a in d['assignments']}
async def review_rows(s):
    return [{k:getattr(r,k) for k in ['id','city','fingerprint','status','detail']} for r in (await s.scalars(select(PlaceEntityReview).order_by(PlaceEntityReview.id))).all()]
async def main():
    url=os.environ['IDENTITY_TEST_DATABASE_URL'];assert re.fullmatch(r'postgresql\+asyncpg://postgres@127\.0\.0\.1:18798/place_identity_test_\d+',url)
    engine=create_async_engine(url);factory=async_sessionmaker(engine,expire_on_commit=False,autoflush=False)
    folder=root/'all-cities/batch-61'/f'scope-preview-{time.time_ns()}';folder.mkdir(parents=True,exist_ok=False)
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
        old_export=await export('before-places.json');assert len(old_export['places'])==2
        old_by_id={p['id']:p for p in old_export['places']}
        assert all(p['verified'] for p in old_by_id.values())
        async with factory() as s:
            originals=copy.deepcopy(await load_mention_rows(s,'济南'));before=await load_catalog(s,'济南')
            assert {m['id']:mention_fingerprint(m) for m in originals}=={i:a['inputHash'] for i,a in expected.items()}
            for d in scopes:
                result=await apply_scope_decision(s,d);assert result==await apply_scope_decision(s,d)
            for d in decisions:
                result=await apply_decision(s,d);assert result==await apply_decision(s,d)
            cat=await load_mention_catalog(s,'济南');assert len(cat.assignments)==2 and len(cat.catalog.entities)==2
            for m in originals:
                result=cat.resolve(m)
                if expected[m['id']]['entityId'] is None:assert result['status']=='review'
                else:
                    assert result['status']=='resolved' and result['entity']['entity_id']==expected[m['id']]['entityId']
                    p=effective_mention(m,result)
                    assert p['reason']==m['reason'] and p['evidence_text']==m['evidence_text'] and p['fact_value']==(m['fact_value'] or {})
                assert cat.resolve({**m,'id':m['id']+100000})['status']=='review'
            reviews=await review_rows(s);assert [r for r in reviews if r['status']!='PENDING']==history['reviews']
            pending=[r for r in reviews if r['status']=='PENDING'];assert len(pending)==1 and {r['detail']['mentionId'] for r in pending}=={mid for mid,a in expected.items() if a['entityId'] is None}
            assert originals==await load_mention_rows(s,'济南');await s.commit()
        exported=await export('xhs-places-济南.json');assert len(exported['places'])==2
        withdrawn=[]
        for p in exported['places']:
            entity=next(g['entity'] for g in frozen['groups'] if g['entity']['entity_id']==p['id'])
            old=old_by_id[p['id']];approved=p['id']=='66c835ba565f34cbd12206d7169c8da1'
            assert p['name']==entity['canonical_name'] and p['category']==('文化' if approved else '其他')
            assert p['payload'].get('xhsPlaceType')==('photo_spot' if approved else None)
            assert set(p['payload']['aliases'])==set(entity['aliases']) and p['payload']['identity']['memberIds']==entity['legacy_ids']
            assert p['verified'] is approved and p['payload']['identity']['revision']==entity['revision']+1
            assert p.get('lat') is None and p.get('lng') is None and p['payload']['imageIdentity']['approved']==[]
            assert [m['mentionId'] for m in p['payload']['mentionSources']]==([12688] if approved else [])
            if approved:
                assert p['payload']['address']=='' and p['payload']['geoStatus']=='unresolvable'
                assert p['payload']['mentionCount']==1 and p['payload']['themes']==[]
                assert p['payload']['content']['highlights']==old['payload']['content']['highlights']
                assert p['payload']['topReasons']==old['payload']['topReasons']
                assert old['evidence']==[]
                assert [(e['kind'],e['content']) for e in p['evidence']]==[('xhs_reason','热门拍照打卡点')]
                assert any('月下观棠' in tip for tip in old['payload']['tips'])
                assert not p['payload'].get('tips')
                assert not p['payload'].get('typicalVisitMinutes')
                for field in ['openHours','reservation','price']:assert p['payload'].get(field)==old['payload'].get(field)
            else:
                assert p['payload']['identityWithdrawal']=={'version':1,'revision':2,'reason':'unavailable_source','candidateIds':[]}
                assert p['evidence']==[]
                for field in ['content','topReasons','address','openHours','reservation','price','tips','themes','typicalVisitMinutes']:
                    assert not p['payload'].get(field),(p['name'],field,p['payload'].get(field))
                withdrawn.append(p['id'])
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
        report={'batch':61,'isolated':True,'synthetic':False,'partialCityReconstruction':True,'sources':2,'historicalEntities':2,'mentions':2,'notes':2,
            'confirmed':1,'pendingAdded':1,'historicalReviewPreserved':True,'newEntities':0,'withdrawals':1,'withdrawnIds':withdrawn,
            'explicitPointCleared':0,'withdrawnCoordinatesRemoved':1,'preciseLocationResolved':False,'confirmedFactsAndDatesPreserved':True,'idempotent':True,'reverseRollback':True,
            'originalSourcesAndMentionsUnchanged':True,'publicationDatesPreserved':True,'imageComparison':'deferred_by_user','fullReviewPassed':False,'failures':[],
            'exportSha256':hashlib.sha256((folder/'xhs-places-济南.json').read_bytes()).hexdigest()}
        with (folder/'report.json').open('x',encoding='utf-8') as f:json.dump(report,f,ensure_ascii=False,indent=2)
        print(json.dumps({'folder':str(folder.relative_to(root)),**report},ensure_ascii=False))
    finally:await engine.dispose()
asyncio.run(main())
