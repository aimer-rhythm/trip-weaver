"""第43批两景点真实资料隔离SQL/导出/投影/幂等/逆序回滚。"""
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
root=Path(__file__).resolve().parent
def read(p):return json.loads((root/p).read_text(encoding='utf-8'))
source=root/'all-cities/batch-43-source.json'
assert hashlib.sha256(source.read_bytes()).hexdigest()=='d6bd3fd03b529868cd58953cf1f8a709fd6eea4f670c9a4f647f583eeca1f6b8'
frozen=read('all-cities/batch-43-source.json');scopes=read('all-cities/batch-43-scope-decisions.json');decisions=read('all-cities/batch-43-decisions.json')
expected={a['mentionId']:a for s in scopes for a in s['assignments']}
async def main():
    url=os.environ['IDENTITY_TEST_DATABASE_URL'];assert re.fullmatch(r'postgresql\+asyncpg://postgres@127\.0\.0\.1:18798/place_identity_test_\d+',url)
    engine=create_async_engine(url);factory=async_sessionmaker(engine,expire_on_commit=False,autoflush=False)
    folder=root/'all-cities/batch-43'/f'scope-preview-{time.time_ns()}';folder.mkdir(parents=True,exist_ok=False)
    try:
        async with engine.begin() as c:await c.run_sync(Base.metadata.create_all)
        async with factory() as s:
            all_mentions=[m for g in frozen['groups'] for m in g['mentions']]
            for n in frozen['notes']:
                m=next(m for m in all_mentions if m['raw_note_id']==n['id'])
                s.add(RawNote(id=n['id'],note_id=f"frozen-{n['id']}",city=n['note_city'],keyword='实城冻结',title=n['note_title'],desc=n['note_desc'],
                    img_analysis=n['note_images'],source_url=m['source_url'],status='EXTRACTED'))
            await s.flush()
            for g in frozen['groups']:
                await s.execute(insert(CanonicalPlace).values(**g['source'],**g['derivedBefore']))
                await s.execute(insert(PlaceEntity).values(**{k:g['entity'][k] for k in ENTITY_FIELDS}))
                await s.execute(insert(PlaceEntityMember).values(place_id=g['source']['id'],entity_id=g['entity']['entity_id']))
                s.add(PlaceSummary(**g['summary']))
                for m in g['mentions']:s.add(PlaceMention(**{k:m[k] for k in MENTION_FIELDS}))
            await s.commit()
        async with factory() as s:
            originals=copy.deepcopy(await load_mention_rows(s,'济南'));before=await load_catalog(s,'济南')
            assert {m['id']:mention_fingerprint(m) for m in originals}=={i:a['inputHash'] for i,a in expected.items()}
            for d in scopes:
                result=await apply_scope_decision(s,d);assert result==await apply_scope_decision(s,d)
            for d in decisions:
                result=await apply_decision(s,d);assert result==await apply_decision(s,d)
            cat=await load_mention_catalog(s,'济南');assert len(cat.assignments)==60 and len(cat.catalog.entities)==2
            resolved=[];pending=[]
            for m in originals:
                result=cat.resolve(m);a=expected[m['id']];projection=effective_mention(m,result)
                if a['entityId']:
                    assert result['status']=='resolved' and result['entity']['entity_id']==a['entityId'];resolved.append(m['id'])
                else:
                    assert result['status']=='review' and result['reason']=='unassigned_target';pending.append(m['id'])
                    assert projection['reason'] is None and projection['evidence_text'] is None and projection['fact_value']=={}
                if m['id'] in [11336,12564]:
                    assert m['fact_value']['minutes']==60 and 'minutes' not in projection['fact_value']
                    assert projection['reason'] is None and projection['evidence_text']==m['evidence_text']
                if m['id']==12851:assert 'minutes' not in projection['fact_value'] and projection['fact_value']['placeContent']
                if m['id']==12929:
                    assert 'reservation' not in projection['fact_value'] and projection['reason']==m['reason']
                    assert projection['fact_value']['placeContent']==m['fact_value']['placeContent']
            assert len(resolved)==46 and len(pending)==14
            reviews=(await s.scalars(select(PlaceEntityReview))).all();assert len(reviews)==14 and all(r.status=='PENDING' for r in reviews)
            groups=mention_groups('济南',cat,originals)
            assert sorted(groups['entity:136719df189e0dd70cd34be75f6faef4']['durations'])==[30,50,60]
            assert groups['entity:290bf0287b4fc3936cb552acd37abca4']['durations']==[]
            assert originals==await load_mention_rows(s,'济南');await s.commit()
        exporter.SessionFactory=factory;output=folder/'xhs-places-济南.json'
        sys.argv=['export_to_tripweaver.py','--city','济南','--out',str(output)];await exporter.main()
        exported=json.loads(output.read_text(encoding='utf-8'));assert len(exported['places'])==2
        results=[]
        for p in exported['places']:
            g=next(g for g in frozen['groups'] if g['entity']['entity_id']==p['id'])
            assert p['verified'] is True and p['category']=='自然' and p['payload']['identity']['revision']==3
            assert p['payload']['aliases']==g['entity']['aliases']
            assert p['payload']['identity']['memberIds']==g['entity']['legacy_ids']
            assert (p['lat'],p['lng'])==(round(g['source']['latitude'],6),round(g['source']['longitude'],6))
            assert sorted(m['mentionId'] for m in p['payload']['mentionSources'])==sorted(i for i,a in expected.items() if a['entityId']==p['id'])
            assert p['payload']['imageIdentity']['approved']==[] and p['payload']['reservation']=='unknown'
            assert p['payload']['reservationEvidence']==[]
            minutes=50 if p['name']=='黑虎泉' else None
            assert p['payload'].get('typicalVisitMinutes')==minutes
            if p['name']=='黑虎泉':
                assert '石雕虎首' in json.dumps(p,ensure_ascii=False)
                assert '玛瑙泉' not in json.dumps(p,ensure_ascii=False)
                assert '游玩1小时' not in json.dumps(p,ensure_ascii=False)
            else:assert '俯瞰' in json.dumps(p,ensure_ascii=False)
            results.append({'name':p['name'],'mentions':p['payload']['mentionCount'],'effectiveMinutes':minutes,'reservation':'unknown'})
        async with factory() as s:
            for d in reversed([*scopes,*decisions]):await rollback_decision(s,d['key'])
            after=await load_catalog(s,'济南');assert before.entities==after.entities and before.members==after.members
            assert originals==await load_mention_rows(s,'济南')
            cat=await load_mention_catalog(s,'济南');assert not cat.scopes and not cat.assignments
            assert not (await s.scalars(select(PlaceEntityReview))).all()
            for g in frozen['groups']:
                actual=await s.get(CanonicalPlace,g['source']['id']);raw={**g['source'],**g['derivedBefore']}
                assert {k:getattr(actual,k) for k in raw}==raw
            await s.rollback()
        report={'batch':43,'isolated':True,'synthetic':False,'partialCityReconstruction':True,'sources':2,'mentions':60,'notes':42,
            'confirmed':46,'pendingAdded':14,'newEntities':0,'withdrawals':0,'results':results,'idempotent':True,'reverseRollback':True,
            'originalSourcesAndMentionsUnchanged':True,'duplicateDurationSamplesNotWeighted':True,'imageComparison':'deferred_by_user',
            'fullReviewPassed':False,'failures':[],'exportSha256':hashlib.sha256(output.read_bytes()).hexdigest()}
        with (folder/'report.json').open('x',encoding='utf-8') as f:json.dump(report,f,ensure_ascii=False,indent=2)
        print(json.dumps({'folder':str(folder.relative_to(root)),**report},ensure_ascii=False))
    finally:await engine.dispose()
asyncio.run(main())
