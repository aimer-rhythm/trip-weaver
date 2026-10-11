"""五个上海高分主体分别治理，不把道路、楼宇、寺观、商圈或机位合并。"""
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
from app.aggregate.mention_identity import load_mention_catalog, load_mention_rows
from app.clean.mention_identity import source_fingerprint, effective_mention
from app.clean.recommendation import recommendation_metrics

runner.CITY, runner.BATCH = '上海', 'batch-104'
runner.SNAPSHOT = ROOT / 'snapshot-20261009T210025621762Z/input.json'
runner.EXTRAS = ROOT / 'shanghai-scope-08-extras.json'
runner.BASELINE = ROOT / 'shanghai-scope-08-baseline.json'
TARGET_ROWS = [
    ('6dfd36ea63dfecb59b523d7212582311', 4811, [4649, 4811], 3, 32),
    ('e5928ccb4d07c2a73e80b798966bd531', 4655, [4655, 5301], 2, 23),
    ('23329a45b196a3d11b4c9a4475d0d9a3', 4651, [4651], 2, 21),
    ('e0cdfdff135da12006c015389c492cf5', 4656, [4656], 2, 21),
    ('b6d79e437f924e798c9c36f13cd468e7', 4659, [4659], 2, 20),
]
runner.TARGETS = {r[0] for r in TARGET_ROWS}
runner.UNASSIGNED = {10358, 11115, 10335, 11221, 9980, 10018, 10146, 10340, 10343, 10359}
runner.FORBIDDEN_PHRASES = ['地铁直达，适合逛街购物', '游客区餐饮易踩雷', '从酒店地铁直达',
    '兴国路拐角或老麦咖啡馆二楼窗口是经典机位', '近地铁，住宿性价比高', '周边吃喝方便，适合住宿',
    '商圈内蛋饼、小笼、奶油小方', '在静安寺附近，性价比高', '窗外即可看到静安寺', '从酒店步行可达',
    '路线规划合理，不绕路不赶场']
FACTS = {
    10994: (['reason', 'evidence_text'], '📍 南京路店\n楼下就是网红打卡机位📸，旁边就是南京路步行街，位置超方便，逛吃出行都省心。'),
    10126: (['reason', 'evidence_text'], '1、武康路：从高铁站坐地铁到上海图书馆站，步行逛永福路、武康路，武康大楼对面拍照之后就可以去交通大学站坐地铁前往下一个目的地啦！'),
    11257: (['evidence_text'], '🉑静安寺/武康路周边：紧邻武康路、安福路、淮海中路，梧桐街区步行可达'),
    10263: (['reason', 'evidence_text'], '📍武康大楼斜对面人行道：斑马线做前景，仰拍整栋法式老建筑，避开车流拍巨物感大片'),
    11013: (['reason', 'evidence_text'], '📍武康大楼斜对面人行道：斑马线做前景，仰拍整栋法式老建筑，避开车流拍巨物感大片'),
    9949: (['evidence_text'], 'P18：陆家嘴天桥中心夜景'),
    11253: (['evidence_text'], '📍陆家嘴天桥：仰拍上海中心、金茂、环球金融中心，城市大片随手就能拍出来'),
    9961: (['reason', 'evidence_text'], '📍静安寺（寺庙+周边商场）'),
    9987: (['reason'], '静安寺-打卡这几个机位-面包超人展'),
    10268: (['evidence_text'], '📍静安寺门外人行道：鎏金古寺与高楼大厦并排，古今建筑反差很强，随手拍出魔幻魔都感'),
}


def inputs():
    raw = runner.SNAPSHOT.read_bytes()
    frozen = next(c for c in json.loads(raw)['cities'] if c['city'] == '上海')
    previous = next(c for c in json.loads((ROOT / 'snapshot-20261009T205339699294Z/input.json').read_bytes())['cities'] if c['city'] == '上海')
    assert frozen['notes'] == previous['notes']
    assert not any(runner.TARGETS.intersection([*s['entity_ids'], *s.get('withdrawal_entity_ids', [])]) for s in frozen['scopes'])
    notes = frozen['notes']
    route = notes['2474']['note_desc']
    start, end = '这次上海 3 日游，按景点气质分成三条线', 'Day3：武康大楼→武康路历史文化名街→田子坊→思南公guan→新天地'
    generic_quote = route[route.index(start):route.index(end) + len(end)]
    for mid in [11235, 11243, 11244]:
        FACTS[mid] = (['reason', 'evidence_text'], generic_quote)
    camera = notes['2281']['note_desc']
    start, end = 'Day1：南京路步行街', '📍南京路路口路牌机位：路口大字路牌做前景，远处拍到东方明珠，城市氛围感拉满'
    camera_quote = camera[camera.index(start):camera.index(end) + len(end)]
    for mid in [10253, 11006]:
        FACTS[mid] = (['reason', 'evidence_text'], camera_quote)
    night = notes['2275']['note_desc']
    start, end = '8️⃣苏州河秋千静安寺', '1️⃣2️⃣静安寺夜景'
    FACTS[10406] = (['reason', 'evidence_text'], night[night.index(start):night.index(end) + len(end)])
    quotes = [
        (2354, '直达外滩、东方明珠、南京路步行街，静安寺、玉佛寺步行可达'),
        (2448, '吃饭尽量避开南京路、豫园核心游客区，能大幅降低踩雷概率。'),
        (2351, '从酒店出来就是地铁站🚇，去陆家嘴和外滩都很方便'),
        (2442, '☀️拍武康大楼：转到兴国路拐角的人行道上，或者去对面的老麦咖啡馆二楼窗口拍'),
        (2278, '✅静安寺 人民广场 江苏路地铁口附近 性价比高'),
        (2347, '静安寺（吃喝方便）'),
        (2319, '4️⃣静安寺\n📍卞姐蛋饼\n📍红宝石奶油小方'),
        (2352, '3️⃣就在静安寺附近，虽然房间比较小，但性价比极高'),
        (2350, '🏯窗外就能看到静安寺，附近地铁站走路十分钟内都能到'),
        (2475, '吃完饭步行就能去南京路步行街、外白渡桥、日落长廊、武康大楼、安福路逛逛打卡'),
        (2459, '🧭顺路怎么玩（这点很加分）吃完可以直接逛：\n豫园 / 城隍庙\n南京路步行街'),
        (2308, '比起行人众多的武康路 安安静静不喧闹'),
        (2311, '国庆来上海，不建议去武康路人挤人'),
        (2281, '1️⃣南京路步行街：别在路边买高价特产'),
        (2276, '5.\u00a0陆家嘴拍照注意秩序，勿攀爬护栏，保护自身安全'),
        (2441, '1️⃣P1，📍武康大楼'),
    ]
    for nid, quote in quotes:
        assert quote in notes[str(nid)]['note_desc'], nid
    own_rows = [m for m in frozen['mentions'] if m['entityId'] in runner.TARGETS]
    assert len(own_rows) == 117
    by_id = {m['id']: m for m in own_rows}
    for mid, (_, quote) in FACTS.items():
        assert quote in notes[str(by_id[mid]['raw_note_id'])]['note_desc'], mid
    evidence = [{'kind': 'reviewed_attraction_source_scope', 'snapshotSha256': hashlib.sha256(raw).hexdigest(),
        'file': str(Path(__file__).relative_to(ROOT.parents[3])),
        'noteQuotes': [{'noteId': nid, 'quote': quote} for nid, quote in quotes],
        'reviewedNotes': [{'noteId': nid, 'noteDescSha256': hashlib.sha256(notes[str(nid)]['note_desc'].encode()).hexdigest()}
            for nid in sorted({m['raw_note_id'] for m in own_rows})],
        'conclusion': '五个主体共117条提及及正文完整复核，同城相邻道路、楼宇、寺庙与区域各自保持。南京路10358酒店交通、11115泛游客餐饮区；陆家嘴10335酒店；武康大楼11221仅兴国路/老麦咖啡二楼独立机位；静安寺9980/10018/10340/10343/10359住宿、10146美食分区标题，10条null待审，不创建域外主体。16条仅按字段排除具体机位、邻近酒店/餐厅、独立展览或商城、混入秋千及整份路线说明。9949/11253保留地域天际线reason，只排具体天桥引文；10268保留寺庙外观reason，只排独立人行道引文，11017/11260直接描述寺庙外观则保持；11264泛称楼体转角、11251泛称街口建筑不机械删除。10406正文独立第12项确有静安寺夜景，保留身份但排除混入第8项苏州河秋千的描述。10994/10997同篇明确餐后实际去步行街和武康大楼，保留，10994只排邻近餐厅描述；11299明确餐后游览保持。武康路9908/9939负评、步行街高价与排队警示、楼体勿占道/不可入内警示、陆家嘴护栏警示、静安寺衣着提醒保持。静安寺旧主源武定西路1185与寺观身份定位尚待核，沿用旧位置不宣称路线定位已核实；不按名称把南京路泛区域、南京西路、美食店或其它建筑并入。'}]
    entities = {e['entity_id']: e for e in frozen['entities']}
    sources = {s['id']: s for s in frozen['sources']}
    scopes, expected = [], []
    for eid, sid, source_ids, revision, total in TARGET_ROWS:
        entity = entities[eid]
        assert entity['revision'] == revision and entity['primary_place_id'] == sid
        assert sorted(int(k) for k, v in frozen['members'].items() if v == eid) == source_ids
        rows = [m for m in own_rows if m['entityId'] == eid]
        assert len(rows) == total
        assignments = [{'mentionId': m['id'], 'inputHash': m['inputHash'],
            'entityId': None if m['id'] in runner.UNASSIGNED else eid} for m in rows]
        for a in assignments:
            if a['mentionId'] in FACTS:
                fields, quote = FACTS[a['mentionId']]
                a['factExclusions'] = {field: {'reason': 'subject_mismatch', 'quote': quote} for field in fields}
        scope = {'key': f'top30-20261010-batch-104-scope-{sid}', 'city': '上海', 'sourcePlaceId': sid,
            'expectedSourceHash': source_fingerprint(sources[sid]), 'expectedScopeRevision': 0,
            'expectedRevisions': {eid: revision}, 'assignments': assignments, 'evidence': evidence}
        if len(source_ids) > 1:
            scope['sources'] = [{'sourcePlaceId': source, 'sourceHash': source_fingerprint(sources[source])} for source in source_ids]
        own = [m for m in rows if m['id'] not in runner.UNASSIGNED]
        scopes.append(scope)
        expected.append({'city': '上海', 'id': eid, 'name': entity['canonical_name'], 'revision': revision + 1, 'verified': True,
            'mentionIds': [m['id'] for m in own], **recommendation_metrics(own)})
    assert [p['mentionCount'] for p in expected] == [30, 23, 20, 20, 14]
    return frozen, scopes, expected


original_apply_checked = runner.apply_checked


async def apply_checked(session, frozen, scopes, expected):
    report = await original_apply_checked(session, frozen, scopes, expected)
    catalog = await load_mention_catalog(session, '上海')
    own_ids = {mid for p in expected for mid in p['mentionIds']}
    for mention in await load_mention_rows(session, '上海'):
        if mention['id'] not in own_ids:
            continue
        projected = effective_mention(mention, catalog.resolve(mention))
        wanted = {**mention, 'fact_value': mention['fact_value'] or {}}
        if mention['id'] in FACTS:
            wanted.update({field: None for field in FACTS[mention['id']][0]})
        assert projected == wanted
    assert {9908, 9939, 10254, 11007, 10264, 11014, 10367, 10374, 10269, 11018, 10406, 10994, 10997, 11299}.issubset(own_ids)
    report['checks'].update(originalWarningsAndExplicitVisitsPreserved=True, selectiveFactsOnly=True,
        fiveSeparateRootsAndGeographyOverridesPreserved=True)
    return report


runner.inputs, runner.apply_checked = inputs, apply_checked
if __name__ == '__main__':
    try:
        asyncio.run(runner.main())
    except Exception as error:
        print(json.dumps({'failed': True, 'errorType': type(error).__name__, 'frames': [
            {'file': Path(f.filename).name, 'line': f.lineno, 'function': f.name}
            for f in traceback.extract_tb(error.__traceback__) if str(ROOT) in f.filename]}, ensure_ascii=False))
        sys.exit(1)
