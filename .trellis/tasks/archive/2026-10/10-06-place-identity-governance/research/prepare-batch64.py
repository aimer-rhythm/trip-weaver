"""三家有地址限定的餐馆完整提及治理；华祥地址疑问只读保留。"""
from pathlib import Path
from datetime import datetime,timezone
import asyncio,hashlib,json,sys
sys.dont_write_bytecode=True
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0,'D:/Project/xhs-travel-pipeline')
from sqlalchemy import text,select
from app.db import SessionFactory,engine
from app.models import RawNote
from app.aggregate.mention_identity import load_mention_catalog,load_mention_rows
from app.aggregate.image_identity import load_image_rows
from app.clean.mention_identity import mention_fingerprint,scope_matches
root=Path(__file__).resolve().parent
def read(p):return json.loads((root/p).read_text(encoding='utf-8'))
def digest(v):return hashlib.sha256(json.dumps(v,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()
def write(p,v):
    with (root/p).open('x',encoding='utf-8') as f:json.dump(v,f,ensure_ascii=False,indent=2)
async def main():
    pointer=read('cleaning-scope/current.json');assert pointer['latestAppliedEntityBatch']==63 and not pointer['userAcceptance']
    pp='priority-cities/济南/last-restaurants-source-packet-01.json';packet=read(pp)
    assert hashlib.sha256((root/pp).read_bytes()).hexdigest()=='f3c5abdc029e349763d90476baf9bcba5fb4156a663d068985ba521dfea591c0'
    photo=read('priority-cities/济南/last-restaurants-photo-metadata-01.json');assert len(photo['entities'])==4
    assert all(not p['independentSources'] and not p['assignments'] for p in photo['entities'])
    pre=read('priority-cities/济南/last-restaurants-photo-preflight-01.json');assert pre['existingPhotoConsumptionPreserved'] and pre['mockEnqueues']==4
    web=read('priority-cities/济南/last-restaurants-web-review-01.json');assert web['fetchedEvidenceChecked'] and web['xuWrongPointEvidence']
    rp='priority-cities/济南/last-restaurants-source-review-01.json'
    paths=[f'all-cities/batch-64-{kind}.json' for kind in ['source','catalog','scope-decisions','decisions','export-expectations']]
    assert all(not (root/p).exists() for p in [rp,*paths])
    names={5331:'许记排骨（县东巷71号）',5343:'桥下把子肉（山大南路店）',5340:'蜗牛叔叔的食堂（泉城路店）'}
    quotes={5331:'县东巷71号',5343:'山大南路蜀易火锅隔壁',5340:'泉城路',5345:'大观园南门西行100米路北'}
    comments={11353:'原文明确县东巷71号，保留整篇清单的作者正评。',12594:'同篇再次抽取，身份明确，不算额外独立来源。',
        12893:'裸名在美食清单中，另一景点路线不能给餐馆定位；待核县东巷71号归属，不声称已经证明有多分店。',
        11365:'原文明确山大南路蜀易火锅隔壁，公开文旅正文同址且明确山大南路店。',12606:'同篇重复抽取地址明确，保留原正评。',
        11643:'另一篇明确二环东路山大南路，与山大南路东段门店支持一致；不继承上一条老苏只有早午餐的时段。',
        11362:'原文泉城路，公开餐馆正文明确泉城路店及狮子口街参照，与当前源街区一致。',12603:'同篇重复提及，保留清单作者正评，不增加独立来源。',
        11367:'原文大观园南门附近，公开经五路/饮虎池街地址不能证明同店连续性，维持原始消费待核。',12608:'同篇重复抽取，门店对应仍待核，不强行改为公开经五路店。'}
    scopes=[];decisions=[];expectations=[];reviewed=[];selected={}
    try:
        async with SessionFactory() as s:
            await s.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            cat=await load_mention_catalog(s,'济南');rows=await load_mention_rows(s,'济南')
            for g in packet['groups']:
                e=g['entity'];eid=e['entity_id'];sid=e['primary_place_id']
                assert e['revision']==1 and cat.catalog.entities[eid]==e and cat.scope_for_source(sid) is None
                current=[m for m in rows if scope_matches({'city':'济南','name_keys':g['nameKeys']},m)]
                assert {m['id']:mention_fingerprint(m) for m in current}=={m['id']:m['inputHash'] for m in packet['mentions'] if m['id'] in g['mentionIds']}
                assignments=[]
                for m in current:
                    assert not m['note_unavailable'];selected[m['id']]=m
                    if m['raw_note_id']==2585:assert quotes[sid] in m['note_desc']
                    target=None if m['id']==12893 else eid
                    assignments.append({'mentionId':m['id'],'inputHash':mention_fingerprint(m),'entityId':target})
                    reviewed.append({'mentionId':m['id'],'noteId':m['raw_note_id'],'conclusion':comments[m['id']],
                        'action':'unchanged_address_identity_pending' if sid==5345 else 'pending_location_qualifier' if target is None else 'confirm'})
                if sid==5345:continue
                key=f'all-cities-20261009-batch-64-source-{sid}'
                scopes.append({'key':key+'-scope','city':'济南','sourcePlaceId':sid,'expectedSourceHash':g['sources'][0]['sourceHash'],
                    'expectedScopeRevision':0,'expectedRevisions':{eid:1},'assignments':assignments,
                    'evidence':[{'kind':'full_original_and_fetched_branch_evidence','file':rp,'conclusion':'完整提及审核；保留真实作者观点，未来新提及须复核。无图片查看。'}]})
                overrides={}
                if sid==5331:overrides={'address':'县东巷71号','lat':None,'lng':None,'geoStatus':'unresolvable'}
                if sid==5343:overrides={'address':'山大南路蜀易火锅隔壁'}
                decisions.append({'key':key+'-branch-name','city':'济南','entityId':eid,'expectedRevisions':{eid:2},'mergeEntityIds':[],
                    'canonicalName':names[sid],'aliases':list(dict.fromkeys([*e['aliases'],names[sid]])),'overrides':overrides,
                    'evidence':[{'kind':'original_address_and_fetched_branch_name','file':'priority-cities/济南/last-restaurants-web-review-01.json',
                        'conclusion':'许记为地址限定展示名，不冒充官方分店名；桥下/蜗牛分店名有抓取正文。许记明显偏离老城旧点清空待核，其余两点未新验证，保持。蜗牛旧狮子口街地址保持，不将历史评论证明为2026营业。'}]})
                expectations.append({'city':'济南','id':eid,'name':names[sid],'revision':3,'verified':True,'mentionIds':sorted(a['mentionId'] for a in assignments if a['entityId'])})
            assert set(selected)==set(comments)
            images=[i for i in await load_image_rows(s,'济南') if i['source_place_id'] in [5331,5343,5340,5345]];assert images==[]
            details=[]
            for n in (await s.scalars(select(RawNote).where(RawNote.id.in_([2585,2602,2856])).order_by(RawNote.id))).all():
                t=next(t for t in packet['noteTimes'] if t['noteId']==n.id)
                assert n.publish_time.isoformat()==t['publishTime'] and n.created_at.isoformat()==t['collectedAt'] and digest(n.raw_json or {})==t['rawJsonSha256']
                details.append({'id':n.id,'city':n.city,'title':n.title,'desc':n.desc,'images':n.img_analysis or [],'status':n.status,
                    'sourceUrl':n.source_url,'publishedAt':n.publish_time.isoformat(),'observedAt':n.created_at.isoformat(),'analysisSha256':digest(n.img_analysis or [])})
        source={**packet,'sources':[v for g in packet['groups'] for v in g['sources']],
            'mentions':[{**m,'inputHash':mention_fingerprint(m)} for m in selected.values()],'images':images,'noteDetails':details,'reviews':packet['catalog']['reviews']}
        review={'city':'济南','batch':64,'sourcePacket':pp,'sourcePacketSha256':hashlib.sha256((root/pp).read_bytes()).hexdigest(),
            'sourcesRead':4,'sourcesGoverned':3,'mentionsRead':10,'assignments':8,'confirmed':7,'pending':1,'readOnlyMentions':2,'fullNotes':3,'rows':reviewed,
            'newEntities':0,'withdrawals':0,'coordinatesCleared':1,'newPreciseLocations':0,'otherTwoCoordinatesPreserved':True,
            'originalNotesReadInFull':True,'existingImageAnalysesRead':True,'factExclusions':0,'validOriginalOpinionsPreservedForConfirmedMentions':True,
            'huaXiangUnchangedReason':'大观园南门、经五路东首与饮虎池街地址之间没有足够同店连续性证据，旧ID/名字/点/消费保持待核，不合并也不猜官方店名。',
            'imageComparison':'deferred_by_user','fullReviewPassed':False,'userAcceptance':False,'appliedAtFreeze':False}
        write(rp,review)
        for p,v in zip(paths,[source,packet['catalog'],scopes,decisions,expectations]):write(p,v)
        print(json.dumps({'batch':64,'sourceSha256':hashlib.sha256((root/paths[0]).read_bytes()).hexdigest(),'scopes':3,'assignments':8,'confirmed':7,'pending':1,'readOnlySources':1,'applied':False},ensure_ascii=False))
    finally:await engine.dispose()
asyncio.run(main())
