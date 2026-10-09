"""冻结民族大街与市场的完整文字scope，保留历史part_of审核和原始数据。"""
from pathlib import Path
import asyncio,hashlib,json,sys
from datetime import datetime,timezone
sys.dont_write_bytecode=True
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0,'D:/Project/xhs-travel-pipeline')
from sqlalchemy import select,text
from app.db import SessionFactory,engine
from app.models import CanonicalPlace,PlaceEntityReview
from app.aggregate.mention_identity import load_mention_catalog,load_mention_rows,source_input,source_keys
from app.aggregate.image_identity import load_image_rows
from app.clean.mention_identity import mention_fingerprint,source_fingerprint,scope_matches
root=Path(__file__).resolve().parent
def read(p):return json.loads((root/p).read_text(encoding='utf-8'))
def write(p,v):
    with (root/p).open('x',encoding='utf-8') as f:json.dump(v,f,ensure_ascii=False,indent=2)
async def main():
    pointer=read('cleaning-scope/current.json')
    assert pointer['latestAppliedEntityBatch']==46 and pointer['userAcceptance'] is False
    assert pointer['imageComparisonPolicy']['status']=='deferred_by_user'
    packet_path='priority-cities/济南/minzu-source-packet-01.json'
    packet_hash=hashlib.sha256((root/packet_path).read_bytes()).hexdigest()
    assert packet_hash=='2841d8ba3394ae84f48ed6a875fccf3b1312a0333907680d297075853bbdf8ff'
    packet=read(packet_path);original=read(packet['originalSourceFile'])
    assert hashlib.sha256((root/packet['originalSourceFile']).read_bytes()).hexdigest()==packet['originalSourceSha256']
    photos=read('priority-cities/济南/minzu-photo-metadata-01.json')
    review_path='priority-cities/济南/minzu-source-review-01.json'
    paths=[f'all-cities/batch-47-{kind}.json' for kind in ['source','catalog','scope-decisions','decisions','export-expectations']]
    assert all(not (root/p).exists() for p in [review_path,*paths])
    reasons={11501:'明确在民族大街吃早餐的个人经历，保留街道目的地；人均20是该次早餐费用，不是街道收费或整个市场均价，不能据此认领具体餐馆。',
        12754:'同篇重复早餐抽取保留原提及与街道范围，不将其当第二篇独立样本，也不分给民族大街市场。',
        11608:'全文主语是图示住宿C区，缺点为离民族大街稍远；原warning/negative不是对道路的独立评价，正文不能定位C区，转待审，不据图示猜范围。',
        12643:'独立民族大街市场条目明确当地菜市场、前段小吃后段蔬菜，食物推荐属于市场逛吃；不借街道其他提及合并两主体。'}
    try:
        async with SessionFactory() as s:
            await s.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            cat=await load_mention_catalog(s,'济南')
            sources=(await s.scalars(select(CanonicalPlace).where(CanonicalPlace.city=='济南'))).all()
            mentions=await load_mention_rows(s,'济南');selected={};scopes=[];decisions=[];expectations=[];reviewed=[]
            for g in packet['groups']:
                eid=g['entity']['entity_id'];sid=g['entity']['primary_place_id'];assert cat.catalog.entities[eid]==g['entity']
                photo=next(e for e in photos['entities'] if e['entityId']==eid)
                assert photo['revision']==1 and not photo['independentSources'] and not photo['assignments']
                assert all(v is None for v in photo['currentImageFields'].values())
                assert {p.id for p in sources if source_keys(p)&set(g['nameKeys'])}=={sid}
                src=next(p for p in sources if p.id==sid)
                assert source_fingerprint(source_input(src))==g['sources'][0]['sourceHash'] and cat.scope_for_source(sid) is None
                current=[m for m in mentions if scope_matches({'city':'济南','name_keys':g['nameKeys']},m)]
                assert {m['id']:mention_fingerprint(m) for m in current}=={m['id']:m['inputHash'] for m in packet['mentions'] if m['id'] in g['mentionIds']}
                assignments=[]
                for m in current:
                    assert not m['note_unavailable'];selected[m['id']]=m
                    quote=next(line for line in m['note_desc'].splitlines() if m['name'] in line)
                    target=None if m['id']==11608 else eid
                    assignments.append({'mentionId':m['id'],'inputHash':mention_fingerprint(m),'entityId':target})
                    reviewed.append({'mentionId':m['id'],'noteId':m['raw_note_id'],'inputHash':mention_fingerprint(m),'entityId':target,
                        'quote':quote,'reason':reasons[m['id']],'status':'needs_evidence' if target is None else 'reviewed_target'})
                key=f'all-cities-20261009-batch-47-source-{sid}'
                scopes.append({'key':key+'-scope','city':'济南','sourcePlaceId':sid,'expectedSourceHash':g['sources'][0]['sourceHash'],
                    'expectedScopeRevision':0,'expectedRevisions':{eid:1},'assignments':assignments,
                    'evidence':[{'kind':'reviewed_full_text_scope','file':review_path,'mentionIds':g['mentionIds'],
                        'conclusion':'完整正文区分街道早餐目的地、具体市场与图示住宿区域评价；沿用审核369的part_of边界，不合并或创建别名。'}]})
                if sid==5372:
                    decisions.append({'key':key+'-subject','city':'济南','entityId':eid,'expectedRevisions':{eid:2},'mergeEntityIds':[],
                        'canonicalName':g['entity']['canonical_name'],'aliases':g['entity']['aliases'],'overrides':{'category':'文化','xhsPlaceType':'other'},
                        'evidence':[{'kind':'reviewed_primary_subject','file':review_path,
                            'conclusion':'民族大街为公共街道，早餐是街上活动，不是名为民族大街的单一餐饮店；纠正food细类为other，保留美食主题和原名/坐标。具体市场仍独立购物/market。'}]})
                expectations.append({'city':'济南','id':eid,'name':g['entity']['canonical_name'],'revision':3 if sid==5372 else 2,'verified':True,
                    'mentionIds':sorted(a['mentionId'] for a in assignments if a['entityId']==eid)})
            assert set(selected)==set(reasons)
            images=[im for im in await load_image_rows(s,'济南') if im['source_place_id'] in [5372,5961]];assert images==[]
            review=await s.get(PlaceEntityReview,369)
            assert {k:getattr(review,k) for k in ['id','city','fingerprint','status','detail']}==packet['catalog']['reviews'][0]
            source={'readOnly':True,'capturedAt':datetime.now(timezone.utc).isoformat(),'city':'济南','groups':packet['groups'],
                'sources':[v for g in packet['groups'] for v in g['sources']],'mentions':[{**m,'inputHash':mention_fingerprint(m)} for m in selected.values()],
                'notes':[n for n in original['notes'] if n['id'] in {m['raw_note_id'] for m in selected.values()}],
                'images':images,'reviews':packet['catalog']['reviews'],'originalSourceFile':packet['originalSourceFile'],'originalSourceSha256':packet['originalSourceSha256']}
        report={'city':'济南','batch':47,'sourcePacket':packet_path,'sourcePacketSha256':packet_hash,'roots':2,'sources':2,'mentions':4,'fullNotes':3,
            'confirmed':3,'pending':1,'historicalReview':369,'historicalVerdict':'part_of','originalNotesReadInFull':True,
            'locationStatus':'existing_points_preserved_not_newly_verified','imageComparison':'deferred_by_user','fullReviewPassed':False,'appliedAtFreeze':False,'rows':reviewed}
        write(review_path,report)
        for p,v in zip(paths,[source,packet['catalog'],scopes,decisions,expectations]):write(p,v)
        print(json.dumps({'batch':47,'sourceSha256':hashlib.sha256((root/paths[0]).read_bytes()).hexdigest(),'confirmed':3,'pending':1},ensure_ascii=False))
    finally:await engine.dispose()
asyncio.run(main())
