"""记录batch-121回滚与广州保全结论，保持任务in_progress。"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PARENT = ROOT.parents[1] / '10-06-place-identity-governance'
note = ('batch-121广州永庆坊隔离预演全绿后已应用、又因无法声明旧运营保全整批逆序回滚；'
    '`operational_preservation.py`要求非空且顺序一致的图片文字来源，广州`imageNoteOrder`为空，'
    'scope-only批次无法满足`preservedOperations>=1`。广州暂不做来源隔离scope，保持只读，'
    '广州塔8100/8108/8133/7693与永庆坊7694作为待决项留在名单与台账。未验收、不提交、不归档。')
for path in [ROOT.parent / 'task.json', PARENT / 'task.json']:
    task = json.loads(path.read_bytes())
    assert task['status'] == 'in_progress' and task['completedAt'] is None
    task['notes'] = task['notes'] + ' ' + note
    continuation = task['meta']['sevenCityContinuation']
    continuation.update(workingStage=note, accepted=False, pendingSyncBatches=[])
    for key, value in [('rolledBackBatches', 'batch-121'), ('heldPreviewBatches', 'batch-121')]:
        current = continuation.get(key, [])
        if value not in current:
            current.append(value)
        continuation[key] = current
    path.write_text(json.dumps(task, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'updated': True, 'rolledBack': ['batch-107', 'batch-121'], 'accepted': False}, ensure_ascii=False))
