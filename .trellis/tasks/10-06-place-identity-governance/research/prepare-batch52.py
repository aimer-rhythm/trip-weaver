"""秦记火烧完整原文分店范围：两明确铜元局提及，混合分店和裸名各一待审。"""
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
    pointer=read('cleaning-scope/current.json');assert pointer['latestAppliedEntityBatch']==51 and not pointer['userAcceptance']
    assert pointer['imageComparisonPolicy']['status']=='deferred_by_user'
    packet_path='priority-cities/济南/food-followup-source-packet-01.json';packet=read(packet_path)
    assert hashlib.sha256((root/packet_path).read_bytes()).hexdigest()=='10b28673fc9d28fb9d51b5f4a89e2860b48df16f2b5624fdaf520c239ece95f3'
    original=read(packet['originalSourceFile']);assert hashlib.sha256((root/packet['originalSourceFile']).read_bytes()).hexdigest()==packet['originalSourceSha256']
    eid='53fc7a0204959595c1277e9c76915534';sid=5342;group=next(g for g in packet['groups'] if g['entity']['entity_id']==eid)
    review_path='priority-cities/济南/qinji-source-review-01.json'
    paths=[f'all-cities/batch-52-{kind}.json' for kind in ['source','catalog','scope-decisions','decisions','export-expectations']]
    assert all(not (root/p).exists() for p in [review_path,*paths])
    photo=next(e for e in read('priority-cities/济南/food-followup-photo-metadata-01.json')['entities'] if e['entityId']==eid)
    assert photo['revision']==1 and not photo['independentSources'] and not photo['assignments'] and all(v is None for v in photo['currentImageFields'].values())
    try:
        async with SessionFactory() as s:
            await s.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            cat=await load_mention_catalog(s,'济南');assert cat.catalog.entities[eid]==group['entity'] and cat.scope_for_source(sid) is None
            current=[m for m in await load_mention_rows(s,'济南') if scope_matches({'city':'济南','name_keys':group['nameKeys']},m)]
            assert {m['id']:mention_fingerprint(m) for m in current}=={m['id']:m['inputHash'] for m in packet['mentions'] if m['id'] in group['mentionIds']}
            assert {m['id'] for m in current}=={11364,12605,11664,12892}
            rows=[];assignments=[]
            for m in current:
                assert not m['note_unavailable'];target=eid if m['id'] in [11364,12605] else None
                quote=next(line for line in m['note_desc'].splitlines() if '秦记火烧' in line)
                if target:
                    assert m['raw_note_id']==2585 and '铜元局前街' in quote
                    reason='原文逐店明确铜元局前街，支持当前来源所在街道门店；同篇重复抽取仅一独立来源，保留原推荐。'
                elif m['id']==11664:
                    assert m['raw_note_id']==2602 and '肉火烧去制锦市，其他去河边' in quote
                    reason='同一句推荐制锦市和河边，不能把多个位置的菜品建议全归铜元局前街；不推断两个文字地点相同，也不拆造新提及或新实体。'
                else:
                    assert m['raw_note_id']==2856 and quote=='4️⃣秦记火烧'
                    reason='只有裸名无分店地址，既有图片分析亦未补门店；面对明确多位置证据不能按同名自动认领，保留待审。'
                assignments.append({'mentionId':m['id'],'inputHash':mention_fingerprint(m),'entityId':target})
                rows.append({'mentionId':m['id'],'noteId':m['raw_note_id'],'quote':quote,'entityId':target,'reason':reason,'status':'reviewed_target' if target else 'needs_branch_evidence'})
            images=[i for i in await load_image_rows(s,'济南') if i['source_place_id']==sid];assert images==[]
            scope={'key':'all-cities-20261009-batch-52-source-5342-scope','city':'济南','sourcePlaceId':sid,'expectedSourceHash':group['sources'][0]['sourceHash'],
                'expectedScopeRevision':0,'expectedRevisions':{eid:1},'assignments':assignments,
                'evidence':[{'kind':'reviewed_full_text_branch_scope','file':review_path,'mentionIds':group['mentionIds'],
                    'conclusion':'明确铜元局前街两同篇提及保留；多位置推荐和无分店裸名留待审。保留原名/ID、原坐标与地址但不宣称新定位通过；不创建分店或别名。'}]}
            source={'readOnly':True,'capturedAt':datetime.now(timezone.utc).isoformat(),'city':'济南','groups':[group],'sources':group['sources'],
                'mentions':[{**m,'inputHash':mention_fingerprint(m)} for m in current],
                'notes':[n for n in original['notes'] if n['id'] in {m['raw_note_id'] for m in current}],
                'images':images,'reviews':[],'originalSourceFile':packet['originalSourceFile'],'originalSourceSha256':packet['originalSourceSha256']}
        history={'entities':[group['entity']],'members':[m for m in packet['catalog']['members'] if m['entity_id']==eid],'reviews':[]}
        report={'city':'济南','batch':52,'sourcePacket':packet_path,'sources':1,'mentions':4,'fullNotes':3,'confirmed':2,'pending':2,'independentConfirmedNotes':1,
            'rows':rows,'originalNotesReadInFull':True,'existingImageAnalysesRead':True,'existingImageAnalysisAddsBranchEvidence':False,
            'locationStatus':'existing_point_and_address_preserved_not_newly_verified','newEntities':0,'imageComparison':'deferred_by_user','fullReviewPassed':False,'appliedAtFreeze':False}
        write(review_path,report)
        for p,v in zip(paths,[source,history,[scope],[],[{'city':'济南','id':eid,'name':'秦记火烧','revision':2,'verified':True,'mentionIds':[11364,12605]}]]):write(p,v)
        print(json.dumps({'batch':52,'sourceSha256':hashlib.sha256((root/paths[0]).read_bytes()).hexdigest(),'confirmed':2,'pending':2},ensure_ascii=False))
    finally:await engine.dispose()
asyncio.run(main())
