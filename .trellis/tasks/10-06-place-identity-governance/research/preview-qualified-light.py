"""第46批真实限定标题：清错误描述、保持原身份及NULL坐标，幂等逆序回滚。"""
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
from app.clean.mention_identity import MENTION_FIELDS,mention_fingerprint,effective_mention
from scripts import export_to_tripweaver as exporter
root=Path(__file__).resolve().parent
def read(p):return json.loads((root/p).read_text(encoding='utf-8'))
frozen=read('all-cities/batch-46-source.json');history=read('all-cities/batch-46-catalog.json')
scopes=read('all-cities/batch-46-scope-decisions.json');decisions=read('all-cities/batch-46-decisions.json')
assert len(scopes)==1 and len(decisions)==1 and len(frozen['mentions'])==1
expected=scopes[0]['assignments'][0]
async def main():
    url=os.environ['IDENTITY_TEST_DATABASE_URL'];assert re.fullmatch(r'postgresql\+asyncpg://postgres@127\.0\.0\.1:18798/place_identity_test_\d+',url)
    engine=create_async_engine(url);factory=async_sessionmaker(engine,expire_on_commit=False,autoflush=False)
    folder=root/'all-cities/batch-46'/f'scope-preview-{time.time_ns()}';folder.mkdir(parents=True,exist_ok=False)
    try:
        async with engine.begin() as c:await c.run_sync(Base.metadata.create_all)
        async with factory() as s:
            for n in frozen['notes']:
                m=frozen['mentions'][0]
                s.add(RawNote(id=n['id'],note_id=f"frozen-{n['id']}",city=n['note_city'],keyword='实城冻结',title=n['note_title'],desc=n['note_desc'],
                    img_analysis=n['note_images'],source_url=m['source_url'],status='EXTRACTED'))
            await s.flush()
            for g in frozen['sources']:
                await s.execute(insert(CanonicalPlace).values(**g['source'],**g['derivedBefore']));s.add(PlaceSummary(**g['summary']))
            for e in history['entities']:await s.execute(insert(PlaceEntity).values(**{k:e[k] for k in ENTITY_FIELDS}))
            for m in history['members']:await s.execute(insert(PlaceEntityMember).values(**m))
            assert history['reviews']==[]
            for m in frozen['mentions']:s.add(PlaceMention(**{k:m[k] for k in MENTION_FIELDS}))
            await s.commit()
        async with factory() as s:
            originals=copy.deepcopy(await load_mention_rows(s,'济南'));before=await load_catalog(s,'济南')
            assert len(originals)==1 and mention_fingerprint(originals[0])==expected['inputHash']
            for d in scopes:
                result=await apply_scope_decision(s,d);assert result==await apply_scope_decision(s,d)
            for d in decisions:
                result=await apply_decision(s,d);assert result==await apply_decision(s,d)
            cat=await load_mention_catalog(s,'济南');assert len(cat.assignments)==1 and len(cat.catalog.entities)==1
            result=cat.resolve(originals[0]);assert result['status']=='resolved' and result['entity']['entity_id']==expected['entityId']
            assert result['factExclusions']==expected['factExclusions']
            projection=effective_mention(originals[0],result)
            assert projection['reason'] is None and projection['evidence_text'] is None and projection['fact_value']=={}
            assert list((await s.scalars(select(PlaceEntityReview))).all())==[]
            assert originals==await load_mention_rows(s,'济南');await s.commit()
        exporter.SessionFactory=factory;output=folder/'xhs-places-济南.json'
        sys.argv=['export_to_tripweaver.py','--city','济南','--out',str(output)];await exporter.main()
        exported=json.loads(output.read_text(encoding='utf-8'));assert len(exported['places'])==1
        p=exported['places'][0];entity=frozen['groups'][0]['entity']
        assert p['id']==entity['entity_id'] and p['name']==entity['canonical_name'] and p['verified'] is True
        assert p['category']=='文化' and p['payload']['identity']['revision']==4 and p['payload']['xhsPlaceType']=='photo_spot'
        assert p['payload']['aliases']==entity['aliases'] and sorted(p['payload']['identity']['memberIds'])==sorted(entity['legacy_ids'])
        assert [m['mentionId'] for m in p['payload']['mentionSources']]==[12776]
        assert p['payload'].get('typicalVisitMinutes') is None and p['payload']['imageIdentity']['approved']==[]
        assert p['lat'] is None and p['lng'] is None and p['payload']['geoStatus']=='unresolvable'
        assert not p['payload']['content']['intro'] and p['payload']['topReasons']==[] and p['evidence']==[]
        assert '夹心胡同' not in json.dumps(p,ensure_ascii=False)
        async with factory() as s:
            for d in reversed([*scopes,*decisions]):await rollback_decision(s,d['key'])
            after=await load_catalog(s,'济南');assert before.entities==after.entities and before.members==after.members
            assert originals==await load_mention_rows(s,'济南')
            cat=await load_mention_catalog(s,'济南');assert not cat.scopes and not cat.assignments
            assert list((await s.scalars(select(PlaceEntityReview))).all())==[]
            for g in frozen['sources']:
                actual=await s.get(CanonicalPlace,g['source']['id']);raw={**g['source'],**g['derivedBefore']}
                assert {k:getattr(actual,k) for k in raw}==raw
            await s.rollback()
        report={'batch':46,'isolated':True,'synthetic':False,'partialCityReconstruction':True,'sources':1,'historicalEntities':1,'mentions':1,'notes':1,
            'confirmed':1,'pendingAdded':0,'newEntities':0,'withdrawals':0,'factExclusions':3,'idempotent':True,'reverseRollback':True,
            'originalSourcesAndMentionsUnchanged':True,'identityAndNullCoordinatesPreserved':True,'imageComparison':'deferred_by_user','fullReviewPassed':False,'failures':[],
            'sourceSha256':hashlib.sha256((root/'all-cities/batch-46-source.json').read_bytes()).hexdigest(),
            'exportSha256':hashlib.sha256(output.read_bytes()).hexdigest()}
        with (folder/'report.json').open('x',encoding='utf-8') as f:json.dump(report,f,ensure_ascii=False,indent=2)
        print(json.dumps({'folder':str(folder.relative_to(root)),**report},ensure_ascii=False))
    finally:await engine.dispose()
asyncio.run(main())
