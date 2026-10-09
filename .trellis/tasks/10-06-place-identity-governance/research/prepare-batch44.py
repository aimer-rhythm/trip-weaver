"""冻结第44批三主体107提及判断；不修改业务库，不查看图片。"""
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
from app.clean.mention_identity import mention_fingerprint,source_fingerprint,scope_matches
root=Path(__file__).resolve().parent
packet_path='priority-cities/济南/shared-routes-source-packet-01.json'
packet_hash='527764a6b532e6ba5b23ff91ed29c7e518dd2cbc95c15fc898d8a9cfa3e3e622'
def read(p):return json.loads((root/p).read_text(encoding='utf-8'))
def write(p,v):
    with (root/p).open('x',encoding='utf-8') as f:json.dump(v,f,ensure_ascii=False,indent=2)
# 全文支持的具体判断；同篇不同提及另行覆盖，不能以同篇正确主体掩盖错误字段。
tower={
2545:'解放阁与黑虎泉是独立两主体，60分钟是合计，连同错误单点reason排除。',
2546:'夜间实际隔岸看到纪念建筑，作者当晚闭馆经历保留为来源观察，不推广营业政策。',
2548:'顺带看解放阁是明确建筑访问，非附近餐馆或交通主语。',
2550:'首日路线明确列出解放阁，住宿段不混入。',
2551:'独立解放阁条目，红星及蓝调夜景为建筑描述。',
2553:'独立历史建筑条目，明确游览约30分钟；不使用前一地点通勤10分钟。',
2563:'黑虎泉旁阁楼是建筑本体，周边相邻不作为别名。',
2564:'第四站联合黑虎泉与解放阁，两地点分别保留，未新增单点时间。',
2567:'登高怀古与俯瞰老城为解放阁独立条目，不混同黑虎泉。',
2570:'11:30至12:00为明确建筑游览，重复抽取同篇只贡献一个30分钟样本。',
2618:'原提及只包含建筑附近夜景/拍照，未含正文另行声称的票价与灯时，不虚构排除字段。',
2622:'实际整日游览路线明确列阁楼，与宽厚里分开。',
2624:'原文明确到解放阁并建议入内参观，后文小吃街不是阁楼。',
2782:'过桥登阶到解放阁，九女亭仅为路径参照，不作同义名。',
2789:'独立红色阁楼及内部济南解放历史展览，保留有界景观说明。',
2793:'远处拍解放阁全景仍以建筑为被摄主体，不创建远处未知机位。',
2797:'原文独立解放阁条目及馆藏，保留描述；不据单篇将济南解放纪念馆增加为全局别名。',
2803:'路线明确解放阁，但当前reason与evidence借全城泛化出片宣传；排除两描述字段，保留地点与线路身份。',
2810:'明确游玩路线点名解放阁，原提及无错误周边事实。',
2830:'独立阁楼俯瞰护城河条目，提及字段未纳入另段政策，不扩大事实范围。',
2834:'阁内济南战役史料为明确建筑文化主体。',
2835:'作者未上楼但远看阁楼，有效被观察建筑，不声称入馆游览。',
2839:'解放阁登高拍照独立条目，与宽厚里小吃分别处理。',
2840:'15:20到阁、15:50下一站，独立30分钟保留。',
2846:'全文高楼远摄古今城市，当前字段明确被摄解放阁的城市位置与历史；不把拍摄高楼当阁楼，不确认图片机位。',
2853:'未具名鲁菜馆宣传步行附近，原提及无阁楼独立游览事实，待审。',
2856:'正文明确实际游览顺序，阁楼与护城河分开。',
}
street={
2545:'曲水亭街与百花洲组合90分钟，排除时长及重复该时长的reason，保留街巷证据。',
2546:'提及混有独立起凤桥摄影看点；整块placeContent同时含街道有效看点，不能全块删除损失事实，暂待精细分配。',
2548:'完整正文描述曲水亭街安静小巷、流水垂柳，街道主体明确。',
2550:'第二日路线点名街道，两次路线提及保留；另一个住宿区域提及单独待审。',
2553:'独立明清古街条目，明确约30分钟有效。',
2554:'正文从泉眼走到石板路，汉服店评价已有店铺限定可保留；提前一天准备非停留且原提及无minutes，不伪造时长排除。',
2560:'明确步行路线的街道一站；8分钟为交通，原记录没有游览分钟。',
2563:'独立街道泉水和老城生活描述，住宿段另行分开。',
2567:'独立街道青砖小瓦及泉水茶馆语境，茶馆不是街道别名。',
2569:'明确推荐citywalk路线经过该街，商场位置不变成街道自身属性。',
2570:'明确15至16点街道访问，涌泉胡同为具名摄影语境，时段覆盖整段街道访问并吃酸蘸儿；重复样本去重。',
2574:'全文老街散步路线中的曲水亭明确沿用已治理街名简称，不另造亭子；泛街区氛围保留来源语境。',
2582:'未具名餐馆附近宣传，缺独立街道访问，待审。',
2583:'餐馆附近列表，不能传播为街道游览事实，待审。',
2584:'餐馆距离与顺路宣传，未形成独立街道游览，待审。',
2609:'独立曲水亭街条目，家家泉水/水墨长卷漫步明确。',
2611:'未具名第二家酒店离街近，旧reason把酒店到街距离错当街到大明湖距离，待审。',
2618:'正文混用曲水亭与百花洲，提及描述实际为百花洲与未知蓝色银河，待审；不撤销已有街名简称等价。',
2619:'全文独立夜游街道，巷子、小店、脚下泉水为同主体。',
2622:'实际游览老巷路线点名街道，保留主体。',
2623:'原文将照片13/14标为曲水亭街，只支持文字地点提及，不声称查看照片。',
2624:'实际走到街道再去王府池子/起凤桥，明确先后与独立主体。',
2782:'街道小茶馆与小酒馆，涌泉胡同机位有明确限定；全文区分更大的百花洲历史文化街区。',
2786:'街道老民居与流水独立段落，保留街道风貌。',
2789:'独立青石板路、门前泉水与老民居段落，不借同篇酒店便利。',
2793:'联合百花洲的慢生活散步描述，不将两地合并或从共享气氛推导时间。',
2798:'正文独立列曲水亭街为景点，图片未查看。',
2800:'一小时路线串联大明湖南门、后宰门街、多个泉桥和店，目标/范围均混合，整条待审。',
2801:'原文明确夜间继续逛曲水亭街，超然楼独立。',
2803:'路线主体明确，现reason/evidence却为全城泛化出片宣传，排除二字段，保留线路身份。',
2806:'实际从湖游完再到街道，三小时属于整次速游，不追加单点分钟。',
2808:'第七站独立描述小河贯穿街道，前段途经诸泉不作别名。',
2810:'街道工作日更清净是具名提示，酒店与茶摊主体另外区分。',
2811:'独立街道老城原生态生活段落。',
2813:'完整泉水一日路线中街道独立小江南描述，百花洲池塘另列。',
2816:'实际整段芙蓉街到曲水亭街沿途胡同及网红点，当前看点没有逐一绑定街道，待审。',
2829:'独立街道夜景与氛围评价，住宿章节不混入。',
2830:'独立石板路与老城烟火条目。',
2834:'独立泉水顺街和岸柳描述，保留来源。',
2835:'明确首日曲水亭街一站，原提及只是线路名称，无商店事实错配。',
2837:'共同条目中泉水穿街是曲水亭街的明确景观语境；不与百花洲同义，不新增共享时间。',
2839:'独立街道摄影条目，保留具名泉水垂杨。',
2840:'16:40到街、17:30下一站，独立50分钟保留。',
2851:'全文对比三条街不同玩法，曲水亭街文艺老民居与溪水独立。',
2853:'未具名餐馆到街的步行宣传，被抽成景点自身距离，待审。',
}
lake={
2545:'与曲水亭街共享90分钟排除，街巷及小店为环湖小街区语境，不把整个历史文化街区并入。',
2546:'百花池/小南湖的隔河拍照明确湖及周边景点；不据单篇新增别名，不混同大明湖。',
2548:'曲水亭街与百花洲分别访问，保留湖边景点主体。',
2550:'第二日路线独立列百花洲，与曲水亭街分别保留。',
2570:'所谓百花洲一小时实际导航书香胡同拍黑色济南墙，原reason/全部看点只指该机位，不能归整个环湖景点，待审。',
2582:'未具名餐馆附近广告，无独立湖边游览，待审。',
2782:'原文明确百花洲景点是围湖的小街区；大历史文化街区同时包含曲水亭街，不能作为同义别名。',
2793:'联合曲水亭街的闲逛氛围支持环湖景点访问，不合并两主体。',
2813:'池塘、天鹅、鸳鸯、荷花、碧水的独立百花洲条目，非大街区或邻街。',
2835:'首日路线明确百花洲一站；提及没有引入后段未具名文创店价格。',
2837:'联合条目的看点混有曲水亭街泉水穿街，当前整块content不能逐条拆分，保留待审而不删除其余有效小店看点。',
2843:'正文P5-P6明确百花洲，只确认文字提及，不声称视觉核查。',
}
pending={12906,11369,12610,11423,11436,12713,11540,11585,11614,11698,12660,12840,12907,11461,12727,11541,12946}
async def main():
    assert hashlib.sha256((root/packet_path).read_bytes()).hexdigest()==packet_hash
    packet=read(packet_path);original=read(packet['originalSourceFile'])
    assert hashlib.sha256((root/packet['originalSourceFile']).read_bytes()).hexdigest()==packet['originalSourceSha256']
    review_path='priority-cities/济南/shared-routes-source-review-01.json'
    files=[f'all-cities/batch-44-{kind}.json' for kind in ['source','catalog','scope-decisions','decisions','export-expectations']]
    assert all(not (root/p).exists() for p in [review_path,*files])
    reviewed=[]
    for g,rules in zip(packet['groups'],[tower,street,lake]):
        ms=[m for m in packet['mentions'] if m['id'] in g['mentionIds']]
        assert set(rules)=={m['raw_note_id'] for m in ms}
        for m in ms:
            n=next(n for n in packet['notes'] if n['id']==m['raw_note_id']);assert not n['unavailable']
            quote=m['evidence_text'] if m['evidence_text'] and m['evidence_text'] in n['desc'] else next(line for line in n['desc'].splitlines() if m['name'] in line or (m['name']=='曲水亭街' and '曲水亭' in line))
            r={'mentionId':m['id'],'noteId':m['raw_note_id'],'originalName':m['name'],'inputHash':m['inputHash'],
                'entityId':None if m['id'] in pending else g['entity']['entity_id'],'quote':quote,'reason':rules[m['raw_note_id']],
                'status':'needs_evidence' if m['id'] in pending else 'reviewed_target'}
            if m['id']==11423:r['reason']='本条为曲水亭街附近住宿/民宿区域，不能用同篇路线替其属性背书。'
            if m['id'] in [11337,12565,11340,12568,11341,12569]:
                q='▪️黑虎泉+解放阁\n游玩1h｜免费｜可接泉水' if m['name']=='解放阁' else '▪️曲水亭街+百花洲\n游玩1.5h｜老济南街巷，有很多有意思的小店'
                r['factExclusions']={'visit_duration':{'reason':'group_duration','quote':q},'reason':{'reason':'subject_mismatch','quote':q}}
            if m['id'] in [12577,12574]:
                q=next(line for line in n['desc'].splitlines() if ('Day2' if m['id']==12577 else 'Day1') in line)
                r['factExclusions']={k:{'reason':'subject_mismatch','quote':q} for k in ['reason','evidence_text']}
            for f in r.get('factExclusions',{}).values():assert f['quote'] in n['desc'] and m['name'] in f['quote']
            reviewed.append(r)
    assert len(reviewed)==107 and {r['mentionId'] for r in reviewed if r['entityId'] is None}==pending
    try:
        async with SessionFactory() as s:
            await s.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            cat=await load_mention_catalog(s,'济南');sources=(await s.scalars(select(CanonicalPlace).where(CanonicalPlace.city=='济南'))).all()
            mentions=await load_mention_rows(s,'济南');selected={};scopes=[];decisions=[];expectations=[]
            for g in packet['groups']:
                eid=g['entity']['entity_id'];assert cat.catalog.entities[eid]==g['entity']
                ids={v['source']['id'] for v in g['sources']}
                assert {v.id for v in sources if set(g['nameKeys'])&source_keys(v)}==ids
                for raw in g['sources']:
                    src=next(v for v in sources if v.id==raw['source']['id'])
                    assert source_fingerprint(source_input(src))==raw['sourceHash'] and cat.scope_for_source(src.id) is None
                current=[m for m in mentions if scope_matches({'city':'济南','name_keys':g['nameKeys']},m)]
                assert {m['id']:mention_fingerprint(m) for m in current}=={m['id']:m['inputHash'] for m in packet['mentions'] if m['id'] in g['mentionIds']}
                selected.update({m['id']:m for m in current});sid=g['entity']['primary_place_id'];version=g['entity']['revision']
                assignments=[{k:r[k] for k in ['mentionId','inputHash','entityId','factExclusions'] if k in r} for r in reviewed if r['mentionId'] in g['mentionIds']]
                key=f'all-cities-20261009-batch-44-source-{sid}'
                scope={'key':key+'-scope','city':'济南','sourcePlaceId':sid,'expectedSourceHash':next(v['sourceHash'] for v in g['sources'] if v['source']['id']==sid),
                    'expectedScopeRevision':0,'expectedRevisions':{eid:version},'assignments':assignments,
                    'evidence':[{'kind':'reviewed_full_text_scope','file':review_path,'mentionIds':g['mentionIds'],'conclusion':'完整原文与实际字段逐提及判读；组合时间、周边广告和独立机位分开，原始记录不改写。'}]}
                if len(ids)>1:scope['sources']=[{'sourcePlaceId':v['source']['id'],'sourceHash':v['sourceHash']} for v in sorted(g['sources'],key=lambda x:x['source']['id'])]
                scopes.append(scope)
                if sid!=5352:
                    decisions.append({'key':key+'-category','city':'济南','entityId':eid,'expectedRevisions':{eid:version+1},'mergeEntityIds':[],
                        'canonicalName':g['entity']['canonical_name'],'aliases':g['entity']['aliases'],'overrides':{'category':'文化'},
                        'evidence':[{'kind':'reviewed_primary_subject','file':review_path,'conclusion':'纪念建筑或百花洲环湖历史小街区为游览主体；不沿用餐饮主题，不将整个百花洲历史文化街区设为别名。'}]})
                expectations.append({'city':'济南','id':eid,'name':g['entity']['canonical_name'],'revision':version+1+(sid!=5352),'verified':True,'mentionIds':sorted(a['mentionId'] for a in assignments if a['entityId'])})
            images=[im for im in await load_image_rows(s,'济南') if im['source_place_id'] in [5360,5352,5493,5364]]
            assert images==[], '有既有图库时不得静默空策略，须先保全'
            source={'readOnly':True,'capturedAt':datetime.now(timezone.utc).isoformat(),'city':'济南','groups':packet['groups'],
                'sources':[v for g in packet['groups'] for v in g['sources']], 'mentions':[{**m,'inputHash':mention_fingerprint(m)} for m in selected.values()],
                'notes':[n for n in original['notes'] if n['id'] in {m['raw_note_id'] for m in selected.values()}], 'images':images,'reviews':[],
                'originalSourceFile':packet['originalSourceFile'],'originalSourceSha256':packet['originalSourceSha256']}
        review={'city':'济南','batch':44,'sourcePacket':packet_path,'sourcePacketSha256':packet_hash,'summary':{'sources':4,'mentions':107,'fullNotes':51,'confirmed':90,'pending':17},
            'identityPolicy':'三个原稳定根及曲水亭两名/两成员保持；百花洲是湖与环湖小街区，不扩成同时包含曲水亭街的大历史文化街区。',
            'durationPolicy':'共享60/90分钟从标量与错误reason排除；解放阁独立30分钟、曲水亭街30/50/60分钟保留；百花洲暂无独立时长。',
            'priorFullTextReuse':{'byteIdenticalNotes':48,'packets':['daminghu-source-packet-01.json','main-sights-source-packet-01.json'],'newFullNotes':[2574,2813,2846]},
            'durationProvenance':'shared-routes-duration-provenance-01.json','imageComparison':'deferred_by_user','fullReviewPassed':False,'appliedAtFreeze':False,'rows':reviewed}
        write(review_path,review)
        for p,v in zip(files,[source,packet['catalog'],scopes,decisions,expectations]):write(p,v)
        print(json.dumps({'batch':44,'sourceSha256':hashlib.sha256((root/files[0]).read_bytes()).hexdigest(),'results':[{ 'name':g['entity']['canonical_name'],'confirmed':sum(r['entityId']==g['entity']['entity_id'] for r in reviewed),'total':len(g['mentionIds'])} for g in packet['groups']], 'imagesNotCompared':len(images)},ensure_ascii=False))
    finally:await engine.dispose()
asyncio.run(main())
