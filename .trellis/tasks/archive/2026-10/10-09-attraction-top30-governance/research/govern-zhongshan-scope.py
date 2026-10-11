"""中山路49条/49篇原文复核：街道游览保留，隔离住宿/活动/店铺及无正文证据。"""
import asyncio
import hashlib
import importlib.util
import json
import sys
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('scope_runner', ROOT / 'govern-disney-scopes.py')
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)
from app.clean.mention_identity import source_fingerprint, effective_mention
from app.clean.recommendation import recommendation_metrics
from app.aggregate.mention_identity import load_mention_catalog, load_mention_rows

runner.CITY, runner.BATCH = '厦门', 'batch-108'
runner.SNAPSHOT = ROOT / 'snapshot-20261009T220123759512Z/input.json'
runner.EXTRAS = ROOT / 'xiamen-scope-03-extras.json'
runner.BASELINE = ROOT / 'xiamen-scope-03-baseline.json'
EID, SID = '5950d3c70e76f5682842a6726f2b1e92', 2670
runner.TARGETS = {EID}
runner.UNASSIGNED = {5437,5543,5631,5966,6160,6168,6240,6320,6389,6584,6597,6679,6802,6808,6852}
runner.FORBIDDEN_PHRASES = ['酒店近步行街，逛吃方便', '举办2026春节主题活动',
    '春节有千年非遗秀', '中秋博饼状元赛、汉服嘉年华', '南洋风市集好逛，跨年飘雪',
    '性价比高，海景房，设施齐全', '住宿方便，周边商圈多', '汤底醇厚，配料新鲜']
FACTS = {
    5341: (['reason','evidence_text'], '推荐住在中山路附近，离景点都不算远，而且周边都是商圈买伴手礼很方便'),
    5363: (['reason','evidence_text'], '很适合在中山路citywalk🚶‍♀️走累了的时候来吃！！'),
    5754: (['reason','evidence_text'], '🉑选择中山路/思明区！市区超方便，离鼓浪屿码头、沙坡尾都近，逛吃出行都舒服😋'),
    6429: (['reason'], '晚上逛骑楼老街，再去八市吃海鲜、沙茶面、五香卷、土笋冻，厦门味直接拉满🦐'),
    6762: (['reason'], '1️⃣住宿就选思明区，中山路、火车站附近去哪都近，淡季价格也友好'),
    6857: (['reason','evidence_text'], '逛完中山路骑楼顺路打卡，想吃正统闽南小吃的游客直接冲！'),
}


def inputs():
    raw = runner.SNAPSHOT.read_bytes()
    frozen = next(c for c in json.loads(raw)['cities'] if c['city'] == '厦门')
    entity = next(e for e in frozen['entities'] if e['entity_id'] == EID)
    assert entity['revision'] == 3 and entity['primary_place_id'] == SID
    assert sorted(int(k) for k,v in frozen['members'].items() if v == EID) == [2539,2649,2670]
    assert not any(EID in [*s['entity_ids'],*s.get('withdrawal_entity_ids',[])] for s in frozen['scopes'])
    rows = [m for m in frozen['mentions'] if m['entityId'] == EID]
    assert len(rows) == len({m['raw_note_id'] for m in rows}) == 49
    notes = frozen['notes']
    quotes = [(1355,'🏠我住在中山街去哪都还挺方便的'),
        (1298,'关于住宿|选对地方少走800条街!首选：思明区(中山路/中华城附近)'),
        (1324,'性价比党直接住厦门本岛（中山路/曾厝垵），白天上岛玩一天足够啦'),
        (1423,'都在老市区！思明区的中山路'),
        (1380,'🛕中山路、八市、轮渡周边，靠近鼓浪屿码头，吃喝出行都方便'),
        (1451,'🆕2026厦门中山路春节活动🔥'),
        (1453,'·中山路千年非遗秀（初一至初七）'),
        (1514,'首选中山路或厦门火车站附近'),
        (1544,'▪️中山路/八市：适合第一次来厦门，吃喝多，晚上也热闹'),
        (1437,'位置省心，离中山路步行街巨近，逛吃完全不慌。'),
        (1436,'就在双子塔A座，出门直接连通大型商场'),
        (1513,'🆕中山路中秋活动🔥'),
        (1440,'在中山路住到人生海景房'),
        (1406,'#厦门中山路美食推荐[话题]#'),
        (1528,'🎉中华城中山路迎新嘉年华'),
        (1279,'✔️可去可不去：沙坡尾/双子塔、中山路、铁路文化公园（3个）'),
        (1316,'3️⃣中山路步行街：特别干净，建筑有民国时期的感觉，观感特别好，就是里面吃的和买的有很多雷，推荐，记得避雷就行💣（查一下）'),
        (1328,'昨天在中山路步行街和八市，被电动车按喇叭已经快按出心脏病了，太吵了，鼓浪屿就没有这么吵。'),
        (1243,'2️⃣中山路：厦门特色小吃（🕒14:00-14:30）')]
    for nid,quote in quotes:
        assert quote in notes[str(nid)]['note_desc'], nid
    for m in rows:
        if m['id'] in FACTS:
            assert FACTS[m['id']][1] in notes[str(m['raw_note_id'])]['note_desc']
    assignments = []
    for m in rows:
        a = {'mentionId':m['id'],'inputHash':m['inputHash'],'entityId':None if m['id'] in runner.UNASSIGNED else EID}
        if m['id'] in FACTS:
            fields,quote = FACTS[m['id']]
            a['factExclusions'] = {field:{'reason':'subject_mismatch','quote':quote} for field in fields}
        assignments.append(a)
    evidence = [{'kind':'reviewed_attraction_source_scope','snapshotSha256':hashlib.sha256(raw).hexdigest(),
        'file':str(Path(__file__).relative_to(ROOT.parents[3])),
        'noteQuotes':[{'noteId':nid,'quote':quote} for nid,quote in quotes],
        'reviewedNotes':[{'noteId':nid,'noteDescSha256':hashlib.sha256(notes[str(nid)]['note_desc'].encode()).hexdigest()}
            for nid in sorted({m['raw_note_id'] for m in rows})],
        'conclusion':'完整49条提及/49篇正文阅读。三条同义来源联合scope，保持既有主名、别名、旧ID、位置和景点分类。5437/5543/5631/6160/6320/6389/6584/6597/6802为住宿片区或酒店交通参照；5966只有12家小吃推荐的地域标题，无街道游览；6168/6240/6679/6852只有春节/中秋/跨年活动（6240兼有店铺清单，无独立街道游览），隔离不创建酒店店铺活动。6808仅美食标签无可读正文，按身份证据不足隔离，保留潜在加分，不声称已确认非同体。5341/5754同篇路线明确中山路，保留身份，只排住宿两个描述字段。5363和6857明确提出中山路citywalk/骑楼后去吃饭，保留有限路线指向，排餐厅两个描述字段，不将其当街道亲历或骑楼详实证据。6429仅排混入八市餐饮的reason，保留骑楼引文；6762仅排混入住宿的reason，保留老街逛吃引文。5730可去可不去、5770建筑好看但消费避雷、6080商业化与拍照限定、6395电动车吵、6414主街特产虚高等原观点保持。6232夜游街区与6912半小时路线逛吃保留，不按food/market标签机械删掉街道游览。八市、镇邦路、局口街、中华城与各店不合并；旧坐标沿用，营业预约和历史活动时效未重核。'}]
    sources = {s['id']:s for s in frozen['sources']}
    scope = {'key':'top30-20261010-batch-108-scope-2670','city':'厦门','sourcePlaceId':SID,
        'expectedSourceHash':source_fingerprint(sources[SID]),'expectedScopeRevision':0,
        'sources':[{'sourcePlaceId':sid,'sourceHash':source_fingerprint(sources[sid])} for sid in [2539,2649,2670]],
        'expectedRevisions':{EID:3},'assignments':assignments,'evidence':evidence}
    own = [m for m in rows if m['id'] not in runner.UNASSIGNED]
    expected = {'city':'厦门','id':EID,'name':entity['canonical_name'],'revision':4,'verified':True,
        'mentionIds':[m['id'] for m in own],**recommendation_metrics(own)}
    assert expected['mentionCount'] == 34
    return frozen,[scope],[expected]


original_apply_checked = runner.apply_checked


async def apply_checked(session, frozen, scopes, expected):
    report = await original_apply_checked(session, frozen, scopes, expected)
    catalog = await load_mention_catalog(session,'厦门')
    for m in await load_mention_rows(session,'厦门'):
        if m['id'] not in expected[0]['mentionIds']:
            continue
        wanted = {**m,'fact_value':m['fact_value'] or {}}
        if m['id'] in FACTS:
            wanted.update({field:None for field in FACTS[m['id']][0]})
        assert effective_mention(m,catalog.resolve(m)) == wanted
    assert {5341,5363,5730,5754,5770,6080,6232,6395,6414,6429,6762,6857,6912}.issubset(expected[0]['mentionIds'])
    assert catalog.catalog.entities[EID]['overrides'] == next(e['overrides'] for e in frozen['entities'] if e['entity_id']==EID)
    report['checks'].update(originalOpinionsAndLimitedRoutesPreserved=True,selectiveFactsOnly=True,
        existingGeographyCategoryAndScorePolicyPreserved=True)
    return report


runner.inputs, runner.apply_checked = inputs, apply_checked
if __name__ == '__main__':
    try:
        asyncio.run(runner.main())
    except Exception as error:
        print(json.dumps({'failed':True,'errorType':type(error).__name__,'frames':[
            {'file':Path(f.filename).name,'line':f.lineno,'function':f.name}
            for f in traceback.extract_tb(error.__traceback__) if str(ROOT) in f.filename]},ensure_ascii=False))
        sys.exit(1)
