"""五龙潭两源逐条复核：冻结现行资料和第33批联合提及分配，禁止覆盖。"""
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
baseline_hash = 'afda1b83f8e98a7592fb53399996647d893338c8cf035db8a5497fcf8c673b71'
park = 'd7dfe7ae5196779e613b8fa0d9bacf5a'
mixed = 'f65621879204866b17b645554f9848db'
# 对每篇完整原文的人工作业结论；同文重复提取逐条保留各自指纹。
# True只确认本条提及的整园对象；False不将原提及改称非地点。
reviews = {
    2545: (True, '▪️五龙潭\n游玩1.5h｜免费，建议从东门进，南门出', '明确整园进出路线及游览时长。'),
    2548: (False, '夏季的五龙潭\n是孩童玩水的好地方', '描述戏水水池，未定位设施；正文另有游船泛称，不能据裸名确认主潭或全园。'),
    2550: (False, 'day1：五龙潭—趵突泉—泉城广场—黑虎泉—解放阁', '仅路线裸名，未限定园区、泉群或主潭。'),
    2551: (True, '五龙潭：免费景区，不需要预约，有很多大锦鲤', '原文将本项明确作为免费景区，并以锦鲤描述景区卖点。'),
    2553: (True, '第一站是五龙潭公园。', '正文明确公园，随后东门进南门出及多处园内景点；不是独立主潭。'),
    2560: (True, '趵突泉 → 步行5min → 五龙潭公园 → 步行8min → 曲水亭街', '路线明确完整公园名；两次提取指向同一公园。'),
    2563: (False, '📍五龙潭：\n四大泉群之一，水清潭幽。（免费，7:00–22:00）', '泉群与公园不是严格同一地理边界；开放时间不足以独立消除泉群/公园泛称。'),
    2564: (True, '第一站：五龙潭公园 西门进 南门出', '完整园名与穿园路线相互印证。'),
    2569: (False, '五龙潭——趵突泉——泉城广场', '只列裸名及通用免费说明，边界不明。'),
    2570: (False, '📍五龙潭（p6）\n📷对面假山拍框镜机位', '仅摄影机位线索；缺P6逐图定位，不把假山或拍摄对象当作整园。'),
    2582: (False, '距离大明湖、曲水亭街、百花洲、黑虎泉、趵突泉、五龙潭..都很近', '餐馆附近地理参照，未明确五龙潭范围。'),
    2583: (False, '附近离着趵突泉、五龙潭、黑虎泉、曲水亭街、芙蓉街、泉城广场都很近', '餐馆附近地理参照，不能仅凭近邻认领公园或主潭。'),
    2589: (False, '店里离着大明湖、五龙潭、趵突泉、泉城路都挺近', '未注明店名的餐馆广告只提供附近裸名。'),
    2607: (False, '如果到时候有体力的话，可以去五龙潭去逛一逛', '条件性游览推荐；上下文进出门主要属于趵突泉，不借给五龙潭。'),
    2609: (True, '五龙潭 – 26处古泉藏身园中，秦琼祠所在地，潭水湛蓝如玉', '多处园内泉与秦琼祠的集合明确指园区。'),
    2611: (False, '五龙潭公园 出门就是小吃街\n酒店位于趵突泉内', '正文是第三家酒店推荐；提取的“出门就是小吃街”主语不明，不作为已确认公园事实。'),
    2622: (False, '五龙潭→趵突泉→黑虎泉', '路线裸名，未描述五龙潭本体范围。'),
    2624: (True, '第一站五龙潭，七点开园，一个小时就能逛完，西门进南门出', '明确开园、穿园路线及整园游览时长。'),
    2782: (True, '其实五龙潭并不大，每个景点离得也都很近，真的很美！', '本项为有多个景点的游览区域；不是单个泉池。'),
    2786: (True, '完全是城市里的宝藏小众园林公园', '五龙潭段落明确园林公园，水景是园内卖点。'),
    2789: (True, '📍五龙潭：泉群密集（月牙泉、古温泉），池水碧绿，沿潭边散步喂锦鲤，打卡秦琼祠，浅滩可伸手碰泉水', '涵盖多泉、秦琼祠及浅滩的整园游览；不将这些设施各自认领为主潭。'),
    2793: (True, '❹五龙潭公园：北方少有的清泉园林，泉水潺潺，景致清幽', '明确全名及园林范围。'),
    2797: (True, '4️⃣五龙潭公园：利用假山的框架式构图，也是拍绿地中心古今同框的机位', '明确公园项下的园内摄影活动；不独立创建或给主潭认领假山。'),
    2803: (False, 'Day1️⃣：趵突泉➡️五龙潭➡️芙蓉街➡️曲水亭街➡️大明湖', '整篇仅有路线裸名，没有五龙潭主体描述。'),
    2806: (True, '趵突泉公园北门出来走路五分钟过个马路进五龙潭➡️南门进东门出', '穿园进出门说明明确园区；不将门口本身并入公园同义身份。'),
    2807: (False, '出来后对面就是五龙潭，附近有吃的', '对街的泛地点参照，未说明五龙潭主体边界。'),
    2808: (True, '第一站：#五龙潭公园[话题]# （免费）\n西门进南门出', '完整公园名与穿园游览路线。'),
    2816: (True, '五龙潭是没有门票的，听说是因为今年雨水多所以里面那个泉才喷水了', '明确区分五龙潭游览区域与“里面那个泉”；未把喷水泉错认主潭。'),
    2830: (False, '📍五龙潭：免费泉群，潭水清澈，锦鲤多，本地人常来遛弯', '泉群泛称与潭水混写，仍缺园区与主潭的明确边界。'),
    2834: (True, '📍五龙潭：园内泉潭相连，石桥古亭、绿树成荫', '明确园内多泉潭、桥与亭的集合。'),
    2835: (True, '★五龙潭公园：南门进，进门就是文创店，五龙潭离门口很近，其他景点为五龙柱子、秦琼祠', '同段明确公园包含潭、文创店、秦琼祠；提及整体为公园，不伪造主潭提及。'),
    2837: (True, '2️⃣五龙潭公园（p9/10/15）\n📌南门进➠东门出', '公园全名、整园路线、半小时及小鸭子事实一致。'),
    2839: (True, '出门就是五龙潭公园，景点离得都很近', '住宿段明确全名，上午第一站“酒店出门即到”承接同一公园，后文从南门离开。'),
    2840: (True, '从五龙潭南门出来，走路几分钟就到', '整园游览一小时后南门离开，主潭为其中景观。原文旧票价5r不作为当前票价证明，提及未携带票价字段。'),
    2841: (True, '五龙潭：五龙壁→五龙潭主潭→名仕阁→古温泉/月牙泉 →东门（五龙雕塑）出', '整园路线明确把主潭作为内部一站；不得从母项提及另造主潭实体。'),
    2843: (False, 'P1：五龙潭', '只有P1裸名和全篇公园话题，缺逐图主体证据，暂不判定照片所指整园或主潭。'),
    2856: (False, '按照五龙潭、趵突泉、黑虎泉、解放阁、大明湖、护城河这个顺序游玩的', '仅游览顺序裸名，无主体边界说明。'),
}


def write_new(path, value):
    with path.open('x', encoding='utf-8', newline='\n') as output:
        output.write(value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, indent=2)+'\n')


async def main():
    assert hashlib.sha256((root/source_file).read_bytes()).hexdigest() == source_hash
    assert hashlib.sha256((root/'all-cities/batch-33-baseline.json').read_bytes()).hexdigest() == baseline_hash
    frozen = json.loads((root/source_file).read_text(encoding='utf-8'))
    baseline = json.loads((root/'all-cities/batch-33-baseline.json').read_text(encoding='utf-8'))
    ledger_name = 'priority-cities/济南/wulongtan-source-review-01.json'
    paths = ['all-cities/batch-33-source.json', 'all-cities/batch-33-decisions.json',
        'all-cities/batch-33-scope-decisions.json', 'all-cities/batch-33-export-expectations.json',
        ledger_name, 'priority-cities/济南/wulongtan-source-review-01.md']
    assert all(not (root/p).exists() for p in paths)
    groups, ledger_rows = [], []
    try:
        async with SessionFactory() as session:
            await session.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            catalog = await load_mention_catalog(session, '济南')
            all_sources = (await session.scalars(select(CanonicalPlace).where(CanonicalPlace.city=='济南'))).all()
            all_rows = await load_mention_rows(session, '济南')
            images = await load_image_rows(session, '济南')
            keys = {k for g in frozen['groups'] if g['entity']['entity_id'] in [park, mixed] for k in g['nameKeys']}
            sources = [s for s in all_sources if keys & source_keys(s)]
            assert {s.id for s in sources} == {5350, 5359}
            rows = [m for m in all_rows if scope_matches({'city':'济南','name_keys':keys}, m)]
            assert {m['id'] for m in rows} == {i for g in frozen['groups'] if g['entity']['entity_id'] in [park, mixed] for i in g['mentionIds']}
            assert {m['raw_note_id'] for m in rows} == set(reviews) and len(rows) == 43
            assert not [im for im in images if im['source_place_id'] in [5350,5359] or im['raw_note_id'] in reviews]
            for row in rows:
                old = next(m for m in frozen['mentions'] if m['id']==row['id'])
                assert mention_fingerprint(row) == old['inputHash']
                note = next(n for n in frozen['notes'] if n['id']==row['raw_note_id'])
                assigned, quote, reason = reviews[row['raw_note_id']]
                assert not note['note_unavailable'] and quote in note['note_desc']
                ledger_rows.append({'mentionId':row['id'], 'inputHash':old['inputHash'], 'noteId':row['raw_note_id'],
                    'originalName':row['name'], 'normalizedName':row['normalized_name'],
                    'entityId':park if assigned else None, 'status':'reviewed_park' if assigned else 'needs_evidence',
                    'quote':quote, 'reason':reason})
            for source in sources:
                entity = catalog.catalog.resolve(place_id=source.id)
                old_group = next(g for g in frozen['groups'] if g['entity']['entity_id']==entity['entity_id'])
                assert entity == old_group['entity'] and entity['revision']==1
                assert catalog.scope_for_source(source.id) is None
                original = next(s for s in frozen['sources'] if s['id']==source.id)
                fields = ['id','city','name','normalized_name','address','latitude','longitude','place_type',
                    'geo_status','amap_poi_id','is_active','quality_score']
                actual = {k:getattr(source,k) for k in fields}
                assert actual == {k:original[k] for k in fields}
                summary = await session.scalar(select(PlaceSummary).where(PlaceSummary.canonical_place_id==source.id))
                groups.append({'entity':entity, 'source':actual, 'sourceHash':source_fingerprint(source_input(source)),
                    'summary':{k:getattr(summary,k) for k in ['canonical_place_id','mention_count_30d','recommend_score']},
                    'mentions':[{**r,'inputHash':mention_fingerprint(r)} for r in rows if r['id'] in old_group['mentionIds']]})
        assigned_ids = sorted(r['mentionId'] for r in ledger_rows if r['entityId'])
        pending_ids = sorted(r['mentionId'] for r in ledger_rows if not r['entityId'])
        assert len(assigned_ids)==25 and len(pending_ids)==18
        ledger = {'version':1, 'city':'济南', 'originalSourceFile':source_file, 'originalSourceSha256':source_hash,
            'batch':'batch-33', 'applied':False, 'reviewIds':[365], 'sourcePlaceIds':[5350,5359],
            'summary':{'mentions':43,'fullNotes':37,'assignedPark':25,'pending':18,'upstreamImages':0},
            'historicalIdPolicy':'五龙潭旧ID保留显式撤回，不重定向到公园或主潭。公园仅消费已确认25提及；不新增主潭、不授予裸名别名。审核365继续待审。',
            'rows':ledger_rows}
        write_new(root/ledger_name, ledger)
        decision = {'key':'all-cities-20261008-batch-33-wulongtan-5350', 'city':'济南', 'sourcePlaceId':5350,
            'expectedSourceHash':next(g['sourceHash'] for g in groups if g['source']['id']==5350),
            'expectedScopeRevision':0, 'sources':[{'sourcePlaceId':g['source']['id'],'sourceHash':g['sourceHash']} for g in groups],
            'expectedRevisions':{mixed:1,park:1},
            'assignments':[{k:r[k] for k in ['mentionId','inputHash','entityId']} for r in ledger_rows],
            'evidence':[{'kind':'reviewed_joint_park_scope','file':ledger_name,
                'sha256':hashlib.sha256((root/ledger_name).read_bytes()).hexdigest(), 'reviewIds':[365],
                'sourcePlaceIds':[5350,5359],'mentionIds':sorted(r['mentionId'] for r in ledger_rows),
                'conclusion':ledger['historicalIdPolicy']},
                {'kind':'map_candidates','file':'priority-cities/济南/geo-01.json',
                 'sha256':hashlib.sha256((root/'priority-cities/济南/geo-01.json').read_bytes()).hexdigest(),
                 'conclusion':'保留5359公园本体参考点，不借用5350裸名点或任何门、码头、商店点；坐标不构成两实体同义证据。'}]}
        source_payload = {'readOnly':True,'city':'济南','capturedAt':datetime.now(timezone.utc).isoformat(),
            'originalSourceFile':source_file,'originalSourceSha256':source_hash,'baselineSha256':baseline_hash,
            'groups':groups,'notes':[n for n in frozen['notes'] if n['id'] in reviews], 'images':[],
            'reviews':[r for r in baseline['reviews'] if r['id']==365]}
        assert len(source_payload['reviews'])==1 and source_payload['reviews'][0]['status']=='PENDING'
        expectations = [
            {'city':'济南','id':mixed,'name':'五龙潭','revision':2,'verified':False,'mentionIds':[],'candidateIds':[park]},
            {'city':'济南','id':park,'name':'五龙潭公园','revision':2,'verified':True,'mentionIds':assigned_ids}]
        for file,payload in zip(paths[:4],[source_payload,[],[decision],expectations]):
            write_new(root/file,payload)
        lines = ['# 五龙潭两源逐提及核查（第33批依据）', '',
            '完整阅读43条提及、37篇原文：25条可确认公园、18条仍待补证。此文件冻结决定依据；是否已应用以批次应用与同步记录为准。', '',
            ledger['historicalIdPolicy'], '',
            '公园是本条游览对象，不代表文中所有泉、店、假山或门口是同义词。照片表为空只表示当前上游无已登记图，未声称看过原始社媒照片。', '',
            '| 提及 | 原文 | 原名 | 结论 | 原文摘录 | 判定理由 |', '| --- | --- | --- | --- | --- | --- |']
        for r in ledger_rows:
            quote=r['quote'].replace('\n',' / ').replace('|','\\|')
            lines.append(f"| {r['mentionId']} | {r['noteId']} | {r['originalName']} | {'公园' if r['entityId'] else '待补证'} | {quote} | {r['reason']} |")
        write_new(root/paths[-1], '\n'.join(lines)+'\n')
        print(json.dumps({'batch':'batch-33','mentions':43,'notes':37,'assigned':len(assigned_ids),'pending':len(pending_ids),
            'sourceSha256':hashlib.sha256((root/paths[0]).read_bytes()).hexdigest(),'files':paths},ensure_ascii=False))
    finally:
        await engine.dispose()


asyncio.run(main())
