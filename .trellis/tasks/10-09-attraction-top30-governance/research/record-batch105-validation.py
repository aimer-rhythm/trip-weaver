"""105批验证与续做断点；不把技术通过或部分阅读记作验收。"""
import ast
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PARENT = ROOT.parents[1] / '10-06-place-identity-governance'
B = PARENT / 'research/all-cities'
SOURCE = 'snapshot-20261009T212651757971Z/input.json'


def read(path):
    return json.loads(path.read_bytes())


def write(name, value):
    with (ROOT / name).open('x', encoding='utf-8') as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)


raw = (ROOT / SOURCE).read_bytes()
snapshot = json.loads(raw)
sha = hashlib.sha256(raw).hexdigest()
ranking_raw = (ROOT / 'seven-cities-ranking-22.json').read_bytes()
ranking = json.loads(ranking_raw)
assert ranking['snapshotSha256'] == sha
previous = read(ROOT / 'seven-cities-ranking-21.json')
flow = read(B / 'flow/run-92/report.json')
assert not flow['failures'] and read(B / 'flow/run-92/cleanup.json')['removed']
assert (B / 'flow/run-92/target-ranking.json').read_bytes() == ranking_raw
coverage = []
for city in ranking['cities']:
    old = next(c for c in previous['cities'] if c['city'] == city['city'])
    assert {p['entityId'] for p in old['top30']} == {p['entityId'] for p in city['top30']}
    assert all(p['score'] == p['downstreamScore'] for p in city['top30'])
    item = next(c['targetCoverage'] for c in flow['cities'] if c['city'] == city['city'])
    assert item['requested'] == item['passed'] == 30 and item['snapshotSha256'] == sha
    assert item['ids'] == [p['entityId'] for p in city['top30']]
    coverage.append({'city': city['city'], **item})
for name in ['seven-cities-catalog-15.json', 'seven-cities-retrieval-13.json']:
    result = read(ROOT / name)
    assert result['passed'] and result['snapshotSha256'] == sha
preservation = read(ROOT / 'seven-cities-preservation-14.json')
assert preservation['passed'] and preservation['afterSha256'] == sha and preservation['batches'] == ['batch-104', 'batch-105']
folder = B / 'batch-105/sync-01'
state = read(folder / 'sync-state.json')
assert all(c.get('importedAt') and c.get('relationsImportedAt') and c.get('embeddingRunAt') for c in state['cities'].values())
checks = list(folder.glob('post-import-check-*.json'))
assert checks and all(not read(p)['failures'] for p in checks)
write('seven-cities-flow-coverage-12.json', {'passed': True, 'run': 'run-92', 'ranking': 'seven-cities-ranking-22.json',
    'rankingSha256': hashlib.sha256(ranking_raw).hexdigest(), 'cities': coverage, 'failures': 0,
    'temporaryDatabaseRemoved': True, 'limits': '210身份候选/排程/保存/编辑/重访，不证明外部地图及路线可行性。'})


record = read(ROOT / 'seven-cities-semantic-readthrough-05.json')
assert record['snapshotSha256'] == sha and len(record['reviews']) == 35
assert sum(len(r['mentions']) for r in record['reviews']) == 370
for name in ['govern-people-square-scope.py', 'record-batch105-boundaries.py',
             'record-shanghai-readthrough.py', 'record-batch105-validation.py']:
    ast.parse((ROOT / name).read_text(encoding='utf-8'))
notes = ('第104—105批已应用、双同步并验证，无待同步。上海五主体117条及人民广场13条来源完成scope，'
    '共14条异主体隔离、18条保留身份按字段排除；人民广场9/27.5分。ranking22及台账13各210项、'
    '分差0、无补位；catalog15的6911项、retrieval13的210覆盖（人民广场1新测/209完整行复用，'
    '前五项已在retrieval12新测）、flow92的210目标通过。6条实体变化，4036来源、8798提及、'
    '1051笔记、3737旧行、357旧媒体字段、201行程及旧scope分配保持；新增6scope/130分配。'
    '74条非同体边界，35项/370当前有效提及阅读记录含上海全部30候选；不等于30项语义全部闭合。'
    '仍6项算法排名风险、6处缺坐标；乍浦路桥10925咖啡、北外滩10944标签、淮海中路展览/洋房'
    '及新天地整份路线描述等待106批，馆区/河岸/寺观组合和错写全名引文等另待核。未验收、不提交、不归档。')
for path in [ROOT.parent / 'task.json', PARENT / 'task.json']:
    task = read(path)
    assert task['status'] == 'in_progress' and task['completedAt'] is None
    task['notes'] = notes
    task['meta']['sevenCityContinuation'].update(latestEntityBatch=105, latestFlowRun=92, pendingSyncBatches=[],
        ranking='10-09-attraction-top30-governance/research/seven-cities-ranking-22.json', accepted=False,
        latestAppliedBatches=['batch-104', 'batch-105'],
        semanticReadthrough='10-09-attraction-top30-governance/research/seven-cities-semantic-readthrough-05.json')
    path.write_text(json.dumps(task, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
next_evidence = read(ROOT / 'seven-cities-next-evidence-08.json')
next_evidence.update(snapshotFile=SOURCE, snapshotSha256=sha, latestAppliedBatches=['batch-104', 'batch-105'],
    pendingSyncBatches=[], nextBatch=106, semanticReadthrough='seven-cities-semantic-readthrough-05.json')
city = next(c for c in snapshot['cities'] if c['city'] == '上海')
for addition in read(ROOT / 'shanghai-readthrough-additions-01.json'):
    for mid in addition.get('pendingMentionIds', []):
        m = next(m for m in city['mentions'] if m['id'] == mid)
        next_evidence['nextEvidence'].append({'city': '上海', 'mentionId': mid, 'inputHash': m['inputHash'],
            'entityId': m['entityId'], 'noteId': m['raw_note_id'], 'conclusion': addition['conclusion']})
next_evidence['remainingReview'] = [r for r in next_evidence['remainingReview'] if not r.startswith('上海其余入榜主体')]
next_evidence['remainingReview'].insert(0, '上海当前30候选的提及阅读已留证，继续已识别错配来源的正式治理；其余六城175项及历史未决边界继续审核，不将阅读覆盖当完成。')
write('seven-cities-next-evidence-09.json', next_evidence)
progress = ROOT.parent / '进展记录.md'
heading, remainder = progress.read_text(encoding='utf-8').split('\n', 1)
section = ('\n\n## 最新继续结果：第105批人民广场与上海阅读覆盖\n\n- ' + notes + '\n'
    '- 105批13条中4条住宿/美食分区隔离；10259/11255同篇明确Day1经过人民广场，保留身份，只排住宿描述，不能仅凭抽取reason误隔离实际路线。\n'
    '- 上海关系49→48、强14保持，来源版本15；人民广场真实召回通过。完整预演、幂等、逆序回滚、实库前后核对、地点关系双同步及210目标消费通过。\n'
    '- 新增17项阅读，原18项逐字段比对后沿用，共35项/370当前提及；上海30候选均读到，但明确保留下一批待处理和馆区/河岸/组合等未决，不称全部语义完成。\n'
    f'- 最终快照{SOURCE}，SHA256 {sha}；台账seven-cities-semantic-readthrough-05.json、下一证据seven-cities-next-evidence-09.json。\n')
progress.write_text(heading + section + remainder, encoding='utf-8')
with (ROOT.parent / '七城剩余问题.md').open('a', encoding='utf-8') as handle:
    handle.write('\n## 第105批后断点\n\n' + notes + '\n\n继续入口：[下一证据](research/seven-cities-next-evidence-09.json)、[原文阅读](七城本轮原文复核.md)。\n')
print(json.dumps({'flowTargets': 210, 'readthroughEntities': 35, 'currentMentions': 370,
    'nextBatch': 106, 'tasksRemainInProgress': True}))

