"""豫园园林保留独立根，隔离老街、灯会、餐饮与酒店参照。"""
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

GARDEN = 'b507a4f0980e5d13106a169b7a0ad044'
runner.CITY, runner.BATCH = '上海', 'batch-103'
runner.SNAPSHOT = ROOT / 'snapshot-20261009T203709273711Z/input.json'
runner.EXTRAS = ROOT / 'shanghai-scope-07-extras.json'
runner.BASELINE = ROOT / 'shanghai-scope-07-baseline.json'
runner.TARGETS = {GARDEN}
runner.UNASSIGNED = {10355, 11116, 11181, 11283, 11314}
runner.FORBIDDEN_PHRASES = ['离酒店近，可顺路游览古典园林', '游客区餐饮易踩雷',
    '新春灯会年味浓', '古风建筑加红灯笼倒影', '距外滩很近，可顺路游览',
    '九曲桥湖面古风人像', '九曲桥湖面倒影配红灯笼', '江南园林，九曲桥夜景古风']
FACT_EXCLUSIONS = {
    10270: (['reason', 'evidence_text'], '📍豫园九曲桥湖面：白天拍园林水景倒影，傍晚红灯笼亮起，古风人像绝佳取景地'),
    11019: (['reason', 'evidence_text'], '📍豫园九曲桥湖面：白天拍园林水景倒影，傍晚红灯笼亮起，古风人像绝佳取景地'),
    11261: (['reason', 'evidence_text'], '📍豫园九曲桥：红灯笼水面倒影，夜景绝美，江南水乡氛围感，适合拍古风照片'),
    10369: (['evidence_text'], '📍豫园：明代江南古典园林，亭台楼阁、九曲桥精致，尽显江南园林韵味'),
    10957: (['reason'], '3⃣豫园：城市中心的江南园林，每年灯会都能成为现象级热点。'),
}


def inputs():
    raw = runner.SNAPSHOT.read_bytes()
    frozen = next(c for c in json.loads(raw)['cities'] if c['city'] == '上海')
    entity = next(e for e in frozen['entities'] if e['entity_id'] == GARDEN)
    assert entity['revision'] == 2 and entity['primary_place_id'] == 4660
    assert not any(GARDEN in [*s['entity_ids'], *s.get('withdrawal_entity_ids', [])] for s in frozen['scopes'])
    assert [int(key) for key, eid in frozen['members'].items() if eid == GARDEN] == [4660]
    rows = [m for m in frozen['mentions'] if m['entityId'] == GARDEN]
    assert len(rows) == 33
    notes = frozen['notes']
    itinerary = notes['2511']['note_desc']
    start, end = '1. 豫园（8:30–10:00）', '• 看点：江南园林、假山、九曲桥'
    FACT_EXCLUSIONS[11026] = (['reason', 'evidence_text'], itinerary[itinerary.index(start):itinerary.index(end) + len(end)])
    quotes = [
        (2354, '离城隍庙，豫园都很近的'),
        (2448, '吃饭尽量避开南京路、豫园核心游客区，能大幅降低踩雷概率。'),
        (2514, '7-8点抵达豫园，赏新春灯会夜景'),
        (2494, '📍 豫园老街\n古风建筑 + 灯笼倒影'),
        (2482, '距离豫园、城隍庙这些景点也很近'),
        (2282, '豫园老街🔜豫园园林(门票40元)🔜城隍庙'),
        (2302, '▪️豫园：单独购买园林门票入园，江南古典亭台楼阁精致耐看，隔壁商业街高价小吃理性避开。'),
        (2509, '3️⃣豫园\n园区内比较小和苏州的拙政园类似！江南水乡的园林！'),
        (2492, '之后再导航步行去豫园'),
        (2459, '🧭顺路怎么玩（这点很加分）吃完可以直接逛：\n豫园 / 城隍庙'),
        (2347, '8️⃣ 豫园几点去合适\n早上8:30刚开门就可以去'),
    ]
    for nid, quote in quotes:
        assert quote in notes[str(nid)]['note_desc'], nid
    by_id = {m['id']: m for m in rows}
    for mid, (_, quote) in FACT_EXCLUSIONS.items():
        assert '豫园' in quote and quote in notes[str(by_id[mid]['raw_note_id'])]['note_desc'], mid
    public = []
    for filename, quote, limitation in [
        ('yuyuan-shio-fetch-01.json', '1995年起，每逢春节，豫园商城都举办豫园新春民俗艺术灯会（简称“豫园灯会”）',
         '政府新闻办实际正文区分园林与商城灯会；不据此补实时开放和票价。'),
        ('yuyuan-wiki-fetch-01.json', '、莲花池等未划入园内。',
         '百科原段明确九曲桥/湖心亭/莲花池未划入园内；引注黄浦区原页两次fetch为空，仅作与社区分区正文一致的辅助证据，不冒充已抓到政府该页。'),
    ]:
        data = (ROOT / filename).read_bytes()
        fetched = json.loads(data)
        assert fetched['ok'] and quote in fetched['content']
        # 保留包含九曲桥及边界的完整段落，避免仅用短尾句说明主体。
        excerpt = next(p for p in fetched['content'].split('\n\n') if quote in p)
        if 'wiki' in filename:
            assert '九曲桥' in excerpt and '不再是城隍廟的附屬園林' in excerpt
        public.append({'file': filename, 'sha256': hashlib.sha256(data).hexdigest(),
            'url': fetched['url'], 'quote': excerpt, 'limit': limitation})
    evidence = [{'kind': 'reviewed_attraction_source_scope', 'snapshotSha256': hashlib.sha256(raw).hexdigest(),
        'file': str(Path(__file__).relative_to(ROOT.parents[3])),
        'noteQuotes': [{'noteId': nid, 'quote': quote} for nid, quote in quotes], 'publicEvidence': public,
        'reviewedNotes': [{'noteId': nid, 'noteDescSha256': hashlib.sha256(notes[str(nid)]['note_desc'].encode()).hexdigest()}
            for nid in sorted({m['raw_note_id'] for m in rows})],
        'conclusion': '完整读取33条提及对应原文。10355酒店邻近、11116餐饮游客区负评、11181新春灯会、11283明确豫园老街、11314餐厅邻近参照隔离，原数据和立场保持。10270/11019/11261的九曲桥机位与11026混入桥体的描述排除，但同篇豫园路线身份保留；10369仅排错配evidence_text、保留园林reason，10957仅排混入灯会的reason、保留明确园林引文。10021/10129/10140/10370/11234原警示保持，不在本批校验实时开放。10088已明确隔壁商业街、11005分区园林评价、11199步行终点、11297独立餐后游览清单均保留。园林、寺庙、老街、商业区与活动不合并；九曲桥源5213却用青浦地址，原11001及位置只读待核，本批不把湖面描述转给它。旧主名、位置和媒体保持，不新增活动、餐饮、酒店或正式组成关系。'}]
    assignments = [{'mentionId': m['id'], 'inputHash': m['inputHash'],
        'entityId': None if m['id'] in runner.UNASSIGNED else GARDEN} for m in rows]
    for a in assignments:
        if a['mentionId'] in FACT_EXCLUSIONS:
            fields, quote = FACT_EXCLUSIONS[a['mentionId']]
            a['factExclusions'] = {field: {'reason': 'subject_mismatch', 'quote': quote} for field in fields}
    source = next(s for s in frozen['sources'] if s['id'] == 4660)
    scope = {'key': 'top30-20261010-batch-103-scope-4660', 'city': '上海', 'sourcePlaceId': 4660,
        'expectedSourceHash': source_fingerprint(source), 'expectedScopeRevision': 0,
        'expectedRevisions': {GARDEN: 2}, 'assignments': assignments, 'evidence': evidence}
    own = [m for m in rows if m['id'] not in runner.UNASSIGNED]
    expected = [{'city': '上海', 'id': GARDEN, 'name': entity['canonical_name'], 'revision': 3, 'verified': True,
        'mentionIds': [m['id'] for m in own], **recommendation_metrics(own)}]
    assert expected[0]['mentionCount'] == 28
    return frozen, [scope], expected


original_apply_checked = runner.apply_checked


async def apply_checked(session, frozen, scopes, expected):
    report = await original_apply_checked(session, frozen, scopes, expected)
    catalog = await load_mention_catalog(session, '上海')
    own_ids = set(expected[0]['mentionIds'])
    for mention in await load_mention_rows(session, '上海'):
        if mention['id'] not in own_ids:
            continue
        projected = effective_mention(mention, catalog.resolve(mention))
        wanted = {**mention, 'fact_value': mention['fact_value'] or {}}
        if mention['id'] in FACT_EXCLUSIONS:
            wanted.update({field: None for field in FACT_EXCLUSIONS[mention['id']][0]})
        assert projected == wanted
    assert {10021, 10129, 10140, 10370, 11234, 10088, 11005, 11199, 11297}.issubset(own_ids)
    report['checks'].update(warningsGardenRoutesAndSeparateSubjectBoundariesPreserved=True,
        onlyBoundBridgeAndFestivalDescriptionsExcluded=True)
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
