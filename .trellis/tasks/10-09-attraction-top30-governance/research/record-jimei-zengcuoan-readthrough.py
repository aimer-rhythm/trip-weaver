"""集美学村及曾厝垵44条全文审阅，保存下一批边界，不执行业务写入。"""
import hashlib
import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')
ROOT=Path(__file__).resolve().parent
PARENT=ROOT.parents[1]/'10-06-place-identity-governance'
read=lambda p:json.loads(p.read_bytes())
record=read(ROOT/'seven-cities-semantic-readthrough-21.json')
raw=(ROOT/record['snapshotFile']).read_bytes()
assert hashlib.sha256(raw).hexdigest()==record['snapshotSha256']
city=next(c for c in json.loads(raw)['cities'] if c['city']=='厦门')
known={n['noteId']:n['noteDescSha256'] for r in record['reviews'] if r['city']=='厦门' for n in r['noteEvidence']}
previous=next(c for c in read(ROOT/'snapshot-20261010T004932152504Z/input.json')['cities'] if c['city']=='厦门')
cases=[('766f37a1bb5763653dd7b28d76c9d498',118,[5352,5669,5756,6179,6243,6318,5321,5914,6729,6866],
    [(1451,'🆕集美学村春节集福马打卡🔥'),(1453,'·集美学村“集福马”打卡骑行'),
     (1285,'🚇 坐1号线直达【集美学村】站'),(1272,'📍集美学村/十里长堤：两个地方很近'),
     (1514,'在【 集美学村 】和【 集美大社 】逛逛'),(1444,'Day3:集美新村→石鼓路→龙舟池→十里长堤')],
    '22条/22篇全文已读，全部原笔记与既有已读哈希及完整字段保持。6179/6243只是春节集福马/剧场活动；5669只具名地铁站，之后是集美Citywalk及大社/龙舟池等路线，未单独写学村游览，拟隔离待审，不建活动或站点。'
    '5352同篇一日路线明确学村，具体描述却是大社与楚雨荨家；6318同篇傍晚明确在学村和大社逛逛，当前描述为海上列车座位景观，保留两条身份并拟排除错配reason/evidence_text。'
    '5756正文写集美新村，不能悄悄增加该别名或伪造学村原文，暂保留既有有限路线身份及描述待核。5321取景地/石鼓路、5914/6866综合路线的包含措辞、6729大社与学村混合描述仍需进一步界定，不能以本次scope声称全边界闭合。'
    '5390明确景点推荐学村、6383实际Day3路线、6886建筑摄影等身份保持；嘉庚公园、陈嘉庚纪念馆、石鼓路、大社、地铁站均不自动并入。当前旧免费运营资料须保全，无旧媒体。118尚未应用。'),
  ('10b9c8b67abe7586342c2f769661d7d5',119,[5546,5632,5897,6203,6390,6708],
    [(1298,'避坑：别住曾厝垵里面!晚上超吵，而且离核心景点远，性价比低~'),
     (1324,'性价比党直接住厦门本岛（中山路/曾厝垵）'),(1544,'▪️曾厝垵附近：离海近，喜欢散步、看海可以住这里'),
     (1432,'Day3 植物园+曾厝垵+返程'),(1456,'相比曾厝垵的喧闹，黄厝更安静、更生活化'),
     (1467,'晚上可以去曾厝垵的海边步道吹风'),(1568,'或去曾厝垵逛吃')],
    '22条/22篇全文已读，21篇按完整笔记字段与正文哈希复用，补读1568步道后明确曾厝垵逛吃全文。5546只警示住宿，5632只建议住本岛，6390只列住宿片区，无独立村落游览，拟隔离住宿来源但原负评仍保留原文。'
    '6203同篇既有住宿又明确Day3植物园→曾厝垵路线，保留身份，住宿reason/evidence_text待排除；不能把含住宿词的整条路线删除。6708处于黄厝别墅推荐中的区域喧闹比较，5897只到海边步道；两条确切边界待继续核，暂不直接认定主体。'
    '5732/5769/6078/6849对商业化、拥挤、小吃普通、不值得专程的负评保持，不能因不推荐而清除；5360/6100/6795有明确村落逛吃身份，不因food/market抽取类型新建餐饮。'
    '既有曾厝垵站点独立结论保持，不把站点或海边步道并入村落；此轮未改变类型配额或地点坐标，无旧媒体，旧预约/营业未知状态也须逐字段核验。119尚未应用。')]

for eid,batch,pending,quotes,conclusion in cases:
    entity=next(e for e in city['entities'] if e['entity_id']==eid)
    assert entity['revision']==1 and not any(r['entityId']==eid for r in record['reviews'])
    rows=[m for m in city['mentions'] if m['entityId']==eid]
    assert len(rows)==len({m['raw_note_id'] for m in rows})==22
    ids={m['raw_note_id'] for m in rows}
    assert ids-known.keys()==({1568} if batch==119 else set())
    assert rows==[m for m in previous['mentions'] if m['entityId']==eid]
    for nid in ids&known.keys():
        assert previous['notes'][str(nid)]==city['notes'][str(nid)]
        assert hashlib.sha256(city['notes'][str(nid)]['note_desc'].encode()).hexdigest()==known[nid]
    for nid,quote in quotes: assert quote in city['notes'][str(nid)]['note_desc']
    record['reviews'].append({'city':'厦门','entityId':eid,'name':entity['canonical_name'],'expectedRevision':1,
      'identityRetained':True,'fullFactsReviewed':False,'scope':'22当前提及/22篇全文，仅阅读，来源治理待应用。',
      'mentions':[{'mentionId':m['id'],'inputHash':m['inputHash'],'resolution':m['resolution']} for m in rows],
      'noteEvidence':[{'noteId':nid,'noteDescSha256':hashlib.sha256(city['notes'][str(nid)]['note_desc'].encode()).hexdigest()} for nid in sorted(ids)],
      'noteQuotes':[{'noteId':n,'quote':q} for n,q in quotes],'reviewedSourceMentionIds':[m['id'] for m in rows],
      'reusedNoteCount':len(ids&known.keys()),'newlyReadNoteIds':sorted(ids-known.keys()),
      'conclusion':conclusion,'businessMutationByThisRecord':False,'userAcceptance':False,
      'pendingMentionIds':pending,'nextProposedBatch':f'batch-{batch}'})
assert len(record['reviews'])==47 and sum(len(r['mentions']) for r in record['reviews'])==735
record['limits']='47项/735当前有效提及已读；118/119尚未应用，5756写名与学村组成范围、曾厝垵海边/住宿比较等边界待核；117为最新完整验证。未验收。'
def write(name,value):
    with (ROOT/name).open('x',encoding='utf-8') as f: json.dump(value,f,ensure_ascii=False,indent=2)
write('seven-cities-semantic-readthrough-22.json',record)
next_evidence=read(ROOT/'seven-cities-next-evidence-24.json')
next_evidence.update(semanticReadthrough='seven-cities-semantic-readthrough-22.json',nextBatch=118)
next_evidence['remainingReview'][0]='集美学村与曾厝垵各22条已读。118先隔离6179/6243活动及5669站点语境、处理5352/6318描述；119住宿参照及海边边界待核。继续厦门余项和广州、成都、杭州、西安、重庆；上海待核边界保持。'
for eid,batch,pending,quotes,conclusion in cases:
    for mid in pending:
        m=next(m for m in city['mentions'] if m['id']==mid)
        next_evidence['nextEvidence'].append({'city':'厦门','entityId':eid,'mentionId':mid,'inputHash':m['inputHash'],
          'resolution':m['resolution'],'conclusion':conclusion,'nextProposedBatch':f'batch-{batch}'})
write('seven-cities-next-evidence-25.json',next_evidence)
lines=['# 本轮逐项原文阅读记录','',record['limits'],'','| 城市 | 地点 | 当前有效提及 | 结论与待办 |','| --- | --- | --- | --- |']
for r in record['reviews']:
    lines.append('| '+' | '.join([r['city'],r['name'],'、'.join(str(m['mentionId']) for m in r['mentions']),r['conclusion'].replace('|','／')])+' |')
lines+=['','证据：[阅读台账](research/seven-cities-semantic-readthrough-22.json)、[累计保全](research/seven-cities-preservation-25.json)。','']
(ROOT.parent/'七城本轮原文复核.md').write_text('\n'.join(lines),encoding='utf-8')
note='集美学村/曾厝垵各22条全文已读，累计47项735当前有效提及；118/119尚未应用，已确认活动/住宿/站点来源与待核边界分列。最新完整验证117/ranking33/flow103，继续剩余城市，未验收、不提交归档。'
for path in [ROOT.parent/'task.json',PARENT/'task.json']:
    task=read(path)
    assert task['status']=='in_progress' and task['meta']['sevenCityContinuation']['latestValidatedEntityBatch']=='117'
    task['notes']+=' '+note
    task['meta']['sevenCityContinuation'].update(semanticReadthrough='10-09-attraction-top30-governance/research/seven-cities-semantic-readthrough-22.json',
       workingStage=note,accepted=False)
    path.write_text(json.dumps(task,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
for name in ['进展记录.md','七城剩余问题.md']:
    with (ROOT.parent/name).open('a',encoding='utf-8') as f:
        f.write('\n## 集美学村及曾厝垵阅读断点\n\n'+note+'\n\n入口：[下一证据](research/seven-cities-next-evidence-25.json)。\n')
print(json.dumps({'readEntities':47,'currentMentions':735,'latestValidatedBatch':117,'nextBatch':118,'accepted':False}))
