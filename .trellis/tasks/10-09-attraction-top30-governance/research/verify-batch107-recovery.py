"""核对回滚后的七城全快照；新增失败决定只保留在审计历史中。"""
import copy
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
B = ROOT.parents[1] / '10-06-place-identity-governance/research/all-cities'
before_path = ROOT / 'snapshot-20261009T213645389978Z/input.json'
after_path = ROOT / 'snapshot-20261009T220123759512Z/input.json'
before, after = [json.loads(p.read_bytes()) for p in [before_path, after_path]]
assert before['tripsDigest'] == after['tripsDigest']
count = {}
for old, new in zip(before['cities'], after['cities']):
    assert old['city'] == new['city']
    old, new = copy.deepcopy(old), copy.deepcopy(new)
    previous = old.pop('changes')
    actual = new.pop('changes')
    if old['city'] == '厦门':
        extras = [c for c in actual if c['change_key'].startswith('top30-20261010-batch-107-')]
        assert len(extras) == 2
        actual = [c for c in actual if c not in extras]
    assert actual == previous
    for key in ['entities', 'scopes', 'assignments']:
        id_key = {'entities':'entity_id','scopes':'place_id','assignments':'mention_id'}[key]
        old[key] = {row[id_key]: row for row in old[key]}
        new[key] = {row[id_key]: row for row in new[key]}
    assert old == new, old['city']
    for key in ['sources','mentions','notes','downstream']:
        count[key] = count.get(key, 0) + len(old[key])
for side in ['upstream','downstream']:
    report = json.loads((ROOT / f'batch-107-{side}-recovery-applied.json').read_bytes())
    assert report['passed'] and report['apply']
report = {'batch':'batch-107', 'rolledBack':True, 'passed':True,
    'beforeSha256':hashlib.sha256(before_path.read_bytes()).hexdigest(),
    'afterSha256':hashlib.sha256(after_path.read_bytes()).hexdigest(),
    'sevenCitiesRestored':True, 'additionalAuditDecisions':2, **count,
    'tripsPreserved':before['tripsDigest']['count'],
    'reason':'完整scope清除下游独有旧封面和1图，已通过双端审计API逆序恢复。原决定及预演保留为失败历史，不再同步或计为当前治理成果。'}
for path in [ROOT / 'batch-107-recovery-verification.json', B / 'batch-107-rolled-back.json']:
    with path.open('x',encoding='utf-8') as file:
        json.dump(report,file,ensure_ascii=False,indent=2)
print(json.dumps(report,ensure_ascii=False))
