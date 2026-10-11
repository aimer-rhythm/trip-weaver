"""104批验证与续做断点；不把技术通过或部分阅读记作验收。"""
import ast
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PARENT = ROOT.parents[1] / '10-06-place-identity-governance'
B = PARENT / 'research/all-cities'
SOURCE = 'snapshot-20261009T211214228056Z/input.json'


def read(path):
    return json.loads(path.read_bytes())


def write(name, value):
    with (ROOT / name).open('x', encoding='utf-8') as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)


raw = (ROOT / SOURCE).read_bytes()
snapshot = json.loads(raw)
sha = hashlib.sha256(raw).hexdigest()
ranking_raw = (ROOT / 'seven-cities-ranking-21.json').read_bytes()
ranking = json.loads(ranking_raw)
assert ranking['snapshotSha256'] == sha
previous = read(ROOT / 'seven-cities-ranking-20.json')
flow = read(B / 'flow/run-91/report.json')
assert not flow['failures'] and read(B / 'flow/run-91/cleanup.json')['removed']
assert (B / 'flow/run-91/target-ranking.json').read_bytes() == ranking_raw
coverage = []
for city in ranking['cities']:
    old = next(c for c in previous['cities'] if c['city'] == city['city'])
    assert {p['entityId'] for p in old['top30']} == {p['entityId'] for p in city['top30']}
    assert all(p['score'] == p['downstreamScore'] for p in city['top30'])
    item = next(c['targetCoverage'] for c in flow['cities'] if c['city'] == city['city'])
    assert item['requested'] == item['passed'] == 30 and item['snapshotSha256'] == sha
    assert item['ids'] == [p['entityId'] for p in city['top30']]
    coverage.append({'city': city['city'], **item})
for name in ['seven-cities-catalog-14.json', 'seven-cities-retrieval-12.json']:
    result = read(ROOT / name)
    assert result['passed'] and result['snapshotSha256'] == sha
preservation = read(ROOT / 'seven-cities-preservation-13.json')
assert preservation['passed'] and preservation['afterSha256'] == sha and preservation['batches'] == ['batch-104']
folder = B / 'batch-104/sync-01'
state = read(folder / 'sync-state.json')
assert all(c.get('importedAt') and c.get('relationsImportedAt') and c.get('embeddingRunAt') for c in state['cities'].values())
checks = list(folder.glob('post-import-check-*.json'))
assert checks and all(not read(p)['failures'] for p in checks)
write('seven-cities-flow-coverage-11.json', {'passed': True, 'run': 'run-91', 'ranking': 'seven-cities-ranking-21.json',
    'rankingSha256': hashlib.sha256(ranking_raw).hexdigest(), 'cities': coverage, 'failures': 0,
    'temporaryDatabaseRemoved': True, 'limits': '210身份候选/排程/保存/编辑/重访，不证明外部地图及路线可行性。'})

prior = read(ROOT / 'seven-cities-semantic-readthrough-03.json')
old_snapshot = read(ROOT / prior['snapshotFile'])
reviews = prior['reviews']
for review in reviews:
    city = next(c for c in snapshot['cities'] if c['city'] == review['city'])
    old = next(c for c in old_snapshot['cities'] if c['city'] == review['city'])
    eid = review['entityId']
    assert next(e for e in city['entities'] if e['entity_id'] == eid) == next(e for e in old['entities'] if e['entity_id'] == eid)
    assert [m for m in city['mentions'] if m['entityId'] == eid] == [m for m in old['mentions'] if m['entityId'] == eid]
    for item in [*review.get('reviewedNotes', []), *review['noteEvidence']]:
        assert city['notes'][str(item['noteId'])] == old['notes'][str(item['noteId'])]
    review['reusedAfterFullEntityMentionsAndNotesComparison'] = True
city = next(c for c in snapshot['cities'] if c['city'] == '上海')
for scope in read(B / 'batch-104-scope-decisions.json'):
    eid, = scope['expectedRevisions']
    entity = next(e for e in city['entities'] if e['entity_id'] == eid)
    evidence = scope['evidence'][0]
    for item in evidence['reviewedNotes']:
        assert hashlib.sha256(city['notes'][str(item['noteId'])]['note_desc'].encode()).hexdigest() == item['noteDescSha256']
    mentions = [m for m in city['mentions'] if m['entityId'] == eid]
    reviews.append({'city': '上海', 'entityId': eid, 'name': entity['canonical_name'], 'expectedRevision': entity['revision'],
        'identityRetained': True, 'fullFactsReviewed': False,
        'scope': f"完整{len(scope['assignments'])}条原归属提及及正文的身份语境阅读。",
        'mentions': [{'mentionId': m['id'], 'inputHash': m['inputHash'], 'resolution': m['resolution']} for m in mentions],
        'reviewedSourceMentionIds': [a['mentionId'] for a in scope['assignments']],
        'reviewedNotes': evidence['reviewedNotes'], 'noteEvidence': evidence['noteQuotes'],
        'conclusion': evidence['conclusion'], 'businessMutationByThisRecord': False, 'userAcceptance': False})
assert len(reviews) == 18 and sum(len(r['mentions']) for r in reviews) == 236
write('seven-cities-semantic-readthrough-04.json', {'snapshotFile': SOURCE, 'snapshotSha256': sha, 'reviews': reviews,
    'limits': '此前13项完整比对后沿用，新增五主体117条原归属提及阅读；其余192项按历史治理和待办单独复核，不代表全部事实已完成。'})
lines = ['# 本轮逐项原文阅读记录', '', '18项、236条当前有效提及已有完整身份语境阅读记录；全部事实与用户验收仍未完成。', '',
    '| 城市 | 地点 | 当前有效提及 | 结论与待办 |', '| --- | --- | --- | --- |']
for r in reviews:
    lines.append('| ' + ' | '.join([r['city'], r['name'], '、'.join(str(m['mentionId']) for m in r['mentions']), r['conclusion'].replace('|', '／')]) + ' |')
lines += ['', '证据：[机器台账](research/seven-cities-semantic-readthrough-04.json)。每项绑定原文、归属和实体版本。', '']
(ROOT.parent / '七城本轮原文复核.md').write_text('\n'.join(lines), encoding='utf-8')
for name in ['govern-shanghai-central-scopes.py', 'record-batch104-boundaries.py', 'record-batch104-validation.py']:
    ast.parse((ROOT / name).read_text(encoding='utf-8'))
notes = ('第104批五个上海主体已应用、双同步并验证，无待同步。南京路步行街30/77.67分、武康路23/62.07分、'
    '陆家嘴20/54.25分、武康大楼20/52.25分、静安寺14/37.79分，各根保持；117条原提及中10条异主体隔离，'
    '16条保留身份按字段排除错配。ranking21及台账12各210项、分差0、无补位；catalog14的6911项、'
    'retrieval12的210覆盖（5新测/205完整行复用）、flow91的210目标通过。5条实体变化，4036来源、'
    '8798提及、1051笔记、3737旧行、357旧媒体字段、201行程及旧范围分配保持；新增5scope/117分配。'
    '24研究回归、10同步契约、研究typecheck和新增脚本AST通过。70条非同体边界，18项/236有效提及阅读台账单列。'
    '仍6项算法排名风险、6处缺坐标；静安寺、外滩及九曲桥旧位置，东方明珠10132全简称引文问题待核。'
    '下一批105，继续其余入榜主体原文身份审核。未验收、不提交、不归档。')
for path in [ROOT.parent / 'task.json', PARENT / 'task.json']:
    task = read(path)
    assert task['status'] == 'in_progress' and task['completedAt'] is None
    task['notes'] = notes
    task['meta']['sevenCityContinuation'].update(latestEntityBatch=104, latestFlowRun=91, pendingSyncBatches=[],
        ranking='10-09-attraction-top30-governance/research/seven-cities-ranking-21.json', accepted=False,
        latestAppliedBatches=['batch-104'], semanticReadthrough='10-09-attraction-top30-governance/research/seven-cities-semantic-readthrough-04.json')
    path.write_text(json.dumps(task, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
next_evidence = read(ROOT / 'seven-cities-next-evidence-07.json')
next_evidence.update(snapshotFile=SOURCE, snapshotSha256=sha, latestAppliedBatches=['batch-104'], pendingSyncBatches=[],
    nextBatch=105, semanticReadthrough='seven-cities-semantic-readthrough-04.json')
next_evidence['remainingReview'] = [r for r in next_evidence['remainingReview'] if '上海下一高分南京路步行街' not in r]
next_evidence['remainingReview'].insert(0, '上海其余入榜主体外白渡桥、人民广场、安福路、邮政博物馆等继续逐提及审核；静安寺旧地址武定西路1185另待定位核实，不借邻近点补坐标。')
write('seven-cities-next-evidence-08.json', next_evidence)
progress = ROOT.parent / '进展记录.md'
current = progress.read_text(encoding='utf-8')
heading, remainder = current.split('\n', 1)
section = ('\n\n## 最新继续结果：第104批上海五主体来源治理\n\n'
    '- ' + notes + '\n'
    '- 完整隔离预演、幂等和逆序回滚后经版本化API应用。酒店、美食分区及独立机位不写入景点；实际餐后游览、道路负评、楼体禁入/勿占道、护栏和衣着警示保持。\n'
    '- 同篇第8项苏州河秋千与第12项静安寺夜景分别判断，10406保留寺庙身份并排混合描述；天桥、寺庙人行道按具体字段排除，直接地标外观评价保持。\n'
    '- 上海同版本关系54→49、强15→14，来源版本14；357为本次基线旧媒体字段数，不是照片数，未新增图片治理。\n'
    '- 输入引文断言曾因原文编号后的不换行空格失败，按实际原文修正后预演通过，没有放宽门禁。\n'
    f'- 最终快照`{SOURCE}`，SHA256 `{sha}`；阅读记录`seven-cities-semantic-readthrough-04.json`、下一证据`seven-cities-next-evidence-08.json`。\n')
progress.write_text(heading + section + remainder, encoding='utf-8')
problems = ROOT.parent / '七城剩余问题.md'
with problems.open('a', encoding='utf-8') as handle:
    handle.write('\n## 第104批后断点\n\n' + notes + '\n\n继续入口：[下一证据](research/seven-cities-next-evidence-08.json)、[原文阅读](七城本轮原文复核.md)。\n')
print(json.dumps({'flowTargets': 210, 'readthroughEntities': 18, 'currentMentions': 236,
    'nextBatch': 105, 'tasksRemainInProgress': True}))
