"""记录114严格保全失败及环岛路全文阅读；不写业务库。"""
import hashlib
import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')
ROOT=Path(__file__).resolve().parent
PARENT=ROOT.parents[1]/'10-06-place-identity-governance'
B=PARENT/'research/all-cities'
read=lambda p:json.loads(p.read_bytes())
record=read(ROOT/'seven-cities-semantic-readthrough-14.json')
raw=(ROOT/record['snapshotFile']).read_bytes()
assert record['snapshotSha256']==hashlib.sha256(raw).hexdigest()
city=next(c for c in json.loads(raw)['cities'] if c['city']=='厦门')
folder=B/'batch-114/preview-01'
preview=read(folder/'report.json')
assert not preview['passed'] and preview['temporaryDatabaseRemoved']
assert preview['checks']['reverseRollback'] and not preview['checks']['targetPayloadFieldsPreserved']
assert not (B/'batch-114-applied.json').exists()
assert {d['field'] for d in preview['preservationDifferences']}=={'openHours','price','reservationNote','reservationEvidence'}
university='cbe09e6c7cf0420523c91d5361069f6a'
old,new=[next(p['payload'] for p in read(folder/name)['places'] if p['id']==university)
    for name in ['before.json','xhs-places-厦门.json']]
assert old['openHours']['text']=='08:00-17:00' and new['openHours']['status']=='unknown'
assert old['price']=='厦门大学免费需预约' and not new.get('price')
assert old['reservation']==new['reservation']=='required'
scope,=read(B/'batch-114-scope-decisions.json')
known={n['noteId']:n['noteDescSha256'] for r in record['reviews'] if r['city']=='厦门' for n in r['noteEvidence']}

def write(name,value):
    with (ROOT/name).open('x',encoding='utf-8') as file:
        json.dump(value,file,ensure_ascii=False,indent=2)

write('batch-114-operational-preservation-hold.json',{'batch':'batch-114','businessApplied':False,
    'sourceSnapshot':record['snapshotFile'],'snapshotSha256':record['snapshotSha256'],
    'preservationGatePassed':False,'temporaryDatabaseRemoved':True,'reverseRollbackPassed':True,
    'differences':preview['preservationDifferences'],
    'exportHashes':{name:hashlib.sha256((folder/name).read_bytes()).hexdigest()
        for name in ['before.json','xhs-places-厦门.json','restored.json']},
    'operationalChanges':{'oldHours':old['openHours']['text'],'newHoursStatus':new['openHours']['status'],
        'oldPrice':old['price'],'newPrice':new.get('price'),'reservationRequiredPreserved':True},
    'applyGateRejectionVerified':True,
    'conclusion':'隔离酒店两条的提及与逆序回滚验证通过，但旧营业/票价退出，预约证据及备注变动；严格预演整体失败且应用入口已实测拒绝，实库仍28条/rev1。旧图文有营业冲突，此轮既不认定其现行正确，也不能无身份依据删除；须保全方案后新版本预演。'})
for eid,total,note_count,newly in [(university,28,27,set()),('13abadcd531dd9b70a031c9925f096f0',26,25,{1346,1350,1456})]:
    entity=next(e for e in city['entities'] if e['entity_id']==eid)
    mentions=[m for m in city['mentions'] if m['entityId']==eid]
    ids={m['raw_note_id'] for m in mentions}
    assert len(mentions)==total and len(ids)==note_count and ids-known.keys()==newly
    for nid in ids & known.keys():
        assert hashlib.sha256(city['notes'][str(nid)]['note_desc'].encode()).hexdigest()==known[nid]
    evidence=[{'noteId':nid,'noteDescSha256':hashlib.sha256(city['notes'][str(nid)]['note_desc'].encode()).hexdigest()} for nid in sorted(ids)]
    r={'city':'厦门','entityId':eid,'name':entity['canonical_name'],'expectedRevision':1,
        'identityRetained':True,'fullFactsReviewed':False,
        'scope':f'{total}当前提及/{note_count}全文；阅读并保留未应用结论。',
        'mentions':[{'mentionId':m['id'],'inputHash':m['inputHash'],'resolution':m['resolution']} for m in mentions],
        'noteEvidence':evidence,'reviewedSourceMentionIds':[m['id'] for m in mentions],
        'reusedNoteCount':len(ids & known.keys()),'newlyReadNoteIds':sorted(newly),
        'businessMutationByThisRecord':False,'userAcceptance':False}
    if eid==university:
        r.update(conclusion=scope['evidence'][0]['conclusion']+' 114严格预演已失败并逆序恢复，旧营业/票价及预约来源保全未过；实库仍28条/71.29分/rev1，酒店6545/6596尚未隔离。',
            pendingMentionIds=[6545,6596],proposedScopeBatch='batch-114',applicationHeldFor='existing_operational_facts_preservation')
    else:
        extra=next(m for m in city['mentions'] if m['id']==5666)
        assert extra['entityId']=='6ed8ab805ffd7c46bdacd535030ab4f6'
        r.update(conclusion='26条/25全文已读，22篇与前序已读笔记哈希一致，另1346/1350/1456完整阅读，5666同体候选原文1260已复核。环岛路骑行/看海与步行身份保留；5530/5548/6082是针对路上骑行的租车避坑提醒，不是已确认独立商户服务，不机械隔离或删除负评。6529步行费脚保留，6759来自明确生成文案，不声称亲历。骑电动车可行与被查扣相互冲突，保留各作者旧说法，不在身份轮判定现行交通许可。6709虽有别墅住宿段，但下午独立推荐环岛路骑行；不因酒店话题整条移出。5666正文明确沿环岛路从黄厝到曾厝垵、白城，支持厦门环岛路同体合并，尚未应用。主根2537旧坐标位于湖里，另一源2786在思明南路段；本轮保留主根旧位置，地点是一条长道路，不能将点坐标当整条路线或宣称行程定位核准。沙滩、音乐广场、店铺与独立机位不合并，道路源自身旧免费资料保全后再落地。',
            additionalBoundaryMentions=[{'mentionId':5666,'entityId':extra['entityId'],'inputHash':extra['inputHash'],
                'noteId':1260,'noteDescSha256':hashlib.sha256(city['notes']['1260']['note_desc'].encode()).hexdigest()}],
            pendingMentionIds=[],nextProposedBatch='batch-115')
    record['reviews'].append(r)
assert len(record['reviews'])==44 and sum(len(r['mentions']) for r in record['reviews'])==673
record['limits']='44项/673当前有效提及阅读；厦大114严格预演暂缓，环岛路26条及1条同体候选已读未合并；最新正式完整验证113。'
write('seven-cities-semantic-readthrough-15.json',record)
lines=['# 本轮逐项原文阅读记录','','44项、673条当前有效提及已读；114厦大因旧运营资料保全暂缓，115环岛路合并待预演。','',
    '| 城市 | 地点 | 当前有效提及 | 结论与待办 |','| --- | --- | --- | --- |']
for r in record['reviews']:
    lines.append('| '+' | '.join([r['city'],r['name'],'、'.join(str(m['mentionId']) for m in r['mentions']),r['conclusion'].replace('|','／')])+' |')
lines+=['','证据：[阅读台账](research/seven-cities-semantic-readthrough-15.json)、[114严格保全](research/batch-114-operational-preservation-hold.json)。','']
(ROOT.parent/'七城本轮原文复核.md').write_text('\n'.join(lines),encoding='utf-8')
note='114厦大28条/27全文已读，拟隔离2条酒店窗景；预演因旧营业/票价及预约证据变动失败，回滚和临时库删除通过，--apply实测拒绝，未应用。环岛路26条/25全文和5666同体候选已读，拟115合并，旧位置与骑行政策争议保留。44项/673当前有效提及已读，最新完整验证仍113/ranking28/flow98。'
next_evidence=read(ROOT/'seven-cities-next-evidence-17.json')
next_evidence.update(nextBatch=115,heldPreviewBatches=['batch-112','batch-114'],semanticReadthrough='seven-cities-semantic-readthrough-15.json')
next_evidence['remainingReview'][0]='115核验环岛路与厦门环岛路同体合并，再推进十里长堤/八市/曾厝垵等及其他城市；厦大114和南普陀112暂缓，植物园花展待保全方案。'
for mid in [6545,6596]:
    next_evidence['nextEvidence'].append({'city':'厦门','entityId':university,'mentionId':mid,
        'conclusion':'114酒店窗景隔离预演因旧运营资料保全失败，尚未应用。','evidence':'batch-114-operational-preservation-hold.json'})
write('seven-cities-next-evidence-18.json',next_evidence)
for path in [ROOT.parent/'task.json',PARENT/'task.json']:
    task=read(path)
    assert task['status']=='in_progress' and task['meta']['sevenCityContinuation']['latestValidatedEntityBatch']==113
    task['notes']+=' '+note
    task['meta']['sevenCityContinuation'].update(latestAttemptedEntityBatch=114,heldPreviewBatches=['batch-112','batch-114'],
        semanticReadthrough='10-09-attraction-top30-governance/research/seven-cities-semantic-readthrough-15.json',
        workingStage='114严格预演暂缓；115继续环岛路同体合并与剩余候选，113为最新完整验证。',accepted=False)
    path.write_text(json.dumps(task,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
for name in ['进展记录.md','七城剩余问题.md','七城人工审核名单.md']:
    with (ROOT.parent/name).open('a',encoding='utf-8') as file:
        file.write('\n## 厦大暂缓与环岛路阅读\n\n'+note+'\n\n入口：[下一证据](research/seven-cities-next-evidence-18.json)。\n')
print(json.dumps({'heldBatch':114,'latestValidatedBatch':113,'readthroughEntities':44,'currentMentions':673,'accepted':False}))
