"""固化植物园同体合并验证，明确区分合并完成与来源隔离待办。"""
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
SOURCE='snapshot-20261009T233649612752Z/input.json'
EID,OLD='410da5dd0d2e2802ead6a313bf030a19','6e83b872db3d9c874ce72af52afef625'
read=lambda path:json.loads(path.read_bytes())
raw=(ROOT/SOURCE).read_bytes()
current,sha=json.loads(raw),hashlib.sha256(raw).hexdigest()
rank_bytes=(ROOT/'seven-cities-ranking-28.json').read_bytes()
ranking=json.loads(rank_bytes)
assert ranking['snapshotSha256']==sha
for name in ['seven-cities-catalog-21.json','seven-cities-retrieval-19.json']:
    result=read(ROOT/name)
    assert result['passed'] and result['snapshotSha256']==sha
preserved=read(ROOT/'seven-cities-preservation-20.json')
assert preserved['passed'] and preserved['afterSha256']==sha
batches=['batch-108-v2','batch-109','batch-110','batch-111','batch-113']
assert preserved['batches']==batches
assert sum(len(c['changedEntityIds']) for c in preserved['cities'])==6
assert sum(c['newAssignments'] for c in preserved['cities'])==159
flow=read(B/'flow/run-98/report.json')
assert not flow['failures'] and read(B/'flow/run-98/cleanup.json')['removed']
assert (B/'flow/run-98/target-ranking.json').read_bytes()==rank_bytes
coverage=[]
old_ranking=read(ROOT/'seven-cities-ranking-27.json')
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

folder=B/'batch-113/sync-01'
assert read(B/'batch-113-applied.json')['apply']
assert read(B/'batch-113/preview-01/report.json')['checks']['primaryOperationalFactsAndProfilePreserved']
state=read(folder/'sync-state.json')
assert all(c.get('importedAt') and c.get('relationsImportedAt') and c.get('embeddingRunAt') for c in state['cities'].values())
checks=list(folder.glob('post-import-check-*.json'))
assert checks and all(not read(path)['failures'] for path in checks)
record=read(ROOT/'seven-cities-semantic-readthrough-13.json')
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
    assert len(rows)==32 and set(old_rows)=={m['id'] for m in rows}
    for m in rows:
        assert m['inputHash']==old_rows[m['id']]['inputHash']
        assert {k:v for k,v in m.items() if k not in {'entityId','resolution'}}=={
            k:v for k,v in old_rows[m['id']].items() if k not in {'entityId','resolution'}}
    evidence={n['noteId']:n['noteDescSha256'] for n in [*r['noteEvidence'],*r['additionalBoundaryMentions']]}
    assert len(evidence)==31 and set(evidence)=={m['raw_note_id'] for m in rows}
    assert all(hashlib.sha256(city['notes'][str(nid)]['note_desc'].encode()).hexdigest()==h for nid,h in evidence.items())
    r.update(expectedRevision=4,scope='113仅合并裸名：32当前提及/31篇全文；6248花展仍未隔离。',
        mentions=[{'mentionId':m['id'],'inputHash':m['inputHash'],'resolution':m['resolution']} for m in rows],
        noteEvidence=[{'noteId':nid,'noteDescSha256':h} for nid,h in sorted(evidence.items())],
        reviewedSourceMentionIds=sorted(old_rows),appliedIdentityBatch='batch-113',
        conclusion='113已将植物园裸名三条5451/5725/5998合并到厦门园林植物园，32条/31篇、83.72分、rev4；旧裸名ID重定向，主源2699旧位置与类别保持。原观点、票价、营业、预约、提示、内容和媒体字段逐字段保全；未新增完整scope，6248迎春花展仍待隔离，不能称来源全部清理。5500园内喷雾摄影保留；5952湿滑、6567绕路疲累、6678日照弱、6733错过喷雾无聊等原评价保持。万石山登山主体、钟鼓索道、入口和园区不合并，旧运营说法不升级为当前已核实事实。')
    r.pop('nextProposedBatch',None)
assert len(record['reviews'])==42 and sum(len(r['mentions']) for r in record['reviews'])==619
record.update(snapshotFile=SOURCE,snapshotSha256=sha,
    limits='42项/619当前有效提及已读；植物园仅同体合并，花展隔离待保全方案。南普陀112暂缓、鼓浪屿107已撤回，阅读不等于治理全部闭合。')
write('seven-cities-flow-coverage-18.json',{'passed':True,'run':'run-98','ranking':'seven-cities-ranking-28.json',
    'rankingSha256':hashlib.sha256(rank_bytes).hexdigest(),'cities':coverage,'failures':0,
    'temporaryDatabaseRemoved':True,'limits':'210身份候选/排程/保存/编辑/重访；不替代位置和实际路线可行性验证。'})
write('seven-cities-semantic-readthrough-14.json',record)
applied=[p.name.removesuffix('-applied.json') for p in B.glob('batch-*-applied.json')
    if 79<=int(re.search(r'batch-(\d+)',p.name).group(1))<=113
    and not (B/(p.name.removesuffix('-applied.json')+'-rolled-back.json')).exists()]
applied.sort(key=lambda name:(int(re.search(r'batch-(\d+)',name).group(1)),name))
subprocess.run([sys.executable,'-B',str(ROOT/'render-seven-review.py'),'--ranking','seven-cities-ranking-28.json',
    '--snapshot',SOURCE,'--catalog','seven-cities-catalog-21.json','--retrieval','seven-cities-retrieval-19.json',
    '--ledger','seven-cities-review-ledger-19.json','--batches',*applied],check=True)
lines=['# 本轮逐项原文阅读记录','','42项、619条当前有效提及已阅读；最新完整验证113。植物园花展隔离、112南普陀及107鼓浪屿待保全方案。','',
    '| 城市 | 地点 | 当前有效提及 | 结论与待办 |','| --- | --- | --- | --- |']
for r in record['reviews']:
    lines.append('| '+' | '.join([r['city'],r['name'],'、'.join(str(m['mentionId']) for m in r['mentions']),r['conclusion'].replace('|','／')])+' |')
lines+=['','证据：[阅读台账](research/seven-cities-semantic-readthrough-14.json)、[累计保全](research/seven-cities-preservation-20.json)。','']
(ROOT.parent/'七城本轮原文复核.md').write_text('\n'.join(lines),encoding='utf-8')
notes=('113植物园裸名3条同体合并已应用，主根32条/31篇、83.72分/rev4，旧ID重定向，旧位置/类别及运营资料/内容/媒体保全。'
    '花展6248完整scope仍待票价保全，南普陀112未应用、鼓浪屿107已撤回；不将同体合并当作全部来源已清。'
    '厦门615导出地点双同步、102关系/强34/来源版本12；ranking28及台账19各210项、分差0无补位，catalog21的6913检查、retrieval19的1新测/209完整行复用、flow98的210目标通过。'
    '自107恢复累计5批、6实体记录（含裸名重定向）、4新scope/159分配；4036来源/8798原提及/1051笔记/3737旧行/387旧媒体字段/201行程保持。'
    '42项/619当前有效提及已读，8项算法排名风险及6处缺坐标保留；继续厦大28条、环岛路26条及其他城市候选。8项合并回归通过。未验收，不提交、不归档。')
for path in [ROOT.parent/'task.json',PARENT/'task.json']:
    task=read(path)
    assert task['status']=='in_progress' and task['completedAt'] is None
    task['notes']=notes
    task['meta']['sevenCityContinuation'].update(latestEntityBatch=113,latestAttemptedEntityBatch=113,
        latestValidatedEntityBatch=113,latestFlowRun=98,latestAppliedBatches=batches,
        pendingSyncBatches=[],rolledBackBatches=['batch-107'],heldPreviewBatches=['batch-112'],accepted=False,
        ranking='10-09-attraction-top30-governance/research/seven-cities-ranking-28.json',
        semanticReadthrough='10-09-attraction-top30-governance/research/seven-cities-semantic-readthrough-14.json',
        workingStage='113植物园合并完整自查通过，无待同步；花展scope及南普陀运营保全、鼓浪屿媒体保全仍待解决，继续厦大与剩余候选。')
    path.write_text(json.dumps(task,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
next_evidence=read(ROOT/'seven-cities-next-evidence-16.json')
next_evidence.update(snapshotFile=SOURCE,snapshotSha256=sha,latestAppliedBatches=batches,nextBatch=114,
    semanticReadthrough='seven-cities-semantic-readthrough-14.json')
next_evidence['remainingReview'][0]='114继续厦大28条、环岛路26条和其它城市；植物园113裸名合并通过，6248花展仍待运营资料保全方案，南普陀112暂缓。'
for item in next_evidence['nextEvidence']:
    if item.get('mentionId')==6248:
        item['conclusion']='113裸名同体合并已应用，当前32条/83.72分/rev4；6248花展尚未scope隔离，须先解决旧票价保全。'
write('seven-cities-next-evidence-17.json',next_evidence)
for name in ['进展记录.md','七城剩余问题.md']:
    with (ROOT.parent/name).open('a',encoding='utf-8') as file:
        file.write('\n## 第113批后的最新断点\n\n'+notes+'\n\n入口：[下一证据](research/seven-cities-next-evidence-17.json)、[原文阅读](七城本轮原文复核.md)。\n')
print(json.dumps({'validatedBatch':113,'flowTargets':210,'readthroughEntities':42,'currentMentions':619,'accepted':False}))
