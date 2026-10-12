"""冻结第42批大明湖三源65提及联合scope；完整正文人工判读，无图片比对。"""
from pathlib import Path
import asyncio
import hashlib
import json
import sys
from datetime import datetime, timezone
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
packet_path='priority-cities/济南/daminghu-source-packet-01.json'
packet_hash='4d124af1f559730bc253a7ac94d908e71b6b363c8b454e960b1062c7d3b89582'
eid='550d6810857b4487aae8ce39c9ee093b'
# 每篇完整原文逐项判定；照片编号不作为视觉核实，地点正文可独立支持身份。
reviews={
2545:(True,'▪️大明湖\n游玩2h｜免费｜傍晚看超然楼亮灯夜景','路线中独立游览大明湖，2小时属于景区；同篇两次抽取保留追溯。'),
2547:(False,'打卡济南核心景点','正文是全城概括，大明湖只在话题中；荷花和老街描述未与具体推荐逐条绑定，继续待审。'),
2548:(True,'大明湖景区内','完整段落明确到湖、看灯和多个景区内码头，支持既有湖泊景区主体；各船线费用不当作景区门票。'),
2550:(True,'day2：大明湖—曲水亭街—百花洲—珍珠泉—芙蓉街','两条景点路线提及归现行景区；同篇另一个住宿区域提及单独待审。'),
2553:(True,'大明湖是济南最著名的景点之一','南门进东北门出、环湖漫步与2小时游览支持完整景区，后文登楼单列。'),
2554:(True,'游览大明湖建议从北门进，可以先看荷花再看超然楼从南门出来就是曲水亭街','明确园区穿行及多个景观；不把同篇周边酒店作为景区住宿属性。'),
2560:(True,'大明湖免费逛','路线与免费逛的正文支持景区访问，原有两次抽取均保留。'),
2563:(True,'📍大明湖：\n四面荷花三面柳，一城山色半城湖','独立景点段落描述湖柳景观，超然楼另列，不作同义合并。'),
2564:(True,'第六站：大明湖 傍晚六点左右去 可以看落日和夜景','明确行程中的景区访问；六点是到达时刻，不新增停留分钟。'),
2567:(True,'泛舟游湖，超惬意！','大明湖条目明确游湖赏荷，湖水景观是景区卖点。'),
2569:(True,'恒隆距离济南必玩景区都超近','同时给出完整游玩路线与门票说明，大明湖为独立一站，不将商场与景区合并。'),
2570:(True,'🕒17:30-18:30📍大明湖（p16）','明确安排一小时景区游览，与随后超然楼分段；只核正文，不证明图16实际机位。'),
2582:(False,'就在大明湖西南对面','餐厅广告的位置参照，未明确具体店点到哪一侧入口，也无独立景区游览事实；不作为已确认推荐。'),
2583:(False,'吃完饭过马路就是大明湖','鲁宴餐厅位置宣传，不借道路相邻证明原提及的游览主体与事实范围，保留待审。'),
2584:(False,'吃完建议直奔大明湖、趵突泉','餐厅宣传中的顺路参照，无独立景区叙述，继续补证。'),
2589:(False,'店里离着大明湖、五龙潭、趵突泉、泉城路都挺近','整条是未点明店名的餐饮附近参照，不导出为已核实大明湖推荐事实。'),
2608:(False,'济南站 / 大明湖站：市中心！离趵突泉大明湖超近','原主语为火车站及住宿片区；旧reason把市中心/交通便利归给景区，暂不认领。'),
2609:(True,'2️⃣ 大明湖 – 泉城明珠，超然楼亮灯瞬间绝美，四季皆景','独立景点条目，以湖泊景区和可见地标为推荐；不扩为楼体同义。'),
2611:(False,'就在济南核心景区大明湖附近','三家未命名酒店广告，附近商圈与步行可达属于酒店，不作为景区事实。'),
2613:(False,'可以直达趵突泉、大明湖、千佛山','未命名酒店的交通宣传，不证实景区具有地铁直达等属性。'),
2614:(False,'酒店坐落和谐广场核心商圈，去趵突泉、大明湖景点出行很方便','旧reason的酒店便利与起步价属于广告酒店，不可归景区。'),
2618:(True,'我们是从南门进北门出','完整夜游明确穿行大明湖，并列湖畔雨荷、超然楼为其中所看景观；保留有名称限定的景观描述，不把灯时当整湖营业时间。'),
2619:(True,'周边就是芙蓉街、大明湖，走路几分钟就到，可以串在一起逛','正文明确建议把两个景点串联游览，主体分别保留；距离仅为社区来源。'),
2620:(False,'机位在大明湖南丰祠附近的游船码头旁','仅为具体拍摄机位，远离景区主路、人少和最佳构图不能推广到全湖；待核具体主体。'),
2622:(True,'从泉眼逛到老巷再到湖景','正文明确整日路线已游览核心景点，大明湖为湖景一站；附近煎饼商铺不当同义。'),
2623:(True,'p5-12是大明湖的夜景和白天的景色','文字明确整组景色所称地点，可保留景区提及；照片主体和质量仍暂缓核查。'),
2624:(True,'重点来到了大明湖，吹吹风太舒服了','明确实际到湖观景、等待灯亮，支持景区访问；文末车站远近不纳入景区事实。'),
2782:(True,'🔟大明湖：\n曲水亭街尽头就是大明湖南门，进门右转就能依次打卡到夏雨荷和超然楼','进入景区并依次访问多个景观，不只是门口位置。'),
2786:(True,'终于亲眼见到课本里的大明湖！','正文独立描述湖景与柳树湖风，支持景区；在楼前拍照不把楼变别名。'),
2789:(True,'📍大明湖：环湖步行，看看历下亭、铁公祠，也可选游船环湖','明确环湖多个景观组成景区访问；保留有名称限定的子景观说明。'),
2793:(True,'蓝调时刻在大明湖可以拍到超然楼亮灯','明确从湖畔观景，并用与号区分景区和楼体，继续保持两主体。'),
2795:(False,'湖畔雨荷灯塑位置在大明湖北岸钢琴广场','提及主要为湖畔雨荷灯塑的位置与亮灯时间，不是全湖属性；待核独立灯塑/广场主体。'),
2797:(True,'1️⃣1️⃣-1️⃣2️⃣大明湖公园：四面荷花三面柳说的应该就是这里了','明确公园全名与湖柳景观，是既有同义关系依据；图片未比对。'),
2798:(True,'1️⃣大明湖','正文明确列为九个景点之一，可保留地点提及；photo_spot是原抽取类型，不改整个景区细分类或声称图像验证。'),
2800:(False,'精华路线：1小时步行打卡，全程不绕路\n起点大明湖南门','实际为南门起点到曲水亭街多个点的一小时线路；旧60分钟不是大明湖单点时长，原提及目标也未准确到门，暂待分配。'),
2801:(True,'白天就只逛了个大明湖差不多就天黑了','明确到景区游览；随后拼图与晚间时间建议不作为大明湖整体事实。'),
2803:(False,'💡大明湖景区附近\n靠近济南站和大明湖景区，交通 便利','本条抽取来自住宿区域段，交通便利及步行至两景点不是全湖属性；同篇路线不替错误字段背书。'),
2806:(True,'坐电瓶车游湖南门下车','进西南门后坐车游湖至南门，支持景区访问；全程三小时未分配给单点。'),
2807:(True,'大明湖西南门进去往北走400米','进入景区到码头并看湖中心，主体有效；原30分钟明确是船上时间，单独排除时长字段。'),
2808:(True,'个人觉得大明湖除了湖边的风景外','明确将湖边风景与超然楼并列，景区为整体访问，楼不作同义。'),
2810:(True,'老舍故居→趵突泉→黑虎泉→宽厚里→解放阁→白石泉→曲水亭街→大明湖→超然楼','原提及是游玩路线景点，不混用同篇住宿周边段。'),
2811:(True,'🌊大明湖｜一城山色半城湖，夏日荷风拂面','独立景区段落，湖面光影属于湖景，其他交通宣传不纳入此提及。'),
2816:(True,'从这个入口进去逛到湖北门附近就是夏雨荷','原文实际从入口逛到北门，支持完整景区访问，灯塑是途经子项。'),
2817:(False,'①大明湖景区(南门)','一小时曲水亭街路线只点名南门起点；旧抽取省略南门，不能把门等同全湖。既有三名同义不因此取消。'),
2829:(True,'📍大明湖（免费）','独立条目描述四面荷花三面柳，与住宿章节分开，景区主体明确。'),
2830:(True,'📍大明湖：免费大湖，风光治愈，可散步划船','独立景区段，散步划船与湖景有效；全文关于地铁覆盖的其他说法不导出成该提及属性。'),
2834:(True,'📍大明湖：“四面荷花三面柳，一城山色半城湖”','明确独立景点条目，以湖柳和文化典故描述景区。'),
2835:(True,'★大明湖景区：南门进，沿路有卖荷花的','明确从南门进入景区沿路访问；门和文创店作为子项，不作同义。'),
2837:(True,'在大明湖等待日落、超然楼亮灯','明确一日线路末站到湖等待观景，未将其他泉群半小时传播到大明湖。'),
2839:(True,'⑩大明湖景区🌊吃完饭逛大明湖！','明确饭后进入景区沿湖观景、北门离开，支持景区同义；酒店休整2小时不作为景区时长。'),
2840:(True,'超大湖泊，绕湖一圈要两小时','整段环湖与多处古迹访问，120分钟是独立环湖建议，不是后文船费或步行到楼时长。'),
2843:(True,'P7—P9：大明湖','文字将该组照片归名大明湖，可保留景点提及；未证明照片内容、机位或视觉质量。'),
2853:(False,'距离黑虎泉、解放阁、曲水亭街、大明湖、泉城广场','餐厅位置宣传，原文没有命名餐馆或大明湖独立景区访问，继续待审。'),
2856:(True,'按照五龙潭、趵突泉、黑虎泉、解放阁、大明湖、护城河这个顺序游玩的','正文明确实际游览顺序，景区和护城河分别保留。'),
}
def read(p):return json.loads((root/p).read_text(encoding='utf-8'))
def write(p,value):
    with (root/p).open('x',encoding='utf-8') as f:json.dump(value,f,ensure_ascii=False,indent=2)

async def main():
    assert hashlib.sha256((root/packet_path).read_bytes()).hexdigest()==packet_hash
    packet=read(packet_path);original=read(packet['originalSourceFile'])
    assert set(reviews)=={n['id'] for n in packet['notes']}
    files=[f'all-cities/batch-42-{name}.json' for name in ['source','decisions','scope-decisions','export-expectations']]
    review_path='priority-cities/济南/daminghu-source-review-01.json'
    assert all(not (root/p).exists() for p in [*files,review_path])
    by_note={n['id']:n for n in packet['notes']};rows=[]
    for m in packet['mentions']:
        selected,quote,reason=reviews[m['raw_note_id']];note=by_note[m['raw_note_id']]
        assert not note['unavailable'] and quote in note['desc'],m['raw_note_id']
        if m['id']==11421:
            selected=False;quote='✅大明湖附近：超然楼和曲水亭街附近，晚上看完超然楼夜景回去比较方便，周边环境不错。'
            reason='原文明确住宿区域，原提及type为hotel；不能当作景区或虚构具体酒店。'
            assert quote in note['desc']
        row={'mentionId':m['id'],'inputHash':m['inputHash'],'noteId':m['raw_note_id'],'originalName':m['name'],
            'entityId':eid if selected else None,'status':'reviewed_scenic_area' if selected else 'needs_evidence','quote':quote,'reason':reason}
        if m['id']==12700:
            quote='3：两公里距离然后到大明湖西南门进去往北走400米，想看大明湖中心就可以买前面码头的票，可以上岛十五分钟，50一位，整个船上时间30分钟内（但是有时候要等船，30分钟内会等到船）'
            assert quote in note['desc']
            row['factExclusions']={'visit_duration':{'reason':'subject_mismatch','quote':quote}}
        rows.append(row)
    confirmed=[r['mentionId'] for r in rows if r['entityId']];pending=[r['mentionId'] for r in rows if not r['entityId']]
    assert len(confirmed)==48 and len(pending)==17
    try:
        async with SessionFactory() as session:
            await session.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            cat=await load_mention_catalog(session,'济南');entity=cat.catalog.entities[eid]
            assert entity==packet['entity'] and entity['revision']==2
            sources=(await session.scalars(select(CanonicalPlace).where(CanonicalPlace.city=='济南'))).all()
            keys={k for g in packet['sources'] for k in source_keys(next(s for s in sources if s.id==g['source']['id']))}
            assert {s.id for s in sources if keys & source_keys(s)}=={5348,5953,5968}
            for g in packet['sources']:
                source=next(s for s in sources if s.id==g['source']['id'])
                assert {k:getattr(source,k) for k in g['source']}==g['source']
                assert source_fingerprint(source_input(source))==g['sourceHash']
                assert cat.scope_for_source(source.id) is None
            actual=[r for r in await load_mention_rows(session,'济南') if scope_matches({'city':'济南','name_keys':keys},r)]
            assert {r['id']:mention_fingerprint(r) for r in actual}=={r['mentionId']:r['inputHash'] for r in rows}
            images=await load_image_rows(session,'济南')
            relevant=[im for im in images if im['source_place_id'] in [5348,5953,5968]]
            source={'readOnly':True,'capturedAt':datetime.now(timezone.utc).isoformat(),'city':'济南','entity':entity,
                'originalSourceFile':packet['originalSourceFile'],'originalSourceSha256':packet['originalSourceSha256'],
                'sources':packet['sources'],'mentions':[{**r,'inputHash':mention_fingerprint(r)} for r in actual],
                'notes':[n for n in original['notes'] if n['id'] in reviews],'images':relevant,'reviews':[]}
        review={'city':'济南','batch':'batch-42','entityId':eid,'sourcePlaceIds':[5348,5953,5968],'sourcePacket':packet_path,
            'sourcePacketSha256':packet_hash,'summary':{'mentions':65,'fullNotes':54,'confirmed':48,'pending':17,'durationFieldsExcluded':1},
            'identityPolicy':'保留用户最初点名及已有正文互证的湖泊景区三名同义、旧稳定ID与自然类别；不把门、灯塑、摄影点、餐馆或酒店合并成景区。',
            'durationPolicy':'12700船上30分钟不作景区时长；其他独立环湖时长保留。12839同时误取南门及整条街区线路60分钟，目标继续待审。',
            'imageComparison':'deferred_by_user','fullReviewPassed':False,'appliedAtFreeze':False,'rows':rows}
        write(review_path,review)
        proof={'kind':'reviewed_joint_lake_scope','file':review_path,'sha256':hashlib.sha256((root/review_path).read_bytes()).hexdigest(),
            'sourcePlaceIds':[5348,5953,5968],'mentionIds':sorted(r['mentionId'] for r in rows),'conclusion':review['identityPolicy']}
        scope={'key':'all-cities-20261009-batch-42-daminghu-scope','city':'济南','sourcePlaceId':5348,
            'expectedSourceHash':next(g['sourceHash'] for g in packet['sources'] if g['source']['id']==5348),
            'expectedScopeRevision':0,'expectedRevisions':{eid:2},
            'sources':[{'sourcePlaceId':g['source']['id'],'sourceHash':g['sourceHash']} for g in sorted(packet['sources'],key=lambda g:g['source']['id'])],
            'assignments':[{k:r[k] for k in ['mentionId','inputHash','entityId','factExclusions'] if k in r} for r in rows],'evidence':[proof]}
        expected=[{'city':'济南','id':eid,'name':'大明湖','revision':3,'verified':True,'mentionIds':sorted(confirmed)}]
        for p,value in zip(files,[source,[],[scope],expected]):write(p,value)
        print(json.dumps({'batch':'batch-42','mentions':65,'notes':54,'confirmed':48,'pending':17,'durationFieldsExcluded':1,
            'sourceSha256':hashlib.sha256((root/files[0]).read_bytes()).hexdigest(),'imagesNotCompared':len(relevant)},ensure_ascii=False))
    finally:await engine.dispose()
asyncio.run(main())
