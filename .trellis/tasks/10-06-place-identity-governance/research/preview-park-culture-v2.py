"""第56批真实资料隔离验证：完整scope、历史审核保留、导出、幂等和逆序回滚。"""
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
assert hashlib.sha256((root/'all-cities/batch-56-v2-source.json').read_bytes()).hexdigest()=='c639ea73b67c9438e8477212c6339823b3b0b84f0c59cf48b0ca27603c1d40fb'
frozen=read('all-cities/batch-56-v2-source.json');history=read('all-cities/batch-56-v2-catalog.json')
scopes=read('all-cities/batch-56-v2-scope-decisions.json');decisions=read('all-cities/batch-56-v2-decisions.json')
expected={a['mentionId']:a for d in scopes for a in d['assignments']}
park='69ab8bb674e8f0eea31c34c936bddf23';cave='7ac1b9fdfb96a01db695da65d8e81830';temple='c93e3216e2e3cc1b75d07097f2c78367'
async def review_rows(s):
    return [{k:getattr(r,k) for k in ['id','city','fingerprint','status','detail']} for r in (await s.scalars(select(PlaceEntityReview).order_by(PlaceEntityReview.id))).all()]
async def main():
    url=os.environ['IDENTITY_TEST_DATABASE_URL'];assert re.fullmatch(r'postgresql\+asyncpg://postgres@127\.0\.0\.1:18798/place_identity_test_\d+',url)
    engine=create_async_engine(url);factory=async_sessionmaker(engine,expire_on_commit=False,autoflush=False)
    folder=root/'all-cities/batch-56-v2'/f'scope-preview-{time.time_ns()}';folder.mkdir(parents=True,exist_ok=False)
    try:
        async with engine.begin() as c:await c.run_sync(Base.metadata.create_all)
        async with factory() as s:
            for n in frozen['notes']:
                m=next(m for m in frozen['mentions'] if m['raw_note_id']==n['id'])
                s.add(RawNote(id=n['id'],note_id=f"frozen-{n['id']}",city=n['note_city'],keyword='实城冻结',title=n['note_title'],desc=n['note_desc'],
                    img_analysis=n['note_images'],source_url=m['source_url'],status='EXTRACTED',created_at=datetime.fromisoformat(m['observed_at'])))
            await s.flush()
            for g in frozen['sources']:
                await s.execute(insert(CanonicalPlace).values(**g['source'],**g['derivedBefore'],**g['supplement']));s.add(PlaceSummary(**g['summary']))
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
            cat=await load_mention_catalog(s,'济南');assert len(cat.assignments)==4 and len(cat.catalog.entities)==3
            for m in originals:
                result=cat.resolve(m);eid=next(g['entity']['entity_id'] for g in frozen['groups'] if m['id'] in g['mentionIds'])
                assert result['status']=='resolved' and result['entity']['entity_id']==eid
                p=effective_mention(m,result)
                assert p['sentiment']==m['sentiment']
                assert p['reason']==m['reason'] and p['evidence_text']==m['evidence_text']
                fact=copy.deepcopy(m['fact_value'] or {})
                if m['id']==12591:assert fact.pop('minutes')==120
                assert p['fact_value']==fact
                future={**m,'id':m['id']+100000};assert cat.resolve(future)['status']=='review'
            assert await review_rows(s)==history['reviews']==[]
            assert originals==await load_mention_rows(s,'济南');await s.commit()
        exporter.SessionFactory=factory;output=folder/'xhs-places-济南.json'
        sys.argv=['export_to_tripweaver.py','--city','济南','--out',str(output)];await exporter.main()
        exported=json.loads(output.read_text(encoding='utf-8'));assert len(exported['places'])==3
        results=[]
        for p in exported['places']:
            group=next(g for g in frozen['groups'] if g['entity']['entity_id']==p['id']);entity=group['entity'];src=group['sources'][0]['source']
            decision=next((d for d in decisions if d['entityId']==p['id']),None)
            assert p['verified'] is True and p['payload']['identity']['revision']==entity['revision']+1+bool(decision)
            assert p['name']==(decision['canonicalName'] if decision else entity['canonical_name'])
            assert p['category']==('自然' if p['id']==park else '文化') and p['payload']['xhsPlaceType']=='attraction'
            aliases=decision['aliases'] if decision else entity['aliases'];assert set(p['payload']['aliases'])==set(aliases)
            assert sorted(p['payload']['identity']['memberIds'])==sorted(set([*entity['legacy_ids'],*[legacy_id('济南',name) for name in aliases]]))
            assert p['payload'].get('typicalVisitMinutes') is None
            assert sorted(m['mentionId'] for m in p['payload']['mentionSources'])==sorted(group['mentionIds'])
            assert p['payload']['imageIdentity']['approved']==[] and p['payload']['themes']==[]
            assert p['payload']['mentionCount']==len(group['mentionIds'])
            if p['id']==cave:
                assert p['lat'] is None and p['lng'] is None and p['payload']['geoStatus']=='unresolvable'
                assert p['payload']['address']=='千佛山景区内'
                assert any('票价略贵' in e['content'] for e in p['evidence'])
            elif p['id']==temple:
                for k in ['lat','lng']:assert p[k]==entity['overrides'][k]
                assert p['payload']['address']==entity['overrides']['address'] and p['payload']['geoStatus']=='resolved'
                assert p['payload']['content']['highlights'][0]['text']=='院内西蜜脂泉'
            else:
                assert (p['lat'],p['lng'])==(round(src['latitude'],6),round(src['longitude'],6))
                assert p['payload']['address']==src['address'] and len(p['payload']['content']['highlights'])==2
                assert '120' not in json.dumps(p['payload'],ensure_ascii=False)
                assert len(p['payload']['topReasons'])==1 and '沿护城河' in p['payload']['topReasons'][0]
            for highlight in p['payload']['content']['highlights']:
                assert highlight['observedAt'] in {m['observed_at'] for m in frozen['mentions'] if m['id'] in group['mentionIds']}
            results.append({'entityId':p['id'],'name':p['name'],'mentions':p['payload']['mentionCount'],'category':p['category'],'type':p['payload']['xhsPlaceType'],
                'coordinatesCleared':p['id']==cave,'historicLocationPreserved':p['id']==temple,'groupDurationExcluded':p['id']==park})
        async with factory() as s:
            for d in reversed([*scopes,*decisions]):await rollback_decision(s,d['key'])
            after=await load_catalog(s,'济南');assert before.entities==after.entities and before.members==after.members
            assert originals==await load_mention_rows(s,'济南') and await review_rows(s)==history['reviews']
            cat=await load_mention_catalog(s,'济南');assert not cat.scopes and not cat.assignments
            for g in frozen['sources']:
                actual=await s.get(CanonicalPlace,g['source']['id']);raw={**g['source'],**g['derivedBefore']}
                assert {k:getattr(actual,k) for k in raw}==raw
                assert (await s.scalar(select(PlaceSummary).where(PlaceSummary.canonical_place_id==g['source']['id']))).top_reasons==g['summary']['top_reasons']
            await s.rollback()
        report={'batch':56,'variant':'v2','isolated':True,'synthetic':False,'partialCityReconstruction':True,'sources':3,'historicalEntities':3,'mentions':4,'notes':4,
            'confirmedScoped':4,'pendingAdded':0,'historicalReviewPreserved':True,'newEntities':0,'withdrawals':0,'results':results,'idempotent':True,'reverseRollback':True,
            'originalSourcesAndMentionsUnchanged':True,'factExclusions':1,'negativeMentionPreserved':True,'historicLocationPreserved':True,
            'imageComparison':'deferred_by_user','fullReviewPassed':False,'failures':[],'exportSha256':hashlib.sha256(output.read_bytes()).hexdigest()}
        with (folder/'report.json').open('x',encoding='utf-8') as f:json.dump(report,f,ensure_ascii=False,indent=2)
        print(json.dumps({'folder':str(folder.relative_to(root)),**report},ensure_ascii=False))
    finally:await engine.dispose()
asyncio.run(main())
