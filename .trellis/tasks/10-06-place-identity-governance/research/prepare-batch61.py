"""第61批：文字墙完整原文scope隔离外来提示；未明确分店的淘子外单待审。"""
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
    pointer=read('cleaning-scope/current.json');assert pointer['latestAppliedEntityBatch']==60 and not pointer['userAcceptance']
    assert pointer['imageComparisonPolicy']['status']=='deferred_by_user'
    packet_path='priority-cities/济南/built-place-source-packet-01.json';packet=read(packet_path)
    assert hashlib.sha256((root/packet_path).read_bytes()).hexdigest()=='e1cf77506a8d66330bd8157a1ab0b02907f9fd990d44c482e4094823c2a5d84e'
    review_path='priority-cities/济南/built-place-source-review-01.json'
    paths=[f'all-cities/batch-61-{kind}.json' for kind in ['source','catalog','scope-decisions','decisions','export-expectations']]
    assert all(not (root/p).exists() for p in [review_path,*paths])
    photos=read('priority-cities/济南/built-place-photo-metadata-01.json')
    assert len(photos['entities'])==7 and all(not p['independentSources'] and not p['assignments'] for p in photos['entities'])
    preflight=read('priority-cities/济南/built-place-photo-preflight-01.json');assert preflight['existingPhotoConsumptionPreserved'] and preflight['mockEnqueues']==7
    original=read(packet['originalSourceFile']);assert hashlib.sha256((root/packet['originalSourceFile']).read_bytes()).hexdigest()==packet['originalSourceSha256']
    reasons={5954:'12688只确认note2817路线第②站所指文字墙，保留该原始主体/稳定ID，不宣称具体墙面已定位；第③站月下观棠附近是另外几面墙，老商埠喜艾旁的墙来自note2566，不能通过通用名称导入。完整scope保留原提及，停止两个未归属图片提示消费，不增加别名/实体/坐标。',
        5400:'全文列出经四万达店、高新店、西市场店，但实际到访描述只写裸名；路线邻近不能选择分店。唯一提及待审，完整scope显式撤回原单店消费，不创建候选门店或标为非地点。'}
    readonly={5955:'原文以月下观棠作白底书法墙导航参照，现有图中文字含汉服妆造；店铺与附近几面墙不是同一主体。公开搜索未取得同店地址正文，暂不指定店型/分店/墙面或新坐标，保留现状并记录未应用边界。',
        5971:'原文明确山东大厦内中庭拍照，官网正文支持马鞍山路2-1号酒店地址；不将酒店经营用途自动等同照片主体，也不把酒店地址当中庭精确点/开放许可。保持现名、类别、点位及描述，粒度和位置媒体待核。',
        5969:'原文明示百花洲西月下观棠旁街巷的济南墙，具体墙面仍未辨明；不与济南文字墙或店铺合并。继承第30批清空的点位与revision2，本批无重复清点。',
        5966:'原文确写明珠天地C，未取得该建筑的独立名称/地址正文；不能把猜测的明湖天地或明珠国际商务港作同义名。现有远东点缺确认，待继续定位，不在本批猜改名字或坐标。',
        5328:'原文夹心胡同(融汇济南老商埠店)作爱心天桥导航，现有文字分析同时有店名/装置和DIY字样；公开检索仍不足裁定商户与同名创意场景边界。保持revision2空点，不自动改shop或补分店主名。'}
    selected={};rows=[];scopes=[];expected=[]
    try:
        async with SessionFactory() as s:
            await s.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            cat=await load_mention_catalog(s,'济南');all_mentions=await load_mention_rows(s,'济南')
            for group in packet['groups']:
                entity=group['entity'];eid=entity['entity_id'];sid=entity['primary_place_id']
                assert cat.catalog.entities[eid]==entity and cat.scope_for_source(sid) is None
                current=[m for m in all_mentions if scope_matches({'city':'济南','name_keys':group['nameKeys']},m)]
                assert {m['id']:mention_fingerprint(m) for m in current}=={m['id']:m['inputHash'] for m in packet['mentions'] if m['id'] in group['mentionIds']}
                if sid not in reasons:
                    rows.append({'entityId':eid,'sourceId':sid,'name':entity['canonical_name'],'mentionIds':group['mentionIds'],'action':'read_only_boundary_pending','conclusion':readonly[sid]});continue
                m=current[0];assert len(current)==1 and not m['note_unavailable'];selected[m['id']]=m
                approved=sid==5954;target=eid if approved else None
                if approved:
                    assert '②济南文字墙\n③月下观棠' in m['note_desc']
                else:assert '济南有三家店：经四万达店、高新店、西市场店' in m['note_desc']
                rows.append({'entityId':eid,'sourceId':sid,'name':entity['canonical_name'],'mentionId':m['id'],'noteId':m['raw_note_id'],'targetEntityId':target,
                    'action':'original_route_subject_confirmed_foreign_tips_removed' if approved else 'specific_branch_unresolved','conclusion':reasons[sid]})
                scopes.append({'key':f'all-cities-20261009-batch-61-source-{sid}-scope','city':'济南','sourcePlaceId':sid,'expectedSourceHash':group['sources'][0]['sourceHash'],
                    'expectedScopeRevision':0,'expectedRevisions':{eid:entity['revision']},'assignments':[{'mentionId':m['id'],'inputHash':mention_fingerprint(m),'entityId':target}],
                    'evidence':[{'kind':'reviewed_original_route_and_branch_boundary','file':review_path,'mentionIds':group['mentionIds'],'conclusion':reasons[sid]}]})
                expected.append({'city':'济南','id':eid,'name':entity['canonical_name'],'revision':entity['revision']+1,'verified':approved,'mentionIds':[m['id']] if approved else [],**({} if approved else {'candidateIds':[]})})
            images=[i for i in await load_image_rows(s,'济南') if i['source_place_id'] in reasons];assert images==[]
        groups=[g for g in packet['groups'] if g['entity']['primary_place_id'] in reasons];ids={g['entity']['entity_id'] for g in groups};nids={m['raw_note_id'] for m in selected.values()}
        source={'readOnly':True,'capturedAt':datetime.now(timezone.utc).isoformat(),'city':'济南','groups':groups,'sources':[v for g in groups for v in g['sources']],
            'mentions':[{**m,'inputHash':mention_fingerprint(m)} for m in selected.values()],'notes':[n for n in original['notes'] if n['id'] in nids],
            'noteTimes':[t for t in packet['noteTimes'] if t['noteId'] in nids],'images':images,'reviews':[], 'originalSourceFile':packet['originalSourceFile'],'originalSourceSha256':packet['originalSourceSha256']}
        history={'entities':[e for e in packet['catalog']['entities'] if e['entity_id'] in ids],'members':[m for m in packet['catalog']['members'] if m['entity_id'] in ids],'reviews':[]}
        assert len(source['mentions'])==2 and len(source['notes'])==2
        review={'city':'济南','batch':61,'sourcePacket':packet_path,'reviewedSources':7,'reviewedMentions':7,'fullNotes':4,'appliedSources':2,'appliedMentions':2,'confirmed':1,'pending':1,'withdrawals':1,'newEntities':0,
            'rows':rows,'originalNotesReadInFull':True,'existingImageAnalysesRead':True,'supplementalExistingAnalysisNote':2856,'noNotAPlaceExclusions':True,'readOnlyBoundaryPending':5,
            'coordinatesExplicitlyCleared':0,'withdrawnCoordinatesRemoved':1,'newPreciseLocations':0,'imageComparison':'deferred_by_user','fullReviewPassed':False,'appliedAtFreeze':False}
        write(review_path,review)
        for p,v in zip(paths,[source,history,scopes,[],expected]):write(p,v)
        print(json.dumps({'batch':61,'sourceSha256':hashlib.sha256((root/paths[0]).read_bytes()).hexdigest(),'confirmed':1,'pending':1,'withdrawals':1,'readOnlySubjects':5},ensure_ascii=False))
    finally:await engine.dispose()
asyncio.run(main())
