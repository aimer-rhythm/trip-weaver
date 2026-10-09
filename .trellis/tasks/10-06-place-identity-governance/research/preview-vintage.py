"""第50批原始资料隔离预演：不明坐标清除、分类、独立身份及逆序回滚。"""
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
from app.aggregate.mention_identity import load_mention_rows,load_mention_catalog
from app.clean.mention_identity import MENTION_FIELDS,mention_fingerprint
from scripts import export_to_tripweaver as exporter
root=Path(__file__).resolve().parent
def read(p):return json.loads((root/p).read_text(encoding='utf-8'))
assert hashlib.sha256((root/'all-cities/batch-50-source.json').read_bytes()).hexdigest()=='5e5409177eb93db984ddf3c2e1b7f8f7c4bdc187d161990eec5e2bcad68358e4'
frozen=read('all-cities/batch-50-source.json');history=read('all-cities/batch-50-catalog.json');decisions=read('all-cities/batch-50-decisions.json')
async def main():
    url=os.environ['IDENTITY_TEST_DATABASE_URL'];assert re.fullmatch(r'postgresql\+asyncpg://postgres@127\.0\.0\.1:18798/place_identity_test_\d+',url)
    engine=create_async_engine(url);factory=async_sessionmaker(engine,expire_on_commit=False,autoflush=False)
    folder=root/'all-cities/batch-50'/f'identity-preview-{time.time_ns()}';folder.mkdir(parents=True,exist_ok=False)
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
            assert history['reviews']==[]
            for m in frozen['mentions']:s.add(PlaceMention(**{k:m[k] for k in MENTION_FIELDS}))
            await s.commit()
        exporter.SessionFactory=factory
        async def export(name):
            output=folder/name;sys.argv=['export_to_tripweaver.py','--city','济南','--out',str(output)];await exporter.main()
            return json.loads(output.read_text(encoding='utf-8'))
        prior_export=await export('before-places.json')
        async with factory() as s:
            originals=copy.deepcopy(await load_mention_rows(s,'济南'));before=await load_catalog(s,'济南')
            assert {m['id']:mention_fingerprint(m) for m in originals}=={m['id']:m['inputHash'] for m in frozen['mentions']}
            for d in decisions:
                result=await apply_decision(s,d);assert result==await apply_decision(s,d)
            cat=await load_mention_catalog(s,'济南');assert not cat.scopes and not cat.assignments and len(cat.catalog.entities)==2
            for g in frozen['groups']:
                eid=g['entity']['entity_id'];assert cat.catalog.entities[eid]['revision']==2
                for m in originals:
                    if m['id'] in g['mentionIds']:assert cat.resolve(m)['entity']['entity_id']==eid
            assert originals==await load_mention_rows(s,'济南');await s.commit()
        exported=await export('xhs-places-济南.json');assert len(exported['places'])==2
        results=[]
        for p in exported['places']:
            g=next(g for g in frozen['groups'] if g['entity']['entity_id']==p['id']);shop=g['entity']['primary_place_id']==5398
            old=next(v for v in prior_export['places'] if v['id']==p['id'])
            assert p['verified'] and p['payload']['identity']['revision']==2
            assert p['name']==old['name'] and p['payload']['aliases']==old['payload']['aliases']
            assert p['lat'] is None and p['lng'] is None and old['lat'] is not None and old['lng'] is not None
            assert p['category']==('购物' if shop else '美食') and p['payload']['xhsPlaceType']==('shop' if shop else 'cafe')
            assert p['payload']['address']==('山东省济南市市中区经三路120号' if shop else '') and p['payload']['geoStatus']=='unresolvable'
            for field in ['mentionCount','typicalVisitMinutes','topReasons','themes','xhsPlaceType','openHours','reservation','reservationEvidence']:
                assert p['payload'].get(field)==old['payload'].get(field),(p['name'],field)
            for field in ['intro','highlights']:assert p['payload']['content'][field]==old['payload']['content'][field]
            assert p['evidence']==old['evidence'] and p['payload']['mentionCount']==1
            assert 'mentionSources' not in p['payload']
            assert all('纬四路' not in n and '上新街' not in n for n in p['payload']['aliases'])
            results.append({'entityId':p['id'],'name':p['name'],'category':p['category'],'type':p['payload']['xhsPlaceType'],'coordinates':None,'address':p['payload']['address'],'factsPreserved':True})
        async with factory() as s:
            for d in reversed(decisions):await rollback_decision(s,d['key'])
            after=await load_catalog(s,'济南');assert before.entities==after.entities and before.members==after.members
            assert originals==await load_mention_rows(s,'济南')
            assert (await s.scalars(select(PlaceEntityReview))).all()==[]
            for g in frozen['sources']:
                current=await s.get(CanonicalPlace,g['source']['id']);raw={**g['source'],**g['derivedBefore']}
                assert {k:getattr(current,k) for k in raw}==raw
            await s.rollback()
        report={'batch':50,'isolated':True,'synthetic':False,'partialCityReconstruction':True,'sources':2,'historicalEntities':2,'mentions':2,'notes':1,
            'scopesAdded':0,'coordinatesCleared':2,'categoriesCorrected':1,'newPreciseLocations':0,'factsPreserved':True,'newAliases':0,'pendingAdded':0,
            'idempotent':True,'reverseRollback':True,'originalSourcesAndMentionsUnchanged':True,'results':results,'imageComparison':'deferred_by_user','fullReviewPassed':False,'failures':[]}
        with (folder/'report.json').open('x',encoding='utf-8') as f:json.dump(report,f,ensure_ascii=False,indent=2)
        print(json.dumps({'folder':str(folder.relative_to(root)),**report},ensure_ascii=False))
    finally:await engine.dispose()
asyncio.run(main())
