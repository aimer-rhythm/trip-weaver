"""汇总已完成验证并更新任务断点；不提交、归档或完成任务。"""
import ast
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PARENT = ROOT.parents[1] / '10-06-place-identity-governance'
FLOW = PARENT / 'research/all-cities/flow/run-83'
ranking_bytes = (ROOT / 'seven-cities-ranking-12.json').read_bytes()
ranking = json.loads(ranking_bytes)
flow = json.loads((FLOW / 'report.json').read_bytes())
assert not flow['failures'] and json.loads((FLOW / 'cleanup.json').read_bytes())['removed']
assert (FLOW / 'target-ranking.json').read_bytes() == ranking_bytes
cities = []
for city in ranking['cities']:
    coverage = next(c['targetCoverage'] for c in flow['cities'] if c['city'] == city['city'])
    assert coverage['requested'] == coverage['passed'] == 30
    assert coverage['snapshotSha256'] == ranking['snapshotSha256']
    assert coverage['ids'] == [p['entityId'] for p in city['top30']]
    cities.append({'city': city['city'], **coverage})
with (ROOT / 'seven-cities-flow-coverage-04.json').open('x', encoding='utf-8') as f:
    json.dump({'passed': True, 'run': 'run-83', 'ranking': 'seven-cities-ranking-12.json',
        'rankingSha256': hashlib.sha256(ranking_bytes).hexdigest(), 'failures': 0,
        'temporaryDatabaseRemoved': True, 'cities': cities,
        'limits': '七城210项身份候选/排程/保存/编辑/重访；其他城市仅兼容回归。无外部地图及路线可行性验收。'}, f, ensure_ascii=False, indent=2)
for filename in ['freeze-scope-baseline.py', 'govern-chongqing-liziba.py', 'record-seven-boundaries-02.py',
                 'verify-retrieval-reuse.py', 'record-batch89-validation.py']:
    ast.parse((ROOT / filename).read_text(encoding='utf-8'))
notes = ('第89批李子坝/轻轨穿楼/轻轨站归一，30有效提及、75.67分，1条换乘待审，1条泛化预约三字段排除；'
         '地点关系及向量双同步完成，无待同步。广州塔广场仅退出景点配额（原32名），类型审核14项。'
         'ranking12七城各30、分差0；6907目录检查、210召回覆盖（2新测/208完整行复用）、flow83的210目标通过。'
         '原4036源、8798提及、1051笔记、3737旧行、306图片字段、201行程及旧scope分配保持。'
         '23测试/24子测试通过。九溪及来福士新增边界证据未改业务；仍9项排名风险、6处缺坐标，完整语义未完成，未验收不提交归档。')
for task_path in [ROOT.parent / 'task.json', PARENT / 'task.json']:
    task = json.loads(task_path.read_bytes())
    assert task['status'] == 'in_progress' and task['completedAt'] is None
    task['notes'] = notes
    task['meta']['sevenCityContinuation'].update(latestEntityBatch=89, latestFlowRun=83,
        pendingSyncBatches=[], ranking='10-09-attraction-top30-governance/research/seven-cities-ranking-12.json',
        accepted=False, latestAppliedBatches=['batch-89'])
    task_path.write_text(json.dumps(task, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'flowTargets': sum(c['passed'] for c in cities), 'syntaxFiles': 5, 'tasksRemainInProgress': True}))
