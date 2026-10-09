"""恢复原始饮品分店身份，隔离导航装置事实并清除不相容旧位置。"""
from pathlib import Path
from datetime import datetime,timezone
import asyncio,hashlib,json,math,sys
sys.dont_write_bytecode=True
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0,'D:/Project/xhs-travel-pipeline')
from sqlalchemy import text
from app.db import SessionFactory,engine
from app.aggregate.mention_identity import load_mention_catalog,load_mention_rows
from app.aggregate.image_identity import load_image_rows
from app.clean.mention_identity import mention_fingerprint,scope_matches
root=Path(__file__).resolve().parent
def read(p):return json.loads((root/p).read_text(encoding='utf-8'))
def sha(p):return hashlib.sha256((root/p).read_bytes()).hexdigest()
def write(p,v):
    with (root/p).open('x',encoding='utf-8') as f:json.dump(v,f,ensure_ascii=False,indent=2)
def km(a,b):
    lat1,lat2=map(math.radians,[a[0],b[0]]);dlat=lat2-lat1;dlon=math.radians(b[1]-a[1])
    return round(6371*2*math.asin(math.sqrt(math.sin(dlat/2)**2+math.cos(lat1)*math.cos(lat2)*math.sin(dlon/2)**2)),3)
async def main():
    pointer=read('cleaning-scope/current.json');assert pointer['latestAppliedEntityBatch']==53 and not pointer['userAcceptance']
    assert pointer['imageComparisonPolicy']['status']=='deferred_by_user' and pointer['mapCredentialGate']['status']=='rotation_required'
    packet_path='priority-cities/济南/beverage-branches-source-packet-01.json';packet=read(packet_path)
    assert sha(packet_path)=='decbdf54d77392a3cb6c66e834c26c5e669d73bd0c21696fc352a3f44aa347c4'
    original=read(packet['originalSourceFile']);assert sha(packet['originalSourceFile'])==packet['originalSourceSha256']
    photos=read('priority-cities/济南/beverage-branches-photo-metadata-01.json')
    reference_path='priority-cities/济南/beverage-reference-02.json';reference=read(reference_path)
    boundary='在济南市的经三路、纬三路、经四路和纬四路这个方形地块里'
    assert reference['ok'] and boundary in reference['content']
    review_path='priority-cities/济南/beverage-branches-source-review-01.json'
    paths=[f'all-cities/batch-54-{kind}.json' for kind in ['source','catalog','scope-decisions','decisions','export-expectations']]
    assert all(not (root/p).exists() for p in [review_path,*paths])
    scopes=[];decisions=[];expectations=[];reviewed=[];selected={}
    reference_place=next(p for p in read('all-cities/batch-53/sync-01/xhs-places-济南.json')['places'] if p['id']=='46bf462d545dc6435d6de296ba099d0f')
    try:
        async with SessionFactory() as s:
            await s.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            cat=await load_mention_catalog(s,'济南');all_mentions=await load_mention_rows(s,'济南')
            for g in packet['groups']:
                eid=g['entity']['entity_id'];sid=g['entity']['primary_place_id'];src=g['sources'][0]['source']
                assert cat.catalog.entities[eid]==g['entity'] and cat.scope_for_source(sid) is None
                photo=next(e for e in photos['entities'] if e['entityId']==eid)
                assert photo['revision']==1 and not photo['independentSources'] and not photo['assignments'] and all(v is None for v in photo['currentImageFields'].values())
                current=[m for m in all_mentions if scope_matches({'city':'济南','name_keys':g['nameKeys']},m)]
                assert len(current)==1
                assert {m['id']:mention_fingerprint(m) for m in current}=={m['id']:m['inputHash'] for m in packet['mentions'] if m['id'] in g['mentionIds']}
                m=current[0];assert not m['note_unavailable'] and m['raw_note_id']==2566;selected[m['id']]=m
                name=m['name'];quote=name+'【'+m['evidence_text']+'】';assert quote in m['note_desc']
                assert '老商埠店' in name and '打卡' in m['reason'] and len(m['fact_value']['placeContent']['highlights'])==1
                exclusions={field:{'reason':'subject_mismatch','quote':quote} for field in ['reason','evidence_text','place_content']}
                assignments=[{'mentionId':m['id'],'inputHash':mention_fingerprint(m),'entityId':eid,'factExclusions':exclusions}]
                key=f'all-cities-20261009-batch-54-source-{sid}'
                scopes.append({'key':key+'-scope','city':'济南','sourcePlaceId':sid,'expectedSourceHash':g['sources'][0]['sourceHash'],'expectedScopeRevision':0,
                    'expectedRevisions':{eid:1},'assignments':assignments,'evidence':[{'kind':'reviewed_branch_navigation_anchor','file':review_path,'mentionIds':[m['id']],
                    'conclusion':'原文明确商店分店名称，但全部描述均为独立雕塑/车/天桥的摄影动作，不作为饮品店自身体验或设施事实；原摄影线索保留，装置位置和归属继续待核。'}]})
                overrides={'lat':None,'lng':None,'address':'融汇济南老商埠','geoStatus':'unresolvable'}
                decisions.append({'key':key+'-branch-name-and-location','city':'济南','entityId':eid,'expectedRevisions':{eid:2},'mergeEntityIds':[],
                    'canonicalName':name,'aliases':list(dict.fromkeys([*g['entity']['aliases'],name])),'overrides':overrides,
                    'evidence':[{'kind':'restore_original_branch_and_remove_incompatible_location','file':review_path,'originalMentionIds':[m['id']],
                    'conclusion':'原提及明确老商埠店；喜茶旧地址恒隆广场与之冲突，两旧点均不在原路线街区。只写原文支持的街区范围，不借商埠中心点、经四路333号或其他门店坐标。'}]})
                expectations.append({'city':'济南','id':eid,'name':name,'revision':3,'verified':True,'mentionIds':[m['id']]})
                reviewed.append({'entityId':eid,'sourceId':sid,'mentionId':m['id'],'noteId':2566,'originalName':name,'currentName':src['name'],'quote':quote,
                    'identityConclusion':'原文明确完整分店名，恢复既有根名称；没有证明店铺与装置为同一主体，不建立同义关系。',
                    'factConclusion':'唯一reason/evidence/highlight均描述摄影装置，按subject_mismatch隔离三字段，原文/原提及不改写；没有独立饮品或店内体验需要保留。',
                    'originalReason':m['reason'],'originalEvidence':m['evidence_text'],'originalContent':m['fact_value']['placeContent'],
                    'oldLocation':{'address':src['address'],'lat':src['latitude'],'lng':src['longitude']},'locationOverride':overrides,
                    'distanceToExistingShangbuReferenceKm':km((src['latitude'],src['longitude']),(reference_place['lat'],reference_place['lng'])),
                    'distanceMeaning':'同一GCJ02系统的现行街区参考点仅供检查明显偏离，不证明店铺或装置坐标；不复制参考点。',
                    'remaining':'精确店址、店外或店内装置范围、摄影主体是否单独建模及图片仍待核。'})
            assert set(selected)=={11344,11346}
            images=[i for i in await load_image_rows(s,'济南') if i['source_place_id'] in [5322,5324]];assert images==[]
            source={'readOnly':True,'capturedAt':datetime.now(timezone.utc).isoformat(),'city':'济南','groups':packet['groups'],
                'sources':[v for g in packet['groups'] for v in g['sources']],'mentions':[{**m,'inputHash':mention_fingerprint(m)} for m in selected.values()],
                'notes':[n for n in original['notes'] if n['id']==2566],'images':images,'reviews':[],
                'originalSourceFile':packet['originalSourceFile'],'originalSourceSha256':packet['originalSourceSha256']}
        review={'city':'济南','batch':54,'sourcePacket':packet_path,'sources':2,'mentions':2,'fullNotes':1,'confirmed':2,'pending':0,'rows':reviewed,
            'originalNotesReadInFull':True,'existingImageAnalysesRead':True,'externalReference':{'file':reference_path,'sha256':sha(reference_path),'url':reference['url'],'quote':boundary,
            'use':'仅支持街区边界，不支持门店或摄影装置的精确位置。'},
            'searchLimitations':'search01仅计划文本；02/03提供商选择配置错误；04/06补充搜索有街区与点评链接，点评两次抓取无内容；05超时。搜索摘要不作精确店址依据。',
            'locationStatus':'incompatible_old_points_cleared_precise_branch_and_installation_locations_pending',
            'newEntities':0,'mapRequests':0,'imageComparison':'deferred_by_user','fullReviewPassed':False,'appliedAtFreeze':False}
        write(review_path,review)
        for p,v in zip(paths,[source,packet['catalog'],scopes,decisions,expectations]):write(p,v)
        print(json.dumps({'batch':54,'sourceSha256':sha(paths[0]),'confirmed':2,'pending':0,'excludedFields':6,'coordinatesCleared':2,'rows':[{k:r[k] for k in ['sourceId','originalName','distanceToExistingShangbuReferenceKm']} for r in reviewed]},ensure_ascii=False))
    finally:await engine.dispose()
asyncio.run(main())
