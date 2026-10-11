"""保存95/96-v2最终验证及接续状态；不提交、不归档、不完成任务。"""
import ast
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PARENT = ROOT.parents[1] / '10-06-place-identity-governance'
FLOW = PARENT / 'research/all-cities/flow/run-86'
ranking_bytes = (ROOT / 'seven-cities-ranking-16.json').read_bytes()
ranking = json.loads(ranking_bytes)
flow = json.loads((FLOW / 'report.json').read_bytes())
assert not flow['failures'] and json.loads((FLOW / 'cleanup.json').read_bytes())['removed']
assert (FLOW / 'target-ranking.json').read_bytes() == ranking_bytes
assert all(p['score'] == p['downstreamScore'] for c in ranking['cities'] for p in c['top30'])
cities = []
for city in ranking['cities']:
    coverage = next(c['targetCoverage'] for c in flow['cities'] if c['city'] == city['city'])
    assert coverage['requested'] == coverage['passed'] == 30
    assert coverage['snapshotSha256'] == ranking['snapshotSha256']
    assert coverage['ids'] == [p['entityId'] for p in city['top30']]
    cities.append({'city': city['city'], **coverage})
for name in ['seven-cities-catalog-09.json', 'seven-cities-retrieval-07.json']:
    result = json.loads((ROOT / name).read_bytes())
    assert result['passed'] and result['snapshotSha256'] == ranking['snapshotSha256']
preservation = json.loads((ROOT / 'seven-cities-preservation-08.json').read_bytes())
assert preservation['passed'] and preservation['afterSha256'] == ranking['snapshotSha256']
for batch in ['batch-95', 'batch-96-v2']:
    directory = PARENT / f'research/all-cities/{batch}/sync-01'
    state = json.loads((directory / 'sync-state.json').read_bytes())
    assert all(c.get('importedAt') and c.get('relationsImportedAt') and c.get('embeddingRunAt') for c in state['cities'].values())
    checks = list(directory.glob('post-import-check-*.json'))
    assert checks and all(not json.loads(p.read_bytes())['failures'] for p in checks)
with (ROOT / 'seven-cities-flow-coverage-06.json').open('x', encoding='utf-8') as handle:
    json.dump({'passed': True, 'run': 'run-86', 'ranking': 'seven-cities-ranking-16.json',
        'rankingSha256': hashlib.sha256(ranking_bytes).hexdigest(), 'failures': 0,
        'temporaryDatabaseRemoved': True, 'cities': cities,
        'limits': '七城210项身份候选/排程/保存/编辑/重访；其它城市仅兼容回归，未验证外部地图及路线可行性。'}, handle, ensure_ascii=False, indent=2)
syntax_files = ['rank.py', 'test_rank.py', 'render-seven-review.py', 'govern-disney-scopes.py',
    'govern-reviewed-scopes.py', 'record-batch96-boundaries.py', 'record-batch96-validation.py']
for name in syntax_files:
    ast.parse((ROOT / name).read_text(encoding='utf-8'))
notes = ('第90—96-v2批治理已应用、双同步并完成事后核验，无待同步。'
    '苏州河隔离酒店参照，3提及12.5分；大唐不夜城隔离5条机位/摄影服务，24提及63.5分，显式保持原娱乐类别。'
    '当前ranking16及台账07七城210项分差0；catalog09的6911项、retrieval07的210覆盖（2新测/208完整行复用）与flow86的210目标通过。'
    '七批累计10条实体记录变化，4036原来源、8798提及、1051笔记、3737旧行、309旧媒体字段、201行程及旧范围分配保全。'
    '24测试/29子测试、9同步契约测试通过。32条非同体边界；仍6项排名风险和6处缺坐标，完整语义未完成。'
    '保留96首轮分类漂移失败；下一批97。未验收、不提交、不归档。')
for path in [ROOT.parent / 'task.json', PARENT / 'task.json']:
    task = json.loads(path.read_bytes())
    assert task['status'] == 'in_progress' and task['completedAt'] is None
    task['notes'] = notes
    task['meta']['sevenCityContinuation'].update(latestEntityBatch=96, latestFlowRun=86,
        pendingSyncBatches=[], ranking='10-09-attraction-top30-governance/research/seven-cities-ranking-16.json',
        accepted=False, latestAppliedBatches=['batch-95', 'batch-96-v2'])
    path.write_text(json.dumps(task, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
previous = json.loads((ROOT / 'seven-cities-next-evidence-04.json').read_bytes())
for entry in previous['evidence']:
    if entry['mentionId'] == 12019:
        entry['currentState'] = '原市场主体只读、负评和review382保持；范围未确认，未合并'
    else:
        entry['appliedBatch'] = 'batch-95' if entry['city'] == '上海' else 'batch-96-v2'
        entry['currentState'] = '已通过正式scope隔离为null待审；旧建议保留为历史证据'
previous.update(snapshotSha256=ranking['snapshotSha256'], previousEvidence='seven-cities-next-evidence-04.json',
    nextBatch=97, nextReview=['上海城隍庙10128及豫园组合review28', '苏州河/步道/河畔的段落边界review6',
        '厦门母步道/林海线/天泉段的范围175/176/192及广场207', '成都蜀锦两馆313缺裸名馆址证据',
        '西安大唐不夜城夜市382范围', '杭州九溪、重庆来福士以及七城其余Top30逐项语义复核'])
with (ROOT / 'seven-cities-next-evidence-05.json').open('x', encoding='utf-8') as handle:
    json.dump(previous, handle, ensure_ascii=False, indent=2)
with (ROOT / 'batch96-category-attempts.json').open('x', encoding='utf-8') as handle:
    json.dump({'first': {'batch': 'batch-96', 'applied': False, 'preview': 'preview-01',
        'reason': '完整scope清空未治理旧themes，产品类别由娱乐回落文化，类别保全断言拦截；业务未应用。'},
        'final': {'batch': 'batch-96-v2', 'applied': True, 'preview': 'preview-01',
            'scopeRevision': 2, 'finalEntityRevision': 3, 'category': '娱乐',
            'resolution': 'scope后以版本化实体API显式保留原类别，两个决定在同一事务；幂等、逆序回滚及整城恢复通过。'},
        'noOldArtifactsOverwritten': True}, handle, ensure_ascii=False, indent=2)
print(json.dumps({'flowTargets': sum(c['passed'] for c in cities), 'syntaxFiles': len(syntax_files),
    'tasksRemainInProgress': True, 'nextBatch': 97}))
