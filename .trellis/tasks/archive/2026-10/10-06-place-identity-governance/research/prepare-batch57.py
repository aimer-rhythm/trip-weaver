"""按完整来源确认原文餐饮分店范围；无分店正负评价均保留待审。"""
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
    pointer=read('cleaning-scope/current.json');assert pointer['latestAppliedEntityBatch']==56 and not pointer['userAcceptance']
    assert pointer['imageComparisonPolicy']['status']=='deferred_by_user'
    packet_path='priority-cities/济南/restaurant-branches-source-packet-01.json';packet=read(packet_path)
    assert hashlib.sha256((root/packet_path).read_bytes()).hexdigest()=='523ec194d950d9e512b781acc6ab965394008f487e57492fbaaf8ae38feff33e'
    original=read(packet['originalSourceFile']);assert hashlib.sha256((root/packet['originalSourceFile']).read_bytes()).hexdigest()==packet['originalSourceSha256']
    photos=read('priority-cities/济南/restaurant-branches-photo-metadata-01.json')
    review_path='priority-cities/济南/restaurant-branches-source-review-01.json'
    paths=[f'all-cities/batch-57-{kind}.json' for kind in ['source','catalog','scope-decisions','decisions','export-expectations']]
    assert all(not (root/p).exists() for p in [review_path,*paths])
    details={11537:('就在燕喜堂（CBD店）去山东博物馆、趵突泉、泉城公园都很方便','明确CBD店，保留菜品描述与评价。'),
        12863:('Day2：千佛山→燕喜堂（CBD店）→山东博物馆→山东美术馆→经三路老商埠','明确CBD店，保留路线推荐。'),
        12798:('Day2：洪家楼天主教堂➡️山东博物馆➡️山东美术馆➡️燕喜堂➡️经三路老商埠','仅裸名，虽与另一篇路线相似仍不能确认同分店，保留待审。'),
        11644:('③刘小忙把子肉（联四路）','正文明确联四路，主名使用原文位置限定，不发明官方分店后缀。'),
        11525:('超意兴、刘小忙把子肉、春水锅贴、穆得・老周家牛肉烧饼、油旋张。','仅品牌列举，不能确认联四路门店，保留待审。'),
        11676:('①亮亮拉面（经十一路）','正文明确经十一路，主名使用原文位置限定，不改为经六路或小纬十一路。'),
        11481:('✔️亮亮拉面（骨汤浓郁，拉面劲道牛肉大块）','原文只有品牌和口味描述，未给分店，不将其归经十一路，保留待审。'),
        12741:('✔️亮亮拉面（骨汤浓郁，拉面劲道牛肉大块）','同篇再次抽取不增加独立分店证据；与11481同等待审。')}
    names={5404:'燕喜堂（CBD店）',5441:'刘小忙把子肉（联四路）',5385:'亮亮拉面（经十一路）'}
    addresses={5404:'CBD',5441:'联四路',5385:'经十一路'}
    preflight=read('priority-cities/济南/restaurant-branches-photo-preflight-01.json')
    assert preflight['existingPhotoConsumptionPreserved'] and all(m['currentPhotos']==0 for m in preflight['media'])
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
                assert any(name in m['note_desc'] for m in current),'新主名必须来自完整原文，不自行拼正式分店名'
                assignments=[]
                for m in current:
                    assert not m['note_unavailable'];selected[m['id']]=m
                    quote,reason=details[m['id']];assert quote in m['note_desc'] or quote in m['note_title']
                    target=eid if m['id'] in [11537,12863,11644,11676] else None
                    assignments.append({'mentionId':m['id'],'inputHash':mention_fingerprint(m),'entityId':target})
                    reviewed.append({'mentionId':m['id'],'noteId':m['raw_note_id'],'originalName':m['name'],'quote':quote,'reason':reason,'entityId':target,'status':'reviewed_branch' if target else 'needs_branch_evidence'})
                key=f'all-cities-20261009-batch-57-source-{sid}'
                scopes.append({'key':key+'-scope','city':'济南','sourcePlaceId':sid,'expectedSourceHash':g['sources'][0]['sourceHash'],'expectedScopeRevision':0,
                    'expectedRevisions':{eid:1},'assignments':assignments,'evidence':[{'kind':'reviewed_full_branch_scope','file':review_path,'mentionIds':g['mentionIds'],
                    'conclusion':'完整原文确认分店；未给分店的正负评价都待审。原始评价不删改，不创建未证实分店。'}]})
                decisions.append({'key':key+'-branch-name','city':'济南','entityId':eid,'expectedRevisions':{eid:2},'mergeEntityIds':[],
                    'canonicalName':name,'aliases':list(dict.fromkeys([*g['entity']['aliases'],name])),'overrides':{'address':addresses[sid],'lat':None,'lng':None,'geoStatus':'unresolvable'},
                    'evidence':[{'kind':'qualify_branch_from_full_original','file':review_path,'originalMentionIds':[m['id'] for m in current if name in m['note_desc']],
                    'conclusion':'原文完整名称和位置限定保留稳定ID/旧裸名；旧点不足以支持明确分店，燕喜堂旧金菊巷地址与CBD店冲突。位置清空待核，地址仅用原文范围，不发明门牌或借其他分店点。'}]})
                expectations.append({'city':'济南','id':eid,'name':name,'revision':3,'verified':True,'mentionIds':sorted(a['mentionId'] for a in assignments if a['entityId'])})
            assert set(selected)==set(details)
            images=[i for i in await load_image_rows(s,'济南') if i['source_place_id'] in names];assert images==[]
            source={'readOnly':True,'capturedAt':datetime.now(timezone.utc).isoformat(),'city':'济南','groups':packet['groups'],
                'sources':[v for g in packet['groups'] for v in g['sources']],'mentions':[{**m,'inputHash':mention_fingerprint(m)} for m in selected.values()],
                'notes':[n for n in original['notes'] if n['id'] in {m['raw_note_id'] for m in selected.values()}],
                'images':images,'reviews':[],'originalSourceFile':packet['originalSourceFile'],'originalSourceSha256':packet['originalSourceSha256']}
        review={'city':'济南','batch':57,'sourcePacket':packet_path,'sources':3,'mentions':8,'fullNotes':6,'confirmed':4,'pending':4,'rows':reviewed,
            'originalNotesReadInFull':True,'existingImageAnalysesRead':True,'imageTextCaveat':'六篇既有文字分析均未为4条裸名补充分店；未查看原图。',
            'sentimentPolicy':'只以原文分店线索判定，不以好评或路线相近补足归属；原评价及重复提及不删改。',
            'locationStatus':'old_points_unsupported_for_qualified_branches_cleared_precise_locations_pending','addressesFromOriginal':addresses,
            'nameMeaning':'燕喜堂CBD店在原提及和正文均存在；刘小忙/亮亮使用正文的括号道路限定，不增加店字，不声明该格式是官方店名。',
            'webEvidenceBoundary':'公开检索未用于新增精确坐标；最终成功/失败与可采用文字见restaurant-branches-web-review-01.json。',
            'newEntities':0,'mapRequests':0,'imageComparison':'deferred_by_user','fullReviewPassed':False,'appliedAtFreeze':False}
        write(review_path,review)
        for p,v in zip(paths,[source,packet['catalog'],scopes,decisions,expectations]):write(p,v)
        print(json.dumps({'batch':57,'sourceSha256':hashlib.sha256((root/paths[0]).read_bytes()).hexdigest(),'confirmed':4,'pending':4,'names':names},ensure_ascii=False))
    finally:await engine.dispose()
asyncio.run(main())
