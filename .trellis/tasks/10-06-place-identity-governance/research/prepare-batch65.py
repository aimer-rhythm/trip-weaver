"""八号门洞摄影主体明确化；起凤桥全文只读复核，不跨源认领或合并。"""
from pathlib import Path
import asyncio,hashlib,json,sys
from datetime import datetime,timezone
sys.dont_write_bytecode=True
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0,'D:/Project/xhs-travel-pipeline')
from sqlalchemy import select,text
from app.db import SessionFactory,engine
from app.models import RawNote
from app.aggregate.mention_identity import load_mention_catalog,load_mention_rows
from app.aggregate.image_identity import load_image_rows
from app.clean.mention_identity import mention_fingerprint,scope_matches
root=Path(__file__).resolve().parent
def read(p):return json.loads((root/p).read_text(encoding='utf-8'))
def sha(p):return hashlib.sha256((root/p).read_bytes()).hexdigest()
def digest(v):return hashlib.sha256(json.dumps(v,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()
def write(p,v):
    with (root/p).open('x',encoding='utf-8') as f:json.dump(v,f,ensure_ascii=False,indent=2)
async def main():
    pointer=read('cleaning-scope/current.json');assert pointer['latestAppliedEntityBatch']==64 and not pointer['userAcceptance']
    pp='priority-cities/济南/bridge-text-source-packet-01.json';packet=read(pp)
    assert sha(pp)=='67c7c3a145a9e23e72e39a2818f29e984b2bff7f3dd0290b30832589d4c048f3'
    photo=read('priority-cities/济南/bridge-text-photo-metadata-01.json');assert all(not p['independentSources'] and not p['assignments'] for p in photo['entities'])
    pre=read('priority-cities/济南/bridge-text-photo-preflight-01.json');assert pre['existingPhotoConsumptionPreserved'] and pre['mockEnqueues']==2
    reference='priority-cities/济南/bridge-text-reference-01.json';page=read(reference)
    assert page['ok'] and '起凤桥8号' in page['content'] and '餐厅地点在芙蓉街' in page['content']
    rp='priority-cities/济南/bridge-text-source-review-01.json'
    paths=[f'all-cities/batch-65-{k}.json' for k in ['source','catalog','scope-decisions','decisions','export-expectations']]
    assert all(not (root/p).exists() for p in [rp,*paths])
    reasons={11437:'起凤桥条目将八号用于导航，不能仅凭导航参照把本提及交给门洞或院落；原文有效体验保持，只读待核。',
        12714:'同2618另一抽取，导航八号未证明桥体与门洞同体；不是额外独立来源，维持现行消费。',
        11626:'原文起风桥列在王府池子之后，桥体/门洞粒度仍未充分区分；不凭同场景历史观察替换归属。',
        12920:'同2624再次抽取，维持原始路线、普通消费和待核边界。',
        12585:'原文具名起凤桥，影视取景为社区作者表述，不采用百科的具体片名或新历史结论；本轮不转给八号。',
        12693:'原文路线起凤桥、既有分析导航八号；地图目的地参照不自动等于摄影主体，继续待核。',
        12841:'人多改拍西侧灯笼亭子是有效作者建议，亭子是替代机位，不吞并为起凤桥或门洞；现有警告保持。',
        11458:'原文独立14:30–15:00起凤桥八号，明确古香古色门洞；摄影主体而非餐厅体验，保留30分钟与原看点。',
        12724:'同篇重复抽取，确认同一门洞摄影主体；两个30分钟不相加、不增加独立样本。'}
    eid='fd7c5d9a0af5a1ec9515743d6f05bce5';name='起凤桥八号门洞';selected={};details=[]
    try:
        async with SessionFactory() as s:
            await s.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            cat=await load_mention_catalog(s,'济南');rows=await load_mention_rows(s,'济南')
            for g in packet['groups']:
                assert cat.catalog.entities[g['entity']['entity_id']]==g['entity'] and g['entity']['revision']==1
                assert cat.scope_for_source(g['entity']['primary_place_id']) is None
                current=[m for m in rows if scope_matches({'city':'济南','name_keys':g['nameKeys']},m)]
                assert {m['id']:mention_fingerprint(m) for m in current}=={m['id']:m['inputHash'] for m in packet['mentions'] if m['id'] in g['mentionIds']}
                selected.update({m['id']:m for m in current});assert all(not m['note_unavailable'] for m in current)
            assert set(selected)==set(reasons)
            quote='🕦14:30-15:00📍起凤桥八号（p8）\n📷古香古色的门洞 烟雨江南即视感'
            assert all(quote in selected[mid]['note_desc'] and selected[mid]['fact_value']['minutes']==30 for mid in [11458,12724])
            group=next(g for g in packet['groups'] if g['entity']['entity_id']==eid)
            images=[i for i in await load_image_rows(s,'济南') if i['source_place_id'] in [5392,5479]];assert images==[]
            for n in (await s.scalars(select(RawNote).where(RawNote.id.in_([n['id'] for n in packet['notes']])).order_by(RawNote.id))).all():
                t=next(t for t in packet['noteTimes'] if t['noteId']==n.id)
                assert n.publish_time.isoformat()==t['publishTime'] and n.created_at.isoformat()==t['collectedAt'] and digest(n.raw_json or {})==t['rawJsonSha256']
                details.append({'id':n.id,'city':n.city,'title':n.title,'desc':n.desc,'images':n.img_analysis,'status':n.status,'sourceUrl':n.source_url,
                    'publishedAt':n.publish_time.isoformat(),'observedAt':n.created_at.isoformat(),'analysisSha256':digest(n.img_analysis)})
        proof=[{'kind':'explicit_gate_photography_full_original','file':rp,'quote':quote,'mentionIds':[11458,12724],
            'conclusion':'原文确指八号门洞摄影机位，保留稳定ID及30分钟，不将餐厅、院落、桥体或灯笼亭视为同义。'}]
        scope={'key':'all-cities-20261009-batch-65-source-5392-scope','city':'济南','sourcePlaceId':5392,'expectedSourceHash':group['sources'][0]['sourceHash'],
            'expectedScopeRevision':0,'expectedRevisions':{eid:1},'assignments':[{'mentionId':mid,'inputHash':mention_fingerprint(selected[mid]),'entityId':eid} for mid in [11458,12724]],'evidence':proof}
        decision={'key':'all-cities-20261009-batch-65-gate-name','city':'济南','entityId':eid,'expectedRevisions':{eid:2},'mergeEntityIds':[],
            'canonicalName':name,'aliases':[name],'excludeNames':['起凤桥八号'],'overrides':{},'evidence':proof}
        source={**packet,'sources':[v for g in packet['groups'] for v in g['sources']],
            'mentions':[{**m,'inputHash':mention_fingerprint(m)} for m in selected.values()],'images':images,'noteDetails':details,'reviews':packet['catalog']['reviews']}
        review={'batch':65,'city':'济南','sourcePacket':pp,'sourcePacketSha256':sha(pp),'sourcesRead':2,'sourcesGoverned':1,'mentionsRead':9,
            'fullNotes':6,'assignments':2,'confirmed':2,'pendingAdded':0,'readOnlyMentions':7,'rows':[{'mentionId':m['id'],'noteId':m['raw_note_id'],
            'action':'confirm_gate' if m['id'] in [11458,12724] else 'read_only_bridge_boundary_pending','conclusion':reasons[m['id']]} for m in selected.values()],
            'publicTextEvidence':{'file':reference,'sha256':sha(reference),'url':page['url'],'adopted':'食记正文有起凤桥8号餐饮用法，说明裸名不宜直接当作门洞同义名。',
                'limits':'历史公开用户食记，不证明2026营业、门洞精确坐标或经营主体与现行8号院同一。日期来自页面标注，不作为迁址连续性证明。'},
            'sourceNamePolicy':'新名明确门洞，原名从消费别名排除；旧稳定ID/原始来源名与历史行程仍保留。',
            'bridgePolicy':'不将导航到八号等同于实体同一；七条起凤桥消费、原正负意见、历史part_of审核保持，本轮未解决桥体/门洞边界。',
            'rejectedWebClaims':['百科混合跨城桥梁且方位与既有媒体正文冲突，不用其具体影视片名/坐标','search02泛化主回答不作证据','search03/04超时终态，无新证据'],
            'imageComparison':'deferred_by_user','newImageViews':0,'newEntities':0,'withdrawals':0,'coordinatesCleared':0,'newPreciseLocations':0,
            'currentPointAndAddressPreservedNotNewlyVerified':True,'originalNotesReadInFull':True,'existingImageAnalysesRead':True,'durationMinutes':30,
            'fullReviewPassed':False,'userAcceptance':False,'appliedAtFreeze':False}
        write(rp,review)
        values=[source,packet['catalog'],[scope],[decision],[{'city':'济南','id':eid,'name':name,'revision':3,'verified':True,'mentionIds':[11458,12724]}]]
        for p,v in zip(paths,values):write(p,v)
        print(json.dumps({'batch':65,'sourceSha256':sha(paths[0]),'scopes':1,'assignments':2,'confirmed':2,'readOnlySources':1,'excludeNames':['起凤桥八号'],'applied':False},ensure_ascii=False))
    finally:await engine.dispose()
asyncio.run(main())
