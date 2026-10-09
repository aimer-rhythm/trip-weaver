"""冻结黑虎泉/千佛山60提及的正文判断与第43批决定；不应用业务变更。"""
from pathlib import Path
import asyncio,hashlib,json,sys
from datetime import datetime,timezone
sys.dont_write_bytecode=True
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0,'D:/Project/xhs-travel-pipeline')
from sqlalchemy import select,text
from app.db import SessionFactory,engine
from app.models import CanonicalPlace,PlaceEntityReview
from app.aggregate.mention_identity import load_mention_catalog,load_mention_rows,source_keys,source_input
from app.aggregate.image_identity import load_image_rows
from app.clean.mention_identity import mention_fingerprint,source_fingerprint,scope_matches
root=Path(__file__).resolve().parent
packet_path='priority-cities/济南/main-sights-source-packet-01.json'
packet_hash='ae67cf18f0146e54467576269b40ac0b2cfe3b222b56ea4885332dd37dd3faef'
def read(p):return json.loads((root/p).read_text(encoding='utf-8'))
def write(p,value):
    with (root/p).open('x',encoding='utf-8') as f:json.dump(value,f,ensure_ascii=False,indent=2)

# 每项已对照整篇正文；不能只依附近名称或旧提取摘要认领。
black={
2545:(True,'▪️黑虎泉+解放阁\n游玩1h｜免费｜可接泉水','明确包含黑虎泉，原60分钟是与解放阁合计，排除数值及错误单点时长reason，保留接水证据。'),
2546:(True,'泉水从三个石雕虎首中喷涌而出','明确虎首泉池本体，旁边接水为有界语境；整段夜游三小时不是单点时长。'),
2548:(True,'交给城中心剩下的黑虎泉等地','第二日明确安排黑虎泉，游船价格/时刻在另段且不当作泉池政策。'),
2550:(True,'五龙潭—趵突泉—泉城广场—黑虎泉—解放阁','提及来自实际景点路线，两次抽取均保留，不借住宿段补充属性。'),
2551:(True,'5️⃣黑虎泉：泉水荡漾，有很多小鱼，沿着河堤走一圈很舒服','黑虎泉独立条目，沿河步行是访问语境，不将护城河作为同义名。'),
2553:(True,'以其独特的“黑虎吐水”景观闻名','明确虎首泉池，独立游览约30分钟保留。'),
2560:(True,'黑虎泉可以接直饮水','独立路线及接水描述支持原主体，两次抽取保留；不据文字核实饮用水卫生政策。'),
2563:(True,'三虎头喷涌气势足','明确泉池虎首特征，后文酒店便利不纳入本提及。'),
2564:(True,'第四站：黑虎泉➕解放阁 沿护城河走','明确合并游览路线中的两地点，未给单点分钟，不新增时长或合并身份。'),
2567:(True,'🐯 黑虎泉：本地人打水的地方','独立黑虎泉条目，后文淄博景点不混入济南实体。'),
2569:(True,'黑虎泉接的免费泉水','正文明确路线及黑虎泉接水提示，商场是另一个主体。'),
2570:(True,'🕘10:30-11:30📍黑虎泉（p11）','明确一小时泉池访问安排，两次抽取不应当作两个独立时长样本；本轮未看P11。'),
2582:(False,'距离大明湖、曲水亭街、百花洲、黑虎泉、趵突泉、五龙潭','未具名餐馆附近宣传，不支持泉池具体游览主体与消费事实。'),
2583:(False,'附近离着趵突泉、五龙潭、黑虎泉','餐厅广告附近参照，原提及未形成独立泉池访问。'),
2607:(True,'去泉城广场，再去黑虎泉','原文给出明确景点访问线路，酒店评价不作为泉池事实。'),
2609:(True,'泉水从三兽头喷射','明确泉池本体，社区接水描述保留来源，不冒称官方卫生结论。'),
2618:(False,'这里是环城水系公园，不止有黑虎泉','旧reason将整个环城公园当黑虎泉；同段景色未逐一绑定泉池，两个混合提及暂待分配。'),
2622:(True,'趵突泉→黑虎泉→解放阁','明确实际游览景点路线，原提及不含错配周边商铺事实。'),
2624:(True,'沿着护城河，就能看到黑虎泉','正文明确到黑虎泉接水，护城河及末段车站是独立语境。'),
2782:(True,'进门右转下去就是黑虎泉','明确从公园入口到泉池，莲花接水台只是具名附属语境，不把入口或台盆当别名。'),
2786:(False,'尤其是玛瑙泉','旧黑虎泉提及的实际看点为玛瑙泉水色；不能将泉群/玛瑙泉描述推广到虎首泉池。'),
2789:(True,'三处兽头喷涌泉水','明确泉池本体，沿河闲逛为其周边活动，不合并护城河。'),
2798:(True,'6️⃣黑虎泉','正文独立列为游览景点，只支持名称提及，不等于照片主体已确认。'),
2803:(False,'步行即可抵达黑虎泉','抽取证据来自宽厚里住宿片区便利说明，不能用同篇路线替该字段背书。'),
2807:(False,'坐大明湖走护城河到黑虎泉的船','提及主体为航线终点/码头，全文没有独立泉池游览事实，保留待审而非把船程当泉池时长。'),
2808:(True,'一直走到黑虎泉取水点，可以远观解放阁','明确黑虎泉访问，阁楼是隔河可见的独立主体。'),
2810:(False,'黑虎泉茶摊喝泉水茶','原提及消费事实只针对未具名茶摊；同篇泉池路线不能给茶摊事实背书，待分配。'),
2816:(False,'旁边还有个游泳池，好像是免费的','旧提及混有取水管、游船与不确定免费游泳池，正文未清楚绑定泉池本体，不能输出确定免费设施。'),
2829:(True,'是本地人爱去的泉','独立泉池条目和接水说明成立，不与住宿片区混合。'),
2830:(True,'三虎头喷水，看着很壮观','明确虎首泉池；全篇交通和其他景区政策不移植。'),
2834:(True,'潭水清澈见底，本地市民常到此取水','独立泉池条目，明确泉流和城墙的周边关系。'),
2835:(True,'★黑虎泉：❗️坐船需要提前买票选座','正文明确到泉池、区分途经诸泉及对面黑虎阁。预约事实实际为坐船选座，单独排除reservation字段，不删除有效具名语境。'),
2837:(False,'环城公园南门➠玛瑙泉➠黑虎泉➠琵琶泉➠五莲泉➠一虎泉➠金虎泉','旧提及整体为多个泉池的90分钟线路，并以玛瑙泉作看点，主体与事实范围均混合，继续待审。'),
2839:(True,'④黑虎泉🥤可以直接接泉水尝一尝','明确实际到访顺序与接水活动，酒店休整时间不属于此地。'),
2840:(True,'✨14:30到黑虎泉','14:30至15:20下一站是实际访问时段，50分钟保留；此数并非游船时长，不能因同段出现船字就排除。'),
2851:(True,'逛完正好接黑虎泉喝口泉水','明确建议黑虎泉为下一游览点，与前述三条街及茶摊分开。'),
2853:(False,'距离黑虎泉、解放阁、曲水亭街','未具名餐馆位置宣传，不作已确认泉池访问事实。'),
2856:(True,'按照五龙潭、趵突泉、黑虎泉、解放阁、大明湖、护城河这个顺序游玩的','明确实际游览顺序，黑虎泉与护城河分别保留。'),
}
mountain={
2548:(True,'早起爬千佛山','明确到千佛山爬山，景区与后续博物馆分开。'),
2560:(True,'或打车10min到千佛山','有条件的可选游览推荐仍可认领主体；10分钟是交通时间，没有写入单点分钟。'),
2564:(True,'第二站：千佛山 美院门进 先往左看大佛 再往右上山','入园后访问大佛并登山，支持整体景区；门、大佛不作别名。'),
2608:(False,'前两个景区都有地铁站','住宿区域交通宣传，原reason推导交通便利，缺少独立景区游览事实。'),
2609:(True,'千佛山 – 登顶俯瞰泉城全景','独立景区登山与兴国禅寺描述，寺庙不是景区同义名。'),
2613:(False,'可以直达趵突泉、大明湖、千佛山','未具名酒店广告的交通宣传，不能给景区赋酒店附近直达属性。'),
2782:(True,'从历山院去山顶的路真的很难走','原文明确景区登山经历及恐高者主观评价，不泛化为客观安全评级。'),
2793:(True,'时间充裕的，可以安排济南千佛山','有条件游览建议，主体为景区，不据此造访记录或造时长。'),
2797:(False,'5️⃣-6️⃣千佛山山顶','原明确主体为山顶摄影机位，旧抽取省略山顶；不能将最佳日落点与时刻不加限定地扩为整个景区。'),
2829:(True,'📍千佛山（景区票30R+洞窟票25R）\n🔜是济南三大名胜之一，山不高，20-40分钟就能登顶','明确景区独立条目；30分钟是登顶路段，不是含下山/寺庙/洞窟的整次游览，排除单点分钟而保留原登山说明。'),
2830:(True,'千佛山：济南名山，爬山祈福，登顶俯瞰全城视野好','明确整体景区爬山活动，寺庙/山顶不作同义名。'),
}
async def main():
    assert hashlib.sha256((root/packet_path).read_bytes()).hexdigest()==packet_hash
    packet=read(packet_path);original=read(packet['originalSourceFile'])
    assert hashlib.sha256((root/packet['originalSourceFile']).read_bytes()).hexdigest()==packet['originalSourceSha256']
    evidence_path='priority-cities/济南/main-sights-source-review-01.json'
    outputs=[evidence_path]+[f'all-cities/batch-43-{kind}.json' for kind in ['source','decisions','scope-decisions','export-expectations']]
    assert all(not (root/p).exists() for p in outputs)
    reviews=[]
    for g,rules in zip(packet['groups'],[black,mountain]):
        mentions=[m for m in packet['mentions'] if m['id'] in g['mentionIds']]
        assert {m['raw_note_id'] for m in mentions}==set(rules)
        for m in mentions:
            selected,quote,reason=rules[m['raw_note_id']]
            n=next(n for n in packet['notes'] if n['id']==m['raw_note_id']);assert quote in n['desc']
            row={'mentionId':m['id'],'noteId':m['raw_note_id'],'entityId':g['entity']['entity_id'] if selected else None,
                'inputHash':m['inputHash'],'status':'reviewed_target' if selected else 'needs_evidence','quote':quote,'reason':reason}
            if m['id'] in [11336,12564]:row['factExclusions']={
                'visit_duration':{'reason':'group_duration','quote':quote},'reason':{'reason':'subject_mismatch','quote':quote}}
            if m['id']==12929:row['factExclusions']={'reservation':{'reason':'subject_mismatch','quote':quote}}
            if m['id']==12851:row['factExclusions']={'visit_duration':{'reason':'subject_mismatch','quote':quote}}
            reviews.append(row)
    assert sum(r['entityId'] is not None for r in reviews)==46 and len(reviews)==60
    try:
        async with SessionFactory() as s:
            await s.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            cat=await load_mention_catalog(s,'济南');sources=(await s.scalars(select(CanonicalPlace).where(CanonicalPlace.city=='济南'))).all()
            rows=await load_mention_rows(s,'济南');groups=[];scopes=[];decisions=[];expectations=[]
            for g in packet['groups']:
                eid=g['entity']['entity_id'];assert cat.catalog.entities[eid]==g['entity'] and g['entity']['revision']==1
                assert len(g['sources'])==1;member=g['sources'][0];sid=member['source']['id']
                source=next(v for v in sources if v.id==sid)
                assert {v.id for v in sources if set(g['nameKeys'])&source_keys(v)}=={sid}
                assert source_fingerprint(source_input(source))==member['sourceHash'] and cat.scope_for_source(sid) is None
                current=[m for m in rows if scope_matches({'city':'济南','name_keys':g['nameKeys']},m)]
                assert {m['id']:mention_fingerprint(m) for m in current}=={m['id']:m['inputHash'] for m in packet['mentions'] if m['id'] in g['mentionIds']}
                groups.append({**member,'entity':g['entity'],'mentions':[{**m,'inputHash':mention_fingerprint(m)} for m in current]})
                assigned=[r for r in reviews if r['mentionId'] in g['mentionIds']]
                key=f'all-cities-20261009-batch-43-source-{sid}'
                scopes.append({'key':key+'-scope','city':'济南','sourcePlaceId':sid,'expectedSourceHash':member['sourceHash'],
                    'expectedScopeRevision':0,'expectedRevisions':{eid:1},
                    'assignments':[{k:r[k] for k in ['mentionId','inputHash','entityId','factExclusions'] if k in r} for r in assigned],
                    'evidence':[{'kind':'reviewed_full_text_scope','file':evidence_path,'sourcePlaceId':sid,'mentionIds':g['mentionIds'],
                        'conclusion':'逐篇分开泉池/景区本体、组合线路、活动和周边主语；有效描述和原身份保持，未确认提及待审。'}]})
                decisions.append({'key':key+'-category','city':'济南','entityId':eid,'expectedRevisions':{eid:2},
                    'mergeEntityIds':[],'canonicalName':g['entity']['canonical_name'],'aliases':g['entity']['aliases'],
                    'overrides':{'category':'自然'},'evidence':[{'kind':'reviewed_primary_subject','file':evidence_path,
                        'conclusion':'泉池自然景观或整体山岳景区为主要主体；不沿用旧住宿/美食主题，不把内含文化点当同义名。'}]})
                expectations.append({'city':'济南','id':eid,'name':g['entity']['canonical_name'],'revision':3,'verified':True,
                    'mentionIds':sorted(r['mentionId'] for r in assigned if r['entityId'])})
            images=[im for im in await load_image_rows(s,'济南') if im['source_place_id'] in [5351,5357]]
            assert not images
            related=(await s.scalars(select(PlaceEntityReview).where(PlaceEntityReview.city=='济南'))).all()
            ids={g['entity']['entity_id'] for g in groups}
            assert not [r for r in related if ids&set(r.detail.get('entityIds',[]))]
            frozen={'readOnly':True,'capturedAt':datetime.now(timezone.utc).isoformat(),'city':'济南','groups':groups,
                'notes':[n for n in original['notes'] if n['id'] in {r['noteId'] for r in reviews}],'reviews':[],'images':[],
                'originalSourceFile':packet['originalSourceFile'],'originalSourceSha256':packet['originalSourceSha256']}
        review={'city':'济南','batch':'batch-43','sourcePacket':packet_path,'sourcePacketSha256':packet_hash,
            'summary':{'sources':2,'mentions':60,'notes':42,'confirmed':46,'pending':14,'durationFieldsExcluded':3,'reasonFieldsExcluded':2,'reservationFieldsExcluded':1},
            'imageComparison':'deferred_by_user','fullReviewPassed':False,'rows':reviews}
        write(evidence_path,review);evidence_hash=hashlib.sha256((root/evidence_path).read_bytes()).hexdigest()
        for d in scopes+decisions:
            for e in d['evidence']:e['sha256']=evidence_hash
        for p,value in zip(outputs[1:],[frozen,decisions,scopes,expectations]):write(p,value)
        print(json.dumps({'batch':'batch-43',**review['summary'],'sourceSha256':hashlib.sha256((root/outputs[1]).read_bytes()).hexdigest()},ensure_ascii=False))
    finally:await engine.dispose()
asyncio.run(main())
