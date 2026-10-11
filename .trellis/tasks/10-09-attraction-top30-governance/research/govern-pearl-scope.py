"""东方明珠保留全简称及塔体体验，隔离酒店餐厅窗景与其它主体事实。"""
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

PEARL = '2af1d8c8816a1645942015d16738c9fd'
runner.CITY, runner.BATCH = '上海', 'batch-102-v2'
runner.SNAPSHOT = ROOT / 'snapshot-20261009T202924933031Z/input.json'
runner.EXTRAS = ROOT / 'shanghai-scope-06-extras.json'
runner.BASELINE = ROOT / 'shanghai-scope-06-baseline.json'
runner.TARGETS = {PEARL}
runner.UNASSIGNED = {10342, 10351, 10991, 11311, 11329}
runner.FORBIDDEN_PHRASES = ['躺着就能看到东方明珠', '酒店房间可观夜景', '在餐厅可观赏',
    '餐厅落地窗可直接观赏东方明珠', '餐厅窗边可远眺东方明珠', '路线规划合理，不绕路不赶场',
    '与陆家嘴三件套择一登顶']
FACT_EXCLUSIONS = {
    9966: '📍陆家嘴→ 步行2分钟→ 📍东方明珠（登塔/正大广场晚饭）',
}


def inputs():
    raw = runner.SNAPSHOT.read_bytes()
    frozen = next(c for c in json.loads(raw)['cities'] if c['city'] == '上海')
    entity = next(e for e in frozen['entities'] if e['entity_id'] == PEARL)
    assert entity['revision'] == 2 and entity['primary_place_id'] == 4666
    assert not any(PEARL in [*s['entity_ids'], *s.get('withdrawal_entity_ids', [])] for s in frozen['scopes'])
    sources = {s['id']: s for s in frozen['sources']}
    source_ids = sorted(int(key) for key, eid in frozen['members'].items() if eid == PEARL)
    assert source_ids == [4650, 4666]
    rows = [m for m in frozen['mentions'] if m['entityId'] == PEARL]
    assert len(rows) == 35
    notes = frozen['notes']
    route = notes['2474']['note_desc']
    start, end = '这次上海 3 日游，按景点气质分成三条线', 'Day2：上海Z心大厦→东方明珠广播电视塔→上海图书馆东馆→陆家嘴Z心→陆家嘴空中步行连廊'
    FACT_EXCLUSIONS[11239] = route[route.index(start):route.index(end) + len(end)]
    comparison = notes['2513']['note_desc']
    start, end = '武康大楼→武康路→豫园→城隍庙→陆家嘴→东方明珠→外滩→南京路→虹桥站', '陆家嘴三件套选一个登就够了，看多了都一样'
    FACT_EXCLUSIONS[11159] = comparison[comparison.index(start):comparison.index(end) + len(end)]
    quotes = [
        (2352, '7️⃣躺着就能看到东方明珠，拍照超出片的一家，位置没得说，全屋智能家居220💰/人'),
        (2354, '房间还能看到东方明珠夜景，真的很漂亮'),
        (2475, '坐在店里就能看到东方明珠、黄浦江景'),
        (2482, '这个大落地窗！美到失语！！可以看到东方明珠'),
        (2464, '外滩22号的景观位复古风李百蟹面馆！！\n窗边就是外滩和东方明珠！'),
        (2480, '吃完直接步行去外滩散步，\n东方明珠、陆家嘴三件套打卡超出片'),
        (2347, '5️⃣ 东方明珠不一定要上去\n上去又贵还要排队'),
        (2281, '📍东方明珠悬空玻璃走廊：隔着透明玻璃，平视陆家嘴三件套，俯瞰整片滨江天际线'),
        (2444, '📍东方明珠悬空走廊：透明玻璃俯瞰黄浦江，脚下是车流，高空视角独一无二很震撼'),
        (2508, '1⃣东方明珠：还能去空中餐厅，纵览上海繁华'),
        (2294, '东方明珠先拍标准游客照，再去环形天桥拍高楼和车流'),
        (2304, '5、东方明珠：懒人就坐一站陆家嘴环线1号线，下车就到东方明珠啦，直接上环形天桥拍照'),
    ]
    for nid, quote in quotes:
        assert quote in notes[str(nid)]['note_desc'], nid
    by_id = {m['id']: m for m in rows}
    for mid, quote in FACT_EXCLUSIONS.items():
        assert '东方明珠' in quote and quote in notes[str(by_id[mid]['raw_note_id'])]['note_desc']
    evidence = [{'kind': 'reviewed_attraction_source_scope', 'snapshotSha256': hashlib.sha256(raw).hexdigest(),
        'file': str(Path(__file__).relative_to(ROOT.parents[3])),
        'noteQuotes': [{'noteId': nid, 'quote': quote} for nid, quote in quotes],
        'reviewedNotes': [{'noteId': nid, 'noteDescSha256': hashlib.sha256(notes[str(nid)]['note_desc'].encode()).hexdigest()}
            for nid in sorted({m['raw_note_id'] for m in rows})],
        'conclusion': '完整阅读35条对应正文。5条酒店/餐厅窗景参照隔离。9966同列正大广场晚饭、11159把三件套登顶建议外推东方明珠、11239整份规划说明，仅排除reason/evidence_text，明确塔体路线身份保持。10132正文仅写简称，原提及被抽成全名，现行事实引文门禁不支持这个简称锚点；保留其明确路线身份和原事实，记录天桥reason/evidence_text待核，不通过整条隔离规避门禁。10255/11008/11252/11195为塔内观光廊体验，10953为塔体路线及空中餐厅体验，均保持，不能因含内部设施即机械删除。11202正文另有餐后外滩散步与地标打卡，未限定新的独立站位，保持地标观景提及，不据此声称登塔或转到浦东；11311只有餐厅窗景且餐后只去外滩，隔离。10025登塔贵/排队负评及其它warning保持。塔体、陆家嘴三件套、环形天桥、正大广场各自身份不合并；旧简称根与ID、主源世纪大道1号、媒体不改。'}]
    assignments = [{'mentionId': m['id'], 'inputHash': m['inputHash'],
        'entityId': None if m['id'] in runner.UNASSIGNED else PEARL} for m in rows]
    for a in assignments:
        if a['mentionId'] in FACT_EXCLUSIONS:
            a['factExclusions'] = {field: {'reason': 'subject_mismatch', 'quote': FACT_EXCLUSIONS[a['mentionId']]}
                for field in ['reason', 'evidence_text']}
    scope = {'key': 'top30-20261010-batch-102-v2-scope-4666', 'city': '上海', 'sourcePlaceId': 4666,
        'expectedSourceHash': source_fingerprint(sources[4666]), 'expectedScopeRevision': 0,
        'expectedRevisions': {PEARL: 2}, 'assignments': assignments, 'evidence': evidence,
        'sources': [{'sourcePlaceId': sid, 'sourceHash': source_fingerprint(sources[sid])} for sid in source_ids]}
    own = [m for m in rows if m['id'] not in runner.UNASSIGNED]
    expected = [{'city': '上海', 'id': PEARL, 'name': entity['canonical_name'], 'revision': 3, 'verified': True,
        'mentionIds': [m['id'] for m in own], **recommendation_metrics(own)}]
    assert expected[0]['mentionCount'] == 30
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
            wanted.update(reason=None, evidence_text=None)
        assert projected == wanted
    assert {10025, 10256, 11009, 10376, 11202, 10255, 11008, 11252, 11195, 10953}.issubset(own_ids)
    report['checks'].update(warningsTowerExperiencesAndExplicitViewsPreserved=True,
        onlyBoundOtherSubjectFactsExcluded=True)
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
