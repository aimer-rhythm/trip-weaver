"""固定南普陀已应用酒店边界，准备完整七城验证；不代替验收。"""
import json
from pathlib import Path

root=Path(__file__).resolve().parent
source='snapshot-20261010T002859093513Z/input.json'
read=lambda p:json.loads(p.read_bytes())
current=read(root/source)
city=next(c for c in current['cities'] if c['city']=='厦门')
m=next(m for m in city['mentions'] if m['id']==6546)
assert m['entityId'] is None and m['resolution']=={'status':'review','reason':'unassigned_target','scopePlaceIds':[2534]}
eid='d0e0f1dff1caee95784a31c71d9ac46f'
entity=next(e for e in city['entities'] if e['entity_id']==eid)
assert entity['revision']==4
quote='酒店房间面积比较大，可以看到厦大，南普陀寺'
assert quote in city['notes']['1435']['note_desc']
boundaries=read(root/'seven-cities-mention-boundaries-15.json')
boundaries.append({'city':'厦门','entityId':eid,'name':entity['canonical_name'],'expectedRevision':4,
  'mentionId':6546,'inputHash':m['inputHash'],'expectedResolution':m['resolution'],'noteId':1435,'quote':quote,
  'relation':'not_same_entity','subjectType':'hotel','conclusion':'酒店房间窗景体验，没有独立寺院游览，不作为寺院主体潜在加分。',
  'businessMutation':False,'limit':'112-v2已正式隔离；仅记录母项边界，不创建酒店或独立机位。'})
with (root/'seven-cities-mention-boundaries-16.json').open('x',encoding='utf-8') as f:
    json.dump(boundaries,f,ensure_ascii=False,indent=2)
for path in [root.parent/'task.json',root.parents[1]/'10-06-place-identity-governance/task.json']:
    task=read(path)
    assert task['status']=='in_progress' and task['completedAt'] is None
    task['meta']['sevenCityContinuation'].update(latestEntityBatch='112-v2',latestAttemptedEntityBatch='112-v2',
      pendingSyncBatches=[],accepted=False,workingStage='112-v2南普陀已应用双同步，旧运营及媒体保全通过；正在ranking30/完整累计保全及flow100验证。')
    task['notes']+=' 112-v2已按新旧运营资料保全协议隔离6546酒店窗景，33条/84.44分/rev4；厦门614导出、669旧行、101关系/强33/版本14双同步并通过事后检查。暂存807上游回归/18运营专项/39下游测试及typecheck通过；完整七城验证进行中，未验收。'
    path.write_text(json.dumps(task,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'batch':'112-v2','boundaries':len(boundaries),'accepted':False}))
