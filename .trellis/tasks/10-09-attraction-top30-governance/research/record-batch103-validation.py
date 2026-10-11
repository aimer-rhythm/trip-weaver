"""103批最终证据与断点，既有读取记录只有逐字段不变才沿用。"""
import ast
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PARENT = ROOT.parents[1] / '10-06-place-identity-governance'
B = PARENT / 'research/all-cities'
SOURCE = 'snapshot-20261009T205339699294Z/input.json'


def read(path):
    return json.loads(path.read_bytes())


def write(name, value):
    with (ROOT / name).open('x', encoding='utf-8') as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)


raw = (ROOT / SOURCE).read_bytes()
snapshot = json.loads(raw)
sha = hashlib.sha256(raw).hexdigest()
ranking_raw = (ROOT / 'seven-cities-ranking-20.json').read_bytes()
ranking = json.loads(ranking_raw)
assert ranking['snapshotSha256'] == sha
previous = read(ROOT / 'seven-cities-ranking-19.json')
flow = read(B / 'flow/run-90/report.json')
assert not flow['failures'] and read(B / 'flow/run-90/cleanup.json')['removed']
assert (B / 'flow/run-90/target-ranking.json').read_bytes() == ranking_raw
coverage = []
for city in ranking['cities']:
    old = next(c for c in previous['cities'] if c['city'] == city['city'])
    assert {p['entityId'] for p in old['top30']} == {p['entityId'] for p in city['top30']}
    assert all(p['score'] == p['downstreamScore'] for p in city['top30'])
    item = next(c['targetCoverage'] for c in flow['cities'] if c['city'] == city['city'])
    assert item['requested'] == item['passed'] == 30 and item['snapshotSha256'] == sha
    assert item['ids'] == [p['entityId'] for p in city['top30']]
    coverage.append({'city': city['city'], **item})
for name in ['seven-cities-catalog-13.json', 'seven-cities-retrieval-11.json']:
    result = read(ROOT / name)
    assert result['passed'] and result['snapshotSha256'] == sha
preservation = read(ROOT / 'seven-cities-preservation-12.json')
batches = ['batch-101', 'batch-102-v2', 'batch-103']
assert preservation['passed'] and preservation['afterSha256'] == sha and preservation['batches'] == batches
for batch in batches:
    folder = B / batch / 'sync-01'
    state = read(folder / 'sync-state.json')
    assert all(c.get('importedAt') and c.get('relationsImportedAt') and c.get('embeddingRunAt') for c in state['cities'].values())
    checks = list(folder.glob('post-import-check-*.json'))
    assert checks and all(not read(p)['failures'] for p in checks)
write('seven-cities-flow-coverage-10.json', {'passed': True, 'run': 'run-90', 'ranking': 'seven-cities-ranking-20.json',
    'rankingSha256': hashlib.sha256(ranking_raw).hexdigest(), 'cities': coverage, 'failures': 0,
    'temporaryDatabaseRemoved': True, 'limits': '210身份候选/排程/保存/编辑/重访，不证明外部地图及路线可行性。'})

prior = read(ROOT / 'seven-cities-semantic-readthrough-02.json')
old_snapshot = read(ROOT / prior['snapshotFile'])
reviews = prior['reviews']
for review in reviews:
    city = next(c for c in snapshot['cities'] if c['city'] == review['city'])
    old = next(c for c in old_snapshot['cities'] if c['city'] == review['city'])
    eid = review['entityId']
    assert next(e for e in city['entities'] if e['entity_id'] == eid) == next(e for e in old['entities'] if e['entity_id'] == eid)
    assert [m for m in city['mentions'] if m['entityId'] == eid] == [m for m in old['mentions'] if m['entityId'] == eid]
    note_ids = {e['noteId'] for e in [*review.get('reviewedNotes', []), *review['noteEvidence']]}
    for nid in note_ids:
        assert city['notes'][str(nid)] == old['notes'][str(nid)]
    review['reusedAfterFullEntityMentionsAndNotesComparison'] = True
city = next(c for c in snapshot['cities'] if c['city'] == '上海')
scope, = read(B / 'batch-103-scope-decisions.json')
eid, = scope['expectedRevisions']
entity = next(e for e in city['entities'] if e['entity_id'] == eid)
evidence = scope['evidence'][0]
for item in evidence['reviewedNotes']:
    assert hashlib.sha256(city['notes'][str(item['noteId'])]['note_desc'].encode()).hexdigest() == item['noteDescSha256']
mentions = [m for m in city['mentions'] if m['entityId'] == eid]
reviews.append({'city': '上海', 'entityId': eid, 'name': entity['canonical_name'], 'expectedRevision': entity['revision'],
    'identityRetained': True, 'fullFactsReviewed': False, 'scope': '完整33条原归属提及及正文的身份语境阅读。',
    'mentions': [{'mentionId': m['id'], 'inputHash': m['inputHash'], 'resolution': m['resolution']} for m in mentions],
    'reviewedSourceMentionIds': [a['mentionId'] for a in scope['assignments']],
    'reviewedNotes': evidence['reviewedNotes'], 'noteEvidence': evidence['noteQuotes'],
    'publicEvidence': evidence['publicEvidence'], 'conclusion': evidence['conclusion'],
    'businessMutationByThisRecord': False, 'userAcceptance': False})
assert len(reviews) == 13 and sum(len(r['mentions']) for r in reviews) == 129
write('seven-cities-semantic-readthrough-03.json', {'snapshotFile': SOURCE, 'snapshotSha256': sha, 'reviews': reviews,
    'limits': '此前12项完整比对后沿用，新增豫园33条原归属提及的阅读；其余197项仍按历史治理和待办单独复核，不代表全部事实已完成。'})
lines = ['# 本轮逐项原文阅读记录', '', '13项、129条当前有效提及已有完整身份语境阅读记录；全部事实与用户验收仍未完成。', '',
    '| 城市 | 地点 | 当前有效提及 | 结论与待办 |', '| --- | --- | --- | --- |']
for r in reviews:
    lines.append('| ' + ' | '.join([r['city'], r['name'], '、'.join(str(m['mentionId']) for m in r['mentions']), r['conclusion'].replace('|', '／')]) + ' |')
lines += ['', '证据：[机器台账](research/seven-cities-semantic-readthrough-03.json)。每项绑定原文、归属和实体版本。', '']
(ROOT.parent / '七城本轮原文复核.md').write_text('\n'.join(lines), encoding='utf-8')
for name in ['govern-yuyuan-scope.py', 'record-batch103-boundaries.py', 'record-batch103-validation.py']:
    ast.parse((ROOT / name).read_text(encoding='utf-8'))
notes = ('第101、102-v2、103批已应用、双同步并验证，无待同步。外滩42/107.02分、建筑群6/20分、'
    '东方明珠30/76.83分、豫园28/73.29分，4根各自保持；20条异主体参照隔离，14条保留身份按字段排除错配描述。'
    'ranking20及台账11各210项、分差0、无补位；catalog13的6911项、retrieval11的210覆盖'
    '（豫园1新测/209完整行复用；前三项已在retrieval10新测）、flow90的210目标通过。'
    '三批4条实体变化，4036来源、8798提及、1051笔记、3737旧行、345旧媒体字段、201行程及旧范围分配保持；'
    '新增4scope/126分配。24回归、10同步契约、研究typecheck及新增脚本AST通过。'
    '60条非同体边界，13项/129有效提及阅读台账单列。仍6项算法排名风险、6处缺坐标；'
    '外滩旧位置、东方明珠10132全简称事实引文、九曲桥青浦旧地址待核。下一批104，继续高分候选原文身份审核。未验收、不提交、不归档。')
for path in [ROOT.parent / 'task.json', PARENT / 'task.json']:
    task = read(path)
    assert task['status'] == 'in_progress' and task['completedAt'] is None
    task['notes'] = notes
    task['meta']['sevenCityContinuation'].update(latestEntityBatch=103, latestFlowRun=90, pendingSyncBatches=[],
        ranking='10-09-attraction-top30-governance/research/seven-cities-ranking-20.json', accepted=False,
        latestAppliedBatches=batches, semanticReadthrough='10-09-attraction-top30-governance/research/seven-cities-semantic-readthrough-03.json')
    path.write_text(json.dumps(task, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
next_evidence = read(ROOT / 'seven-cities-next-evidence-06.json')
next_evidence.update(snapshotFile=SOURCE, snapshotSha256=sha, latestAppliedBatches=batches, pendingSyncBatches=[],
    nextBatch=104, semanticReadthrough='seven-cities-semantic-readthrough-03.json')
for mid, conclusion in [
    (10132, '明确东方明珠路线身份保持，天桥reason/evidence_text未修改；原文简称与抽取全名不满足现行事实引文门禁。'),
    (11001, '正文是豫园片区九曲桥，旧来源5213却用青浦朱家角地址；本轮只读，不接收豫园分出的机位描述。'),
]:
    m = next(m for m in city['mentions'] if m['id'] == mid)
    next_evidence['nextEvidence'].append({'city': '上海', 'mentionId': mid, 'inputHash': m['inputHash'],
        'entityId': m['entityId'], 'noteId': m['raw_note_id'], 'conclusion': conclusion})
next_evidence['remainingReview'].insert(0, '上海下一高分南京路步行街、武康大楼等未完成逐提及复核者；外滩旧主位置另待核。')
write('seven-cities-next-evidence-07.json', next_evidence)
write('yuyuan-public-evidence-notes.json', {'search01': '60秒超时，未采用；沙箱外search02取得候选。',
    'search02': '生成内容错误地将上海市政府当景点并说九曲桥在园内，不作为事实证据。',
    'successfulFetches': ['yuyuan-shio-fetch-01.json', 'yuyuan-wiki-fetch-01.json'],
    'unavailableFetches': ['yuyuan-huangpu-fetch-01.json', 'yuyuan-huangpu-fetch-02.json'],
    'limit': '黄浦区被引用页面两次提取为空，不声称读过；只采用实际正文支持的边界，不补实时开闭门或地址。'})
print(json.dumps({'flowTargets': 210, 'readthroughEntities': 13, 'currentMentions': 129,
    'nextBatch': 104, 'tasksRemainInProgress': True}))
