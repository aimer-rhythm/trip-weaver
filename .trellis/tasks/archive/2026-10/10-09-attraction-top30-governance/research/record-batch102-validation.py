"""绑定101/102-v2终态、七城技术覆盖及逐项阅读；不执行任务收尾。"""
import ast
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PARENT = ROOT.parents[1] / '10-06-place-identity-governance'
BATCH_ROOT = PARENT / 'research/all-cities'
SOURCE = 'snapshot-20261009T203709273711Z/input.json'
BATCHES = ['batch-101', 'batch-102-v2']


def read(path):
    return json.loads(path.read_bytes())


def write(name, value):
    with (ROOT / name).open('x', encoding='utf-8') as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)


raw = (ROOT / SOURCE).read_bytes()
snapshot = json.loads(raw)
sha = hashlib.sha256(raw).hexdigest()
ranking_bytes = (ROOT / 'seven-cities-ranking-19.json').read_bytes()
ranking = json.loads(ranking_bytes)
assert ranking['snapshotSha256'] == sha
previous = read(ROOT / 'seven-cities-ranking-18.json')
flow_dir = BATCH_ROOT / 'flow/run-89'
flow = read(flow_dir / 'report.json')
assert not flow['failures'] and read(flow_dir / 'cleanup.json')['removed']
assert (flow_dir / 'target-ranking.json').read_bytes() == ranking_bytes
coverage = []
for city in ranking['cities']:
    old = next(c for c in previous['cities'] if c['city'] == city['city'])
    assert {p['entityId'] for p in old['top30']} == {p['entityId'] for p in city['top30']}
    assert all(p['score'] == p['downstreamScore'] for p in city['top30'])
    item = next(c['targetCoverage'] for c in flow['cities'] if c['city'] == city['city'])
    assert item['requested'] == item['passed'] == 30 and item['snapshotSha256'] == sha
    assert item['ids'] == [p['entityId'] for p in city['top30']]
    coverage.append({'city': city['city'], **item})
for name in ['seven-cities-catalog-12.json', 'seven-cities-retrieval-10.json']:
    result = read(ROOT / name)
    assert result['passed'] and result['snapshotSha256'] == sha
preservation = read(ROOT / 'seven-cities-preservation-11.json')
assert preservation['passed'] and preservation['afterSha256'] == sha and preservation['batches'] == BATCHES
scopes = []
for batch in BATCHES:
    folder = BATCH_ROOT / batch / 'sync-01'
    state = read(folder / 'sync-state.json')
    assert all(c.get('importedAt') and c.get('relationsImportedAt') and c.get('embeddingRunAt') for c in state['cities'].values())
    checks = list(folder.glob('post-import-check-*.json'))
    assert checks and all(not read(p)['failures'] for p in checks)
    scopes.extend(read(BATCH_ROOT / f'{batch}-scope-decisions.json'))
write('seven-cities-flow-coverage-09.json', {'passed': True, 'run': 'run-89',
    'ranking': 'seven-cities-ranking-19.json', 'rankingSha256': hashlib.sha256(ranking_bytes).hexdigest(),
    'failures': 0, 'temporaryDatabaseRemoved': True, 'cities': coverage,
    'limits': '210个身份候选/排程/保存/编辑/重访目标，不证明坐标及外部路线可行性。'})

# 旧9项只能在完整当前归属及引用笔记都未变时继续采用。
old_readthrough = read(ROOT / 'seven-cities-semantic-readthrough-01.json')
old_snapshot = read(ROOT / old_readthrough['snapshotFile'])
reviews = old_readthrough['reviews']
for review in reviews:
    city = next(c for c in snapshot['cities'] if c['city'] == review['city'])
    old_city = next(c for c in old_snapshot['cities'] if c['city'] == review['city'])
    eid = review['entityId']
    assert next(e for e in city['entities'] if e['entity_id'] == eid) == next(e for e in old_city['entities'] if e['entity_id'] == eid)
    assert [m for m in city['mentions'] if m['entityId'] == eid] == [m for m in old_city['mentions'] if m['entityId'] == eid]
    for entry in review['noteEvidence']:
        assert city['notes'][str(entry['noteId'])] == old_city['notes'][str(entry['noteId'])]
    review['reusedAfterFullEntityMentionsAndNotesComparison'] = True
city = next(c for c in snapshot['cities'] if c['city'] == '上海')
for scope in scopes:
    eid = next(iter(scope['expectedRevisions']))
    entity = next(e for e in city['entities'] if e['entity_id'] == eid)
    mentions = [m for m in city['mentions'] if m['entityId'] == eid]
    evidence = scope['evidence'][0]
    for item in evidence['reviewedNotes']:
        assert hashlib.sha256(city['notes'][str(item['noteId'])]['note_desc'].encode()).hexdigest() == item['noteDescSha256']
    reviews.append({'city': '上海', 'entityId': eid, 'name': entity['canonical_name'],
        'expectedRevision': entity['revision'], 'identityRetained': True, 'fullFactsReviewed': False,
        'scope': '全部原归属提及及其完整正文的身份语境阅读；以正式scope记录隔离结果。',
        'mentions': [{'mentionId': m['id'], 'inputHash': m['inputHash'], 'resolution': m['resolution']} for m in mentions],
        'reviewedSourceMentionIds': [a['mentionId'] for a in scope['assignments']],
        'reviewedNotes': evidence['reviewedNotes'], 'noteEvidence': evidence['noteQuotes'],
        'conclusion': evidence['conclusion'], 'businessMutationByThisRecord': False, 'userAcceptance': False})
assert len(reviews) == 12
write('seven-cities-semantic-readthrough-02.json', {'snapshotFile': SOURCE, 'snapshotSha256': sha,
    'reviews': reviews, 'limits': '9项完整比对后沿用，新增3主体共93条原归属提及的正文阅读；不能将其它198项或全部资料事实计为完成。'})
lines = ['# 本轮逐项原文阅读记录', '',
    '12项已有完整身份语境阅读记录，当前101条有效提及；不表示全部资料事实或用户验收通过。', '',
    '| 城市 | 地点 | 当前有效提及 | 结论与待办 |', '| --- | --- | --- | --- |']
for review in reviews:
    lines.append('| ' + ' | '.join([review['city'], review['name'],
        '、'.join(str(m['mentionId']) for m in review['mentions']), review['conclusion'].replace('|', '／')]) + ' |')
lines += ['', '证据：[机器台账](research/seven-cities-semantic-readthrough-02.json)。每项绑定原文指纹、当前归属和版本；其它历史审核以各批审计为准。', '']
(ROOT.parent / '七城本轮原文复核.md').write_text('\n'.join(lines), encoding='utf-8')
for name in ['inspect-seven-cities.py', 'govern-bund-scopes.py', 'govern-pearl-scope.py',
             'record-batch102-boundaries.py', 'record-batch102-validation.py']:
    ast.parse((ROOT / name).read_text(encoding='utf-8'))
notes = ('第101、102-v2批已应用、双同步并完成事后核验。外滩42提及/107.02分，建筑群6提及/20分，'
    '东方明珠30提及/76.83分，三根各自保持；15条酒店/餐饮/片区/建筑群参照隔离，8条仅排除错配描述。'
    'ranking19七城各30、分差0、无补位；catalog12的6911项、retrieval10的210覆盖（3新测/207完整行复用）、'
    'flow89的210目标通过。4036来源、8798提及、1051笔记、3737旧行、345旧媒体字段、201行程及旧范围分配保持；'
    '新增3scope/93分配。24回归、10同步契约及研究typecheck通过。55条非同体边界；12项阅读台账单列。'
    '仍6项算法排名风险、6处缺坐标；外滩旧位置待核、东方明珠10132天桥描述因全简称引文门禁保留待核。'
    '下一批103，豫园33条已读正在准备方案。未验收、不提交、不归档。')
for path in [ROOT.parent / 'task.json', PARENT / 'task.json']:
    task = read(path)
    assert task['status'] == 'in_progress' and task['completedAt'] is None
    task['notes'] = notes
    task['meta']['sevenCityContinuation'].update(latestEntityBatch=102, latestFlowRun=89,
        pendingSyncBatches=[], ranking='10-09-attraction-top30-governance/research/seven-cities-ranking-19.json',
        accepted=False, latestAppliedBatches=BATCHES,
        semanticReadthrough='10-09-attraction-top30-governance/research/seven-cities-semantic-readthrough-02.json')
    path.write_text(json.dumps(task, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
write('batch102-attempt-notes.json', {'originalBatchApplied': False,
    'inputAttempt': '11159原文序号后是非普通空格，改用原样连续主体至建议摘录，未修改原文。',
    'batch102Preview01': '10132抽取全名，正文仅简称，事实摘录不满足现行主名门禁；隔离预演回滚并删除临时库。',
    'planChangeAttempt': '同批计划指纹变更被拦截，另用102-v2，不覆盖失败工件。',
    'final': '102-v2保留10132原身份和字段，单列待核；其余来源隔离/事实排除完整预演后应用。',
    'remainingMention': 10132, 'guardrailsUnchanged': True})
print(json.dumps({'flowTargets': 210, 'readthroughEntities': len(reviews),
    'currentMentions': sum(len(r['mentions']) for r in reviews), 'nextBatch': 103, 'tasksRemainInProgress': True}))
