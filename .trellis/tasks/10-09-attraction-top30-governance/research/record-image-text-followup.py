"""补核既有图片文字的身份语境，纠正5546待隔离建议；不审核照片或写业务。"""
import hashlib
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parent
read=lambda p:json.loads(p.read_bytes())
record=read(ROOT/'seven-cities-semantic-readthrough-22.json')
city=next(c for c in read(ROOT/record['snapshotFile'])['cities'] if c['city']=='厦门')
notes={n['id']:n for n in city['governanceState']['rawNotes']}
hash_value=lambda v:hashlib.sha256(json.dumps(v,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()
def proof(nid):
    note=notes[nid]
    texts=[{'imageIndex':i,'keyInfo':v.get('key_info')} for i,v in enumerate(note.get('img_analysis') or []) if isinstance(v,dict) and v.get('has_text')]
    return {'noteId':nid,'rawNoteSha256':hash_value(note),'existingImageTextSha256':hash_value(texts),'existingImageTextCount':len(texts)}
checks=[proof(nid) for nid in [1435,1436,1451,1453,1513,1285,1444,1324,1544,1456]]
assert all(c['existingImageTextCount']==0 or c['noteId']==1324 for c in checks)
assert all(not any((v.get('key_info') or {}).values()) for v in notes[1324]['img_analysis'] if v.get('has_text'))
item=notes[1298]['img_analysis'][1]['key_info']
assert '曾厝垵是美食街不用逛太久挑重点吃' in item['tips'] and '曾厝垵17:00-19:00' in item['hours']
zeng=next(r for r in record['reviews'] if r['entityId']=='10b9c8b67abe7586342c2f769661d7d5')
zeng['conclusion']=zeng['conclusion'].replace('5546只警示住宿，5632只建议住本岛，6390只列住宿片区，无独立村落游览，拟隔离住宿来源但原负评仍保留原文。',
    '5632只建议住本岛、6390只列住宿片区，无独立村落游览且既有图片文字无补充，拟隔离住宿来源。5546正文虽只警示住宿，但note1298图片索引1已有曾厝垵逛吃与17:00–19:00行程安排，不能直接按仅住宿隔离；保留身份及原负评，住宿描述是否需要分字段处理继续核对。该时段不作为本轮确认的营业时间。')
zeng['additionalImageTextEvidence']=[proof(nid) for nid in [1298,1324,1544,1456]]
jimei=next(r for r in record['reviews'] if r['entityId']=='766f37a1bb5763653dd7b28d76c9d498')
jimei['additionalImageTextEvidence']=[proof(nid) for nid in [1285,1444,1451,1453]]
record['limits']='47项/735当前有效提及正文已读；关联既有图片文字证据另列，不代表照片语义审核。5546补充逛吃证据使仅住宿隔离建议撤回；118/119仍待应用，117为最新完整验证。'
def write(name,value):
    with (ROOT/name).open('x',encoding='utf-8') as f: json.dump(value,f,ensure_ascii=False,indent=2)
write('seven-cities-semantic-readthrough-23.json',record)
write('image-text-followup-01.json',{'readOnly':True,'snapshotFile':record['snapshotFile'],'snapshotSha256':record['snapshotSha256'],
    'previouslyAppliedExcludedMentions':[6545,6546,6596,6180,6244,6690,6248],'checks':checks,
    'correctedProposal':{'mentionId':5546,'proof':proof(1298),'conclusion':zeng['conclusion']},'businessMutation':False})
next_evidence=read(ROOT/'seven-cities-next-evidence-25.json')
next_evidence['semanticReadthrough']='seven-cities-semantic-readthrough-23.json'
for item in next_evidence['nextEvidence']:
    if item.get('entityId')==zeng['entityId']: item['conclusion']=zeng['conclusion']
write('seven-cities-next-evidence-26.json',next_evidence)
rows=['# 本轮逐项原文阅读记录','',record['limits'],'','| 城市 | 地点 | 当前有效提及 | 结论与待办 |','| --- | --- | --- | --- |']
for r in record['reviews']:
    rows.append('| '+' | '.join([r['city'],r['name'],'、'.join(str(m['mentionId']) for m in r['mentions']),r['conclusion'].replace('|','／')])+' |')
rows+=['','证据：[阅读台账](research/seven-cities-semantic-readthrough-23.json)、[图片文字补核](research/image-text-followup-01.json)。','']
(ROOT.parent/'七城本轮原文复核.md').write_text('\n'.join(rows),encoding='utf-8')
for path in [ROOT.parent/'task.json',ROOT.parents[1]/'10-06-place-identity-governance/task.json']:
    task=read(path)
    task['meta']['sevenCityContinuation']['semanticReadthrough']='10-09-attraction-top30-governance/research/seven-cities-semantic-readthrough-23.json'
    task['notes']+=' 补核已有图片文字：5546同篇有曾厝垵逛吃行程，不按仅住宿隔离；此前四批七条隔离来源未发现此类补充文字。证据image-text-followup-01，照片审核仍暂缓。'
    path.write_text(json.dumps(task,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'correctedMention':5546,'businessMutation':False,'readEntities':47}))
