"""108-v2实库、自查和阅读证据归档到工作文件；不提交或标记任务完成。"""
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')
ROOT = Path(__file__).resolve().parent
PARENT = ROOT.parents[1] / '10-06-place-identity-governance'
B = PARENT / 'research/all-cities'
SOURCE = 'snapshot-20261009T221643288652Z/input.json'
read = lambda path: json.loads(path.read_bytes())
raw = (ROOT/SOURCE).read_bytes()
snapshot = json.loads(raw)
sha = hashlib.sha256(raw).hexdigest()
ranking = read(ROOT/'seven-cities-ranking-24.json')
assert ranking['snapshotSha256']==sha
for name in ['seven-cities-catalog-17.json','seven-cities-retrieval-15.json']:
    report = read(ROOT/name)
    assert report['passed'] and report['snapshotSha256']==sha
preservation = read(ROOT/'seven-cities-preservation-16.json')
assert preservation['passed'] and preservation['afterSha256']==sha
assert preservation['batches']==['batch-108-v2']
flow = read(B/'flow/run-94/report.json')
assert not flow['failures'] and read(B/'flow/run-94/cleanup.json')['removed']
assert (B/'flow/run-94/target-ranking.json').read_bytes()==(ROOT/'seven-cities-ranking-24.json').read_bytes()
coverage = []
previous_ranking = read(ROOT/'seven-cities-ranking-23.json')
for city in ranking['cities']:
    old = next(c for c in previous_ranking['cities'] if c['city']==city['city'])
    assert {p['entityId'] for p in old['top30']}=={p['entityId'] for p in city['top30']}
    assert all(p['score']==p['downstreamScore'] for p in city['top30'])
    target = next(c['targetCoverage'] for c in flow['cities'] if c['city']==city['city'])
    assert target['requested']==target['passed']==30 and target['snapshotSha256']==sha
    assert target['ids']==[p['entityId'] for p in city['top30']]
    coverage.append({'city':city['city'],**target})
assert sum(len(c['rankAffectingUncertainty']) for c in ranking['cities'])==8
def write(name,value):
    with (ROOT/name).open('x',encoding='utf-8') as file:
        json.dump(value,file,ensure_ascii=False,indent=2)
write('seven-cities-flow-coverage-14.json',{'passed':True,'run':'run-94','ranking':'seven-cities-ranking-24.json',
    'rankingSha256':hashlib.sha256((ROOT/'seven-cities-ranking-24.json').read_bytes()).hexdigest(),
    'cities':coverage,'failures':0,'temporaryDatabaseRemoved':True,
    'limits':'210身份候选/排程/保存/编辑/重访，不证明地图或路线可行性。'})
folder = B/'batch-108-v2/sync-01'
assert read(B/'batch-108-v2-applied.json')['apply']
state = read(folder/'sync-state.json')
assert all(c.get('importedAt') and c.get('relationsImportedAt') and c.get('embeddingRunAt') for c in state['cities'].values())
checks = list(folder.glob('post-import-check-*.json'))
assert checks and all(not read(path)['failures'] for path in checks)
record = read(ROOT/'seven-cities-semantic-readthrough-07.json')
previous = read(ROOT/record['snapshotFile'])
for r in record['reviews']:
    old = next(c for c in previous['cities'] if c['city']==r['city'])
    now = next(c for c in snapshot['cities'] if c['city']==r['city'])
    eid = r['entityId']
    assert old['notes']==now['notes']
    assert next(e for e in old['entities'] if e['entity_id']==eid)==next(e for e in now['entities'] if e['entity_id']==eid)
    assert [m for m in old['mentions'] if m['entityId']==eid]==[m for m in now['mentions'] if m['entityId']==eid]
    r['reusedAfterFullEntityMentionsAndNotesComparison']=True
city = next(c for c in snapshot['cities'] if c['city']=='厦门')
scope, = read(B/'batch-108-v2-scope-decisions.json')
eid, = scope['expectedRevisions']
entity = next(e for e in city['entities'] if e['entity_id']==eid)
mentions = [m for m in city['mentions'] if m['entityId']==eid]
assert entity['revision']==4 and len(mentions)==34
evidence = scope['evidence'][0]
for note in evidence['reviewedNotes']:
    assert hashlib.sha256(city['notes'][str(note['noteId'])]['note_desc'].encode()).hexdigest()==note['noteDescSha256']
record['reviews'].append({'city':'厦门','entityId':eid,'name':entity['canonical_name'],'expectedRevision':4,
    'identityRetained':True,'fullFactsReviewed':False,'scope':'49原提及/49全文，108-v2来源隔离后34有效；非全量事实审核。',
    'mentions':[{'mentionId':m['id'],'inputHash':m['inputHash'],'resolution':m['resolution']} for m in mentions],
    'noteEvidence':evidence['reviewedNotes'],'reviewedSourceMentionIds':[a['mentionId'] for a in scope['assignments']],
    'conclusion':evidence['conclusion'],'businessMutationByThisRecord':False,'userAcceptance':False,
    'appliedScopeBatch':'batch-108-v2','pendingMentionIds':[5363,6808]})
record.update(snapshotFile=SOURCE,snapshotSha256=sha,
    limits='37项/454当前有效提及的阅读，含上海30候选及厦门鼓浪屿/中山路；不是37项全部语义闭合或用户验收。')
write('seven-cities-semantic-readthrough-08.json',record)
applied = [path.name.removesuffix('-applied.json') for path in B.glob('batch-*-applied.json')
    if 79<=int(re.search(r'batch-(\d+)',path.name).group(1))<=108
    and not (B/(path.name.removesuffix('-applied.json')+'-rolled-back.json')).exists()]
applied.sort(key=lambda name:(int(re.search(r'batch-(\d+)',name).group(1)),name))
subprocess.run([sys.executable,'-B',str(ROOT/'render-seven-review.py'),
    '--ranking','seven-cities-ranking-24.json','--snapshot',SOURCE,'--catalog','seven-cities-catalog-17.json',
    '--retrieval','seven-cities-retrieval-15.json','--ledger','seven-cities-review-ledger-15.json',
    '--batches',*applied],check=True)
lines = ['# 本轮逐项原文阅读记录','','37项、454条当前有效提及已阅读；鼓浪屿107已撤回，中山路108-v2已应用并自查。','',
    '| 城市 | 地点 | 当前有效提及 | 结论与待办 |','| --- | --- | --- | --- |']
for r in record['reviews']:
    lines.append('| '+' | '.join([r['city'],r['name'],'、'.join(str(m['mentionId']) for m in r['mentions']),r['conclusion'].replace('|','／')])+' |')
lines += ['','证据：[阅读台账](research/seven-cities-semantic-readthrough-08.json)、[107恢复核验](research/batch-107-recovery-verification.json)。','']
(ROOT.parent/'七城本轮原文复核.md').write_text('\n'.join(lines),encoding='utf-8')
notes = ('107鼓浪屿旧媒体回归已双端审计撤回，七城旧状态完整恢复；53条/134.4分及旧1图保持，50篇阅读保留待应用。'
    '108-v2中山路49条/49全文已复核，新增三源联合scope/49分配，隔离15条、5条字段排除，现34条/89.71分、实体rev4。'
    '5363全简称事实引文门禁未过，保留有限路线及原描述待核；6808纯标签未知仍计潜在分。'
    '616地点双同步，关系113→111、强41→38、源版本8，严格媒体及facts预演通过。'
    'ranking24、台账15各210项、分差0无补位，catalog17的6911项、retrieval15的1新测/209完整行复用、flow94的210目标通过。'
    '4036来源/8798原提及/1051笔记/3737旧行/387旧媒体字段/201行程保持。90条非同体边界，37项/454有效提及阅读。'
    '8项算法排名风险、6处缺坐标；鼓浪屿媒体、上海馆区河岸等旧未决项保留，继续沙坡尾及其他六城候选。'
    '24研究回归、12同步契约、研究和全仓typecheck通过；未验收，不提交、不归档。')
for path in [ROOT.parent/'task.json',PARENT/'task.json']:
    task = read(path)
    assert task['status']=='in_progress' and task['completedAt'] is None
    task['notes']=notes
    task['meta']['sevenCityContinuation'].update(latestEntityBatch=108,latestAttemptedEntityBatch=108,
        latestValidatedEntityBatch=108,latestFlowRun=94,pendingSyncBatches=[],latestAppliedBatches=['batch-108-v2'],
        rolledBackBatches=['batch-107'],accepted=False,
        ranking='10-09-attraction-top30-governance/research/seven-cities-ranking-24.json',
        semanticReadthrough='10-09-attraction-top30-governance/research/seven-cities-semantic-readthrough-08.json',
        workingStage='108-v2中山路完整落地和自查通过；下一批109继续沙坡尾40条等，107鼓浪屿媒体范围暂缓。')
    path.write_text(json.dumps(task,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
next_evidence = read(ROOT/'seven-cities-next-evidence-10.json')
next_evidence.update(snapshotFile=SOURCE,snapshotSha256=sha,latestAppliedBatches=['batch-108-v2'],
    rolledBackBatches=['batch-107'],pendingSyncBatches=[],nextBatch=109,
    semanticReadthrough='seven-cities-semantic-readthrough-08.json')
for mid in [5363,6808]:
    m = next(m for m in city['mentions'] if m['id']==mid)
    next_evidence['nextEvidence'].append({'city':'厦门','entityId':eid,'mentionId':mid,'inputHash':m['inputHash'],
        'resolution':m['resolution'],'conclusion':'全简称事实引文门禁不支持，保留身份及原描述待核。' if mid==5363 else '仅标签，无原图主体证据，已隔离但仍计潜在分。'})
next_evidence['remainingReview'][0]='109从厦门沙坡尾40条、白城36条、黄厝34条、南普陀34条继续；其余五城未审候选继续。鼓浪屿107已撤回，50全文结论保留待媒体保全方案；集美大社也有旧媒体。'
write('seven-cities-next-evidence-11.json',next_evidence)
for name in ['进展记录.md','七城剩余问题.md']:
    with (ROOT.parent/name).open('a',encoding='utf-8') as file:
        file.write('\n## 第108-v2批与107恢复后的最新断点\n\n'+notes+'\n\n'
            '入口：[下一证据](research/seven-cities-next-evidence-11.json)、[原文阅读](七城本轮原文复核.md)、'
            '[107恢复](research/batch-107-recovery-verification.json)。\n')
print(json.dumps({'validatedBatch':'batch-108-v2','flowTargets':210,'readthroughEntities':37,'currentMentions':454,
    'nextBatch':109,'rolledBack':['batch-107'],'accepted':False}))
