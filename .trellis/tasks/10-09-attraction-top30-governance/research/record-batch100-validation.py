"""汇总97—100正式批次及本轮阅读；始终保留未验收状态。"""
import ast
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PARENT = ROOT.parents[1] / '10-06-place-identity-governance'
FLOW = PARENT / 'research/all-cities/flow/run-88'
ranking_bytes = (ROOT / 'seven-cities-ranking-18.json').read_bytes()
ranking = json.loads(ranking_bytes)
previous = json.loads((ROOT / 'seven-cities-ranking-16.json').read_bytes())
flow = json.loads((FLOW / 'report.json').read_bytes())
assert not flow['failures'] and json.loads((FLOW / 'cleanup.json').read_bytes())['removed']
assert (FLOW / 'target-ranking.json').read_bytes() == ranking_bytes
cities = []
for city in ranking['cities']:
    old = next(c for c in previous['cities'] if c['city'] == city['city'])
    assert {p['entityId'] for p in old['top30']} == {p['entityId'] for p in city['top30']}
    assert all(p['score'] == p['downstreamScore'] for p in city['top30'])
    coverage = next(c['targetCoverage'] for c in flow['cities'] if c['city'] == city['city'])
    assert coverage['requested'] == coverage['passed'] == 30
    assert coverage['snapshotSha256'] == ranking['snapshotSha256']
    assert coverage['ids'] == [p['entityId'] for p in city['top30']]
    cities.append({'city': city['city'], **coverage})
for name in ['seven-cities-catalog-11.json', 'seven-cities-retrieval-09.json']:
    result = json.loads((ROOT / name).read_bytes())
    assert result['passed'] and result['snapshotSha256'] == ranking['snapshotSha256']
preservation = json.loads((ROOT / 'seven-cities-preservation-10.json').read_bytes())
assert preservation['passed'] and preservation['afterSha256'] == ranking['snapshotSha256']
batches = ['batch-97', 'batch-98', 'batch-99-v2', 'batch-100']
assert preservation['batches'] == batches
for batch in batches:
    directory = PARENT / f'research/all-cities/{batch}/sync-01'
    state = json.loads((directory / 'sync-state.json').read_bytes())
    assert all(c.get('importedAt') and c.get('relationsImportedAt') and c.get('embeddingRunAt') for c in state['cities'].values())
    checks = list(directory.glob('post-import-check-*.json'))
    assert checks and all(not json.loads(p.read_bytes())['failures'] for p in checks)
with (ROOT / 'seven-cities-flow-coverage-08.json').open('x', encoding='utf-8') as handle:
    json.dump({'passed': True, 'run': 'run-88', 'ranking': 'seven-cities-ranking-18.json',
        'rankingSha256': hashlib.sha256(ranking_bytes).hexdigest(), 'failures': 0,
        'temporaryDatabaseRemoved': True, 'cities': cities,
        'limits': '七城210项身份候选/排程/保存/编辑/重访；其它城市仅兼容回归，不证明外部地图及路线可行性。'}, handle, ensure_ascii=False, indent=2)
for name in ['govern-disney-scopes.py', 'govern-tianzifang-scope.py', 'govern-xingqing-scope.py',
             'record-batch100-boundaries.py', 'record-batch100-validation.py', 'record-semantic-readthrough.py']:
    ast.parse((ROOT / name).read_text(encoding='utf-8'))
notes = ('第97、98、99-v2、100批已应用、双同步并完成事后核验，无待同步。'
    '九溪/十八涧隔离公交站和民宿参照；来福士隔离机位/商场，保留1207路线身份。'
    '田子坊11245保留身份，仅排除整份路线reason/evidence_text；兴庆宫12266爱心树负评隔离，原11883及独立树保持。'
    'ranking18及台账09各210项、分差0，无新增补位；catalog11的6911项、retrieval09的210覆盖'
    '（2新测/208完整行复用）、flow88的210目标通过。四批5条实体变化，4036来源、8798提及、1051笔记、'
    '3737旧行、330旧媒体字段、201行程及旧范围分配保全；新增5scope/39分配。'
    '24回归、10同步契约测试及研究typecheck通过。40条非同体边界；9项/23有效提及原文阅读单列，完整事实未审完。'
    '仍6项算法排名风险及6处缺坐标；下一批101。未验收、不提交、不归档。')
for path in [ROOT.parent / 'task.json', PARENT / 'task.json']:
    task = json.loads(path.read_bytes())
    assert task['status'] == 'in_progress' and task['completedAt'] is None
    task['notes'] = notes
    task['meta']['sevenCityContinuation'].update(latestEntityBatch=100, latestFlowRun=88,
        pendingSyncBatches=[], ranking='10-09-attraction-top30-governance/research/seven-cities-ranking-18.json',
        accepted=False, latestAppliedBatches=batches,
        semanticReadthrough='10-09-attraction-top30-governance/research/seven-cities-semantic-readthrough-01.json')
    path.write_text(json.dumps(task, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
with (ROOT / 'batch99-100-attempt-notes.json').open('x', encoding='utf-8') as handle:
    json.dump({'batch99Applied': False, 'failedPreviews': {
        'preview-01': '旧scope/分配记录查询次序不同，列表比较误拒；实体全等。',
        'preview-02': '再次确认实体全等，失败仍来自旧scope/分配列表顺序。',
        'preview-03': '键集合及每行全等诊断通过，确认仅查询顺序不同。',
        'preview-04': '按键完整比较后通过旧范围保护；事实摘录未包含田子坊主体，被既有契约拒绝。'},
        'final': '99-v2/preview-01扩大原文摘录至田子坊路线行，预演、幂等、逆序回滚、实库审计和双同步通过。',
        'batch100Sync': '初次export/preview入口只接受两位批次号，尚未导出；统一受控批次名验证器支持三位及以上，仍拒绝路径穿越，10测试通过后正常执行。',
        'typecheck': '新增JS验证器首次缺TS声明，补sync-contract.d.mts后研究typecheck通过。',
        'oldArtifactsPreserved': True, 'businessTablesNotPatched': True}, handle, ensure_ascii=False, indent=2)
print(json.dumps({'flowTargets': 210, 'nextBatch': 101, 'tasksRemainInProgress': True}))
