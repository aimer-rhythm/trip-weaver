"""保存97/98批最终验证及接续状态，不提交、归档或完成任务。"""
import ast
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PARENT = ROOT.parents[1] / '10-06-place-identity-governance'
FLOW = PARENT / 'research/all-cities/flow/run-87'
ranking_bytes = (ROOT / 'seven-cities-ranking-17.json').read_bytes()
ranking = json.loads(ranking_bytes)
old_ranking = json.loads((ROOT / 'seven-cities-ranking-16.json').read_bytes())
flow = json.loads((FLOW / 'report.json').read_bytes())
assert not flow['failures'] and json.loads((FLOW / 'cleanup.json').read_bytes())['removed']
assert (FLOW / 'target-ranking.json').read_bytes() == ranking_bytes
assert all(p['score'] == p['downstreamScore'] for c in ranking['cities'] for p in c['top30'])
cities = []
for city in ranking['cities']:
    old = next(c for c in old_ranking['cities'] if c['city'] == city['city'])
    assert {p['entityId'] for p in old['top30']} == {p['entityId'] for p in city['top30']}
    coverage = next(c['targetCoverage'] for c in flow['cities'] if c['city'] == city['city'])
    assert coverage['requested'] == coverage['passed'] == 30
    assert coverage['snapshotSha256'] == ranking['snapshotSha256']
    assert coverage['ids'] == [p['entityId'] for p in city['top30']]
    cities.append({'city': city['city'], **coverage})
for name in ['seven-cities-catalog-10.json', 'seven-cities-retrieval-08.json']:
    result = json.loads((ROOT / name).read_bytes())
    assert result['passed'] and result['snapshotSha256'] == ranking['snapshotSha256']
preservation = json.loads((ROOT / 'seven-cities-preservation-09.json').read_bytes())
assert preservation['passed'] and preservation['afterSha256'] == ranking['snapshotSha256']
for batch in ['batch-97', 'batch-98']:
    directory = PARENT / f'research/all-cities/{batch}/sync-01'
    state = json.loads((directory / 'sync-state.json').read_bytes())
    assert all(c.get('importedAt') and c.get('relationsImportedAt') and c.get('embeddingRunAt') for c in state['cities'].values())
    checks = list(directory.glob('post-import-check-*.json'))
    assert checks and all(not json.loads(p.read_bytes())['failures'] for p in checks)
with (ROOT / 'seven-cities-flow-coverage-07.json').open('x', encoding='utf-8') as handle:
    json.dump({'passed': True, 'run': 'run-87', 'ranking': 'seven-cities-ranking-17.json',
        'rankingSha256': hashlib.sha256(ranking_bytes).hexdigest(), 'failures': 0,
        'temporaryDatabaseRemoved': True, 'cities': cities,
        'limits': '七城210项身份候选/排程/保存/编辑/重访；其它城市仅兼容回归，未验证外部地图及路线可行性。'}, handle, ensure_ascii=False, indent=2)
syntax_files = ['govern-jiuxi-scopes.py', 'govern-raffles-scope.py',
    'record-batch98-boundaries.py', 'record-batch98-validation.py']
for name in syntax_files:
    ast.parse((ROOT / name).read_text(encoding='utf-8'))
notes = ('第97/98批已应用、双同步并完成事后核验，无待同步。九溪隔离公交站提及，7提及22.5分；'
    '九溪十八涧隔离民宿步行参照，11提及32.05分。来福士隔离4条外部机位和1条商场评价，'
    '保留1207路线身份、排除机位reason/evidence_text，7提及22.5分，重排重庆第30名。'
    '没有新增补位；ranking17及台账08七城210项分差0。catalog10的6911项、retrieval08的210覆盖'
    '（2新测/208完整行复用）及flow87的210目标通过。两批3条实体记录变化，4036原来源、8798提及、'
    '1051笔记、3737旧行、330旧媒体字段、201行程及旧范围分配保全；新增3scope/32分配。'
    '24回归测试、9同步契约测试通过。39条非同体边界；仍6项算法排名风险和6处缺坐标，完整语义未完成。'
    '下一业务批次99。未验收、不提交、不归档。')
for path in [ROOT.parent / 'task.json', PARENT / 'task.json']:
    task = json.loads(path.read_bytes())
    assert task['status'] == 'in_progress' and task['completedAt'] is None
    task['notes'] = notes
    task['meta']['sevenCityContinuation'].update(latestEntityBatch=98, latestFlowRun=87,
        pendingSyncBatches=[], ranking='10-09-attraction-top30-governance/research/seven-cities-ranking-17.json',
        accepted=False, latestAppliedBatches=['batch-97', 'batch-98'])
    path.write_text(json.dumps(task, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'flowTargets': sum(c['passed'] for c in cities), 'syntaxFiles': len(syntax_files),
    'tasksRemainInProgress': True, 'nextBatch': 99}))
