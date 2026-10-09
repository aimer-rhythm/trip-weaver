"""第59批真实资料隔离验证：迁址旧导航待审、评价保留、幂等和逆序回滚。"""
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
assert hashlib.sha256((root/'all-cities/batch-59-source.json').read_bytes()).hexdigest()=='77fe3d6aa918a4e231b14305e9f626ce21b72c153c8eaa81e75f44de0ebde393'
frozen=read('all-cities/batch-59-source.json');history=read('all-cities/batch-59-catalog.json')
scopes=read('all-cities/batch-59-scope-decisions.json');decisions=read('all-cities/batch-59-decisions.json')
expected={a['mentionId']:a for d in scopes for a in d['assignments']}
async def review_rows(s):
    return [{k:getattr(r,k) for k in ['id','city','fingerprint','status','detail']} for r in (await s.scalars(select(PlaceEntityReview).order_by(PlaceEntityReview.id))).all()]
async def main():
    url=os.environ['IDENTITY_TEST_DATABASE_URL'];assert re.fullmatch(r'postgresql\+asyncpg://postgres@127\.0\.0\.1:18798/place_identity_test_\d+',url)
    engine=create_async_engine(url);factory=async_sessionmaker(engine,expire_on_commit=False,autoflush=False)
    folder=root/'all-cities/batch-59'/f'scope-preview-{time.time_ns()}';folder.mkdir(parents=True,exist_ok=False)
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
        old=(await export('before-places.json'))['places'][0]
        assert '祝舜路1469号' in old['payload']['content']['intro'] and '祝甸站B口' in old['payload']['content']['intro']
        assert len(old['evidence'])==5
        async with factory() as s:
            originals=copy.deepcopy(await load_mention_rows(s,'济南'));before=await load_catalog(s,'济南')
            assert {m['id']:mention_fingerprint(m) for m in originals}=={i:a['inputHash'] for i,a in expected.items()}
            for d in scopes:
                result=await apply_scope_decision(s,d);assert result==await apply_scope_decision(s,d)
            for d in decisions:
                result=await apply_decision(s,d);assert result==await apply_decision(s,d)
            cat=await load_mention_catalog(s,'济南');assert len(cat.assignments)==5 and len(cat.catalog.entities)==1
            for m in originals:
                result=cat.resolve(m)
                if m['id']==11464:assert result['status']=='review'
                else:
                    assert result['status']=='resolved' and result['entity']['entity_id']==expected[m['id']]['entityId']
                    p=effective_mention(m,result)
                    assert p['reason']==m['reason'] and p['evidence_text']==m['evidence_text'] and p['fact_value']==(m['fact_value'] or {})
                assert cat.resolve({**m,'id':m['id']+100000})['status']=='review'
            reviews=await review_rows(s);assert [r for r in reviews if r['status']!='PENDING']==history['reviews']
            pending=[r for r in reviews if r['status']=='PENDING'];assert len(pending)==1 and pending[0]['detail']['mentionId']==11464
            assert originals==await load_mention_rows(s,'济南');await s.commit()
        exported=await export('xhs-places-济南.json');assert len(exported['places'])==1
        p=exported['places'][0];entity=frozen['groups'][0]['entity'];decision=decisions[0]
        ids=[11571,11607,12647,12825]
        assert p['id']==entity['entity_id'] and p['verified'] is True and p['payload']['identity']['revision']==3
        assert p['name']==decision['canonicalName'] and p['category']=='购物' and p['payload']['xhsPlaceType']=='market'
        assert set(p['payload']['aliases'])==set(decision['aliases'])
        assert sorted(p['payload']['identity']['memberIds'])==sorted(set([*entity['legacy_ids'],legacy_id('济南',p['name'])]))
        assert sorted(m['mentionId'] for m in p['payload']['mentionSources'])==ids
        assert p['lat']==old['lat'] and p['lng']==old['lng'] and p['payload']['address']=='祝舜路555号'
        assert p['payload'].get('geoStatus')==old['payload'].get('geoStatus')
        assert p['payload']['mentionCount']==4 and p['payload'].get('typicalVisitMinutes') is None
        assert p['payload']['themes']==[] and p['payload']['imageIdentity']['approved']==[]
        for word in ['祝舜路1469号','祝甸站','夜市火爆，小吃种类丰富，推荐品尝烤冷面、鸡柳等']:
            assert word not in json.dumps(p,ensure_ascii=False)
        assert [h['text'] for h in p['payload']['content']['highlights']]==['超级大的夜市，有时间可逛']
        assert p['payload']['content']['highlights']==old['payload']['content']['highlights'][2:]
        evidence=[{'kind':e['kind'],'content':e['content']} for e in p['evidence']]
        assert sorted((e['kind'],e['content']) for e in evidence)==sorted(('xhs_warning' if m['sentiment']=='negative' else 'xhs_reason',m['reason']) for m in frozen['mentions'] if m['id'] in ids)
        assert sum(e['kind']=='xhs_warning' for e in evidence)==3
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
        report={'batch':59,'isolated':True,'synthetic':False,'partialCityReconstruction':True,'sources':1,'historicalEntities':1,'mentions':5,'notes':4,
            'confirmed':4,'negativeConfirmed':3,'positiveConfirmed':1,'pendingAdded':1,'historicalReviewPreserved':True,'newEntities':0,'withdrawals':0,
            'coordinatesPreservedNotNewlyVerified':True,'addressCorrected':True,'staleNavigationRemoved':True,'idempotent':True,'reverseRollback':True,
            'originalSourcesAndMentionsUnchanged':True,'publicationDatesPreserved':True,'imageComparison':'deferred_by_user','fullReviewPassed':False,'failures':[],
            'exportSha256':hashlib.sha256((folder/'xhs-places-济南.json').read_bytes()).hexdigest()}
        with (folder/'report.json').open('x',encoding='utf-8') as f:json.dump(report,f,ensure_ascii=False,indent=2)
        print(json.dumps({'folder':str(folder.relative_to(root)),**report},ensure_ascii=False))
    finally:await engine.dispose()
asyncio.run(main())
