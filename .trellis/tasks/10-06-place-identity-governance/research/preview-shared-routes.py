"""第44批真实四源/四历史实体预演：分配、时长投影、别名与逆序回滚。"""
from pathlib import Path
import asyncio,copy,hashlib,json,os,re,sys,time
sys.dont_write_bytecode=True
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0,'D:/Project/xhs-travel-pipeline')
from sqlalchemy import insert,select
from sqlalchemy.ext.asyncio import create_async_engine,async_sessionmaker
from app.models import Base,CanonicalPlace,PlaceEntity,PlaceEntityMember,PlaceEntityReview,PlaceMention,PlaceSummary,RawNote
from app.aggregate.place_identity import ENTITY_FIELDS,apply_decision,load_catalog,rollback_decision
from app.aggregate.mention_identity import apply_scope_decision,load_mention_rows,load_mention_catalog
from app.aggregate.summary import mention_groups
from app.clean.mention_identity import MENTION_FIELDS,mention_fingerprint,effective_mention
from scripts import export_to_tripweaver as exporter
from scripts.build_visit_duration import extract_note_durations
root=Path(__file__).resolve().parent
def read(p):return json.loads((root/p).read_text(encoding='utf-8'))
assert hashlib.sha256((root/'all-cities/batch-44-source.json').read_bytes()).hexdigest()=='14f24a2b3785ee8fada9f58c7c9cb294478ebbcfc69d63403a2d366487a7f6e3'
frozen=read('all-cities/batch-44-source.json');history=read('all-cities/batch-44-catalog.json')
scopes=read('all-cities/batch-44-scope-decisions.json');decisions=read('all-cities/batch-44-decisions.json')
expected={a['mentionId']:a for d in scopes for a in d['assignments']}
async def main():
    url=os.environ['IDENTITY_TEST_DATABASE_URL'];assert re.fullmatch(r'postgresql\+asyncpg://postgres@127\.0\.0\.1:18798/place_identity_test_\d+',url)
    engine=create_async_engine(url);factory=async_sessionmaker(engine,expire_on_commit=False,autoflush=False)
    folder=root/'all-cities/batch-44'/f'scope-preview-{time.time_ns()}';folder.mkdir(parents=True,exist_ok=False)
    try:
        async with engine.begin() as c:await c.run_sync(Base.metadata.create_all)
        async with factory() as s:
            for n in frozen['notes']:
                m=next(m for m in frozen['mentions'] if m['raw_note_id']==n['id'])
                s.add(RawNote(id=n['id'],note_id=f"frozen-{n['id']}",city=n['note_city'],keyword='实城冻结',title=n['note_title'],desc=n['note_desc'],
                    img_analysis=n['note_images'],source_url=m['source_url'],status='EXTRACTED'))
            await s.flush()
            for g in frozen['sources']:
                await s.execute(insert(CanonicalPlace).values(**g['source'],**g['derivedBefore']));s.add(PlaceSummary(**g['summary']))
            for e in sorted(history['entities'],key=lambda e:e['redirect_to'] is not None):
                await s.execute(insert(PlaceEntity).values(**{k:e[k] for k in ENTITY_FIELDS}))
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
            cat=await load_mention_catalog(s,'济南');assert len(cat.assignments)==107 and len(cat.catalog.entities)==4
            for m in originals:
                a=expected[m['id']];result=cat.resolve(m);projection=effective_mention(m,result)
                if a['entityId']:assert result['status']=='resolved' and result['entity']['entity_id']==a['entityId']
                else:
                    assert result['status']=='review' and result['reason']=='unassigned_target'
                    assert projection['reason'] is None and projection['evidence_text'] is None and projection['fact_value']=={}
                if m['id'] in [11337,12565,11340,12568,11341,12569]:
                    assert m['fact_value']['minutes'] in [60,90] and 'minutes' not in projection['fact_value']
                    assert projection['reason'] is None and projection['evidence_text']==m['evidence_text']
                if m['id'] in [12577,12574]:assert projection['reason'] is None and projection['evidence_text'] is None
            reviews=(await s.scalars(select(PlaceEntityReview))).all();assert len(reviews)==18 and sum(r.status=='PENDING' for r in reviews)==17
            for r in history['reviews']:
                actual=next(x for x in reviews if x.id==r['id']);assert {k:getattr(actual,k) for k in r}==r
            groups=mention_groups('济南',cat,originals)
            for eid,ds in [('15ad3a8280476165635672cb0e43117a',[30,30,30]),('c9c9ce7c33c95b71b859f0ab30bf7136',[30,50,60]),('b58d15060ff3828b071f950487e487db',[])]:
                assert sorted(groups['entity:'+eid]['durations'])==ds
            for g in frozen['groups']:
                for name in g['entity']['aliases']:assert cat.catalog.resolve(name)['entity_id']==g['entity']['entity_id']
            n=next(n for n in frozen['notes'] if n['id']==2554)
            assert extract_note_durations(n['note_desc'],n['note_images'],[(m['name'],m['normalized_name'],m['place_type']) for m in originals if m['raw_note_id']==2554])==[]
            assert originals==await load_mention_rows(s,'济南');await s.commit()
        exporter.SessionFactory=factory;output=folder/'xhs-places-济南.json'
        sys.argv=['export_to_tripweaver.py','--city','济南','--out',str(output)];await exporter.main()
        exported=json.loads(output.read_text(encoding='utf-8'));assert len(exported['places'])==3
        results=[]
        for p in exported['places']:
            g=next(g for g in frozen['groups'] if g['entity']['entity_id']==p['id']);entity=g['entity']
            assert p['verified'] is True and p['category']=='文化' and p['payload']['identity']['revision']==3
            assert p['payload']['aliases']==entity['aliases'] and sorted(p['payload']['identity']['memberIds'])==sorted(entity['legacy_ids'])
            primary=next(v['source'] for v in g['sources'] if v['source']['id']==entity['primary_place_id'])
            assert (p['lat'],p['lng'])==(entity['overrides'].get('lat',round(primary['latitude'],6)),entity['overrides'].get('lng',round(primary['longitude'],6)))
            assert sorted(m['mentionId'] for m in p['payload']['mentionSources'])==sorted(i for i,a in expected.items() if a['entityId']==p['id'])
            minutes={'解放阁':30,'曲水亭街':50,'百花洲':None}[p['name']]
            assert p['payload'].get('typicalVisitMinutes')==minutes
            assert p['payload']['imageIdentity']['approved']==[]
            assert '游玩1.5小时' not in json.dumps(p,ensure_ascii=False)
            if p['name']=='解放阁':assert '游玩1小时' not in json.dumps(p,ensure_ascii=False)
            if p['name']=='百花洲':assert '书香胡同' not in json.dumps(p,ensure_ascii=False)
            assert p['payload']['content'] and p['payload']['topReasons']
            results.append({'name':p['name'],'mentions':p['payload']['mentionCount'],'effectiveMinutes':minutes,'category':p['category']})
        async with factory() as s:
            for d in reversed([*scopes,*decisions]):await rollback_decision(s,d['key'])
            after=await load_catalog(s,'济南');assert before.entities==after.entities and before.members==after.members
            assert originals==await load_mention_rows(s,'济南')
            cat=await load_mention_catalog(s,'济南');assert not cat.scopes and not cat.assignments
            reviews=(await s.scalars(select(PlaceEntityReview).order_by(PlaceEntityReview.id))).all()
            assert [{k:getattr(r,k) for k in history['reviews'][0]} for r in reviews]==history['reviews']
            for g in frozen['sources']:
                actual=await s.get(CanonicalPlace,g['source']['id']);raw={**g['source'],**g['derivedBefore']}
                assert {k:getattr(actual,k) for k in raw}==raw
            await s.rollback()
        report={'batch':44,'isolated':True,'synthetic':False,'partialCityReconstruction':True,'sources':4,'historicalEntities':4,'mentions':107,'notes':51,
            'confirmed':90,'pendingAdded':17,'newEntities':0,'withdrawals':0,'results':results,'idempotent':True,'reverseRollback':True,
            'originalSourcesAndMentionsUnchanged':True,'existingReview366Preserved':True,'duplicateDurationSamplesNotWeighted':True,
            'leadTimeFalsePositiveRejected':True,'imageComparison':'deferred_by_user','fullReviewPassed':False,'failures':[],
            'exportSha256':hashlib.sha256(output.read_bytes()).hexdigest()}
        with (folder/'report.json').open('x',encoding='utf-8') as f:json.dump(report,f,ensure_ascii=False,indent=2)
        print(json.dumps({'folder':str(folder.relative_to(root)),**report},ensure_ascii=False))
    finally:await engine.dispose()
asyncio.run(main())
