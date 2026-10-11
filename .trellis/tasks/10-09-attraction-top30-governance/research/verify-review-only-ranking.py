"""边界审核只改变潜在风险标签；确认既有技术验证仍覆盖同一210项。"""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
def load(name): return json.loads((ROOT / name).read_bytes())
old, new = load('seven-cities-ranking-10.json'), load('seven-cities-ranking-11.json')
assert old['snapshotSha256'] == new['snapshotSha256'] and old['cityScope'] == new['cityScope']
fields = ['entityId', 'name', 'revision', 'aliases', 'legacyIds', 'sourceIds', 'score', 'downstreamScore',
          'mentionIds', 'effectiveType', 'hasCoordinates', 'rank']
for before, after in zip(old['cities'], new['cities']):
    assert before['city'] == after['city']
    assert [{k: p[k] for k in fields} for p in before['top30']] == [{k: p[k] for k in fields} for p in after['top30']]
for file in ['seven-cities-catalog-05.json', 'seven-cities-retrieval-04.json']:
    report = load(file)
    assert report['passed'] and report['snapshotSha256'] == new['snapshotSha256'] and len(report['rows']) == 210
flow = load('seven-cities-flow-coverage-03.json')
assert flow['passed'] and flow['temporaryDatabaseRemoved']
assert flow['rankingSha256'] == hashlib.sha256((ROOT / 'seven-cities-ranking-10.json').read_bytes()).hexdigest()
for city in new['cities']:
    row = next(c for c in flow['cities'] if c['city'] == city['city'])
    assert row['ids'] == [p['entityId'] for p in city['top30']]
report = {'passed': True, 'businessMutation': False, 'ranking': 'seven-cities-ranking-11.json',
    'snapshotSha256': new['snapshotSha256'], 'previousRanking': 'seven-cities-ranking-10.json',
    'comparedFields': fields, 'top30IdentitiesScoresAndConsumptionInputsUnchanged': True,
    'verifiedEntities': 210, 'nonEquivalentMentionReviews': 10,
    'rankUncertaintyBefore': sum(len(c['rankAffectingUncertainty']) for c in old['cities']),
    'rankUncertaintyAfter': sum(len(c['rankAffectingUncertainty']) for c in new['cities']),
    'reusedTechnicalReports': ['seven-cities-catalog-05.json', 'seven-cities-retrieval-04.json', 'seven-cities-flow-coverage-03.json'],
    'limits': '不更改原提及和历史待审，只明确其不等同母项，故不构成母项潜在加分；技术消费目标保持，未重复运行全套。'}
with (ROOT / 'seven-cities-ranking-review-only-01.json').open('x', encoding='utf-8') as handle:
    json.dump(report, handle, ensure_ascii=False, indent=2)
for name in ['10-09-attraction-top30-governance', '10-06-place-identity-governance']:
    path = ROOT.parents[1] / name / 'task.json'
    task = json.loads(path.read_bytes())
    task['notes'] = task['notes'].replace('ranking-10', 'ranking-11').replace('仍有15个潜在排名边界记录',
        '10条非同体提及边界已绑定原文且原待审保持；仍有9个潜在排名边界记录')
    task['meta']['sevenCityContinuation']['ranking'] = '10-09-attraction-top30-governance/research/seven-cities-ranking-11.json'
    assert task['status'] == 'in_progress' and not task['meta']['sevenCityContinuation']['accepted']
    path.write_text(json.dumps(task, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'passed': True, 'targetsUnchanged': 210, 'rankUncertainty': report['rankUncertaintyAfter']}))
