"""112预演发现旧运营资料消费变化，记录暂缓；不应用业务决定。"""
import copy
import hashlib
import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')
ROOT=Path(__file__).resolve().parent
PARENT=ROOT.parents[1]/'10-06-place-identity-governance'
B=PARENT/'research/all-cities'
FOLDER=B/'batch-112/preview-01'
SOURCE='snapshot-20261009T231058589044Z/input.json'
EID='d0e0f1dff1caee95784a31c71d9ac46f'
read=lambda path:json.loads(path.read_bytes())
assert not (B/'batch-112-applied.json').exists()
preview=read(FOLDER/'report.json')
assert preview['passed'] and preview['temporaryDatabaseRemoved']
before,after=[next(p for p in read(FOLDER/name)['places'] if p['id']==EID)
    for name in ['before.json','xhs-places-厦门.json']]
old,new=before['payload'],after['payload']
assert old['openHours']['text']=='08:00-17:30' and new['openHours']['status']=='unknown'
assert old['price']=='南普陀寺免费' and new.get('price') is None
assert {a['sourceKind'] for a in old['openHours']['attributions']}=={'image'}
a,b=copy.deepcopy(old['content']),copy.deepcopy(new['content'])
for content in [a,b]:
    content.pop('compiledAt',None)
assert a==b
assert len(after['payload']['mentionSources'])==33
raw=(ROOT/SOURCE).read_bytes()
snapshot=json.loads(raw)
city=next(c for c in snapshot['cities'] if c['city']=='厦门')
entity=next(e for e in city['entities'] if e['entity_id']==EID)
assert entity['revision']==3
mentions=[m for m in city['mentions'] if m['entityId']==EID]
assert len(mentions)==34 and len({m['raw_note_id'] for m in mentions})==30
scope,=read(B/'batch-112-scope-decisions.json')
evidence=scope['evidence'][0]
for n in [*evidence['reviewedNotes'],*evidence['additionalBoundaryNotes']]:
    assert hashlib.sha256(city['notes'][str(n['noteId'])]['note_desc'].encode()).hexdigest()==n['noteDescSha256']
def write(name,data):
    with (ROOT/name).open('x',encoding='utf-8') as file:
        json.dump(data,file,ensure_ascii=False,indent=2)
report={'batch':'batch-112','businessApplied':False,'sourceSnapshot':SOURCE,
    'snapshotSha256':hashlib.sha256(raw).hexdigest(),'existingPreviewPassed':True,
    'existingPreviewLimitation':'原检查覆盖提及字段、分类位置、媒体和其他实体；未要求目标旧运营字段保持。',
    'preservationGatePassed':False,'temporaryDatabaseRemoved':True,
    'exportHashes':{name:hashlib.sha256((FOLDER/name).read_bytes()).hexdigest()
        for name in ['before.json','xhs-places-厦门.json','restored.json']},
    'changes':[{'field':'openHours','beforeText':old['openHours']['text'],'afterStatus':new['openHours']['status'],
        'oldAttributedClauses':[a['clause'] for a in old['openHours']['attributions']],
        'sourceKind':'image','conclusion':'旧图文分别给出17:30/18:00结束时间；身份复核不能直接裁定删除，也不宣称当前官方运营已核。'},
        {'field':'price','before':old['price'],'after':new.get('price'),
         'conclusion':'旧免费字段在scope后不再消费，尚无本批删除依据。'}],
    'profilePreservedIgnoringCompiledAt':True,
    'resolution':'暂停应用112，保留实库旧消费及审核证据；需合法保全旧已归属资料，或在明确的资料治理范围内核定。不得伪造图片已审核、改原文或借名称纠错绕过来源治理。'}
write('batch-112-operational-preservation-hold.json',report)
record=read(ROOT/'seven-cities-semantic-readthrough-11.json')
assert record['snapshotSha256']==hashlib.sha256(raw).hexdigest()
record['reviews'].append({'city':'厦门','entityId':EID,'name':entity['canonical_name'],'expectedRevision':3,
    'identityRetained':True,'fullFactsReviewed':False,'scope':'34当前提及/30全文；112仅隔离预演，尚未应用。',
    'mentions':[{'mentionId':m['id'],'inputHash':m['inputHash'],'resolution':m['resolution']} for m in mentions],
    'noteEvidence':evidence['reviewedNotes'],'reviewedSourceMentionIds':[a['mentionId'] for a in scope['assignments']],
    'conclusion':evidence['conclusion']+' 以上为待应用结论；112预演使旧营业时间和免费字段退出消费，正式应用暂缓，6546仍在当前有效提及中。',
    'businessMutationByThisRecord':False,'userAcceptance':False,'pendingMentionIds':[6546],
    'proposedScopeBatch':'batch-112','applicationHeldFor':'existing_operational_facts_preservation'})
assert len(record['reviews'])==41 and sum(len(r['mentions']) for r in record['reviews'])==587
record['limits']='41项/587当前有效提及已读；南普陀112仅预演暂缓，鼓浪屿107已撤回，不能计为当前已应用来源治理。'
write('seven-cities-semantic-readthrough-12.json',record)
lines=['# 本轮逐项原文阅读记录','','41项、587条当前有效提及已阅读；中山路108-v2、沙坡尾109、白城110、黄厝111已应用。南普陀112预演后暂缓，鼓浪屿107已撤回。','',
    '| 城市 | 地点 | 当前有效提及 | 结论与待办 |','| --- | --- | --- | --- |']
for r in record['reviews']:
    lines.append('| '+' | '.join([r['city'],r['name'],'、'.join(str(m['mentionId']) for m in r['mentions']),r['conclusion'].replace('|','／')])+' |')
lines+=['','证据：[阅读台账](research/seven-cities-semantic-readthrough-12.json)、[112保全暂缓](research/batch-112-operational-preservation-hold.json)。','']
(ROOT.parent/'七城本轮原文复核.md').write_text('\n'.join(lines),encoding='utf-8')
note=('112南普陀34条/30全文已读，预演拟隔离1条酒店窗景、保留33条；但完整scope会清掉旧营业时间和免费票价，故未正式应用。'
    '原预演通过仅覆盖既有门禁，不能当运营资料保全通过。旧业务状态完整保留；不是图片文件丢失，也没有新增图片审核。'
    '当前最新已应用并完整验证批次仍111，ranking27/flow97不变。阅读累计41项/587当前有效提及，112只读待应用；继续113植物园29条。未验收，不提交、不归档。')
for path in [ROOT.parent/'task.json',PARENT/'task.json']:
    task=read(path)
    assert task['status']=='in_progress' and task['meta']['sevenCityContinuation']['latestValidatedEntityBatch']==111
    task['notes']+=' '+note
    task['meta']['sevenCityContinuation'].update(latestAttemptedEntityBatch=112,pendingSyncBatches=[],accepted=False,
        heldPreviewBatches=['batch-112'],semanticReadthrough='10-09-attraction-top30-governance/research/seven-cities-semantic-readthrough-12.json',
        workingStage='112南普陀预演后因旧运营资料消费变化暂缓，未应用；继续113植物园。111为最新完整验证批次。')
    path.write_text(json.dumps(task,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
next_evidence=read(ROOT/'seven-cities-next-evidence-14.json')
next_evidence.update(nextBatch=113,heldPreviewBatches=['batch-112'],
    semanticReadthrough='seven-cities-semantic-readthrough-12.json')
next_evidence['remainingReview'][0]='113从厦门植物园29条、厦大28条、环岛路26条继续；南普陀112已完整阅读但运营资料保全未过，暂缓应用。其他城市未审主体仍需推进。'
next_evidence['nextEvidence'].append({'city':'厦门','entityId':EID,'mentionId':6546,
    'conclusion':'酒店窗景来源错配已确认；112预演清除旧运营字段，保全未过暂不应用。当前仍34条/86.97分/rev3。',
    'evidence':'batch-112-operational-preservation-hold.json'})
write('seven-cities-next-evidence-15.json',next_evidence)
for name in ['进展记录.md','七城剩余问题.md','七城人工审核名单.md']:
    with (ROOT.parent/name).open('a',encoding='utf-8') as file:
        file.write('\n## 第112批预演暂缓\n\n'+note+'\n\n证据：[运营资料保全](research/batch-112-operational-preservation-hold.json)。\n')
print(json.dumps({'heldBatch':'batch-112','businessApplied':False,'latestValidatedBatch':111,
    'readthroughEntities':41,'currentMentions':587,'nextBatch':113,'accepted':False}))
