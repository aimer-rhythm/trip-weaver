"""芙蓉街：完整提及审核、餐馆主体隔离与既有作者警示保全。只生成决定，不应用。"""
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
from app.aggregate.note_text_warnings import load_warning_notes
from app.clean.mention_identity import mention_fingerprint,scope_matches
from app.clean.note_text_warnings import warning_input,validate_text_warnings
root=Path(__file__).resolve().parent
def read(p):return json.loads((root/p).read_text(encoding='utf-8'))
def write(p,v):
    with (root/p).open('x',encoding='utf-8') as f:json.dump(v,f,ensure_ascii=False,indent=2)
async def main():
    pointer=read('cleaning-scope/current.json');assert pointer['latestAppliedEntityBatch']==62 and not pointer['userAcceptance']
    assert pointer['imageComparisonPolicy']['status']=='deferred_by_user'
    pp='priority-cities/济南/furong-source-packet-01.json';packet=read(pp)
    assert hashlib.sha256((root/pp).read_bytes()).hexdigest()=='551bc2ba76c317db036d84987e8edc57190e9d8d669c135917c6308a42f64b1f'
    photo=read('priority-cities/济南/furong-photo-metadata-01.json');assert len(photo['entities'])==1
    assert not photo['entities'][0]['independentSources'] and not photo['entities'][0]['assignments']
    pre=read('priority-cities/济南/furong-photo-preflight-01.json');assert pre['existingPhotoConsumptionPreserved'] and pre['mockEnqueues']==1
    rp='priority-cities/济南/furong-source-review-01.json'
    paths=[f'all-cities/batch-63-{kind}.json' for kind in ['source','catalog','scope-decisions','decisions','export-expectations']]
    assert all(not (root/p).exists() for p in [rp,*paths])
    reasons={11339:'正文明确芙蓉街0.5h，独立街道停留；与12567同篇同分钟仅一个时长样本。',
      11389:'明确晚上空余时间前往芙蓉街，不采用同篇其他店铺或地图候选身份。',
      11415:'day2路线明确街道名称，保留原路线提及，不合并相邻景点。',
      11431:'街道小吃、老牌及拥挤评价有明确主体，保留作者观点。',
      11447:'标题虽写芙蓉街或恒隆广场，后续段落明确步行到芙蓉街、游览约30分钟和游览完芙蓉街后；独立街道30分钟有效。',
      11499:'原文明确芙蓉街及特色小吃，保留街道描述；不以泉城广场背面重新定位。',
      11506:'曲水亭街周边明确芙蓉街、大明湖的步行参照，不是酒店或餐馆菜品描述。',
      11579:'晚间到访街道的人流体验，保持作者评价，不推断营业时段。',
      11586:'全文具名鲁宴·八不食味道(大明湖总店)，街道为其附近游览参照；只保留有界邻近理由，不把餐馆菜单归给街道。',
      11613:'全文具名李长久萃华楼，芙蓉街是距离参照；原字段无菜单，不合并店铺。',
      11623:'路线列芙蓉街，原小吃描述归属明确。',
      11689:'正文芙蓉街/宽厚里并列，小吃街身份有效且两者不合并；百年小吃街仅保留有原文引用的社区作者表述，未据公共商业街史推定连续百年餐饮经营，也没有证据裁定原文为假，不伪造subject_mismatch排除年代。',
      11699:'街道名称有效，但晚上去方便的主语是未具名第二家酒店；排除reason/evidence_text，保留身份，不新造酒店。',
      12567:'与11339重复抽取同篇0.5小时，保留提及但时长只计一个样本。',
      12573:'明确路线与历下区段落中芙蓉美食街，保留地点和美食街看点，不采全城诗词为看点。',
      12625:'宽厚里与芙蓉街并列逛吃，两独立街区不合并；作者邻近评价保留，不用作精确距离。',
      12638:'芙蓉街32号至起凤桥街为导航描述，保持街道身份，不把桥或门牌当整街新坐标。',
      12659:'正文步行街小吃体验，保留作者一般评价。',
      12681:'与11415同篇路线街道重复抽取，身份明确。',
      12709:'与11431同篇街道评价，小吃看点有效，拥挤限定不删除。',
      12752:'明确街道小吃体验，不据导航短语新定位。',
      12816:'芙蓉街与宽厚里均为明确小吃街；逛逛就行、不必特意吃为有效负面建议，保持xhs_warning消费。',
      12833:'与11579同篇十点到访，人少是作者当次体验，不推断开放时间。',
      12835:'芙蓉街段明确油旋、甜沫和烤猪蹄的小吃体验，保留看点与饭点人多限定。',
      12836:'同段原文明确人多及不推婴儿车，保留负面建议。',
      12904:'全文主角是未具名鲁菜馆，茶香排骨/糖醋鲤鱼属于店铺；街名为位置参照，整体待审，不猜店名、不把街道当餐馆。',
      12917:'与11623同篇街道小吃路线有效。',
      12932:'路线明确芙蓉街，后文文创比较未进入提及字段，不虚构排除。',
      12948:'三刷、量大便宜及菜单属于芙蓉街和西更道交叉口未具名餐馆，整体待审，不猜门店、不合并街道。',
      12956:'原文明确芙蓉街小吃体验，保留街道提及。'}
    try:
        async with SessionFactory() as s:
            await s.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            cat=await load_mention_catalog(s,'济南');all_rows=await load_mention_rows(s,'济南')
            g=packet['groups'][0];e=g['entity'];eid=e['entity_id'];assert e['revision']==3 and cat.catalog.entities[eid]==e
            assert cat.scope_for_source(5353) is None
            mentions=[m for m in all_rows if scope_matches({'city':'济南','name_keys':g['nameKeys']},m)]
            assert {m['id']:mention_fingerprint(m) for m in mentions}=={m['id']:m['inputHash'] for m in packet['mentions']}
            assert set(reasons)=={m['id'] for m in mentions} and all(not m['note_unavailable'] for m in mentions)
            notes=await load_warning_notes(s,[{'noteId':2568,'imageIndex':3}]);n=notes[2568]
            extra=next(n for n in packet['noteDetails'] if n['id']==2568)
            assert all(n[k]==extra[k] for k in ['city','title','desc','images','sourceUrl','observedAt','publishedAt'])
            quote='美食：别在芙蓉街买小吃，又贵又不正宗！';text_content=n['images'][3]['text_content'];start=text_content.index(quote)
            warning={**warning_input(2568,3,n),'start':start,'end':start+len(quote),'quote':quote,'entityId':eid}
            validate_text_warnings([warning],city='济南',notes=notes,entities=cat.catalog.entities,confirmed_ids={eid})
            assignments=[]
            for m in mentions:
                a={'mentionId':m['id'],'inputHash':mention_fingerprint(m),'entityId':None if m['id'] in [12904,12948] else eid}
                if m['id']==11699:
                    quote='📍第二家（大明湖）\n离大明湖、曲水亭街很近，步行十分钟就到\n晚上去芙蓉街宽厚里小吃街也很方便\n装修设计也很复古和现代元素结合\nLoft设计每层都不小，上下都有卫生间\n有浴缸累了可以边赏景边泡澡，很舒服'
                    assert quote in m['note_desc']
                    a['factExclusions']={k:{'reason':'subject_mismatch','quote':quote} for k in ['reason','evidence_text']}
                assignments.append(a)
            images=[i for i in await load_image_rows(s,'济南') if i['source_place_id']==5353];assert images==[]
            scope={'key':'all-cities-20261009-batch-63-source-5353-scope','city':'济南','sourcePlaceId':5353,
                'expectedSourceHash':g['sources'][0]['sourceHash'],'expectedScopeRevision':0,'expectedRevisions':{eid:3},
                'assignments':assignments,'textWarnings':[warning],
                'evidence':[{'kind':'reviewed_full_text_and_existing_analysis_warning','file':rp,
                    'conclusion':'30提及完整审核：28确认，2未具名餐馆待审；酒店位置评价字段排除，独立30分钟与正负意见保持。既有图片文字的完整警示原句以输入指纹保留，无图片查看。'}]}
        source={**packet,'sources':[v for g in packet['groups'] for v in g['sources']],
            'mentions':[{**m,'inputHash':mention_fingerprint(m)} for m in mentions],'images':images,'reviews':packet['catalog']['reviews']}
        review={'city':'济南','batch':63,'sourcePacket':pp,'sourcePacketSha256':hashlib.sha256((root/pp).read_bytes()).hexdigest(),
            'sources':1,'mentions':30,'fullNotes':23,'supplementalFullNotes':1,'confirmed':28,'pending':2,'newEntities':0,'withdrawals':0,
            'rows':[{'mentionId':m['id'],'noteId':m['raw_note_id'],'action':'pending_unnamed_restaurant' if m['id'] in [12904,12948] else 'confirm_with_description_exclusion' if m['id']==11699 else 'confirm','conclusion':reasons[m['id']]} for m in mentions],
            'textWarnings':[warning],'durationSamples':{'notes':[2545,2553],'minutes':30,'duplicateMentionsDeduplicated':[11339,12567]},
            'originalNotesReadInFull':True,'existingImageAnalysesRead':True,'oldPointAndAddressPreserved':True,'newPreciseLocations':0,
            'imageComparison':'deferred_by_user','fullReviewPassed':False,'userAcceptance':False,'appliedAtFreeze':False}
        write(rp,review)
        for p,v in zip(paths,[source,packet['catalog'],[scope],[],[{'city':'济南','id':eid,'name':'芙蓉街','revision':4,'verified':True,'mentionIds':sorted(a['mentionId'] for a in assignments if a['entityId'])}]]):write(p,v)
        print(json.dumps({'batch':63,'sourceSha256':hashlib.sha256((root/paths[0]).read_bytes()).hexdigest(),'scopes':1,'assignments':30,'confirmed':28,'pending':2,'textWarnings':1,'entityRevision':'3→4','applied':False},ensure_ascii=False))
    finally:await engine.dispose()
asyncio.run(main())
