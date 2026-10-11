"""兴庆宫公园隔离重复的爱心树负评；独立爱心树及原评价保持。"""
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

TARGET = 'f54a5c3ac9f95600f01e2c41b0dc5860'
TREE = 'e642c6ca58a8a96f1a5d3c442391b241'
runner.CITY, runner.BATCH = '西安', 'batch-100'
runner.SNAPSHOT = ROOT / 'snapshot-20261009T192058158076Z/input.json'
runner.EXTRAS = ROOT / 'xian-scope-04-extras.json'
runner.BASELINE = ROOT / 'xian-scope-04-baseline.json'
runner.TARGETS, runner.UNASSIGNED = {TARGET}, {12266}
runner.FORBIDDEN_PHRASES = ['除了爱心树拍照打卡，没啥东西，可不去', '除了拍照打卡，没啥东西，可以不去']


def inputs():
    raw = runner.SNAPSHOT.read_bytes()
    frozen = next(c for c in json.loads(raw)['cities'] if c['city'] == '西安')
    entity = next(e for e in frozen['entities'] if e['entity_id'] == TARGET)
    assert entity['revision'] == 3 and entity['primary_place_id'] == 5809
    assert not any(TARGET in s['entity_ids'] for s in frozen['scopes'])
    source_ids = {int(sid) for sid, eid in frozen['members'].items() if eid == TARGET}
    assert source_ids == {5585, 5809}
    rows = [m for m in frozen['mentions'] if m['entityId'] == TARGET]
    assert {m['id'] for m in rows} == {12041, 12266, 12317, 12536}
    assert next(m for m in frozen['mentions'] if m['id'] == 11883)['entityId'] == TREE
    quotes = [(2628, '④兴庆宫爱心树（除了拍照打卡，没啥东西，可以不去）'),
        (2632, '小唐风汉服妆造+兴庆宫拍照+三根电杆陕菜馆+阿丽娅拌面馆'),
        (2712, '兴庆宫拍妆造（沉香亭｜迎春桥）'),
        (2761, '兴庆宫公园\n唐代皇家园林，满园桂香，湖边银杏红枫搭配仿唐亭台，傍晚光影绝美。')]
    for nid, quote in quotes:
        assert quote in frozen['notes'][str(nid)]['note_desc']
    evidence = [{'kind': 'reviewed_attraction_source_scope', 'snapshotSha256': hashlib.sha256(raw).hexdigest(),
        'file': str(Path(__file__).relative_to(ROOT.parents[3])),
        'noteQuotes': [{'noteId': n, 'quote': q} for n, q in quotes],
        'conclusion': '12266将爱心树负评错抽到公园，null待审；同篇11883原已归独立爱心树，身份、负评、原文全保持，不重复分配也不创建新树。12041/12317实际到兴庆宫拍照且商户妆造与公园行程分别列出，不因妆造一词误判为服务评价。12536明确公园景观。保留公园原全简称归一、旧ID及主位置，不把树/亭/桥并入公园别名。'}]
    sources = {s['id']: s for s in frozen['sources']}
    scope = {'key': 'top30-20261010-batch-100-xingqing-scope', 'city': '西安', 'sourcePlaceId': 5809,
        'expectedSourceHash': source_fingerprint(sources[5809]), 'expectedScopeRevision': 0,
        'sources': [{'sourcePlaceId': sid, 'sourceHash': source_fingerprint(sources[sid])} for sid in sorted(source_ids)],
        'expectedRevisions': {TARGET: 3}, 'assignments': [{'mentionId': m['id'], 'inputHash': m['inputHash'],
            'entityId': None if m['id'] in runner.UNASSIGNED else TARGET} for m in rows], 'evidence': evidence}
    own = [m for m in rows if m['id'] not in runner.UNASSIGNED]
    metrics = recommendation_metrics(own)
    assert metrics == {'mentionCount': 3, 'recommendScore': 12.5}
    return frozen, [scope], [{'city': '西安', 'id': TARGET, 'name': entity['canonical_name'], 'revision': 4,
        'verified': True, 'mentionIds': [m['id'] for m in own], **metrics}]


original_apply_checked = runner.apply_checked


async def apply_checked(session, frozen, scopes, expected):
    report = await original_apply_checked(session, frozen, scopes, expected)
    catalog = await load_mention_catalog(session, '西安')
    for mention in await load_mention_rows(session, '西安'):
        if mention['id'] in [11883, *expected[0]['mentionIds']]:
            assert effective_mention(mention, catalog.resolve(mention)) == {**mention, 'fact_value': mention['fact_value'] or {}}
        if mention['id'] == 11883:
            assert catalog.resolve(mention)['entity']['entity_id'] == TREE
    assert catalog.catalog.entities[TREE] == next(e for e in frozen['entities'] if e['entity_id'] == TREE)
    report['checks'].update(independentTreeAndNegativeReviewPreserved=True, otherAssignedFactsPreserved=True)
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
