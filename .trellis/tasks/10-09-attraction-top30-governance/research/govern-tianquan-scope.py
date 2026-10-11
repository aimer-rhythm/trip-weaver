"""天泉步道广场：隔离上方步道机位，排除整段路线事实；不合并任何主体。"""
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

TARGET = 'c2f0df60bef3612fec9ed56021ac090f'
runner.CITY, runner.BATCH = '厦门', 'batch-94'
runner.SNAPSHOT = ROOT / 'snapshot-20261009T182425163301Z/input.json'
runner.EXTRAS = ROOT / 'xiamen-scope-01-extras.json'
runner.BASELINE = ROOT / 'xiamen-scope-01-baseline.json'
runner.TARGETS, runner.UNASSIGNED = {TARGET}, {6876}
runner.FORBIDDEN_PHRASES = ['步道视野好，可拍海边全景', '终点广场，沿途休息区洗手间多',
                            '精华路线终点，全程下坡塑胶步道，适合老人小孩']


def inputs():
    raw = runner.SNAPSHOT.read_bytes()
    frozen = next(c for c in json.loads(raw)['cities'] if c['city'] == runner.CITY)
    assert not any(TARGET in [*s['entity_ids'], *s.get('withdrawal_entity_ids', [])] for s in frozen['scopes'])
    entity = next(e for e in frozen['entities'] if e['entity_id'] == TARGET)
    assert entity['revision'] == 2 and entity['primary_place_id'] == 2735
    rows = [m for m in frozen['mentions'] if m['entityId'] == TARGET]
    assert {m['id'] for m in rows} == {5506, 5525, 5698, 5972, 5989, 6097, 6876}
    quotes = [
        (1263, '图❼ ：天泉步道广场上面的步道'),
        (1562, '山海步道（D18入口）➡️ 万石沧海•大面筋 ➡️盼归塔•金门标语 ➡️日落观景平台•看日落 ➡️天泉步道广场'),
        (1562, '一路上休息区和洗手间很多'),
        (1568, '望湖塔入口→万石沧海螺旋塔（小瑞士核心机位） → 盼归塔 → 天泉步道广场。全程3公里基本下坡且都是塑胶步道'),
        (1571, '看完日落，顺着步道慢慢走到天泉步道广场'),
        (1278, '音乐广场对面就是天泉步道广场'),
    ]
    for nid, quote in quotes:
        assert quote in frozen['notes'][str(nid)]['note_desc']
    evidence = [{'kind': 'reviewed_attraction_source_scope', 'snapshotSha256': hashlib.sha256(raw).hexdigest(),
        'file': str(Path(__file__).relative_to(ROOT.parents[3])),
        'noteQuotes': [{'noteId': n, 'quote': q} for n, q in quotes],
        'conclusion': '6876明确是广场上方的步道机位，null待审，不算广场推荐。5525、6097在原文路线中明确到达广场，保留身份，但reason及evidence_text抽取的是整段路线设施/铺装，按subject_mismatch排除。其余4条保留原广场归属；5698沿路视角、5972图中范围仍未全面核实。本批不合并天泉步道/母步道/盼归塔，不建正式part_of；不补坐标、不新增图片治理。'}]
    assignments = [{'mentionId': m['id'], 'inputHash': m['inputHash'],
        'entityId': None if m['id'] == 6876 else TARGET} for m in rows]
    for mid in [5525, 6097]:
        mention = next(m for m in rows if m['id'] == mid)
        quote = next(q for nid, q in quotes if nid == mention['raw_note_id'])
        next(a for a in assignments if a['mentionId'] == mid)['factExclusions'] = {
            field: {'reason': 'subject_mismatch', 'quote': quote} for field in ['reason', 'evidence_text']}
    source = next(s for s in frozen['sources'] if s['id'] == 2735)
    scope = {'key': 'top30-20261010-batch-94-tianquan-scope', 'city': runner.CITY, 'sourcePlaceId': 2735,
        'expectedSourceHash': source_fingerprint(source), 'expectedScopeRevision': 0,
        'expectedRevisions': {TARGET: 2}, 'assignments': assignments, 'evidence': evidence}
    own = [m for m in rows if m['id'] != 6876]
    expected = {'city': runner.CITY, 'id': TARGET, 'name': entity['canonical_name'], 'revision': 3,
        'verified': True, 'mentionIds': [m['id'] for m in own], **recommendation_metrics(own)}
    assert expected['recommendScore'] == 20.0
    return frozen, [scope], [expected]


original_apply_checked = runner.apply_checked


async def apply_checked(session, frozen, scopes, expected):
    report = await original_apply_checked(session, frozen, scopes, expected)
    catalog = await load_mention_catalog(session, runner.CITY)
    rows = await load_mention_rows(session, runner.CITY)
    for m in rows:
        if m['id'] in [5525, 6097]:
            projected = effective_mention(m, catalog.resolve(m))
            assert projected['reason'] is None and projected['evidence_text'] is None
            assert catalog.resolve(m)['entity']['entity_id'] == TARGET
        elif m['id'] in [5506, 5698, 5972, 5989]:
            assert effective_mention(m, catalog.resolve(m)) == {**m, 'fact_value': m['fact_value'] or {}}
    report['checks'].update(routeFactsExcludedWithEndpointIdentityRetained=True, otherAssignedFactsPreserved=True)
    return report


runner.inputs, runner.apply_checked = inputs, apply_checked
if __name__ == '__main__':
    try:
        asyncio.run(runner.main())
    except Exception as error:
        driver = getattr(getattr(error, 'orig', None), '__cause__', None)
        print(json.dumps({'failed': True, 'errorType': type(error).__name__, 'sqlstate': getattr(driver, 'sqlstate', None),
            'constraint': getattr(driver, 'constraint_name', None), 'frames': [
                {'file': Path(f.filename).name, 'line': f.lineno, 'function': f.name}
                for f in traceback.extract_tb(error.__traceback__) if str(ROOT) in f.filename]}, ensure_ascii=False))
        sys.exit(1)
