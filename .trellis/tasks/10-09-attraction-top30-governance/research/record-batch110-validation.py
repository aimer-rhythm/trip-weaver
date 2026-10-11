"""固化110白城及108-v2以来累计验证，保留用户待验收状态。"""
import ast
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')
ROOT = Path(__file__).resolve().parent
PARENT = ROOT.parents[1]/'10-06-place-identity-governance'
B = PARENT/'research/all-cities'
SOURCE = 'snapshot-20261009T224916589831Z/input.json'
read = lambda path: json.loads(path.read_bytes())
raw = (ROOT/SOURCE).read_bytes()
current,sha = json.loads(raw),hashlib.sha256(raw).hexdigest()
ranking_bytes = (ROOT/'seven-cities-ranking-26.json').read_bytes()
ranking = json.loads(ranking_bytes)
assert ranking['snapshotSha256']==sha
for name in ['seven-cities-catalog-19.json','seven-cities-retrieval-17.json']:
    result=read(ROOT/name)
    assert result['passed'] and result['snapshotSha256']==sha
preserved=read(ROOT/'seven-cities-preservation-18.json')
assert preserved['passed'] and preserved['afterSha256']==sha
assert preserved['batches']==['batch-108-v2','batch-109','batch-110']
assert sum(len(c['changedEntityIds']) for c in preserved['cities'])==3
assert sum(c['newAssignments'] for c in preserved['cities'])==125
flow=read(B/'flow/run-96/report.json')
assert not flow['failures'] and read(B/'flow/run-96/cleanup.json')['removed']
assert (B/'flow/run-96/target-ranking.json').read_bytes()==ranking_bytes
coverage=[]
old_ranking=read(ROOT/'seven-cities-ranking-25.json')
for city in ranking['cities']:
    old=next(c for c in old_ranking['cities'] if c['city']==city['city'])
    assert {p['entityId'] for p in old['top30']}=={p['entityId'] for p in city['top30']}
    assert all(p['score']==p['downstreamScore'] for p in city['top30'])
    target=next(c['targetCoverage'] for c in flow['cities'] if c['city']==city['city'])
    assert target['requested']==target['passed']==30 and target['snapshotSha256']==sha
    assert target['ids']==[p['entityId'] for p in city['top30']]
    coverage.append({'city':city['city'],**target})
assert sum(len(c['rankAffectingUncertainty']) for c in ranking['cities'])==8
def write(name,value):
    with (ROOT/name).open('x',encoding='utf-8') as file:
        json.dump(value,file,ensure_ascii=False,indent=2)
write('seven-cities-flow-coverage-16.json',{'passed':True,'run':'run-96','ranking':'seven-cities-ranking-26.json',
    'rankingSha256':hashlib.sha256(ranking_bytes).hexdigest(),'cities':coverage,'failures':0,
    'temporaryDatabaseRemoved':True,'limits':'210身份候选/排程/保存/编辑/重访，不表示位置与外部路线可行性通过。'})
folder=B/'batch-110/sync-01'
assert read(B/'batch-110-applied.json')['apply']
state=read(folder/'sync-state.json')
assert all(c.get('importedAt') and c.get('relationsImportedAt') and c.get('embeddingRunAt') for c in state['cities'].values())
checks=list(folder.glob('post-import-check-*.json'))
assert checks and all(not read(path)['failures'] for path in checks)
record=read(ROOT/'seven-cities-semantic-readthrough-09.json')
previous=read(ROOT/record['snapshotFile'])
for r in record['reviews']:
    old=next(c for c in previous['cities'] if c['city']==r['city'])
    city=next(c for c in current['cities'] if c['city']==r['city'])
    eid=r['entityId']
    assert old['notes']==city['notes']
    assert next(e for e in old['entities'] if e['entity_id']==eid)==next(e for e in city['entities'] if e['entity_id']==eid)
    assert [m for m in old['mentions'] if m['entityId']==eid]==[m for m in city['mentions'] if m['entityId']==eid]
    r['reusedAfterFullEntityMentionsAndNotesComparison']=True
city=next(c for c in current['cities'] if c['city']=='厦门')
scope,=read(B/'batch-110-scope-decisions.json')
eid,=scope['expectedRevisions']
entity=next(e for e in city['entities'] if e['entity_id']==eid)
mentions=[m for m in city['mentions'] if m['entityId']==eid]
assert entity['revision']==4 and len(mentions)==33
evidence=scope['evidence'][0]
assert len(evidence['reviewedNotes'])==36
for n in evidence['reviewedNotes']:
    assert hashlib.sha256(city['notes'][str(n['noteId'])]['note_desc'].encode()).hexdigest()==n['noteDescSha256']
record['reviews'].append({'city':'厦门','entityId':eid,'name':entity['canonical_name'],'expectedRevision':4,
    'identityRetained':True,'fullFactsReviewed':False,'scope':'36原提及/36全文，110批后33条有效；不是全量事实审核。',
    'mentions':[{'mentionId':m['id'],'inputHash':m['inputHash'],'resolution':m['resolution']} for m in mentions],
    'noteEvidence':evidence['reviewedNotes'],'reviewedSourceMentionIds':[a['mentionId'] for a in scope['assignments']],
    'conclusion':evidence['conclusion'],'businessMutationByThisRecord':False,'userAcceptance':False,
    'appliedScopeBatch':'batch-110','pendingMentionIds':[]})
assert len(record['reviews'])==39 and sum(len(r['mentions']) for r in record['reviews'])==523
record.update(snapshotFile=SOURCE,snapshotSha256=sha,
    limits='39项/523当前有效提及阅读，上海30候选及厦门4高分主体已读；不等于全部身份与类型闭合。鼓浪屿107已撤回，媒体保全方案待处理。')
write('seven-cities-semantic-readthrough-10.json',record)
applied=[p.name.removesuffix('-applied.json') for p in B.glob('batch-*-applied.json')
    if 79<=int(re.search(r'batch-(\d+)',p.name).group(1))<=110
    and not (B/(p.name.removesuffix('-applied.json')+'-rolled-back.json')).exists()]
applied.sort(key=lambda name:(int(re.search(r'batch-(\d+)',name).group(1)),name))
subprocess.run([sys.executable,'-B',str(ROOT/'render-seven-review.py'),'--ranking','seven-cities-ranking-26.json',
    '--snapshot',SOURCE,'--catalog','seven-cities-catalog-19.json','--retrieval','seven-cities-retrieval-17.json',
    '--ledger','seven-cities-review-ledger-17.json','--batches',*applied],check=True)
lines=['# 本轮逐项原文阅读记录','','39项、523条当前有效提及已阅读；中山路108-v2、沙坡尾109、白城110已应用和自查，鼓浪屿107已撤回。','',
    '| 城市 | 地点 | 当前有效提及 | 结论与待办 |','| --- | --- | --- | --- |']
for r in record['reviews']:
    lines.append('| '+' | '.join([r['city'],r['name'],'、'.join(str(m['mentionId']) for m in r['mentions']),r['conclusion'].replace('|','／')])+' |')
lines+=['','证据：[阅读台账](research/seven-cities-semantic-readthrough-10.json)、[107恢复核验](research/batch-107-recovery-verification.json)。','']
(ROOT.parent/'七城本轮原文复核.md').write_text('\n'.join(lines),encoding='utf-8')
notes=('110白城沙滩36条/36篇全文已复核；三源联合scope，隔离1条跨年烟花和2条酒店参照，33条/87.05分/rev4。'
    '原正负观点、位置、类别及评分策略保持，不新增事实排除或主体。厦门616地点双同步，关系104→102、强35保持、来源版本10。'
    'ranking26与台账17各210项，分差0无补位；catalog19共6911检查、retrieval17为1新测/209完整行复用、flow96明确覆盖210目标，均通过。'
    '自107恢复快照累计108-v2/109/110三实体、3新scope、125分配、22条隔离及5条按字段排除。'
    '4036来源/8798原提及/1051笔记/3737旧行/387旧媒体字段/201行程保持，字段数不是图片数。'
    '97条非同体边界，39项/523当前有效提及已读；仍8项算法排名风险、6处缺坐标。'
    '107鼓浪屿已双端撤回，53条/134.4分及旧1图保持，50篇阅读待媒体保全；集美大社旧媒体、5363全简称事实引文、6808纯标签与上海旧未决保留。'
    '继续111黄厝及剩余城市候选。未验收，不提交、不归档。')
for path in [ROOT.parent/'task.json',PARENT/'task.json']:
    task=read(path)
    assert task['status']=='in_progress' and task['completedAt'] is None
    task['notes']=notes
    task['meta']['sevenCityContinuation'].update(latestEntityBatch=110,latestAttemptedEntityBatch=110,
        latestValidatedEntityBatch=110,latestFlowRun=96,latestAppliedBatches=['batch-108-v2','batch-109','batch-110'],
        pendingSyncBatches=[],rolledBackBatches=['batch-107'],accepted=False,
        ranking='10-09-attraction-top30-governance/research/seven-cities-ranking-26.json',
        semanticReadthrough='10-09-attraction-top30-governance/research/seven-cities-semantic-readthrough-10.json',
        workingStage='110白城完整自查通过，无待同步；继续111黄厝34条及其余候选。107鼓浪屿已撤回并保留阅读，媒体范围待保全方案。')
    path.write_text(json.dumps(task,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
next_evidence=read(ROOT/'seven-cities-next-evidence-12.json')
next_evidence.update(snapshotFile=SOURCE,snapshotSha256=sha,latestAppliedBatches=['batch-108-v2','batch-109','batch-110'],
    rolledBackBatches=['batch-107'],pendingSyncBatches=[],nextBatch=111,
    semanticReadthrough='seven-cities-semantic-readthrough-10.json')
next_evidence['remainingReview'][0]='111从厦门黄厝34条、南普陀34条继续，广州成都杭州西安重庆未审主体仍需推进。鼓浪屿107已撤回，50全文结论待媒体保全方案，集美大社也有旧媒体。'
write('seven-cities-next-evidence-13.json',next_evidence)
for name in ['进展记录.md','七城剩余问题.md']:
    with (ROOT.parent/name).open('a',encoding='utf-8') as file:
        file.write('\n## 第110批后的最新断点\n\n'+notes+'\n\n'
            '入口：[下一证据](research/seven-cities-next-evidence-13.json)、[原文阅读](七城本轮原文复核.md)、'
            '[累计保全](research/seven-cities-preservation-18.json)。\n')
for name in ['govern-baicheng-scope.py','record-batch110-boundaries.py','record-batch110-validation.py']:
    ast.parse((ROOT/name).read_text(encoding='utf-8'))
print(json.dumps({'validatedBatch':'batch-110','flowTargets':210,'readthroughEntities':39,'currentMentions':523,
    'nextBatch':111,'rolledBack':['batch-107'],'accepted':False}))
