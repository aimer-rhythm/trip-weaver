"""按完整来源恢复餐饮分店名；无分店正负评价均保留待审。"""
from pathlib import Path
from datetime import datetime,timezone
import asyncio,hashlib,json,sys
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
def write(p,v):
    with (root/p).open('x',encoding='utf-8') as f:json.dump(v,f,ensure_ascii=False,indent=2)
async def main():
    pointer=read('cleaning-scope/current.json');assert pointer['latestAppliedEntityBatch']==52 and not pointer['userAcceptance']
    assert pointer['imageComparisonPolicy']['status']=='deferred_by_user'
    packet_path='priority-cities/济南/food-branches-source-packet-01.json';packet=read(packet_path)
    assert hashlib.sha256((root/packet_path).read_bytes()).hexdigest()=='c6bb1c6ba7fab6a3691e93a37c7632190c9de1394406a0c4519244d92f7a25ff'
    original=read(packet['originalSourceFile']);assert hashlib.sha256((root/packet['originalSourceFile']).read_bytes()).hexdigest()==packet['originalSourceSha256']
    photos=read('priority-cities/济南/food-branches-photo-metadata-01.json')
    review_path='priority-cities/济南/food-branches-source-review-01.json'
    paths=[f'all-cities/batch-53-{kind}.json' for kind in ['source','catalog','scope-decisions','decisions','export-expectations']]
    assert all(not (root/p).exists() for p in [review_path,*paths])
    details={11708:('避雷济南鑫龙火锅','消费争议原文没有门店，菜单既有文字列多店且收据文字没有可确认分店，不将负评归北园店，原评价保留待审。'),
        11709:('但一定要吃北园大街店‼️感觉最正宗','原提及全名及完整正文明确北园大街店，保留清汤锅底、调料和上菜描述；不把原文最正宗当客观排名。'),
        12846:('鑫龙虽然是本土铜锅，但我觉得口味太单调，我老公倒是挺喜欢','口味分歧原文未给分店，已有图文亦不补门店，保留待审；不按评价正负决定分配。'),
        12890:('2️⃣鑫龙火锅','正向裸名推荐同样未给分店，保留待审，不自动归北园店。'),
        11635:('②七九刘家烧烤（纬九路）','原文明确纬九路，与另一篇具体门牌相容，保留此独立来源推荐。'),
        12886:('[八R].七九刘家烧烤(纬九路店)\n人均∶102\n小经六路东首近纬九路\n虾酱馒头片，各种烤串','原提及完整分店名和正文地址明确纬九路店，保留菜品；不把此次人均当固定价格。')}
    names={5474:'鑫龙火锅（北园大街店）',5433:'七九刘家烧烤(纬九路店)'}
    scopes=[];decisions=[];expectations=[];reviewed=[];selected={}
    try:
        async with SessionFactory() as s:
            await s.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            cat=await load_mention_catalog(s,'济南');all_mentions=await load_mention_rows(s,'济南')
            for g in packet['groups']:
                eid=g['entity']['entity_id'];sid=g['entity']['primary_place_id'];name=names[sid]
                assert cat.catalog.entities[eid]==g['entity'] and cat.scope_for_source(sid) is None
                photo=next(e for e in photos['entities'] if e['entityId']==eid)
                assert photo['revision']==1 and not photo['independentSources'] and not photo['assignments'] and all(v is None for v in photo['currentImageFields'].values())
                current=[m for m in all_mentions if scope_matches({'city':'济南','name_keys':g['nameKeys']},m)]
                assert {m['id']:mention_fingerprint(m) for m in current}=={m['id']:m['inputHash'] for m in packet['mentions'] if m['id'] in g['mentionIds']}
                assert any(m['name']==name for m in current),'新主名必须来自原提及，不自行拼分店'
                assignments=[]
                for m in current:
                    assert not m['note_unavailable'];selected[m['id']]=m
                    quote,reason=details[m['id']];assert quote in m['note_desc'] or quote in m['note_title']
                    target=eid if m['id'] in [11709,11635,12886] else None
                    assignments.append({'mentionId':m['id'],'inputHash':mention_fingerprint(m),'entityId':target})
                    reviewed.append({'mentionId':m['id'],'noteId':m['raw_note_id'],'originalName':m['name'],'quote':quote,'reason':reason,'entityId':target,'status':'reviewed_branch' if target else 'needs_branch_evidence'})
                key=f'all-cities-20261009-batch-53-source-{sid}'
                scopes.append({'key':key+'-scope','city':'济南','sourcePlaceId':sid,'expectedSourceHash':g['sources'][0]['sourceHash'],'expectedScopeRevision':0,
                    'expectedRevisions':{eid:1},'assignments':assignments,'evidence':[{'kind':'reviewed_full_branch_scope','file':review_path,'mentionIds':g['mentionIds'],
                    'conclusion':'完整原文确认分店；未给分店的正负评价都待审。原始评价不删改，不创建未证实分店。'}]})
                decisions.append({'key':key+'-branch-name','city':'济南','entityId':eid,'expectedRevisions':{eid:2},'mergeEntityIds':[],
                    'canonicalName':name,'aliases':list(dict.fromkeys([*g['entity']['aliases'],name])),'overrides':{},
                    'evidence':[{'kind':'restore_original_branch_name','file':review_path,'originalMentionIds':[m['id'] for m in current if m['name']==name],
                    'conclusion':'恢复原提及完整分店名并保留稳定ID/旧裸名兼容；不修改原地址坐标，也不将保留旧值称为本次位置核验通过。'}]})
                expectations.append({'city':'济南','id':eid,'name':name,'revision':3,'verified':True,'mentionIds':sorted(a['mentionId'] for a in assignments if a['entityId'])})
            assert set(selected)==set(details)
            images=[i for i in await load_image_rows(s,'济南') if i['source_place_id'] in names];assert images==[]
            source={'readOnly':True,'capturedAt':datetime.now(timezone.utc).isoformat(),'city':'济南','groups':packet['groups'],
                'sources':[v for g in packet['groups'] for v in g['sources']],'mentions':[{**m,'inputHash':mention_fingerprint(m)} for m in selected.values()],
                'notes':[n for n in original['notes'] if n['id'] in {m['raw_note_id'] for m in selected.values()}],
                'images':images,'reviews':[],'originalSourceFile':packet['originalSourceFile'],'originalSourceSha256':packet['originalSourceSha256']}
        review={'city':'济南','batch':53,'sourcePacket':packet_path,'sources':2,'mentions':6,'fullNotes':6,'confirmed':3,'pending':3,'rows':reviewed,
            'originalNotesReadInFull':True,'existingImageAnalysesRead':True,'imageTextCaveat':'2604既有门头分析文字不稳定，未查看原图或据OCR更改品牌；本轮只按全文与原提及确认北园分店。',
            'sentimentPolicy':'两个负评和一个正向裸名均按缺分店证据待审；不按观点正负筛选，不删除原评价。',
            'locationStatus':'existing_points_and_addresses_preserved_not_newly_verified','newEntities':0,'imageComparison':'deferred_by_user','fullReviewPassed':False,'appliedAtFreeze':False}
        write(review_path,review)
        for p,v in zip(paths,[source,packet['catalog'],scopes,decisions,expectations]):write(p,v)
        print(json.dumps({'batch':53,'sourceSha256':hashlib.sha256((root/paths[0]).read_bytes()).hexdigest(),'confirmed':3,'pending':3,'names':names},ensure_ascii=False))
    finally:await engine.dispose()
asyncio.run(main())
