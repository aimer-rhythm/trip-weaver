"""第63批真实全文和既有分析的隔离重建、原文警示消费、幂等和倒序回滚。"""
from pathlib import Path
from datetime import datetime
import asyncio,copy,hashlib,json,os,re,sys,time
sys.dont_write_bytecode=True
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0,'D:/Project/xhs-travel-pipeline')
from sqlalchemy import insert,select
from sqlalchemy.ext.asyncio import create_async_engine,async_sessionmaker
from app.models import Base,CanonicalPlace,PlaceEntity,PlaceEntityMember,PlaceEntityReview,PlaceMention,PlaceSummary,RawNote
from app.aggregate.place_identity import ENTITY_FIELDS,load_catalog,rollback_decision
from app.aggregate.mention_identity import apply_scope_decision,load_mention_rows,load_mention_catalog
from app.clean.mention_identity import MENTION_FIELDS,mention_fingerprint,effective_mention
from scripts import export_to_tripweaver as exporter
root=Path(__file__).resolve().parent
def read(p):return json.loads((root/p).read_text(encoding='utf-8'))
frozen=read('all-cities/batch-63-source.json');scope=read('all-cities/batch-63-scope-decisions.json')[0]
assert hashlib.sha256((root/'all-cities/batch-63-source.json').read_bytes()).hexdigest()=='161207196ea38dde4689247e42583111f55db8235f7de3cca75d30b4ffc709e8'
eid=frozen['groups'][0]['entity']['entity_id'];warning=scope['textWarnings'][0]['quote']
async def reviews(s):return [{k:getattr(r,k) for k in ['id','city','fingerprint','status','detail']} for r in (await s.scalars(select(PlaceEntityReview).order_by(PlaceEntityReview.id))).all()]
async def main():
    url=os.environ['IDENTITY_TEST_DATABASE_URL'];assert re.fullmatch(r'postgresql\+asyncpg://postgres@127\.0\.0\.1:18798/place_identity_test_\d+',url)
    engine=create_async_engine(url);factory=async_sessionmaker(engine,expire_on_commit=False,autoflush=False)
    folder=root/'all-cities/batch-63'/f'scope-preview-{time.time_ns()}';folder.mkdir(parents=True,exist_ok=False)
    try:
        async with engine.begin() as c:await c.run_sync(Base.metadata.create_all)
        async with factory() as s:
            for n in frozen['noteDetails']:
                s.add(RawNote(id=n['id'],note_id=f"frozen-{n['id']}",city=n['city'],keyword='实城冻结',title=n['title'],desc=n['desc'],
                    img_analysis=n['images'],source_url=n['sourceUrl'],status=n['status'],created_at=datetime.fromisoformat(n['observedAt']),
                    publish_time=datetime.fromisoformat(n['publishedAt']) if n['publishedAt'] else None))
            await s.flush()
            for g in frozen['sources']:
                await s.execute(insert(CanonicalPlace).values(**g['source'],**g['derivedBefore'],**g['supplement']));s.add(PlaceSummary(**g['summary']))
            for e in frozen['catalog']['entities']:await s.execute(insert(PlaceEntity).values(**{k:e[k] for k in ENTITY_FIELDS}))
            for m in frozen['catalog']['members']:await s.execute(insert(PlaceEntityMember).values(**m))
            for r in frozen['catalog']['reviews']:await s.execute(insert(PlaceEntityReview).values(**r))
            for m in frozen['mentions']:s.add(PlaceMention(**{k:m[k] for k in MENTION_FIELDS}))
            await s.commit()
        exporter.SessionFactory=factory
        async def export(name):
            output=folder/name;sys.argv=['export_to_tripweaver.py','--city','济南','--out',str(output)];await exporter.main()
            return json.loads(output.read_text(encoding='utf-8'))
        before_export=await export('xhs-places-before.json');assert len(before_export['places'])==1
        old=before_export['places'][0]
        assert any('别在芙蓉街买小吃' in t and '山东博物馆' in t for t in old['payload']['tips'])
        assert old['payload']['typicalVisitMinutes']==30 and old['payload']['identity']['revision']==3
        async with factory() as s:
            original=copy.deepcopy(await load_mention_rows(s,'济南'));before=await load_catalog(s,'济南')
            assert {m['id']:mention_fingerprint(m) for m in original}=={m['id']:m['inputHash'] for m in frozen['mentions']}
            result=await apply_scope_decision(s,scope);assert result==await apply_scope_decision(s,scope)
            cat=await load_mention_catalog(s,'济南');assert len(cat.assignments)==30 and len(cat.scopes)==1
            for m in original:
                resolution=cat.resolve(m)
                if m['id'] in [12904,12948]:assert resolution['status']=='review'
                else:
                    assert resolution['status']=='resolved' and resolution['entity']['entity_id']==eid
                    effective=effective_mention(m,resolution)
                    if m['id']==11699:assert effective.get('reason') is None and effective.get('evidence_text') is None
                    else:assert effective['reason']==m['reason'] and effective['evidence_text']==m['evidence_text'] and effective['fact_value']==(m['fact_value'] or {})
                assert cat.resolve({**m,'id':m['id']+100000})['status']=='review'
            assert cat.text_warnings_for(eid)[0]['quote']==warning
            assert len(cat.supplemental_sources())==1
            pending=await reviews(s);assert len(pending)==2 and {r['detail']['mentionId'] for r in pending}=={12904,12948}
            assert original==await load_mention_rows(s,'济南');await s.commit()
        after_export=await export('xhs-places-济南.json');p=after_export['places'][0]
        assert len(after_export['places'])==1 and p['verified'] and p['name']=='芙蓉街'
        for k in ['lat','lng','category']:assert p[k]==old[k]
        for k in ['aliases','address','geoStatus','xhsPlaceType','typicalVisitMinutes','reservation']:
            assert p['payload'].get(k)==old['payload'].get(k),(k,p['payload'].get(k),old['payload'].get(k))
        old_hours=copy.deepcopy(old['payload']['openHours'])
        assert len(old_hours['review'])==1 and old_hours['review'][0]['subject']=='山东博物馆' and old_hours['review'][0]['reason']=='other_entity'
        old_hours['review']=[];assert p['payload']['openHours']==old_hours
        assert p['payload']['identity']['revision']==4
        assert p['payload']['tips']==[warning]
        assert sorted(m['mentionId'] for m in p['payload']['mentionSources'])==sorted(a['mentionId'] for a in scope['assignments'] if a['entityId'])
        assert p['payload']['mentionCount']==28 and p['payload']['imageIdentity']['approved']==[]
        contents={(x['kind'],x['content']) for x in p['evidence']}
        assert ('xhs_warning',warning) in contents
        assert ('xhs_warning','小吃逛逛就行，不必特意吃') in contents and ('xhs_warning','人最多，拥挤，不宜推婴儿车') in contents
        assert all((x['kind'],x['content']) in contents for x in old['evidence'])
        new_highlights=p['payload']['content']['highlights']
        assert all(h in new_highlights for h in old['payload']['content']['highlights'])
        consumer=json.dumps({'content':p['payload']['content'],'tips':p['payload']['tips'],'reasons':p['payload']['topReasons'],'evidence':p['evidence']},ensure_ascii=False)
        for bad in ['茶香排骨','糖醋鲤鱼','三刷认证','量大便宜','晚上去小吃街方便','山东博物馆周一闭馆','自带空瓶']:
            assert bad not in consumer,bad
        supplement=after_export['relationIdentity']['sourceState']['supplementalSources'];assert len(supplement)==1 and supplement[0]['scopePlaceId']==5353
        async with factory() as s:
            await rollback_decision(s,scope['key'])
            cat=await load_mention_catalog(s,'济南');after=await load_catalog(s,'济南')
            assert not cat.scopes and not cat.assignments and not cat.supplemental_sources()
            assert before.entities==after.entities and before.members==after.members and original==await load_mention_rows(s,'济南')
            assert await reviews(s)==frozen['catalog']['reviews']
            for g in frozen['sources']:
                actual=await s.get(CanonicalPlace,g['source']['id']);raw={**g['source'],**g['derivedBefore'],**g['supplement']}
                assert {k:getattr(actual,k) for k in raw}==raw
            for n in frozen['noteDetails']:
                actual=await s.get(RawNote,n['id']);assert actual.img_analysis==n['images'] and actual.desc==n['desc'] and actual.title==n['title']
                assert actual.created_at.isoformat()==n['observedAt'] and (actual.publish_time.isoformat() if actual.publish_time else None)==n['publishedAt']
            await s.commit()
        restored=await export('xhs-places-restored.json')
        def stable(v):
            v=copy.deepcopy(v)
            for p in v['places']:
                if p['payload'].get('content'):p['payload']['content'].pop('compiledAt',None)
            return v['places']
        assert stable(restored)==stable(before_export)
        assert 'supplementalSources' not in restored['relationIdentity']['sourceState']
        report={'batch':63,'isolated':True,'synthetic':False,'partialCityReconstruction':True,'sources':1,'mentions':30,'fullNotes':24,
            'confirmed':28,'pendingAdded':2,'textWarnings':1,'fieldExcludedMentionIds':[11699],'duration':30,'newEntities':0,'withdrawals':0,
            'oldHighlightCount':len(old['payload']['content']['highlights']),'newHighlightCount':len(new_highlights),
            'oldEvidenceCount':len(old['evidence']),'newEvidenceCount':len(p['evidence']),
            'oldTipsCount':len(old['payload']['tips']),'newTipsCount':1,'validOldOpinionsAndHighlightsPreserved':True,
            'sourceDatesAndAnalysisUnchanged':True,'originalSourcesAndMentionsUnchanged':True,'idempotent':True,'reverseRollback':True,
            'imageComparison':'deferred_by_user','fullReviewPassed':False,'failures':[],
            'exportSha256':hashlib.sha256((folder/'xhs-places-济南.json').read_bytes()).hexdigest()}
        with (folder/'report.json').open('x',encoding='utf-8') as f:json.dump(report,f,ensure_ascii=False,indent=2)
        print(json.dumps({'folder':str(folder.relative_to(root)),**report},ensure_ascii=False))
    finally:await engine.dispose()
asyncio.run(main())
