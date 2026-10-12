"""更新已有曲水亭联合scope；完整冻结历史，只修正两条明确的混合看点。"""
from pathlib import Path
import asyncio,copy,hashlib,json,sys
from datetime import datetime,timezone
sys.dont_write_bytecode=True
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0,'D:/Project/xhs-travel-pipeline')
from sqlalchemy import select,text
from app.db import SessionFactory,engine
from app.models import CanonicalPlace,PlaceEntityReview
from app.aggregate.mention_identity import load_mention_catalog,load_mention_rows,source_input,source_keys,scope_snapshot
from app.aggregate.image_identity import load_image_rows
from app.clean.mention_identity import mention_fingerprint,source_fingerprint,scope_matches,validate_fact_exclusions
root=Path(__file__).resolve().parent
eid='c9c9ce7c33c95b71b859f0ab30bf7136'; changed={11369,12610}
def read(p):return json.loads((root/p).read_text(encoding='utf-8'))
def write(p,v):
    with (root/p).open('x',encoding='utf-8') as f:json.dump(v,f,ensure_ascii=False,indent=2)
async def main():
    pointer=read('cleaning-scope/current.json')
    assert pointer['latestAppliedEntityBatch']==48 and pointer['userAcceptance'] is False
    assert pointer['imageComparisonPolicy']['status']=='deferred_by_user'
    old=read('all-cities/batch-44-source.json');g=copy.deepcopy(next(g for g in old['groups'] if g['entity']['entity_id']==eid))
    original=read(old['originalSourceFile'])
    assert hashlib.sha256((root/old['originalSourceFile']).read_bytes()).hexdigest()==old['originalSourceSha256']
    previous=next(d for d in read('all-cities/batch-44-scope-decisions.json') if d['sourcePlaceId']==5352)
    photo=read('priority-cities/济南/qushui-photo-metadata-01.json')['entities'][0]
    assert photo['entityId']==eid and photo['revision']==3 and not photo['independentSources'] and not photo['assignments']
    assert photo['currentImageFields']=={'coverImage':None,'amapPhoto':None,'imageGallery':[]}
    paths=[f'all-cities/batch-49-{kind}.json' for kind in ['source','catalog','scope-decisions','decisions','export-expectations']]
    review_path='priority-cities/济南/qushui-source-review-01.json'
    assert all(not (root/p).exists() for p in [*paths,review_path])
    try:
        async with SessionFactory() as s:
            await s.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            cat=await load_mention_catalog(s,'济南');g['entity']=cat.catalog.entities[eid];assert g['entity']['revision']==3
            scope=cat.scope_for_source(5352);assert scope==cat.scope_for_source(5493) and scope['revision']==1 and scope['source_valid']
            assert scope['change_key']==previous['key'] and scope['joint']
            sources=(await s.scalars(select(CanonicalPlace).where(CanonicalPlace.city=='济南'))).all()
            assert {p.id for p in sources if source_keys(p)&set(g['nameKeys'])}=={5352,5493}
            for item in g['sources']:
                p=next(p for p in sources if p.id==item['source']['id'])
                assert source_fingerprint(source_input(p))==item['sourceHash']
                for k,v in {**item['source'],**item['derivedBefore']}.items():assert getattr(p,k)==v,(p.id,k)
            rows=[m for m in await load_mention_rows(s,'济南') if scope_matches(scope,m)]
            assert {m['id'] for m in rows}==set(g['mentionIds']) and len(rows)==56
            for m in rows:
                assert not m['note_unavailable']
                assert mention_fingerprint(m)==next(v['inputHash'] for v in old['mentions'] if v['id']==m['id'])
            before=await scope_snapshot(s,'济南',5352,g['nameKeys'],[eid],[5352,5493])
            for a in previous['assignments']:
                actual=cat.assignments[a['mentionId']]
                assert actual['entity_id']==a['entityId'] and actual['input_hash']==a['inputHash'] and actual['revision']==1
                assert actual['change_key']==previous['key'] and actual.get('fact_exclusions')==a.get('factExclusions')
            history=[e for key,e in cat.catalog.entities.items() if (cat.catalog.root(key) or {}).get('entity_id')==eid]
            history_ids={e['entity_id'] for e in history}
            reviews=(await s.scalars(select(PlaceEntityReview).where(PlaceEntityReview.city=='济南').order_by(PlaceEntityReview.id))).all()
            related=[{k:getattr(r,k) for k in ['id','city','fingerprint','status','detail']} for r in reviews
                if history_ids&set(r.detail.get('entityIds',[])) or r.detail.get('mentionId') in g['mentionIds']]
            catalog={'entities':history,'members':[{'place_id':pid,'entity_id':value} for pid,value in cat.catalog.members.items() if pid in [5352,5493]],
                'reviews':related,'scopeBefore':before}
            images=[im for im in await load_image_rows(s,'济南') if im['source_place_id'] in [5352,5493]];assert images==[]
            source={'readOnly':True,'capturedAt':datetime.now(timezone.utc).isoformat(),'city':'济南','groups':[g],'sources':g['sources'],
                'mentions':[{**m,'inputHash':mention_fingerprint(m)} for m in rows],
                'notes':[n for n in original['notes'] if n['id'] in {m['raw_note_id'] for m in rows}],
                'images':images,'reviews':related,'originalSourceFile':old['originalSourceFile'],'originalSourceSha256':old['originalSourceSha256']}
        decision=copy.deepcopy(previous);decision.update(key='all-cities-20261009-batch-49-qushui-scope',expectedScopeRevision=1,expectedRevisions={eid:3})
        judgments=[]
        for a in decision['assignments']:
            if a['mentionId'] not in changed:continue
            m=next(m for m in rows if m['id']==a['mentionId']);assert a['entityId'] is None
            quote=next(line for line in m['note_desc'].splitlines() if line.startswith('⒈曲水亭街：'))
            exclusions={'reason':{'reason':'subject_mismatch','quote':quote},
                'place_content':{'reason':'subject_mismatch','quote':quote,'highlightIndexes':[1]}}
            assert validate_fact_exclusions(exclusions,m,eid)==exclusions
            a.update(entityId=eid,factExclusions=exclusions)
            judgments.append({'mentionId':m['id'],'noteId':2546,'inputHash':a['inputHash'],'entityId':eid,'quote':quote,
                'factExclusions':exclusions,'retainedEvidenceText':m['evidence_text'],'retainedHighlight':m['fact_value']['placeContent']['highlights'][0],
                'reason':'独立曲水亭街条目明确街道风貌；起凤桥为单独机位，排除混合reason与看点1，保留街道看点0及有效evidence_text。',
                'status':'reviewed_target'})
        decision['evidence']=[*previous['evidence'],{'kind':'reviewed_partial_highlights','file':review_path,'mentionIds':sorted(changed),
            'conclusion':'全文明确街道主体，逐项排除独立起凤桥机位，原54条分配及其排除策略不变。'}]
        confirmed=[a['mentionId'] for a in decision['assignments'] if a['entityId']];pending=[a['mentionId'] for a in decision['assignments'] if a['entityId'] is None]
        assert len(confirmed)==46 and len(pending)==10
        for a,b in zip(previous['assignments'],decision['assignments']):
            if a['mentionId'] not in changed:assert a==b
        review={'city':'济南','batch':49,'roots':1,'sources':2,'mentions':56,'fullNotes':len(source['notes']),
            'previousReview':'priority-cities/济南/shared-routes-source-review-01.json','priorWholeScopeReviewPreserved':True,
            'allOriginalFingerprintsUnchanged':True,'changedNotesReadInFull':[2546,2837],'confirmed':46,'pending':10,'pendingResolved':sorted(changed),
            'unchangedAssignments':54,'partialHighlightExclusionsAdded':2,'descriptionFieldExclusionsAdded':2,
            'rows':judgments,'retainedPendingFinding':{'entityId':'b58d15060ff3828b071f950487e487db','mentionId':12946,'noteId':2837,
                'quote':'6️⃣曲水亭街、百花洲（p17）\n▪️这两个地方也是紧邻着，有很多文创小店、临水茶座。泉水穿街而过，水底是水草摇曳，岸上是柳树低垂，很岁月静好🌿',
                'reason':'双主体共用描述不能分辨哪些小店或茶座属于百花洲；仅能分看点不足以确认事实归属，保持原待审。','applied':False},
            'locationStatus':'existing_points_preserved_not_newly_verified','imageComparison':'deferred_by_user','fullReviewPassed':False,'appliedAtFreeze':False}
        write(review_path,review)
        for p,v in zip(paths,[source,catalog,[decision],[],[{'city':'济南','id':eid,'name':g['entity']['canonical_name'],'revision':4,'verified':True,'mentionIds':confirmed}]]):write(p,v)
        print(json.dumps({'batch':49,'sourceSha256':hashlib.sha256((root/paths[0]).read_bytes()).hexdigest(),'sources':2,'mentions':56,'notes':len(source['notes']),
            'historyEntities':len(history),'reviews':len(related),'confirmed':46,'pending':10,'unchangedAssignments':54},ensure_ascii=False))
    finally:await engine.dispose()
asyncio.run(main())
