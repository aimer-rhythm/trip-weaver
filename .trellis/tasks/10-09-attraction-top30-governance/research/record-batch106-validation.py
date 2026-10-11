"""106批验证与续做断点；不把技术通过或部分阅读记作验收。"""
import ast
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PARENT = ROOT.parents[1] / '10-06-place-identity-governance'
B = PARENT / 'research/all-cities'
SOURCE = 'snapshot-20261009T213645389978Z/input.json'


def read(path):
    return json.loads(path.read_bytes())


def write(name, value):
    with (ROOT / name).open('x', encoding='utf-8') as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)


raw = (ROOT / SOURCE).read_bytes()
snapshot = json.loads(raw)
sha = hashlib.sha256(raw).hexdigest()
ranking_raw = (ROOT / 'seven-cities-ranking-23.json').read_bytes()
ranking = json.loads(ranking_raw)
assert ranking['snapshotSha256'] == sha
previous = read(ROOT / 'seven-cities-ranking-22.json')
flow = read(B / 'flow/run-93/report.json')
assert not flow['failures'] and read(B / 'flow/run-93/cleanup.json')['removed']
assert (B / 'flow/run-93/target-ranking.json').read_bytes() == ranking_raw
coverage = []
for city in ranking['cities']:
    old = next(c for c in previous['cities'] if c['city'] == city['city'])
    assert {p['entityId'] for p in old['top30']} == {p['entityId'] for p in city['top30']}
    assert all(p['score'] == p['downstreamScore'] for p in city['top30'])
    item = next(c['targetCoverage'] for c in flow['cities'] if c['city'] == city['city'])
    assert item['requested'] == item['passed'] == 30 and item['snapshotSha256'] == sha
    assert item['ids'] == [p['entityId'] for p in city['top30']]
    coverage.append({'city': city['city'], **item})
for name in ['seven-cities-catalog-16.json', 'seven-cities-retrieval-14.json']:
    result = read(ROOT / name)
    assert result['passed'] and result['snapshotSha256'] == sha
preservation = read(ROOT / 'seven-cities-preservation-15.json')
assert preservation['passed'] and preservation['afterSha256'] == sha and preservation['batches'] == ['batch-104', 'batch-105', 'batch-106']
folder = B / 'batch-106/sync-01'
state = read(folder / 'sync-state.json')
assert all(c.get('importedAt') and c.get('relationsImportedAt') and c.get('embeddingRunAt') for c in state['cities'].values())
checks = list(folder.glob('post-import-check-*.json'))
assert checks and all(not read(p)['failures'] for p in checks)
write('seven-cities-flow-coverage-13.json', {'passed': True, 'run': 'run-93', 'ranking': 'seven-cities-ranking-23.json',
    'rankingSha256': hashlib.sha256(ranking_raw).hexdigest(), 'cities': coverage, 'failures': 0,
    'temporaryDatabaseRemoved': True, 'limits': '210身份候选/排程/保存/编辑/重访，不证明外部地图及路线可行性。'})



record = read(ROOT / 'seven-cities-semantic-readthrough-06.json')
assert record['snapshotSha256'] == sha and len(record['reviews']) == 35
assert sum(len(r['mentions']) for r in record['reviews']) == 367
assert sum(len(c['rankAffectingUncertainty']) for c in ranking['cities']) == 7
for name in ['govern-shanghai-readthrough-scopes.py', 'record-batch106-boundaries.py',
             'record-batch106-readthrough.py', 'record-batch106-validation.py']:
    ast.parse((ROOT / name).read_text(encoding='utf-8'))
batches = ['batch-104', 'batch-105', 'batch-106']
notes = ('第104—106批已应用、双同步并验证，无待同步。上海10主体163条来源进入新scope，'
    '17条隔离（16条有非同体证据、北外滩10944仅标签待补图），21条保留身份按字段排除；'
    '乍浦路桥10/30分、淮海中路8/25分、北外滩5/17.5分、新天地7/22.5分。'
    'ranking23及台账14各210项、分差0、无补位；catalog16的6911项、retrieval14的210覆盖'
    '（4新测/206完整行复用，前6项已在retrieval12/13新测）、flow93的210目标通过。'
    '10条实体变化，4036来源、8798提及、1051笔记、3737旧行、357旧媒体字段、201行程'
    '及旧scope分配保持；新增10scope/163分配。76条非同体边界；35项/367当前有效提及'
    '阅读记录含上海全部30候选，不等于30项语义全部闭合。北外滩未知标签仍计潜在分，'
    '算法排名风险现7项、缺坐标仍6处。上海馆区/河岸/寺观组合、街区类型、旧定位、'
    '错写全名引文等继续待核；下一批107从厦门高分及其它六城未审主体继续。未验收、不提交、不归档。')
for path in [ROOT.parent / 'task.json', PARENT / 'task.json']:
    task = read(path)
    assert task['status'] == 'in_progress' and task['completedAt'] is None
    task['notes'] = notes
    task['meta']['sevenCityContinuation'].update(latestEntityBatch=106, latestFlowRun=93, pendingSyncBatches=[],
        ranking='10-09-attraction-top30-governance/research/seven-cities-ranking-23.json', accepted=False,
        latestAppliedBatches=batches,
        semanticReadthrough='10-09-attraction-top30-governance/research/seven-cities-semantic-readthrough-06.json')
    path.write_text(json.dumps(task, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
next_evidence = read(ROOT / 'seven-cities-next-evidence-09.json')
next_evidence.update(snapshotFile=SOURCE, snapshotSha256=sha, latestAppliedBatches=batches,
    pendingSyncBatches=[], nextBatch=107, semanticReadthrough='seven-cities-semantic-readthrough-06.json')
resolved = {10925, 11271, 9989, 10074, 11247}
next_evidence['nextEvidence'] = [e for e in next_evidence['nextEvidence'] if e.get('mentionId') not in resolved]
city = next(c for c in snapshot['cities'] if c['city'] == '上海')
for e in next_evidence['nextEvidence']:
    if e.get('mentionId') == 10944:
        m = next(m for m in city['mentions'] if m['id'] == 10944)
        assert m['entityId'] is None and m['resolution']['status'] == 'review'
        e.update(entityId=None, inputHash=m['inputHash'], resolution=m['resolution'],
            conclusion='106批隔离为身份证据不足；原文只有混合地域/摄影标签，待原图补证，仍计北外滩潜在分，不作not_same_entity。')
next_evidence['remainingReview'] = [r for r in next_evidence['remainingReview'] if not r.startswith('上海当前30候选')]
next_evidence['remainingReview'].insert(0, '107批从厦门鼓浪屿53条、中山路步行街49条及沙坡尾40条等高分来源完整阅读继续；厦门母步道/林海线/天泉边界保留，广州成都杭州西安重庆未审主体继续。')
next_evidence['remainingReview'].insert(1, '上海当前30候选已有提及阅读；未决馆区/河岸/寺观组合、商业街区任务类型、旧位置与10132/11238/11246全简称或错字事实引文继续单列，不宣称上海已全部完成。')
write('seven-cities-next-evidence-10.json', next_evidence)
progress = ROOT.parent / '进展记录.md'
heading, remainder = progress.read_text(encoding='utf-8').split('\n', 1)
section = ('\n\n## 最新继续结果：第106批上海阅读发现落地\n\n- ' + notes + '\n'
    '- 33条来源分别覆盖乍浦路桥、淮海中路、北外滩、新天地。9989只排混入巨人展的reason，保留街名引文；10074与11247排两个描述字段，仍保留地点身份。桥上拍车、地域夜景、饭后散步及原负评保持。\n'
    '- 北外滩10944只有标签，隔离待原图而非声称非同体；排名上界仍包含该提及。新增非同体边界仅10925桥旁咖啡和11271沿路洋房，算法风险从6变7如实保留。\n'
    '- 上海关系48→46、强14→12，来源版本16；4项真实SQL/向量新测，206项完整行相等复用。全部210身份候选/排程/保存/编辑/重访通过且临时库删除。\n'
    '- 本轮24研究回归、10同步契约及研究typecheck已通过；新增批次的完整预演、幂等、逆序回滚、正式前后核对、AST与diff空白检查分别留证。未进行无关前端构建。\n'
    f'- 最终快照{SOURCE}，SHA256 {sha}；阅读台账seven-cities-semantic-readthrough-06.json、下一证据seven-cities-next-evidence-10.json。\n')
progress.write_text(heading + section + remainder, encoding='utf-8')
with (ROOT.parent / '七城剩余问题.md').open('a', encoding='utf-8') as handle:
    handle.write('\n## 第106批后断点\n\n' + notes + '\n\n继续入口：[下一证据](research/seven-cities-next-evidence-10.json)、[原文阅读](七城本轮原文复核.md)。\n')
print(json.dumps({'flowTargets': 210, 'readthroughEntities': 35, 'currentMentions': 367,
    'nextBatch': 107, 'tasksRemainInProgress': True}))

