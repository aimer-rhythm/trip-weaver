"""冻结趵突泉两源的60条真实提及及第34批逐条分配；不覆盖任何历史证据。"""
from pathlib import Path
import asyncio
import hashlib
import json
import sys
from datetime import datetime, timezone

sys.dont_write_bytecode = True
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, 'D:/Project/xhs-travel-pipeline')
from sqlalchemy import select, text
from app.db import engine, SessionFactory
from app.models import CanonicalPlace, PlaceSummary
from app.aggregate.mention_identity import load_mention_catalog, load_mention_rows, source_input, source_keys
from app.aggregate.image_identity import load_image_rows
from app.clean.mention_identity import mention_fingerprint, source_fingerprint, scope_matches

root = Path(__file__).resolve().parent
source_file = 'priority-cities/济南/run-1791385235272324900/sources.json'
source_hash = '9aa559e894e1cfbcdf74db2214c8eeb6614739064a96967780c6b32af59a889b'
baseline_hash = 'ffe0c6943d290fb3f4802c6c7ad5b8a4dccfc361dde03be9efb7385ed3400b7e'
park = 'd14cc0c8a631defad91e60d475b7aedd'
mixed = '8808e16f1472d0df17bed729a2e54e83'
reviews = {
    2545: (True, '五龙潭南门出可以直接从趵突泉北门进', '整项门票、两小时游览和北门入园共同限定园区。'),
    2547: (False, '打卡济南核心景点', '名称只出现在全篇话题，正文的赏名泉是通用描述，未明确主体范围。'),
    2548: (True, '赶在大部队到来之前游览完趵突泉景区', '前段明确景区内很多泉眼，随后结束景区游览；非单个泉池。'),
    2550: (False, 'day1：五龙潭—趵突泉—泉城广场—黑虎泉—解放阁', '仅路线裸名，不能确认公园或主泉池。'),
    2551: (False, '趵突泉：泉水清澈见底，泉水潺潺很美很出片', '泛水景摄影评价，未限定园区与泉池。'),
    2553: (True, '趵突泉公园内还有许多历史建筑和纪念碑', '公园全名、多处历史建筑、北门进东门出和1.5小时游览相互支持。'),
    2554: (True, '趵突泉早上7点就开放', '本条提及为开放及入园票资格，整段以可进入拍摄的景区为对象；时间和优惠仅保留来源证据，不作为官方现行核实。'),
    2560: (False, '趵突泉早上去人少', '裸名路线加早去建议，未说明具体泉池或园区。'),
    2563: (False, '天下第一泉，泉水终年喷涌', '名泉称谓及喷涌特征聚焦泉池，附票价不能单独消除公园/泉池边界。'),
    2564: (True, '第二站：趵突泉 北门进 东门出', '明确穿园路线，本项九点前到达建议属于整园访问。'),
    2567: (False, '三股水翻腾太治愈', '文字聚焦三股泉水，但未明确本条游览粒度；不可把旧混合ID整体改成主泉池。'),
    2569: (True, '以上只有趵突泉需要门票，其他景点都免费', '恒隆周边必玩景区说明、收费入口及趵突泉景区话题共同限定景区访问。'),
    2570: (False, '📍趵突泉（p3.15）\n📷早起冲人少 拍喷涌的泉眼和大可爱鸭', '两个照片的泉眼/鸭子未逐图定位，无法确认母项或具体泉池。'),
    2582: (False, '距离大明湖、曲水亭街、百花洲、黑虎泉、趵突泉、五龙潭..都很近', '餐厅附近裸名参照，范围不明。'),
    2583: (False, '附近离着趵突泉、五龙潭、黑虎泉、曲水亭街、芙蓉街、泉城广场都很近', '餐厅附近地理参照，不能据近邻判定本体。'),
    2584: (False, '吃完建议直奔大明湖、趵突泉', '餐馆广告的顺路建议，不足以确定地点粒度。'),
    2589: (False, '店里离着大明湖、五龙潭、趵突泉、泉城路都挺近', '原文餐馆位于北门附近，不将餐馆或入口距离误当主泉池位置。'),
    2607: (False, '如果进来的早，建议直奔趵突泉', '同篇同时以趵突泉指入园目的地与园内主泉；提及reason和highlight分别借两种语境，需进一步拆清。'),
    2608: (False, '4 月杨柳絮飘满湖面，潭水上飘一层白毛', '照片水面评价，缺具体泉池与机位。'),
    2609: (True, '李清照纪念堂藏身园中', '同项包含主泉和园内纪念堂，整体为园区访问。'),
    2611: (False, '步行可达大明湖和趵突泉', '酒店推荐，另称酒店在趵突泉内；原文未给具体酒店，附近与内部表述混用，保持待审。'),
    2613: (False, '可以直达趵突泉、大明湖、千佛山', '酒店交通宣传，只列裸名，不证实主体或直达交通事实。'),
    2614: (False, '去趵突泉、大明湖景点出行很方便', '和谐广场酒店的出行参照，未限定趵突泉主体。'),
    2622: (False, '五龙潭→趵突泉→黑虎泉', '仅路线名称，没有具体园区或泉池描述。'),
    2623: (False, 'p1.2.3.4趵突泉', '只有照片编号，未逐图确认。'),
    2624: (False, '西门进南门出，斜对过就是趵突泉啦', '原文先讲五龙潭路线，趵突泉只是斜对过位置参照；其中旧提取还错写了出入口方向。'),
    2782: (False, '如果不想逛，只想去趵突泉，可以从南门或者东门进', '同一句区别逛园与奔主泉，提及目标偏核心泉池，不将其直接归公园或借旧ID认领核心。'),
    2786: (True, '整趟逛下来我最偏爱濯缨池', '趵突泉段明确对比三股水与濯缨池，为园内多点游览。'),
    2789: (True, '园内必逛：李清照纪念堂、万竹园', '本条同时概述主泉及园内多个目的地，整体为公园。'),
    2793: (True, '❺趵突泉公园：看三股泉水喷涌，泉池幽深波光粼粼', '原文明确完整公园名，主泉是该园区的推荐卖点。'),
    2798: (False, '2️⃣趵突泉', '拍照姿势图册只有裸名，未确认图中主体。'),
    2803: (False, '步行可抵达趵突泉景区', '提及highlights的泉水泡茶来自后文城市泛描述，不属于本条地点证据；不能整条分配后导出该事实。'),
    2806: (True, '园子里其他地方可以后面慢慢看', '整条为南门进北门出的园区访问，正文另明确称趵突泉公园；核心泉池作为园内一站。'),
    2807: (True, '趵突泉南门进，北门出', '明确整园穿行，非某门口与泉池同体。'),
    2808: (True, '趵突泉景区比较大，里面除了趵突泉外有很多泉、纪念馆、故居等', '明确区分园区与园内主泉、其他泉及建筑。'),
    2809: (True, '趵突泉东门-枫溪-激湍碑-天下第一泉-板泉桥-濯缨池-李清照纪念堂-趵突泉东门', '标题全园游玩，正文完整园内路线，主泉只是其中一站。'),
    2810: (False, '趵突泉8点前去，人少好拍照', '早去及枯水期的摄影建议，未确定园区/泉池粒度。'),
    2811: (False, '三股泉涌终年不息，亭台临水', '描述泉池与临水亭，仍需区分本条核心泉池与园区卖点。'),
    2816: (False, '以前我去过了因为有门票所以这次就不去了', '本次未进入且只作对街参照，不能当作已核实的本次推荐访问或具体泉池。'),
    2825: (False, '去趵突泉看肥锦鲤了', '未说明具体水池，照片未核查。'),
    2829: (False, '济南七十二名泉之首', '泉池名次称谓，附40R与城市路线不能独立证明整园归属。'),
    2830: (True, '园林雅致，有李清照纪念堂', '完整同项包含三股水、园林、纪念堂，指园区。'),
    2834: (True, '园内泉群密布，一步一景', '明确园内多个泉群与人文景观的集合。'),
    2835: (True, '北门进，沿路能看到很多漂亮的小潭', '北门入、沿多潭到主泉石碑、东门出的完整访问，主泉为园内一站。'),
    2837: (True, '南门进➠无忧泉➠趵突泉➠漱玉泉➠濯缨池➠北门出', '两小时全园路线明确包含主泉与其他泉，提及不等于其中一个核心泉池。'),
    2839: (False, '五龙潭南门出来就是趵突泉北门', '本条highlight仅取天下第一泉；北门邻近不自动证明当前提及粒度。'),
    2840: (False, '“天下第一泉”名不虚传，三股水昼夜喷涌', '本条事实集中在三股泉水与雪糕打卡；门票、外围步行和时长未消除园区/核心粒度疑问。'),
    2841: (True, '趵突泉东门入园（6:30）', '正文列主泉、万竹园、无忧泉、沧园、漱玉泉、濯缨池等9段路线；整体为公园访问。'),
    2843: (False, 'P2：趵突泉', '仅照片编号和裸名，主体未核。'),
    2852: (False, '那两家牛肉烧饼离趵突泉都不远', '美食店附近位置参照，未明确趵突泉本体。'),
    2856: (False, '按照五龙潭、趵突泉、黑虎泉、解放阁、大明湖、护城河这个顺序', '裸名顺序，不能据同游认定主体粒度。'),
}


def write_new(path, value):
    with path.open('x',encoding='utf-8',newline='\n') as output:
        output.write(value if isinstance(value,str) else json.dumps(value,ensure_ascii=False,indent=2)+'\n')


async def main():
    assert hashlib.sha256((root/source_file).read_bytes()).hexdigest()==source_hash
    baseline_file=root/'all-cities/batch-34-baseline.json'
    assert hashlib.sha256(baseline_file.read_bytes()).hexdigest()==baseline_hash
    frozen=json.loads((root/source_file).read_text(encoding='utf-8'))
    baseline=json.loads(baseline_file.read_text(encoding='utf-8'))
    ledger_name='priority-cities/济南/baotu-source-review-01.json'
    files=['all-cities/batch-34-source.json','all-cities/batch-34-decisions.json',
        'all-cities/batch-34-scope-decisions.json','all-cities/batch-34-export-expectations.json',
        ledger_name,'priority-cities/济南/baotu-source-review-01.md']
    assert all(not (root/p).exists() for p in files)
    groups,ledger_rows=[],[]
    try:
        async with SessionFactory() as session:
            await session.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            catalog=await load_mention_catalog(session,'济南')
            all_sources=(await session.scalars(select(CanonicalPlace).where(CanonicalPlace.city=='济南'))).all()
            all_rows=await load_mention_rows(session,'济南')
            images=await load_image_rows(session,'济南')
            keys={k for g in frozen['groups'] if g['entity']['entity_id'] in [park,mixed] for k in g['nameKeys']}
            sources=[s for s in all_sources if keys & source_keys(s)]
            assert {s.id for s in sources}=={5349,5366}
            rows=[m for m in all_rows if scope_matches({'city':'济南','name_keys':keys},m)]
            assert {m['id'] for m in rows}=={i for g in frozen['groups'] if g['entity']['entity_id'] in [park,mixed] for i in g['mentionIds']}
            assert {m['raw_note_id'] for m in rows}==set(reviews) and len(rows)==60
            assert not [im for im in images if im['source_place_id'] in [5349,5366] or im['raw_note_id'] in reviews]
            for row in rows:
                old=next(m for m in frozen['mentions'] if m['id']==row['id'])
                assert mention_fingerprint(row)==old['inputHash']
                note=next(n for n in frozen['notes'] if n['id']==row['raw_note_id'])
                assigned,quote,reason=reviews[row['raw_note_id']]
                assert not note['note_unavailable'] and quote in note['note_desc'],row['raw_note_id']
                if row['id']==11618:
                    reason+=' 本条reason把五龙潭的西门进错写成西门出；不能传播该错误。'
                if row['id']==12911:
                    reason+=' 本条南门方向与原文一致，但仍只是邻近参照，不能替代主体边界核实。'
                ledger_rows.append({'mentionId':row['id'],'inputHash':old['inputHash'],'noteId':row['raw_note_id'],
                    'originalName':row['name'],'normalizedName':row['normalized_name'],
                    'entityId':park if assigned else None,'status':'reviewed_park' if assigned else 'needs_evidence',
                    'quote':quote,'reason':reason})
            for source in sources:
                entity=catalog.catalog.resolve(place_id=source.id)
                old_group=next(g for g in frozen['groups'] if g['entity']['entity_id']==entity['entity_id'])
                baseline_entity=next(e for e in baseline['entities'] if e['entity_id']==entity['entity_id'])
                assert entity=={k:v for k,v in baseline_entity.items() if k!='places'}
                assert entity['revision']==(2 if entity['entity_id']==mixed else 1)
                assert catalog.scope_for_source(source.id) is None
                original=next(s for s in frozen['sources'] if s['id']==source.id)
                fields=['id','city','name','normalized_name','address','latitude','longitude','place_type','geo_status','amap_poi_id','is_active','quality_score']
                actual={k:getattr(source,k) for k in fields}
                assert actual=={k:original[k] for k in fields}
                summary=await session.scalar(select(PlaceSummary).where(PlaceSummary.canonical_place_id==source.id))
                groups.append({'entity':entity,'source':actual,'sourceHash':source_fingerprint(source_input(source)),
                    'summary':{k:getattr(summary,k) for k in ['canonical_place_id','mention_count_30d','recommend_score']},
                    'mentions':[{**r,'inputHash':mention_fingerprint(r)} for r in rows if r['id'] in old_group['mentionIds']]})
        assigned_ids=sorted(r['mentionId'] for r in ledger_rows if r['entityId'])
        assert len(assigned_ids)==22 and len(ledger_rows)-len(assigned_ids)==38
        ledger={'version':1,'city':'济南','originalSourceFile':source_file,'originalSourceSha256':source_hash,
            'batch':'batch-34','appliedAtFreeze':False,'reviewIds':[364],'sourcePlaceIds':[5349,5366],
            'summary':{'mentions':60,'fullNotes':51,'assignedPark':22,'pending':38,'upstreamImages':0},
            'historicalIdPolicy':'趵突泉旧混合ID显式撤回，不重定向到公园或改绑主泉池；公园只消费22条已确认提及。38条继续待审，不赋予裸名别名，不伪造主泉池提及。审核364未关闭。',
            'categoryPolicy':'公园整体包含自然泉水园林及纪念建筑，以自然为活动类别；显式override避免受控清旧themes后的默认文化分类。',
            'rows':ledger_rows}
        write_new(root/ledger_name,ledger)
        evidence={'kind':'reviewed_joint_park_scope','file':ledger_name,
            'sha256':hashlib.sha256((root/ledger_name).read_bytes()).hexdigest(),'reviewIds':[364],
            'sourcePlaceIds':[5349,5366],'mentionIds':sorted(r['mentionId'] for r in ledger_rows),
            'conclusion':ledger['historicalIdPolicy']}
        scope={'key':'all-cities-20261008-batch-34-baotu-5349','city':'济南','sourcePlaceId':5349,
            'expectedSourceHash':next(g['sourceHash'] for g in groups if g['source']['id']==5349),
            'expectedScopeRevision':0,'sources':[{'sourcePlaceId':g['source']['id'],'sourceHash':g['sourceHash']} for g in groups],
            'expectedRevisions':{mixed:2,park:1},
            'assignments':[{k:r[k] for k in ['mentionId','inputHash','entityId']} for r in ledger_rows],
            'evidence':[evidence,{'kind':'map_candidates','file':'priority-cities/济南/geo-01.json',
                'sha256':hashlib.sha256((root/'priority-cities/济南/geo-01.json').read_bytes()).hexdigest(),
                'conclusion':'保留5366趵突泉南路1号公园本体参考点。5349旧酒店点仍被清除，不借酒店、门口或泉池点替代公园。'}]}
        decision={'key':'all-cities-20261008-batch-34-park-category','city':'济南','entityId':park,
            'mergeEntityIds':[],'canonicalName':'趵突泉公园','expectedRevisions':{park:2},'overrides':{'category':'自然'},
            'evidence':[{**evidence,'kind':'reviewed_park_category','conclusion':ledger['categoryPolicy']}]}
        payload={'readOnly':True,'city':'济南','capturedAt':datetime.now(timezone.utc).isoformat(),
            'originalSourceFile':source_file,'originalSourceSha256':source_hash,'baselineSha256':baseline_hash,
            'groups':groups,'notes':[n for n in frozen['notes'] if n['id'] in reviews],'images':[],
            'reviews':[r for r in baseline['reviews'] if r['id']==364]}
        assert len(payload['reviews'])==1 and payload['reviews'][0]['status']=='PENDING'
        expectations=[{'city':'济南','id':mixed,'name':'趵突泉','revision':3,'verified':False,'mentionIds':[],'candidateIds':[park]},
            {'city':'济南','id':park,'name':'趵突泉公园','revision':3,'verified':True,'mentionIds':assigned_ids}]
        for file,value in zip(files[:4],[payload,[decision],[scope],expectations]): write_new(root/file,value)
        lines=['# 趵突泉两源逐提及核查（第34批依据）','',
            '完整阅读60条提及、51篇原文，22条归公园、38条待补证。是否已应用以正式批次及同步记录为准。','',
            ledger['historicalIdPolicy'],'',ledger['categoryPolicy'],'',
            '原文的票价、开放时间和学生优惠只作为所指主体的语境证据，不在此声明已经官方核实。原始社媒照片未逐图查看。','',
            '| 提及 | 原文 | 原名 | 结论 | 原文摘录 | 判定理由 |','| --- | --- | --- | --- | --- | --- |']
        for row in ledger_rows:
            quote=row['quote'].replace('\n',' / ').replace('|','\\|')
            lines.append(f"| {row['mentionId']} | {row['noteId']} | {row['originalName']} | {'公园' if row['entityId'] else '待补证'} | {quote} | {row['reason']} |")
        write_new(root/files[-1],'\n'.join(lines)+'\n')
        print(json.dumps({'batch':'batch-34','mentions':60,'notes':51,'assigned':22,'pending':38,
            'sourceSha256':hashlib.sha256((root/files[0]).read_bytes()).hexdigest()},ensure_ascii=False))
    finally:
        await engine.dispose()


asyncio.run(main())
