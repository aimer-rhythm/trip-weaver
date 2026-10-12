"""第45批只冻结大观园与斑马线路口；三处未满足保全条件的主体不纳入变更。"""
from pathlib import Path
import asyncio,hashlib,json,sys
from datetime import datetime,timezone
sys.dont_write_bytecode=True
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0,'D:/Project/xhs-travel-pipeline')
from sqlalchemy import select,text
from app.db import SessionFactory,engine
from app.models import CanonicalPlace
from app.aggregate.mention_identity import load_mention_catalog,load_mention_rows,source_input,source_keys
from app.aggregate.image_identity import load_image_rows
from app.clean.mention_identity import mention_fingerprint,source_fingerprint,scope_matches,validate_fact_exclusions
root=Path(__file__).resolve().parent
packet_path='priority-cities/济南/commercial-source-packet-01.json'
packet_hash='b238f038008e23be87e945b3f669782aea85f8c0f9b0b808e43d1b618bf43834'
def read(p):return json.loads((root/p).read_text(encoding='utf-8'))
def write(p,v):
    with (root/p).open('x',encoding='utf-8') as f:json.dump(v,f,ensure_ascii=False,indent=2)
rules={
11419:'第三日路线明确老商埠商业街区，保留既有同义关系。',12685:'同篇路线重复提及，仍为商业街区；不合并经三路道路。',
11424:'独立老商埠条目描述复古建筑与咖啡馆。',12702:'独立条目及红砖墙咖啡馆看点支持商业街区。',
11498:'条件推荐去老商埠拍照是明确主体，非路途时长。',12751:'条件推荐与劝退仍为明确街区对象。',
11530:'老商埠→经三路→中山公园明确区分商业体、道路和公园。',
12616:'济南文字装置、花墙、老爷车与彩墙为街区看点，不移给道路。',
12645:'老商埠·经三路沿用已确认的商业街区名称；不据名称包含道路而合并道路。',
12785:'实际主语是经三路-老商埠附近未具名咖啡店，不是商业体本身的独立提及，建议待审。',
12799:'整块placeContent混合商业体有效洋楼/咖啡店与范围未明的爱心红绿灯，不删除全部有效看点以掩盖混合范围，建议待审。',
12866:'明确复古洋楼与店铺的商业街区描述。',12878:'明确老城记忆与新潮商业街区描述。',
11529:'独立道路咖啡/古着店描述，全文将商业体另列。',
12617:'完整正文将心形红绿灯限定纬三路；现reason遗漏限定，建议排除reason，保留具有纬三路限定的placeContent及道路主体。',
12776:'红绿灯主体明确，但这里指经三路周边，夹心胡同不能成为红绿灯自身所包含的景观；三描述字段建议排除。拼接抽取名在原文不连续，现字段排除校验拒绝该引用，保留未应用发现，不改原文或放宽校验。',
11343:'全文路线首站明确路口爱心斑马线，后续商店/夹心胡同独立；全线路1至2小时不能分给路口，原提及无minutes不伪造排除。',
11425:'独立大观园条目描述古城风貌与市井夜景，非具体餐馆。',
12703:'同篇重复提及仍为大观园整体游览，夜景描述不转为营业政策。',
12619:'古色古香及汇聚本地小吃指商业文化街区，不是单家餐厅；以文化主体分类。',
12644:'可去可不去为大观园本身评价，保留明确主体与来源判断。',
}
async def main():
    assert hashlib.sha256((root/packet_path).read_bytes()).hexdigest()==packet_hash
    packet=read(packet_path);original=read(packet['originalSourceFile'])
    assert hashlib.sha256((root/packet['originalSourceFile']).read_bytes()).hexdigest()==packet['originalSourceSha256']
    review_path='priority-cities/济南/commercial-source-review-01.json'
    files=[f'all-cities/batch-45-{kind}.json' for kind in ['source','catalog','scope-decisions','decisions','export-expectations']]
    assert all(not (root/p).exists() for p in [review_path,*files])
    assert set(rules)=={m['id'] for m in packet['mentions']}
    groups=[g for g in packet['groups'] if g['entity']['primary_place_id'] in [5321,5478]]
    photos=read('priority-cities/济南/commercial-photo-metadata-01.json')
    for g in groups:
        e=next(e for e in photos['entities'] if e['entityId']==g['entity']['entity_id'])
        assert not e['independentSources'] and not e['assignments'] and all(v is None for v in e['currentImageFields'].values())
    reviewed=[]
    for g in packet['groups']:
        for m in packet['mentions']:
            if m['id'] not in g['mentionIds']:continue
            n=next(n for n in packet['notes'] if n['id']==m['raw_note_id']);assert not n['unavailable']
            quote=m['evidence_text'] if m['evidence_text'] and m['evidence_text'] in n['desc'] else next(line for line in n['desc'].splitlines() if m['name'] in line)
            reviewed.append({'mentionId':m['id'],'noteId':m['raw_note_id'],'inputHash':m['inputHash'],'originalName':m['name'],
                'proposedEntityId':None if m['id'] in [12785,12799] else g['entity']['entity_id'],
                'quote':quote,'reason':rules[m['id']],'includedInBatch':g in groups})
    light=next(m for m in packet['mentions'] if m['id']==12776)
    note=next(n for n in packet['notes'] if n['id']==2797)
    quote=next(line for line in note['desc'].splitlines() if '爱心红绿灯' in line)
    try:
        validate_fact_exclusions({'reason':{'reason':'subject_mismatch','quote':quote}},dict(light,note_desc=note['desc'],note_title=note['title']),'ce733b67e45f0d657e53ff9bff8cbbce')
        raise AssertionError('预期当前主体摘录校验拒绝不连续拼接名')
    except ValueError as exc:assert str(exc)=='事实排除摘录未对应当前提及主体'
    try:
        async with SessionFactory() as s:
            await s.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            cat=await load_mention_catalog(s,'济南');sources=(await s.scalars(select(CanonicalPlace).where(CanonicalPlace.city=='济南'))).all()
            mentions=await load_mention_rows(s,'济南');selected={};scopes=[];decisions=[];expectations=[]
            for g in groups:
                eid=g['entity']['entity_id'];assert cat.catalog.entities[eid]==g['entity']
                ids={v['source']['id'] for v in g['sources']};assert len(ids)==1
                assert {v.id for v in sources if set(g['nameKeys'])&source_keys(v)}==ids
                raw=g['sources'][0];src=next(v for v in sources if v.id==raw['source']['id'])
                assert source_fingerprint(source_input(src))==raw['sourceHash'] and cat.scope_for_source(src.id) is None
                current=[m for m in mentions if scope_matches({'city':'济南','name_keys':g['nameKeys']},m)]
                assert {m['id']:mention_fingerprint(m) for m in current}=={m['id']:m['inputHash'] for m in packet['mentions'] if m['id'] in g['mentionIds']}
                selected.update({m['id']:m for m in current});sid=g['entity']['primary_place_id'];version=g['entity']['revision']
                assignments=[{'mentionId':m['id'],'inputHash':mention_fingerprint(m),'entityId':eid} for m in current]
                key=f'all-cities-20261009-batch-45-source-{sid}'
                scopes.append({'key':key+'-scope','city':'济南','sourcePlaceId':sid,'expectedSourceHash':raw['sourceHash'],'expectedScopeRevision':0,
                    'expectedRevisions':{eid:version},'assignments':assignments,'evidence':[{'kind':'reviewed_full_text_scope','file':review_path,
                    'mentionIds':g['mentionIds'],'conclusion':'完整原文确认独立路口/商业文化街区，原提及不改写，原图库无匹配数据；非本批三主体保持原状。'}]})
                overrides={'category':'文化'}
                evidence=[{'kind':'reviewed_primary_subject','file':review_path,'conclusion':'城市路口公共彩绘摄影点或大观园商业文化游览主体，不沿用餐饮主题。'}]
                if sid==5478:
                    overrides.update(lat=None,lng=None,address='山东省济南市市中区经四路与纬二路交汇处',geoStatus='unresolvable')
                    evidence.append({'kind':'wrong_point_cleared','files':['priority-cities/济南/commercial-reference-01.json','priority-cities/济南/commercial-reference-03.json','priority-cities/济南/commercial-geo-01.json'],
                        'conclusion':'百科地理位置明确经四路与纬二路，省地名网说明整体文化商业旅游主体；地图大观园及欧亚商场均在相同片区。旧经二路728及西侧约2.5公里点不符。候选点涉及整体、商场及入口粒度，暂清精确点不借入口坐标。'})
                decisions.append({'key':key+'-subject','city':'济南','entityId':eid,'expectedRevisions':{eid:version+1},'mergeEntityIds':[],
                    'canonicalName':g['entity']['canonical_name'],'aliases':g['entity']['aliases'],'overrides':overrides,'evidence':evidence})
                expectations.append({'city':'济南','id':eid,'name':g['entity']['canonical_name'],'revision':version+2,'verified':True,'mentionIds':sorted(a['mentionId'] for a in assignments)})
            images=[im for im in await load_image_rows(s,'济南') if im['source_place_id'] in [5321,5478]];assert images==[]
            history={k:[v for v in packet['catalog'][k] if (v['entity_id'] in {g['entity']['entity_id'] for g in groups})] for k in ['entities','members']}
            history['reviews']=[];assert len(history['entities'])==2 and len(history['members'])==2
            source={'readOnly':True,'capturedAt':datetime.now(timezone.utc).isoformat(),'city':'济南','groups':groups,'sources':[v for g in groups for v in g['sources']],
                'mentions':[{**m,'inputHash':mention_fingerprint(m)} for m in selected.values()],
                'notes':[n for n in original['notes'] if n['id'] in {m['raw_note_id'] for m in selected.values()}],'images':images,'reviews':[],
                'originalSourceFile':packet['originalSourceFile'],'originalSourceSha256':packet['originalSourceSha256']}
        review={'city':'济南','batch':45,'sourcePacket':packet_path,'sourcePacketSha256':packet_hash,'investigated':{'roots':5,'sources':7,'mentions':21,'fullNotes':12},
            'batchScope':{'roots':2,'sources':2,'mentions':5,'fullNotes':4,'confirmed':5,'pending':0},
            'deferredEntityIds':[g['entity']['entity_id'] for g in packet['groups'] if g not in groups],
            'deferredImageReason':'老商埠/经三路有18个旧目录记录，4个旧元数据eligible；新增mentionSources也阻断名称图库回退，不能无视觉核查自动绑定或静默丢弃。',
            'deferredTextReason':'红绿灯拼接抽取名在原文不连续，当前字段排除引用校验拒绝，未修改数据或弱化校验。',
            'imageComparison':'deferred_by_user','fullReviewPassed':False,'appliedAtFreeze':False,'rows':reviewed}
        write(review_path,review)
        for p,v in zip(files,[source,history,scopes,decisions,expectations]):write(p,v)
        print(json.dumps({'batch':45,'sourceSha256':hashlib.sha256((root/files[0]).read_bytes()).hexdigest(),'mentions':len(selected),'deferredRoots':3},ensure_ascii=False))
    finally:await engine.dispose()
asyncio.run(main())
