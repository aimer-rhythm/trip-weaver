"""固化环岛路同体合并验证及累计七城保全。"""
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')
ROOT=Path(__file__).resolve().parent
PARENT=ROOT.parents[1]/'10-06-place-identity-governance'
B=PARENT/'research/all-cities'
SOURCE='snapshot-20261009T234942074836Z/input.json'
EID,OLD='13abadcd531dd9b70a031c9925f096f0','6ed8ab805ffd7c46bdacd535030ab4f6'
read=lambda path:json.loads(path.read_bytes())
raw=(ROOT/SOURCE).read_bytes()
current,sha=json.loads(raw),hashlib.sha256(raw).hexdigest()
rank_bytes=(ROOT/'seven-cities-ranking-29.json').read_bytes()
ranking=json.loads(rank_bytes)
assert ranking['snapshotSha256']==sha
for name in ['seven-cities-catalog-22.json','seven-cities-retrieval-20.json']:
    result=read(ROOT/name)
    assert result['passed'] and result['snapshotSha256']==sha
preserved=read(ROOT/'seven-cities-preservation-21.json')
assert preserved['passed'] and preserved['afterSha256']==sha
batches=['batch-108-v2','batch-109','batch-110','batch-111','batch-113','batch-115']
assert preserved['batches']==batches
assert sum(len(c['changedEntityIds']) for c in preserved['cities'])==8
assert sum(c['newAssignments'] for c in preserved['cities'])==159
flow=read(B/'flow/run-99/report.json')
assert not flow['failures'] and read(B/'flow/run-99/cleanup.json')['removed']
assert (B/'flow/run-99/target-ranking.json').read_bytes()==rank_bytes
coverage=[]
old_ranking=read(ROOT/'seven-cities-ranking-28.json')
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

folder=B/'batch-115/sync-01'
assert read(B/'batch-115-applied.json')['apply']
assert read(B/'batch-115/preview-01/report.json')['checks']['primaryOperationalFactsAndProfilePreserved']
state=read(folder/'sync-state.json')
assert all(c.get('importedAt') and c.get('relationsImportedAt') and c.get('embeddingRunAt') for c in state['cities'].values())
checks=list(folder.glob('post-import-check-*.json'))
assert checks and all(not read(path)['failures'] for path in checks)
record=read(ROOT/'seven-cities-semantic-readthrough-15.json')
previous=read(ROOT/record['snapshotFile'])
for r in record['reviews']:
    old=next(c for c in previous['cities'] if c['city']==r['city'])
    city=next(c for c in current['cities'] if c['city']==r['city'])
    eid=r['entityId']
    assert old['notes']==city['notes']
    if eid!=EID:
        assert next(e for e in old['entities'] if e['entity_id']==eid)==next(e for e in city['entities'] if e['entity_id']==eid)
        assert [m for m in old['mentions'] if m['entityId']==eid]==[m for m in city['mentions'] if m['entityId']==eid]
        r['reusedAfterFullEntityMentionsAndNotesComparison']=True
        continue
    old_rows={m['id']:m for m in old['mentions'] if m['entityId'] in {EID,OLD}}
    rows=[m for m in city['mentions'] if m['entityId']==EID]
    assert len(rows)==27 and set(old_rows)=={m['id'] for m in rows}
    for m in rows:
        assert m['inputHash']==old_rows[m['id']]['inputHash']
        assert {k:v for k,v in m.items() if k not in {'entityId','resolution'}}=={
            k:v for k,v in old_rows[m['id']].items() if k not in {'entityId','resolution'}}
    evidence={n['noteId']:n['noteDescSha256'] for n in [*r['noteEvidence'],*r['additionalBoundaryMentions']]}
    assert len(evidence)==26 and set(evidence)=={m['raw_note_id'] for m in rows}
    assert all(hashlib.sha256(city['notes'][str(nid)]['note_desc'].encode()).hexdigest()==h for nid,h in evidence.items())
    r.update(expectedRevision=2,scope='115同体合并：27当前提及/26篇全文；长道路定位及骑行规则不在本轮核准。',
        mentions=[{'mentionId':m['id'],'inputHash':m['inputHash'],'resolution':m['resolution']} for m in rows],
        noteEvidence=[{'noteId':nid,'noteDescSha256':h} for nid,h in sorted(evidence.items())],
        reviewedSourceMentionIds=sorted(old_rows),appliedIdentityBatch='batch-115',
        conclusion='115已将厦门环岛路5666并入环岛路，27条/26篇、71.44分、rev2；旧全称ID重定向，主源2537旧位置及文化类别保持。原运营资料、免费字段、内容及媒体逐字段保全，不新增完整scope。5530/5548/6082是道路骑行避坑提醒，6529步行费脚等原观点保持；6759属于明确生成文案，不称亲历。另一路段源2786旧点不替换主源，不将长路点坐标当完整路线验证；电动车许可冲突保留，不在身份轮判定。沙滩、音乐广场、店铺和独立机位不合并。')
    r.pop('nextProposedBatch',None)
assert len(record['reviews'])==44 and sum(len(r['mentions']) for r in record['reviews'])==674
record.update(snapshotFile=SOURCE,snapshotSha256=sha,
    limits='44项/674当前有效提及已读；植物园113及环岛路115仅同体合并。南普陀112和厦大114因运营保全暂缓，鼓浪屿107已撤回，阅读不等于全部治理闭合。')
write('seven-cities-flow-coverage-19.json',{'passed':True,'run':'run-99','ranking':'seven-cities-ranking-29.json',
    'rankingSha256':hashlib.sha256(rank_bytes).hexdigest(),'cities':coverage,'failures':0,
    'temporaryDatabaseRemoved':True,'limits':'210身份候选/排程/保存/编辑/重访；不替代位置和实际路线可行性验证。'})
write('seven-cities-semantic-readthrough-16.json',record)
applied=[p.name.removesuffix('-applied.json') for p in B.glob('batch-*-applied.json')
    if 79<=int(re.search(r'batch-(\d+)',p.name).group(1))<=115
    and not (B/(p.name.removesuffix('-applied.json')+'-rolled-back.json')).exists()]
applied.sort(key=lambda name:(int(re.search(r'batch-(\d+)',name).group(1)),name))
subprocess.run([sys.executable,'-B',str(ROOT/'render-seven-review.py'),'--ranking','seven-cities-ranking-29.json',
    '--snapshot',SOURCE,'--catalog','seven-cities-catalog-22.json','--retrieval','seven-cities-retrieval-20.json',
    '--ledger','seven-cities-review-ledger-20.json','--batches',*applied],check=True)
lines=['# 本轮逐项原文阅读记录','','44项、674条当前有效提及已阅读；最新完整验证115。植物园花展隔离、112南普陀、114厦大及107鼓浪屿待保全方案。','',
    '| 城市 | 地点 | 当前有效提及 | 结论与待办 |','| --- | --- | --- | --- |']
for r in record['reviews']:
    lines.append('| '+' | '.join([r['city'],r['name'],'、'.join(str(m['mentionId']) for m in r['mentions']),r['conclusion'].replace('|','／')])+' |')
lines+=['','证据：[阅读台账](research/seven-cities-semantic-readthrough-16.json)、[累计保全](research/seven-cities-preservation-21.json)。','']
(ROOT.parent/'七城本轮原文复核.md').write_text('\n'.join(lines),encoding='utf-8')
notes='115环岛路与厦门环岛路同体合并落地，27条/26篇、71.44分/rev2，旧全称ID重定向，旧位置/类别及运营资料/内容/媒体严格保全。厦门614地点双同步、102关系/强34/来源版本13；ranking29与台账20各210项、分差0无补位，catalog22的6915检查、retrieval20的1新测/209完整行复用、flow99的210目标通过。自107恢复累计6批/8实体记录（含2个重定向）、4新scope/159分配；4036来源/8798原提及/1051笔记/3737旧行/387旧媒体字段/201行程保持。44项/674当前有效提及已读，8项算法排名风险/6处缺坐标仍在；112南普陀和114厦大因旧运营保全暂缓、植物园花展待隔离、107鼓浪屿已撤回及集美大社旧媒体待保全。十里长堤24条已开始复核，继续其余城市。24研究回归通过。未验收，不提交、不归档。'
for path in [ROOT.parent/'task.json',PARENT/'task.json']:
    task=read(path)
    assert task['status']=='in_progress' and task['completedAt'] is None
    task['notes']=notes
    task['meta']['sevenCityContinuation'].update(latestEntityBatch=115,latestAttemptedEntityBatch=115,
        latestValidatedEntityBatch=115,latestFlowRun=99,latestAppliedBatches=batches,
        pendingSyncBatches=[],rolledBackBatches=['batch-107'],heldPreviewBatches=['batch-112','batch-114'],accepted=False,
        ranking='10-09-attraction-top30-governance/research/seven-cities-ranking-29.json',
        semanticReadthrough='10-09-attraction-top30-governance/research/seven-cities-semantic-readthrough-16.json',
        workingStage='115环岛路合并完整自查通过，无待同步；112/114运营保全与107媒体待办保留，继续十里长堤与剩余城市候选。')
    path.write_text(json.dumps(task,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
next_evidence=read(ROOT/'seven-cities-next-evidence-18.json')
next_evidence.update(snapshotFile=SOURCE,snapshotSha256=sha,latestAppliedBatches=batches,nextBatch=116,
    semanticReadthrough='seven-cities-semantic-readthrough-16.json')
next_evidence['remainingReview'][0]='116继续十里长堤24条、集美学村22条、曾厝垵22条及其它城市；112/114运营保全、植物园6248花展和107媒体暂缓保留。'
for item in next_evidence['nextEvidence']:
    if item.get('mentionId')==6248:
        item['conclusion']='113裸名同体合并已应用，当前32条/83.72分/rev4；6248花展尚未scope隔离，须先解决旧票价保全。'
write('seven-cities-next-evidence-19.json',next_evidence)
for name in ['进展记录.md','七城剩余问题.md']:
    with (ROOT.parent/name).open('a',encoding='utf-8') as file:
        file.write('\n## 第115批后的最新断点\n\n'+notes+'\n\n入口：[下一证据](research/seven-cities-next-evidence-19.json)、[原文阅读](七城本轮原文复核.md)。\n')
print(json.dumps({'validatedBatch':115,'flowTargets':210,'readthroughEntities':44,'currentMentions':674,'accepted':False}))
