"""第49批已有联合scope升版的真实SQL、消费投影、幂等和逆序回滚。"""
from pathlib import Path
import asyncio,copy,hashlib,json,os,re,sys,time
sys.dont_write_bytecode=True
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0,'D:/Project/xhs-travel-pipeline')
from sqlalchemy import insert,select
from sqlalchemy.ext.asyncio import create_async_engine,async_sessionmaker
from app.models import (Base,CanonicalPlace,CanonicalPlaceSource,PlaceEntity,PlaceEntityMember,PlaceEntityReview,
    PlaceIdentityScope,PlaceIdentityScopeSource,PlaceMentionAssignment,PlaceMention,PlaceSummary,PlaceRelation,RawNote)
from app.aggregate.place_identity import ENTITY_FIELDS,rollback_decision
from app.aggregate.mention_identity import apply_scope_decision,load_mention_rows,load_mention_catalog,scope_snapshot
from app.clean.mention_identity import MENTION_FIELDS,mention_fingerprint,effective_mention
from scripts import export_to_tripweaver as exporter
root=Path(__file__).resolve().parent
def read(p):return json.loads((root/p).read_text(encoding='utf-8'))
assert hashlib.sha256((root/'all-cities/batch-49-source.json').read_bytes()).hexdigest()=='efba37b97e0274256f38b7f7584e0453c61d111cb3db90c4d9184857a2394f3d'
frozen=read('all-cities/batch-49-source.json');history=read('all-cities/batch-49-catalog.json');old=history['scopeBefore']
decision=read('all-cities/batch-49-scope-decisions.json')[0];expected={a['mentionId']:a for a in decision['assignments']}
eid=next(iter(decision['expectedRevisions']));changed={11369,12610}
async def reviews(s):
    return [{k:getattr(r,k) for k in ['id','city','fingerprint','status','detail']} for r in (await s.scalars(select(PlaceEntityReview).order_by(PlaceEntityReview.id))).all()]
async def main():
    url=os.environ['IDENTITY_TEST_DATABASE_URL'];assert re.fullmatch(r'postgresql\+asyncpg://postgres@127\.0\.0\.1:18798/place_identity_test_\d+',url)
    engine=create_async_engine(url);factory=async_sessionmaker(engine,expire_on_commit=False,autoflush=False)
    folder=root/'all-cities/batch-49'/f'scope-preview-{time.time_ns()}';folder.mkdir(parents=True,exist_ok=False)
    try:
        async with engine.begin() as c:await c.run_sync(Base.metadata.create_all)
        async with factory() as s:
            for n in frozen['notes']:
                m=next(m for m in frozen['mentions'] if m['raw_note_id']==n['id'])
                s.add(RawNote(id=n['id'],note_id=f"frozen-{n['id']}",city=n['note_city'],keyword='实城冻结',title=n['note_title'],desc=n['note_desc'],
                    img_analysis=n['note_images'],source_url=m['source_url'],status='EXTRACTED'))
            await s.flush()
            for m in frozen['mentions']:s.add(PlaceMention(**{k:m[k] for k in MENTION_FIELDS}))
            await s.flush()
            for g in frozen['sources']:await s.execute(insert(CanonicalPlace).values(**g['source'],**g['derivedBefore']))
            for e in sorted(history['entities'],key=lambda e:e['entity_id']!=eid):await s.execute(insert(PlaceEntity).values(**{k:e[k] for k in ENTITY_FIELDS}))
            for model,rows in [(PlaceEntityMember,history['members']),(PlaceEntityReview,history['reviews']),
                (PlaceIdentityScope,old['scopes']),(PlaceIdentityScopeSource,old['scopeSources']),(PlaceMentionAssignment,old['assignments']),
                (PlaceSummary,old['summaries']),(CanonicalPlaceSource,old['provenance'])]:
                for row in rows:await s.execute(insert(model).values(**row))
            for r in old['relations']:await s.execute(insert(PlaceRelation).values(city='济南',**r))
            assert old['imageAssignments']==[] and old['imageReviews']==[]
            await s.commit()
        async with factory() as s:
            originals=copy.deepcopy(await load_mention_rows(s,'济南'));prior=await load_mention_catalog(s,'济南')
            assert {m['id']:mention_fingerprint(m) for m in originals}=={i:a['inputHash'] for i,a in expected.items()}
            before=await scope_snapshot(s,'济南',5352,['曲水亭','曲水亭街'],[eid],[5352,5493]);assert before==old
            result=await apply_scope_decision(s,decision);assert result==await apply_scope_decision(s,decision)
            cat=await load_mention_catalog(s,'济南');assert len(cat.assignments)==56 and len(cat.catalog.entities)==2
            assert cat.scopes[5352]['revision']==2 and cat.catalog.entities[eid]['revision']==4
            for m in originals:
                actual=cat.resolve(m);a=expected[m['id']]
                assert actual['status']==('resolved' if a['entityId'] else 'review')
                assert cat.assignments[m['id']]['revision']==2
                if m['id'] in changed:
                    projected=effective_mention(m,actual)
                    assert prior.resolve(m)['status']=='review' and projected['reason'] is None
                    assert projected['evidence_text']==m['evidence_text']
                    assert projected['fact_value']['placeContent']['highlights']==[m['fact_value']['placeContent']['highlights'][0]]
                else:
                    assert actual['status']==prior.resolve(m)['status']
                    if actual['status']=='resolved':assert effective_mention(m,actual)==effective_mention(m,prior.resolve(m))
            wanted=copy.deepcopy(history['reviews'])
            for r in wanted:
                if r['detail'].get('mentionId') in changed:r['status']='RESOLVED'
            assert await reviews(s)==wanted
            assert originals==await load_mention_rows(s,'济南');await s.commit()
        exporter.SessionFactory=factory;output=folder/'xhs-places-济南.json'
        sys.argv=['export_to_tripweaver.py','--city','济南','--out',str(output)];await exporter.main()
        exported=json.loads(output.read_text(encoding='utf-8'));assert len(exported['places'])==1;p=exported['places'][0]
        assert p['id']==eid and p['name']=='曲水亭街' and p['verified'] and p['category']=='文化'
        assert p['payload']['identity']['revision']==4 and p['payload']['typicalVisitMinutes']==50
        assert p['payload']['aliases']==frozen['groups'][0]['entity']['aliases']
        assert sorted(p['payload']['identity']['memberIds'])==sorted(frozen['groups'][0]['entity']['legacy_ids'])
        assert p['payload']['mentionCount']==46 and len(p['payload']['mentionSources'])==46
        assert sorted(m['mentionId'] for m in p['payload']['mentionSources'])==sorted(i for i,a in expected.items() if a['entityId'])
        serialized=json.dumps(p,ensure_ascii=False);assert '起凤桥' not in serialized
        assert any('小桥流水、青石板路' in h['text'] for h in p['payload']['content']['highlights'])
        src=frozen['groups'][0]['sources'][0]['source'];assert (p['lat'],p['lng'])==(round(src['latitude'],6),round(src['longitude'],6))
        async with factory() as s:
            await rollback_decision(s,decision['key'])
            after=await scope_snapshot(s,'济南',5352,['曲水亭','曲水亭街'],[eid],[5352,5493]);assert before==after
            cat=await load_mention_catalog(s,'济南');assert cat.scopes==prior.scopes and cat.assignments==prior.assignments
            assert cat.catalog.entities==prior.catalog.entities and cat.catalog.members==prior.catalog.members
            assert await reviews(s)==history['reviews'] and originals==await load_mention_rows(s,'济南')
            for g in frozen['sources']:
                actual=await s.get(CanonicalPlace,g['source']['id']);raw={**g['source'],**g['derivedBefore']}
                assert {k:getattr(actual,k) for k in raw}==raw
            await s.rollback()
        report={'batch':49,'isolated':True,'synthetic':False,'partialCityReconstruction':True,'sources':2,'historicalEntities':2,'mentions':56,'notes':45,
            'confirmed':46,'pending':10,'pendingResolved':sorted(changed),'historicalReviewsPreserved':13,'unchangedAssignments':54,
            'partialHighlightExclusions':2,'descriptionFieldExclusions':2,'idempotent':True,'reverseRollback':True,
            'existingScopeAndAssignmentsRestored':True,'originalSourcesAndMentionsUnchanged':True,'imageComparison':'deferred_by_user','fullReviewPassed':False,'failures':[],
            'exportSha256':hashlib.sha256(output.read_bytes()).hexdigest()}
        with (folder/'report.json').open('x',encoding='utf-8') as f:json.dump(report,f,ensure_ascii=False,indent=2)
        print(json.dumps({'folder':str(folder.relative_to(root)),**report},ensure_ascii=False))
    finally:await engine.dispose()
asyncio.run(main())
