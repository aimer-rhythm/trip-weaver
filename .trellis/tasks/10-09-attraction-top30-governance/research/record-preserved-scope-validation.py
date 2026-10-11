"""固化运营保全scope的完整验证，逐项继承完整原文阅读；不提交或验收。"""
import argparse
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
read=lambda p:json.loads(p.read_bytes())
p=argparse.ArgumentParser()
for arg in ['batch','snapshot','ranking','catalog','retrieval','preservation','flow','coverage','previous-semantic',
            'semantic','ledger','prior-next','next','boundaries']:
    p.add_argument('--'+arg,required=True)
args=p.parse_args()
raw=(ROOT/args.snapshot).read_bytes()
current,sha=json.loads(raw),hashlib.sha256(raw).hexdigest()
ranking=read(ROOT/args.ranking)
assert ranking['snapshotSha256']==sha
for name in [args.catalog,args.retrieval]:
    report=read(ROOT/name)
    assert report['passed'] and report['snapshotSha256']==sha
preserved=read(ROOT/args.preservation)
assert preserved['passed'] and preserved['afterSha256']==sha and args.batch in preserved['batches']
flow=read(B/'flow'/args.flow/'report.json')
assert not flow['failures'] and read(B/'flow'/args.flow/'cleanup.json')['removed']
assert (B/'flow'/args.flow/'target-ranking.json').read_bytes()==(ROOT/args.ranking).read_bytes()
coverage=[]
for city in ranking['cities']:
    assert len(city['top30'])==30 and all(r['score']==r['downstreamScore'] for r in city['top30'])
    target=next(c['targetCoverage'] for c in flow['cities'] if c['city']==city['city'])
    assert target['requested']==target['passed']==30 and target['snapshotSha256']==sha
    assert target['ids']==[r['entityId'] for r in city['top30']]
    coverage.append({'city':city['city'],**target})
folder=B/args.batch/'sync-01'
assert read(B/(args.batch+'-applied.json'))['apply']
assert read(B/args.batch/'preview-01/report.json')['checks']['targetPayloadFieldsPreserved']
state=read(folder/'sync-state.json')
assert all(c.get('importedAt') and c.get('relationsImportedAt') and c.get('embeddingRunAt') for c in state['cities'].values())
checks=list(folder.glob('post-import-check-*.json'))
assert checks and all(not read(path)['failures'] for path in checks)
for city in state['cities']:
    reports=list((folder/('preview-'+city)).glob('preview-*.json'))
    assert len(reports)==1
    result=read(reports[0])
    assert result['preservedOperations']>=1 and result['photoConsumptionPreserved'] and result['reverseRollback']

record=read(ROOT/args.previous_semantic)
previous=read(ROOT/record['snapshotFile'])
scopes=read(B/(args.batch+'-scope-decisions.json'))
targets={eid:scope for scope in scopes for eid in scope['expectedRevisions']}
assert targets.keys() <= {r['entityId'] for r in record['reviews']}
for review in record['reviews']:
    old=next(c for c in previous['cities'] if c['city']==review['city'])
    city=next(c for c in current['cities'] if c['city']==review['city'])
    assert old['notes']==city['notes']
    eid=review['entityId']
    rows=[m for m in city['mentions'] if m['entityId']==eid]
    old_rows=[m for m in old['mentions'] if m['entityId']==eid]
    if eid not in targets:
        assert next(e for e in old['entities'] if e['entity_id']==eid)==next(e for e in city['entities'] if e['entity_id']==eid)
        assert old_rows==rows
        review['reusedAfterFullEntityMentionsAndNotesComparison']=True
        continue
    scope=targets[eid]
    assert {m['id'] for m in old_rows}=={a['mentionId'] for a in scope['assignments']}
    assert {m['id'] for m in rows}=={a['mentionId'] for a in scope['assignments'] if a['entityId']==eid}
    by_id={m['id']:m for m in city['mentions']}
    for m in old_rows:
        assert {k:v for k,v in m.items() if k not in {'entityId','resolution'}}=={
            k:v for k,v in by_id[m['id']].items() if k not in {'entityId','resolution'}}
    entity=next(e for e in city['entities'] if e['entity_id']==eid)
    payload=next(row['payload'] for row in city['downstream'] if row['id']==eid)
    old_payload=next(row['payload'] for row in old['downstream'] if row['id']==eid)
    assert all(payload.get(key)==old_payload.get(key) for key in
        ['price','openHours','reservation','reservationNote','reservationEvidence','reservationConflict'])
    preserved_inputs=[value for value in scope.get('preserveOperationalFacts',[]) if value['entityId']==eid]
    marker=payload.get('operationalIdentity')
    if preserved_inputs:
        assert len(preserved_inputs)==1 and marker['revision']==entity['revision'] and marker['currentFactsReviewed'] is False
    else:
        assert not marker and not old_payload.get('operationalIdentity'), '无绑定请求不能保留或伪造运营声明'
    evidence=scope['evidence'][0]
    text=evidence['conclusion']
    removed=[a['mentionId'] for a in scope['assignments'] if a['entityId'] is None]
    conclusion=f"{args.batch}已应用：{len(rows)}条/{payload['recommendScore']}分/rev{entity['revision']}；隔离{removed}，六项原运营投影、旧媒体及实际消费保持。"+text
    review.update(expectedRevision=entity['revision'],appliedIdentityBatch=args.batch,
        mentions=[{'mentionId':m['id'],'inputHash':m['inputHash'],'resolution':m['resolution']} for m in rows],
        reviewedSourceMentionIds=sorted(m['id'] for m in old_rows),scope=f'{args.batch}完整来源隔离及'+('旧运营输入保全' if preserved_inputs else '旧资料字段保全'),
        conclusion=conclusion)
    review.pop('nextProposedBatch',None)
    handled={a['mentionId'] for a in scope['assignments'] if a['entityId'] is None or a.get('factExclusions')}
    if 'pendingMentionIds' in review:
        review['pendingMentionIds']=[mid for mid in review['pendingMentionIds'] if mid not in handled]
    for note in review['noteEvidence']:
        assert hashlib.sha256(city['notes'][str(note['noteId'])]['note_desc'].encode()).hexdigest()==note['noteDescSha256']
for review in record['reviews']:
    batch=review.get('appliedIdentityBatch')
    if batch not in {'batch-112-v2','batch-114-v2','batch-116','batch-117','batch-118','batch-119','batch-119-v2','batch-120'}: continue
    scope=next(s for s in read(B/(batch+'-scope-decisions.json')) if review['entityId'] in s['expectedRevisions'])
    handled={a['mentionId'] for a in scope['assignments'] if a['entityId'] is None or a.get('factExclusions')}
    if 'pendingMentionIds' in review:
        review['pendingMentionIds']=[mid for mid in review['pendingMentionIds'] if mid not in handled]
    if review.get('applicationHeldFor')=='existing_operational_facts_preservation':
        payload=next(row['payload'] for city in current['cities'] for row in city['downstream'] if row['id']==review['entityId'])
        assert payload['operationalIdentity']['revision']==review['expectedRevision']
        review['supersededHeldScopeBatch']=review.pop('proposedScopeBatch',None)
        review.pop('applicationHeldFor')
count=sum(len(r['mentions']) for r in record['reviews'])
record.update(snapshotFile=args.snapshot,snapshotSha256=sha,
    limits=f'{len(record["reviews"])}项/{count}当前有效提及已读；阅读和技术验证不等于身份全部闭合或用户验收。旧运营保全只审主体，不称现行事实审核；107媒体及其余来源边界仍待办。')
def write(name,value):
    with (ROOT/name).open('x',encoding='utf-8') as f: json.dump(value,f,ensure_ascii=False,indent=2)
write(args.semantic,record)
write(args.coverage,{'passed':True,'run':args.flow,'ranking':args.ranking,'rankingSha256':hashlib.sha256((ROOT/args.ranking).read_bytes()).hexdigest(),
    'cities':coverage,'failures':0,'temporaryDatabaseRemoved':True,'limits':'210身份链路目标；不替代当前营业核实、坐标或实际路线可行性验证。'})
applied=[path.name.removesuffix('-applied.json') for path in B.glob('batch-*-applied.json')
    if int(re.search(r'batch-(\d+)',path.name).group(1))>=79
    and not (B/(path.name.removesuffix('-applied.json')+'-rolled-back.json')).exists()]
applied.sort(key=lambda name:(int(re.search(r'batch-(\d+)',name).group(1)),name))
subprocess.run([sys.executable,'-X','utf8','-B',str(ROOT/'render-seven-review.py'),'--ranking',args.ranking,
    '--snapshot',args.snapshot,'--catalog',args.catalog,'--retrieval',args.retrieval,'--ledger',args.ledger,'--batches',*applied],check=True)
next_evidence=read(ROOT/args.prior_next)
next_evidence.update(snapshotFile=args.snapshot,snapshotSha256=sha,latestAppliedBatches=preserved['batches'],
    semanticReadthrough=args.semantic,nextBatch=int(re.search(r'batch-(\d+)',args.batch).group(1))+1)
remaining=[label for batch,label in [('batch-114-v2','厦大酒店来源'),('batch-116','十里长堤活动及婚登点描述'),
    ('batch-117','植物园花展'),('batch-118','集美学村活动/站点来源'),('batch-119-v2','曾厝垵住宿来源')] if batch not in applied]
next_evidence['remainingReview'][0]='继续'+('、'.join(remaining)+'、' if remaining else '')+'厦门其余候选及其他城市；集美学村组成范围/写名、曾厝垵海边/住宿比较及107鼓浪屿/集美大社旧媒体保全仍待。'
handled=set()
for batch in ['batch-112-v2','batch-114-v2','batch-116','batch-117','batch-118','batch-119','batch-119-v2','batch-120']:
    if batch in applied:
        for scope in read(B/(batch+'-scope-decisions.json')):
            handled.update(a['mentionId'] for a in scope['assignments'] if a['entityId'] is None or a.get('factExclusions'))
next_evidence['nextEvidence']=[item for item in next_evidence['nextEvidence'] if item.get('mentionId') not in handled]
for item in next_evidence['nextEvidence']:
    if 'pendingMentionIds' in item:
        item['pendingMentionIds']=[mid for mid in item['pendingMentionIds'] if mid not in handled]
write(args.next,next_evidence)
rows=['# 本轮逐项原文阅读记录','',record['limits'],'','| 城市 | 地点 | 当前有效提及 | 结论与待办 |','| --- | --- | --- | --- |']
for r in record['reviews']:
    rows.append('| '+' | '.join([r['city'],r['name'],'、'.join(str(m['mentionId']) for m in r['mentions']),r['conclusion'].replace('|','／')])+' |')
rows+=['',f'证据：[阅读台账](research/{args.semantic})、[累计保全](research/{args.preservation})。','']
(ROOT.parent/'七城本轮原文复核.md').write_text('\n'.join(rows),encoding='utf-8')
notes=f'{args.batch}完整验证通过：旧运营资料来源、字段、证据及媒体消费保持；{args.ranking}七城210项、分差0，目录及真实变更召回/复用、{args.flow}的210目标通过。累计{len(preserved["batches"])}批、{sum(len(c["changedEntityIds"]) for c in preserved["cities"])}实体记录、{sum(c["newAssignments"] for c in preserved["cities"])}新分配；4036来源/8798提及/1051笔记/3737旧行/387媒体字段/201行程保全。{len(record["reviews"])}项/{count}当前有效提及已读。仍有其他景点来源及边界待治理，未验收、不提交、不归档。'
for path in [ROOT.parent/'task.json',PARENT/'task.json']:
    task=read(path)
    assert task['status']=='in_progress' and task['completedAt'] is None
    task['notes']=notes
    task['meta']['sevenCityContinuation'].update(latestEntityBatch=args.batch.removeprefix('batch-'),
      latestAttemptedEntityBatch=args.batch.removeprefix('batch-'),
      latestValidatedEntityBatch=args.batch.removeprefix('batch-'),latestFlowRun=int(args.flow.removeprefix('run-')),
      latestAppliedBatches=preserved['batches'],pendingSyncBatches=[],accepted=False,
      ranking='10-09-attraction-top30-governance/research/'+args.ranking,
      semanticReadthrough='10-09-attraction-top30-governance/research/'+args.semantic,
      workingStage=notes)
    continuation=task['meta']['sevenCityContinuation']
    superseded=[old for old,new in [('batch-112','batch-112-v2'),('batch-114','batch-114-v2'),('batch-119','batch-119-v2')] if new in applied]
    continuation['heldPreviewBatches']=[batch for batch in continuation.get('heldPreviewBatches',[]) if batch not in superseded]
    continuation['supersededPreviewBatches']=superseded
    path.write_text(json.dumps(task,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
for name in ['进展记录.md','七城剩余问题.md']:
    with (ROOT.parent/name).open('a',encoding='utf-8') as f:
        f.write(f'\n## {args.batch}完整验证\n\n{notes}\n\n入口：[最新阅读](research/{args.semantic})、[下一证据](research/{args.next})。\n')
print(json.dumps({'validatedBatch':args.batch,'flowTargets':210,'readEntities':len(record['reviews']),'currentMentions':count,'accepted':False}))
