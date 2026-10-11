"""九溪家族保持独立，只隔离公交站与酒店邻近参照；不合并线路和景观点。"""
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

BARE = '810fa1131a4f6e1d80351cd94d74af7d'
STREAM = '081c7742f47eaa80675fc74446ed89e2'
SMOKE = 'b1fe60915782867d914bff2db22b960d'
runner.CITY, runner.BATCH = '杭州', 'batch-97'
runner.SNAPSHOT = ROOT / 'snapshot-20261009T190946794061Z/input.json'
runner.EXTRAS = ROOT / 'hangzhou-scope-01-extras.json'
runner.BASELINE = ROOT / 'hangzhou-scope-01-baseline.json'
runner.TARGETS, runner.UNASSIGNED = {BARE, STREAM}, {8750, 9336}
runner.FORBIDDEN_PHRASES = ['徒步起点，沿溪而行，绿意包裹', '绿意盎然，适合徒步吸氧，上午去更舒适']


def inputs():
    raw = runner.SNAPSHOT.read_bytes()
    frozen = next(c for c in json.loads(raw)['cities'] if c['city'] == '杭州')
    assert not frozen['scopes'] and not frozen['assignments']
    entities = {e['entity_id']: e for e in frozen['entities']}
    sources = {s['id']: s for s in frozen['sources']}
    quotes = [
        (2246, '1️⃣\xa0九溪(公交站)\n2️⃣\xa0九溪十八涧'),
        (2099, '第[二R]家｜龙井村茶园山野民宿'),
        (2099, '有泳池、小院和公共茶室，步行能去九溪十八涧、满觉陇'),
        (1940, '九溪公交站 → 九溪烟树 → 九溪十八涧 → 龙井村'),
        (1940, '九溪烟树（核心打卡点） 标志性的小瀑布+碧水+翠枫'),
        (1940, '九溪十八涧 踩着溪中的石墩一路向前'),
        (2254, '沿着九溪十八涧一路走到九溪烟树'),
        (2089, '路线：九溪公交站出发 → 九溪烟树 → 九溪十八涧 → 龙井村'),
    ]
    for nid, quote in quotes:
        assert quote in frozen['notes'][str(nid)]['note_desc'], nid
    evidence = [{'kind': 'reviewed_attraction_source_scope', 'snapshotSha256': hashlib.sha256(raw).hexdigest(),
        'file': str(Path(__file__).relative_to(ROOT.parents[3])),
        'noteQuotes': [{'noteId': n, 'quote': q} for n, q in quotes],
        'conclusion': '8750的原文明确是九溪公交站，null待审，不计景观推荐。9336的唯一明确十八涧名称是民宿步行范围，泛指九溪绿意/上午建议不足以确定十八涧推荐，null待审；不是仅凭酒店标题排除。其余7条裸名九溪、11条十八涧保持原归属及作者正负体验。多篇同一路线分别列公交站、九溪烟树瀑布潭水节点和十八涧溪涧路段，不作同义合并，不创建正式part_of、公交站、民宿或机位主体。九溪烟树和亲水区原根完全保持；裸名区域边界尚不明确，不声称整家族语义已完结。'}]
    scopes, expected = [], []
    for eid, sid, total, expected_score in [(BARE, 4049, 8, 22.5), (STREAM, 4105, 12, 32.05)]:
        entity = entities[eid]
        assert entity['revision'] == 1 and entity['primary_place_id'] == sid
        rows = [m for m in frozen['mentions'] if m['entityId'] == eid]
        assert len(rows) == total
        scopes.append({'key': f'top30-20261010-batch-97-scope-{sid}', 'city': '杭州', 'sourcePlaceId': sid,
            'expectedSourceHash': source_fingerprint(sources[sid]), 'expectedScopeRevision': 0,
            'expectedRevisions': {eid: 1}, 'assignments': [{'mentionId': m['id'], 'inputHash': m['inputHash'],
                'entityId': None if m['id'] in runner.UNASSIGNED else eid} for m in rows], 'evidence': evidence})
        own = [m for m in rows if m['id'] not in runner.UNASSIGNED]
        metrics = recommendation_metrics(own)
        assert metrics['recommendScore'] == expected_score
        expected.append({'city': '杭州', 'id': eid, 'name': entity['canonical_name'], 'revision': 2,
            'verified': True, 'mentionIds': [m['id'] for m in own], **metrics})
    return frozen, scopes, expected


original_apply_checked = runner.apply_checked


async def apply_checked(session, frozen, scopes, expected):
    report = await original_apply_checked(session, frozen, scopes, expected)
    catalog = await load_mention_catalog(session, '杭州')
    own_ids = {mid for p in expected for mid in p['mentionIds']}
    for mention in await load_mention_rows(session, '杭州'):
        if mention['id'] in own_ids:
            assert effective_mention(mention, catalog.resolve(mention)) == {**mention, 'fact_value': mention['fact_value'] or {}}
    assert 8463 in own_ids  # 雨天青苔湿石警示保留。
    assert catalog.catalog.entities[SMOKE] == next(e for e in frozen['entities'] if e['entity_id'] == SMOKE)
    report['checks'].update(otherAssignedFactsAndWarningsPreserved=True, smokeNodeNotMerged=True)
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
