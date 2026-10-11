"""保存十里长堤24条全文复核与待隔离结论，不执行业务写入。"""
import hashlib
import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')
ROOT=Path(__file__).resolve().parent
PARENT=ROOT.parents[1]/'10-06-place-identity-governance'
read=lambda path:json.loads(path.read_bytes())
record=read(ROOT/'seven-cities-semantic-readthrough-16.json')
raw=(ROOT/record['snapshotFile']).read_bytes()
assert hashlib.sha256(raw).hexdigest()==record['snapshotSha256']
city=next(c for c in json.loads(raw)['cities'] if c['city']=='厦门')
eid='b5aafe8228f99dca3ab61421b4452cf4'
entity=next(e for e in city['entities'] if e['entity_id']==eid)
assert entity['revision']==3 and entity['primary_place_id']==2630
mentions=[m for m in city['mentions'] if m['entityId']==eid]
ids={m['raw_note_id'] for m in mentions}
assert len(mentions)==len(ids)==24
known={n['noteId']:n['noteDescSha256'] for r in record['reviews'] if r['city']=='厦门' for n in r['noteEvidence']}
assert ids-known.keys()=={1517}
previous=next(c for c in read(ROOT/'snapshot-20261009T233649612752Z/input.json')['cities'] if c['city']=='厦门')
for nid in ids&known.keys():
    assert previous['notes'][str(nid)]==city['notes'][str(nid)]
    assert hashlib.sha256(city['notes'][str(nid)]['note_desc'].encode()).hexdigest()==known[nid]
quotes=[(1451,'🆕十里长堤草坪音乐会🔥'),(1453,'·十里长堤草坪音乐会（看日落版）'),
    (1513,'🆕集美十里长堤、集美大社中秋活动'),
    (1327,'📍集美学村 → 十里长堤 → 婚登点'),
    (1517,'📍十里长堤\n看日落就来这里🌄能看到夕阳下驶过的海上地铁，傍晚还有街头乐队驻唱，氛围超级好。')]
for nid,quote in quotes:
    assert quote in city['notes'][str(nid)]['note_desc']
conclusion=('24条/24篇完整正文已读，23篇与前序原笔记全部字段及正文哈希保持，补读1517集美路线全文。'
    '6180/6244只有春节草坪音乐会，6690只有中秋活动清单，三条应隔离活动来源，尚未应用。'
    '6435正文明确把十里长堤与婚登点分别列在路线，故保留普通长堤路线身份；婚登装置及其设施描述需单独排除或补证，不将婚登点自动合并成整片长堤。'
    '6717虽结尾推广行李寄存，但有完整长堤观日落路线，保留景点本身推荐。5977虽正文后段卖车推广，免费摄影清单仍独立列出长堤，不全篇隔离。'
    '6087泥巴多、人多但喜欢热闹可晚上去的完整正反体验保持；6337海边涨潮风险、小山坡与原设施评价保持，不裁定现行露营许可。'
    '6235/6521为长堤露营和海景停车清单，未证实独立经营营地；不因露天电影/集市/婚登等词自动移除真实地点身份。'
    '主源2630与旧集美十里长堤2561既有归并保持，地铁站、南堤公园、婚登点和集美学村不合并；旧点位与桥名描述不作为本轮新地理核准。'
    '当前有旧价格字段、无旧媒体；完整scope前须解决运营资料保全，不重复112/114无旧票价输出的损失。116尚未建立业务决定，当前仍24条/64.79分/rev3。')
record['reviews'].append({'city':'厦门','entityId':eid,'name':entity['canonical_name'],'expectedRevision':3,
    'identityRetained':True,'fullFactsReviewed':False,'scope':'24当前提及/24篇全文，只读，116尚未应用。',
    'mentions':[{'mentionId':m['id'],'inputHash':m['inputHash'],'resolution':m['resolution']} for m in mentions],
    'noteEvidence':[{'noteId':nid,'noteDescSha256':hashlib.sha256(city['notes'][str(nid)]['note_desc'].encode()).hexdigest()} for nid in sorted(ids)],
    'reviewedSourceMentionIds':[m['id'] for m in mentions],
    'noteQuotes':[{'noteId':nid,'quote':quote} for nid,quote in quotes],
    'reusedAfterFullNotesComparison':True,'reusedNoteCount':23,'newlyReadNoteIds':[1517],
    'conclusion':conclusion,'businessMutationByThisRecord':False,'userAcceptance':False,
    'pendingMentionIds':[6180,6244,6435,6690],'nextProposedBatch':'batch-116'})
assert len(record['reviews'])==45 and sum(len(r['mentions']) for r in record['reviews'])==698
record['limits']='45项/698当前有效提及已读；十里长堤仅阅读，112/114暂缓，107已撤回；最新正式完整验证115，未闭合事项继续列出。'
def write(name,value):
    with (ROOT/name).open('x',encoding='utf-8') as file:
        json.dump(value,file,ensure_ascii=False,indent=2)
write('seven-cities-semantic-readthrough-17.json',record)
lines=['# 本轮逐项原文阅读记录','','45项、698条当前有效提及已读；最新完整验证115。十里长堤待隔离，112/114运营资料与107媒体保全待办仍在。','',
    '| 城市 | 地点 | 当前有效提及 | 结论与待办 |','| --- | --- | --- | --- |']
for r in record['reviews']:
    lines.append('| '+' | '.join([r['city'],r['name'],'、'.join(str(m['mentionId']) for m in r['mentions']),r['conclusion'].replace('|','／')])+' |')
lines+=['','证据：[阅读台账](research/seven-cities-semantic-readthrough-17.json)、[累计保全](research/seven-cities-preservation-21.json)。','']
(ROOT.parent/'七城本轮原文复核.md').write_text('\n'.join(lines),encoding='utf-8')
next_evidence=read(ROOT/'seven-cities-next-evidence-19.json')
next_evidence['semanticReadthrough']='seven-cities-semantic-readthrough-17.json'
next_evidence['remainingReview'][0]='十里长堤24条已读，116拟隔离6180/6244/6690活动并处理6435婚登点描述，尚未建决定；须先解决旧运营资料保全，继续集美学村22条、曾厝垵22条与其他城市候选。'
for mid in [6180,6244,6435,6690]:
    m=next(m for m in mentions if m['id']==mid)
    next_evidence['nextEvidence'].append({'city':'厦门','entityId':eid,'mentionId':mid,'inputHash':m['inputHash'],
        'resolution':m['resolution'],'conclusion':'6435保留长堤路线身份，婚登点具体描述待核；其余三条为限时活动待隔离。尚未应用，运营资料保全先行。' if mid==6435 else '限时音乐会或中秋活动，未独立游览长堤，待隔离；完整scope须先保全旧运营资料。'})
write('seven-cities-next-evidence-20.json',next_evidence)
note='十里长堤24条/24全文已读：6180/6244/6690限时活动待隔离，6435保留路线身份、婚登点描述待核；当前旧票价须保全，116尚未建业务决定。累计45项/698当前有效提及阅读，最新完整验证115/ranking29/flow99，任务保持in_progress、accepted=false。'
for path in [ROOT.parent/'task.json',PARENT/'task.json']:
    task=read(path)
    assert task['status']=='in_progress' and task['meta']['sevenCityContinuation']['latestValidatedEntityBatch']==115
    task['notes']+=' '+note
    task['meta']['sevenCityContinuation'].update(
        semanticReadthrough='10-09-attraction-top30-governance/research/seven-cities-semantic-readthrough-17.json',
        workingStage='115完整自查通过；十里长堤24全文已读，116尚无决定。先解决完整scope旧运营资料保全，继续集美学村及剩余城市。',accepted=False)
    path.write_text(json.dumps(task,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
for name in ['进展记录.md','七城剩余问题.md','七城人工审核名单.md']:
    with (ROOT.parent/name).open('a',encoding='utf-8') as file:
        file.write('\n## 十里长堤阅读断点\n\n'+note+'\n\n'+conclusion+'\n\n入口：[下一证据](research/seven-cities-next-evidence-20.json)。\n')
print(json.dumps({'readthroughEntities':45,'currentMentions':698,'latestValidatedBatch':115,'nextBatch':116,'accepted':False}))
