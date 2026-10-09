"""护城河完整scope隔离解放阁图片提示；其余五个主体保持普通来源。"""
from pathlib import Path
from datetime import datetime,timezone
import asyncio,hashlib,json,sys
sys.dont_write_bytecode=True
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0,'D:/Project/xhs-travel-pipeline')
from sqlalchemy import text
from app.db import SessionFactory,engine
from app.aggregate.mention_identity import load_mention_catalog,load_mention_rows
from app.clean.mention_identity import mention_fingerprint,scope_matches
root=Path(__file__).resolve().parent
def read(p):return json.loads((root/p).read_text(encoding='utf-8'))
def write(p,v):
    with (root/p).open('x',encoding='utf-8') as f:json.dump(v,f,ensure_ascii=False,indent=2)
async def main():
    pointer=read('cleaning-scope/current.json');assert pointer['latestAppliedEntityBatch']==57 and not pointer['userAcceptance']
    assert pointer['imageComparisonPolicy']['status']=='deferred_by_user'
    packet_path='priority-cities/济南/ordinary-outdoors-source-packet-01.json';packet=read(packet_path)
    assert hashlib.sha256((root/packet_path).read_bytes()).hexdigest()=='d4b0c0d2b43cf56155bea2aa4c4844e7720566a303a6517f630fc1483971bd46'
    eid='4dfda3371793b69de15122bb7e330eac';sid=5477;group=next(g for g in packet['groups'] if g['entity']['entity_id']==eid)
    review_path='priority-cities/济南/river-source-review-01.json'
    paths=[f'all-cities/batch-58-{kind}.json' for kind in ['source','catalog','scope-decisions','decisions','export-expectations']]
    assert all(not (root/p).exists() for p in [review_path,*paths])
    photo=next(e for e in read('priority-cities/济南/ordinary-outdoors-photo-metadata-01.json')['entities'] if e['entityId']==eid)
    assert photo['revision']==1 and not photo['independentSources'] and not photo['assignments'] and all(v is None for v in photo['currentImageFields'].values())
    supplement=next(n for n in packet['supplementalImageFactNotes'] if n['note']['id']==2810)
    image=next(i for i in supplement['note']['img_analysis'] if i['image_index']==5)
    assert image['text_content'].startswith('解放阁\n济南解放纪念馆\n')
    wrong_tip='为纪念济南解放而建，位于旧城城墙遗址。登阁可看展览了解历史，也能俯瞰黑虎泉和护城河景色。'
    assert image['key_info']['tips']==wrong_tip
    try:
        async with SessionFactory() as s:
            await s.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            cat=await load_mention_catalog(s,'济南');assert cat.catalog.entities[eid]==group['entity'] and cat.scope_for_source(sid) is None
            current=[m for m in await load_mention_rows(s,'济南') if scope_matches({'city':'济南','name_keys':group['nameKeys']},m)]
            assert {m['id']:mention_fingerprint(m) for m in current}=={m['id']:m['inputHash'] for m in packet['mentions'] if m['id'] in group['mentionIds']}
            assert {m['id'] for m in current}=={11404,12901}
            rows=[];assignments=[]
            for m in current:
                quote=next(line for line in m['note_desc'].splitlines() if '护城河' in line)
                assert not m['note_unavailable'] and (m['fact_value'] or {}).get('minutes') is None
                assignments.append({'mentionId':m['id'],'inputHash':mention_fingerprint(m),'entityId':eid})
                rows.append({'mentionId':m['id'],'noteId':m['raw_note_id'],'quote':quote,'entityId':eid,'reason':'完整老城路线明确护城河，保持河道主体和推荐；不据此归入解放阁、游船或任一船站。'})
            scope={'key':'all-cities-20261009-batch-58-source-5477-scope','city':'济南','sourcePlaceId':sid,'expectedSourceHash':group['sources'][0]['sourceHash'],
                'expectedScopeRevision':0,'expectedRevisions':{eid:1},'assignments':assignments,
                'evidence':[{'kind':'reviewed_river_scope_excludes_unrelated_image_tips','file':review_path,'mentionIds':group['mentionIds'],
                    'conclusion':'两条原文河道提及全部保留；不再按全城图片文字包含护城河而借入解放阁提示。不改原始图文、旧名/ID/类别/位置，不创建游船主体。'}]}
            source={'readOnly':True,'capturedAt':datetime.now(timezone.utc).isoformat(),'city':'济南','groups':[group],'sources':group['sources'],
                'mentions':[{**m,'inputHash':mention_fingerprint(m)} for m in current],
                'notes':[n for n in packet['notes'] if n['id'] in {m['raw_note_id'] for m in current}],
                'supplementalImageFactNotes':packet['supplementalImageFactNotes'],'images':[],'reviews':[],
                'originalSourceFile':packet['originalSourceFile'],'originalSourceSha256':packet['originalSourceSha256']}
        review={'city':'济南','batch':58,'sourcePacket':packet_path,'sources':1,'mentions':2,'fullNotes':2,'confirmed':2,'pending':0,'rows':rows,
            'originalNotesReadInFull':True,'existingImageAnalysesRead':True,'supplementalNotesScanned':11,
            'wrongTip':wrong_tip,'wrongTipOrigin':{'noteId':2810,'imageIndex':5,'subject':'解放阁 / 济南解放纪念馆','inputHash':supplement['inputHash']},
            'otherImageTextBoundary':'游船黑虎泉码头票价/预约、趵突泉与博物馆政策均不作为河道本体政策；当前旧导出未采用它们，不虚报新增删除。',
            'locationStatus':'existing_point_and_address_preserved_not_newly_verified','categoryStatus':'existing_cultural_attraction_preserved_not_merged_with_memorial',
            'rawDataPreserved':True,'newEntities':0,'imageComparison':'deferred_by_user','fullReviewPassed':False,'appliedAtFreeze':False}
        history={'entities':[group['entity']],'members':[m for m in packet['catalog']['members'] if m['entity_id']==eid],'reviews':[]}
        write(review_path,review)
        for p,v in zip(paths,[source,history,[scope],[],[{'city':'济南','id':eid,'name':'护城河','revision':2,'verified':True,'mentionIds':[11404,12901]}]]):write(p,v)
        print(json.dumps({'batch':58,'sourceSha256':hashlib.sha256((root/paths[0]).read_bytes()).hexdigest(),'confirmed':2,'pending':0},ensure_ascii=False))
    finally:await engine.dispose()
asyncio.run(main())
