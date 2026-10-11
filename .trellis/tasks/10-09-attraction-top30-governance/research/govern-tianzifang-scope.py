"""田子坊保留三条路线身份，只排除归于整份旅行路线的说明。"""
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

TARGET = 'b886bee90f1d16aedf0768894658d286'
runner.CITY, runner.BATCH = '上海', 'batch-99-v2'
runner.SNAPSHOT = ROOT / 'snapshot-20261009T192058158076Z/input.json'
runner.EXTRAS = ROOT / 'shanghai-scope-04-extras.json'
runner.BASELINE = ROOT / 'shanghai-scope-04-baseline.json'
runner.TARGETS, runner.UNASSIGNED = {TARGET}, set()
runner.FORBIDDEN_PHRASES = ['路线规划合理，不绕路不赶场', '按景点气质分成三条线']


def inputs():
    raw = runner.SNAPSHOT.read_bytes()
    frozen = next(c for c in json.loads(raw)['cities'] if c['city'] == '上海')
    entity = next(e for e in frozen['entities'] if e['entity_id'] == TARGET)
    assert entity['revision'] == 2 and entity['primary_place_id'] == 4739
    assert not any(TARGET in s['entity_ids'] for s in frozen['scopes'])
    rows = [m for m in frozen['mentions'] if m['entityId'] == TARGET]
    assert {m['id'] for m in rows} == {10005, 10284, 11245}
    quotes = [(2279, '武康路 → 新天地 → 田子坊 → 思南公馆 → 豫园 → 城隍庙'),
        (2290, 'Day2：武康路➡新天地➡田子坊➡思南公馆➡豫园➡城隍庙'),
        (2474, '这次上海 3 日游，按景点气质分成三条线，走下来舒服又顺畅'),
        (2474, 'Day3：武康大楼→武康路历史文化名街→田子坊→思南公guan→新天地')]
    for nid, quote in quotes:
        assert quote in frozen['notes'][str(nid)]['note_desc']
    evidence = [{'kind': 'reviewed_attraction_source_scope', 'snapshotSha256': hashlib.sha256(raw).hexdigest(),
        'file': str(Path(__file__).relative_to(ROOT.parents[3])),
        'noteQuotes': [{'noteId': n, 'quote': q} for n, q in quotes],
        'conclusion': '三篇均明确列田子坊为路线地点，保留身份和原推荐立场，不因同篇住宿建议删除实际游览。11245的reason/evidence_text描述整份三日游规划，按subject_mismatch排除；不当作田子坊自身设施/特征。不合并新天地、思南公馆，不修改任何原文或图片。'}]
    assignments = [{'mentionId': m['id'], 'inputHash': m['inputHash'], 'entityId': TARGET} for m in rows]
    original = frozen['notes']['2474']['note_desc']
    fact_quote = original[original.index(quotes[2][1]):original.index(quotes[3][1]) + len(quotes[3][1])]
    assert '田子坊' in fact_quote and len(fact_quote) < 2048
    next(a for a in assignments if a['mentionId'] == 11245)['factExclusions'] = {
        field: {'reason': 'subject_mismatch', 'quote': fact_quote} for field in ['reason', 'evidence_text']}
    source = next(s for s in frozen['sources'] if s['id'] == 4739)
    scope = {'key': 'top30-20261010-batch-99-v2-tianzifang-scope', 'city': '上海', 'sourcePlaceId': 4739,
        'expectedSourceHash': source_fingerprint(source), 'expectedScopeRevision': 0,
        'expectedRevisions': {TARGET: 2}, 'assignments': assignments, 'evidence': evidence}
    metrics = recommendation_metrics(rows)
    assert metrics == {'mentionCount': 3, 'recommendScore': 12.5}
    return frozen, [scope], [{'city': '上海', 'id': TARGET, 'name': entity['canonical_name'], 'revision': 3,
        'verified': True, 'mentionIds': [m['id'] for m in rows], **metrics}]


original_apply_checked = runner.apply_checked


async def apply_checked(session, frozen, scopes, expected):
    report = await original_apply_checked(session, frozen, scopes, expected)
    catalog = await load_mention_catalog(session, '上海')
    for mention in await load_mention_rows(session, '上海'):
        if mention['id'] == 11245:
            projected = effective_mention(mention, catalog.resolve(mention))
            assert projected['reason'] is None and projected['evidence_text'] is None
            assert catalog.resolve(mention)['entity']['entity_id'] == TARGET
        elif mention['id'] in expected[0]['mentionIds']:
            assert effective_mention(mention, catalog.resolve(mention)) == {**mention, 'fact_value': mention['fact_value'] or {}}
    report['checks'].update(routeIdentityPreservedWithGenericPlanFactsExcluded=True)
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
