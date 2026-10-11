"""阅读后四主体的明确来源错配；标签不充分与已证实非同体分别记录。"""
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

runner.CITY, runner.BATCH = '上海', 'batch-106'
runner.SNAPSHOT = ROOT / 'snapshot-20261009T212651757971Z/input.json'
runner.EXTRAS = ROOT / 'shanghai-scope-10-extras.json'
runner.BASELINE = ROOT / 'shanghai-scope-10-baseline.json'
TARGETS = [('1bd5394a328dfcddf66a31efc03c58ef', 4723, 11, 10),
    ('1ad90072b41962955001d46a0060ecc1', 4658, 9, 8),
    ('6fd07ebb97c1fdeeb2aa94f06e40b30f', 4709, 6, 5),
    ('7c070ffa455db9978014329a6582a648', 4738, 7, 7)]
runner.TARGETS = {r[0] for r in TARGETS}
runner.UNASSIGNED = {10925, 11271, 10944}
runner.FORBIDDEN_PHRASES = ['经典拍照机位，旁边有咖啡店', '公主风格洋房，光影有意境',
    '0元出片机位，适合拍照打卡', '商业街有巨人展可看', '潮牌店和GM巨人展', '路线规划合理，不绕路不赶场']
FACTS = {9989: (['reason'], '第五站\n淮海中路-巨人展'),
    10074: (['reason', 'evidence_text'], '6️⃣淮海中路：这边有很多潮牌店和gm巨人展！')}


def inputs():
    raw = runner.SNAPSHOT.read_bytes()
    frozen = next(c for c in json.loads(raw)['cities'] if c['city'] == '上海')
    assert not any(runner.TARGETS.intersection([*s['entity_ids'], *s.get('withdrawal_entity_ids', [])]) for s in frozen['scopes'])
    route = frozen['notes']['2474']['note_desc']
    start, end = '这次上海 3 日游，按景点气质分成三条线', 'Day3：武康大楼→武康路历史文化名街→田子坊→思南公guan→新天地'
    FACTS[11247] = (['reason', 'evidence_text'], route[route.index(start):route.index(end) + len(end)])
    quotes = [(2507, '📷关于打卡拍照\n📍乍浦路桥旁边的咖啡'),
        (2441, '2️⃣P2，📍淮海中路公主风格洋房，近武康大楼'),
        (2488, frozen['notes']['2488']['note_desc']),
        (2485, '6点后来北外滩看夜景，真的非常惊艳！！'),
        (2502, '▫️乍浦路桥：陆家嘴三件套+东方明珠做背景！经典机位，侧拍溜背车身，蓝调日出时天空粉紫，绝美城市天际线')]
    for nid, quote in quotes:
        assert quote in frozen['notes'][str(nid)]['note_desc'], nid
    rows = [m for m in frozen['mentions'] if m['entityId'] in runner.TARGETS]
    assert len(rows) == 33
    evidence = [{'kind': 'reviewed_attraction_source_scope', 'snapshotSha256': hashlib.sha256(raw).hexdigest(),
        'file': str(Path(__file__).relative_to(ROOT.parents[3])),
        'noteQuotes': [{'noteId': n, 'quote': q} for n, q in quotes],
        'reviewedNotes': [{'noteId': n, 'noteDescSha256': hashlib.sha256(frozen['notes'][str(n)]['note_desc'].encode()).hexdigest()}
            for n in sorted({m['raw_note_id'] for m in rows})],
        'conclusion': '四主体33条提及及正文阅读。10925原文仅桥旁咖啡且路线未列桥，11271仅沿路未具名洋房，分别隔离为非同体经营场所/建筑参照，不新建或转给邻近实体。10944正文只有混合北外滩/外滩/0元机位标签，无法确认北外滩身份，null待原图补证；证据不足不是已证实非同体，不能据此排除潜在排名上界。9989明确街道站点，仅排混合巨人展的reason，保留街名引文；10074明确街道列表，排混合商店与展览的reason/evidence_text。11247排整份路线描述但保留新天地站点。11129桥上拍车语境只使用桥景，不将汽车性能当景点事实；10874有完整北外滩夜景正文，不能仅因标签小巨蛋就转子项。其余路段、桥景、原负评及明确散步保持，四根与邻近桥梁/楼宇/展览/经营场所不合并，旧位置不当新核实。'}]
    scopes, expected = [], []
    for eid, sid, count, remaining in TARGETS:
        entity = next(e for e in frozen['entities'] if e['entity_id'] == eid)
        source = next(s for s in frozen['sources'] if s['id'] == sid)
        assert entity['revision'] == 2 and entity['primary_place_id'] == sid
        assert [int(k) for k, v in frozen['members'].items() if v == eid] == [sid]
        own = [m for m in rows if m['entityId'] == eid]
        assert len(own) == count
        assignments = []
        for m in own:
            a = {'mentionId': m['id'], 'inputHash': m['inputHash'], 'entityId': None if m['id'] in runner.UNASSIGNED else eid}
            if m['id'] in FACTS:
                fields, quote = FACTS[m['id']]
                assert quote in frozen['notes'][str(m['raw_note_id'])]['note_desc']
                a['factExclusions'] = {field: {'reason': 'subject_mismatch', 'quote': quote} for field in fields}
            assignments.append(a)
        scopes.append({'key': f'top30-20261010-batch-106-scope-{sid}', 'city': '上海', 'sourcePlaceId': sid,
            'expectedSourceHash': source_fingerprint(source), 'expectedScopeRevision': 0,
            'expectedRevisions': {eid: 2}, 'assignments': assignments, 'evidence': evidence})
        retained = [m for m in own if m['id'] not in runner.UNASSIGNED]
        expected.append({'city': '上海', 'id': eid, 'name': entity['canonical_name'], 'revision': 3, 'verified': True,
            'mentionIds': [m['id'] for m in retained], **recommendation_metrics(retained)})
        assert expected[-1]['mentionCount'] == remaining
    return frozen, scopes, expected


original_apply_checked = runner.apply_checked


async def apply_checked(session, frozen, scopes, expected):
    report = await original_apply_checked(session, frozen, scopes, expected)
    catalog = await load_mention_catalog(session, '上海')
    owned = {mid for p in expected for mid in p['mentionIds']}
    for m in await load_mention_rows(session, '上海'):
        if m['id'] not in owned:
            continue
        wanted = {**m, 'fact_value': m['fact_value'] or {}}
        if m['id'] in FACTS:
            wanted.update({field: None for field in FACTS[m['id']][0]})
        assert effective_mention(m, catalog.resolve(m)) == wanted
    assert {9989, 10074, 11129, 10874, 11133, 10087, 11247}.issubset(owned)
    report['checks'].update(explicitVisitsAndOriginalOpinionsPreserved=True, selectiveFactsOnly=True)
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
