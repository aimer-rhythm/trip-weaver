"""植物园29提及/28正文及裸名3正文阅读，不执行业务决定。"""
import hashlib
import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')
ROOT=Path(__file__).resolve().parent
PARENT=ROOT.parents[1]/'10-06-place-identity-governance'
read=lambda path:json.loads(path.read_bytes())
record=read(ROOT/'seven-cities-semantic-readthrough-12.json')
raw=(ROOT/record['snapshotFile']).read_bytes()
assert hashlib.sha256(raw).hexdigest()==record['snapshotSha256']
city=next(c for c in json.loads(raw)['cities'] if c['city']=='厦门')
eid='410da5dd0d2e2802ead6a313bf030a19'
entity=next(e for e in city['entities'] if e['entity_id']==eid)
assert entity['revision']==3
mentions=[m for m in city['mentions'] if m['entityId']==eid]
note_ids={m['raw_note_id'] for m in mentions}
assert len(mentions)==29 and len(note_ids)==28
comparison_entities={'9eca880667ffe616ddea0fa7db4b7049','15f4085f90907345a822ac07663783c3',
    'd0e0f1dff1caee95784a31c71d9ac46f'}
previous_notes={n['noteId']:n['noteDescSha256'] for r in record['reviews']
    if r['entityId'] in comparison_entities for n in r['noteEvidence']}
newly_read={1249,1386,1432,1503,1481,1520}
assert note_ids-set(previous_notes)==newly_read
for nid in note_ids&set(previous_notes):
    assert hashlib.sha256(city['notes'][str(nid)]['note_desc'].encode()).hexdigest()==previous_notes[nid]
notes=[{'noteId':nid,'noteDescSha256':hashlib.sha256(city['notes'][str(nid)]['note_desc'].encode()).hexdigest()}
    for nid in sorted(note_ids)]
extra=[next(m for m in city['mentions'] if m['id']==mid) for mid in [5451,5725,5998]]
assert {m['entityId'] for m in extra}=={'6e83b872db3d9c874ce72af52afef625'}
conclusion=('29条当前提及/28篇正文已完整阅读，其中22篇与白城/黄厝/南普陀同篇且全文哈希保持，另外6篇本轮补读。'
    '6248同篇只有植物园迎春花展，无独立园区游览，拟隔离活动来源，尚未应用。'
    '5500拍照姿势正文配厦门植物园标签，描述晴天丁达尔和园内喷雾，没有摄影商户或独立场所，不因摄影主题直接隔离。'
    '5952雨林湿滑、6567园区大且绕路疲累、6678冬日日照弱效果有限、6733错过喷雾无聊等原意见保持。'
    '雨林/多肉园区体验不等于另一独立主体；各篇喷雾时段和6791抢票时间为旧社区说法，不当本轮确认的最新运营。'
    '旧根植物园的5451南普陀后游览、5725厦门推荐清单、5998雨林喷雾及钟鼓索道路线已读，属于需继续核定的同体候选；尚未合并，不偷加提及或别名。'
    '万石山（植物园）为登山清单独立对象，不按括号合并；北门旧来源的定位此前已由主源覆盖，仍沿用既有位置。'
    '当前正式导出有旧票价，113若新增完整scope须先验证运营资料保全，不能复用112仅提及/媒体通过的结论。'
    '本记录只保存阅读证据，不更新身份、评分、图像或其他业务内容。')
record['reviews'].append({'city':'厦门','entityId':eid,'name':entity['canonical_name'],'expectedRevision':3,
    'identityRetained':True,'fullFactsReviewed':False,'scope':'29当前提及/28全文，仅阅读，113尚无业务决定。',
    'mentions':[{'mentionId':m['id'],'inputHash':m['inputHash'],'resolution':m['resolution']} for m in mentions],
    'noteEvidence':notes,'reviewedSourceMentionIds':[m['id'] for m in mentions],
    'additionalBoundaryMentions':[{'mentionId':m['id'],'entityId':m['entityId'],'inputHash':m['inputHash'],
        'noteId':m['raw_note_id'],'noteDescSha256':hashlib.sha256(city['notes'][str(m['raw_note_id'])]['note_desc'].encode()).hexdigest()} for m in extra],
    'conclusion':conclusion,'businessMutationByThisRecord':False,'userAcceptance':False,
    'pendingMentionIds':[6248],'nextProposedBatch':'batch-113'})
assert len(record['reviews'])==42 and sum(len(r['mentions']) for r in record['reviews'])==616
record['limits']='42项/616当前有效提及已读。植物园仅阅读；南普陀112预演暂缓；鼓浪屿107已撤回。阅读不代表全部来源、事实、位置或类型已闭合。'
with (ROOT/'seven-cities-semantic-readthrough-13.json').open('x',encoding='utf-8') as file:
    json.dump(record,file,ensure_ascii=False,indent=2)
lines=['# 本轮逐项原文阅读记录','','42项、616条当前有效提及已阅读；最新正式验证批次111。植物园仅阅读，南普陀112预演暂缓，鼓浪屿107已撤回。','',
    '| 城市 | 地点 | 当前有效提及 | 结论与待办 |','| --- | --- | --- | --- |']
for r in record['reviews']:
    lines.append('| '+' | '.join([r['city'],r['name'],'、'.join(str(m['mentionId']) for m in r['mentions']),r['conclusion'].replace('|','／')])+' |')
lines+=['','证据：[阅读台账](research/seven-cities-semantic-readthrough-13.json)、[112保全暂缓](research/batch-112-operational-preservation-hold.json)。','']
(ROOT.parent/'七城本轮原文复核.md').write_text('\n'.join(lines),encoding='utf-8')
note=('植物园29条/28全文及裸名植物园3篇边界阅读已完成；6248花展待隔离，5451/5725/5998裸名同体候选待正式处理。'
    '旧票价须在113预演先核保全；当前仍29条/76.14分/rev3，未有113业务决定。'
    '累计42项/616当前有效提及已读，最新完整验证111，112南普陀运营资料保全暂缓。')
for path in [ROOT.parent/'task.json',PARENT/'task.json']:
    task=read(path)
    assert task['status']=='in_progress' and task['meta']['sevenCityContinuation']['latestValidatedEntityBatch']==111
    task['notes']+=' '+note
    task['meta']['sevenCityContinuation'].update(
        semanticReadthrough='10-09-attraction-top30-governance/research/seven-cities-semantic-readthrough-13.json',
        workingStage='植物园29提及/28全文及裸名3篇已读；113尚未建决定，先核旧票价保全及裸名同体。112南普陀预演暂缓，111为最新完整验证。')
    path.write_text(json.dumps(task,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
next_evidence=read(ROOT/'seven-cities-next-evidence-15.json')
next_evidence['semanticReadthrough']='seven-cities-semantic-readthrough-13.json'
next_evidence['remainingReview'][0]='113植物园29条/28全文已读，拟核裸名3条同体及6248花展，完整scope前须保全旧票价；后续厦大28条、环岛路26条。112南普陀保全暂缓，其他城市未审主体继续推进。'
next_evidence['nextEvidence'].append({'city':'厦门','entityId':eid,'mentionId':6248,
    'conclusion':'只有春节植物园迎春花展，未独立游览。尚未scope隔离，旧票价保全及裸名三条待处理。'})
with (ROOT/'seven-cities-next-evidence-16.json').open('x',encoding='utf-8') as file:
    json.dump(next_evidence,file,ensure_ascii=False,indent=2)
for name in ['进展记录.md','七城剩余问题.md','七城人工审核名单.md']:
    with (ROOT.parent/name).open('a',encoding='utf-8') as file:
        file.write('\n## 植物园阅读断点\n\n'+note+'\n\n'+conclusion+'\n\n入口：[下一证据](research/seven-cities-next-evidence-16.json)。\n')
print(json.dumps({'readthroughEntities':42,'currentMentions':616,'latestValidatedBatch':111,'nextBatch':113,
    'businessMutation':False,'accepted':False}))
