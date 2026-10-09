from pathlib import Path
import json
root=Path(__file__).resolve().parent
s=(root/'verify-last-restaurants-data.mts').read_text(encoding='utf-8')
s=s.replace("import {assertRestaurantRow} from './last-restaurants-assertions';","import {assertBridgeTextRow,GATE_ID,GATE_NAME} from './bridge-text-assertions';")
s=s.replace('last-restaurants','bridge-text').replace('batch-64','batch-65').replace('batch:64','batch:65').replace('四家餐馆','桥及门洞').replace('assertRestaurantRow','assertBridgeTextRow')
s=s.replace('61,62,63,64]','61,62,63,64,65]').replace('vectorProbes.length,4','vectorProbes.length,2')
s=s.replace("['许记排骨（其他路店）','桥下把子肉（其他路店）','蜗牛叔叔的食堂（其他路店）','穆香斋','芙蓉街','老商埠']", "['起凤桥','起凤桥街','起凤桥八号','起凤桥8号','起凤桥八号餐厅',GATE_NAME,'西侧灯笼亭子','起凤泉'].filter(name=>!(p.payload!.aliases as string[]).includes(name))")
s=s.replace('assignments.length,356','assignments.length,358').replace('graph.manifest.revision,38','graph.manifest.revision,39')
s=s.replace("pending.filter((m:any)=>m.mentionId!==12893)", 'pending')
a=s.index("  const priorAudit=");b=s.index('  const trips=',a)
s=s[:a]+'''  for(const name of [GATE_NAME,'起凤桥八号']) {
    assert.ok(!(await retrieve([name],{city,category:'food',vector:'off',limit:48})).some(p=>p.canonicalPlaceId===GATE_ID));
  }
  const priorAudit=await read('all-cities/audit/run-63/snapshot.json'),audit=await read('all-cities/audit/run-64/snapshot.json');
  assert.deepEqual(audit.reviews,priorAudit.reviews);
  assert.deepEqual(audit.scopes.filter((r:any)=>Number(r.place_id)!==5392),priorAudit.scopes);assert.deepEqual(audit.scopeSources,priorAudit.scopeSources);
''' +s[b:]
s=s.replace('assignmentRows:356','assignmentRows:358').replace('scopesAdded:3,confirmed:7,pendingAdded:1','scopesAdded:1,confirmed:2,pendingAdded:0').replace('coordinatesCleared:1','coordinatesCleared:0').replace('realVectorProbes:4','realVectorProbes:2')
s=s.replace('realVectors:vectors.cities[0].vectorProbes,graph:18','realVectors:vectors.cities[0].vectorProbes,foodExclusionProbes:2,graph:18')
with (root/'verify-bridge-text-data.mts').open('x',encoding='utf-8') as f:f.write(s)
s=(root/'verify-last-restaurants-consumption.test.mts').read_text(encoding='utf-8')
s=s.replace("import {assertRestaurantRow,RESTAURANT_PLAN} from './last-restaurants-assertions';", "import {assertBridgeTextRow,GATE_ID,GATE_NAME} from './bridge-text-assertions';")
s=s.replace('last-restaurants','bridge-text').replace('batch-64','batch-65').replace('batch:64','batch:65').replace('assertRestaurantRow','assertBridgeTextRow')
s=s.replace('三家餐馆地址限定、原评价和华祥只读保全与实际图库消费','门洞独立摄影停留、桥体旧消费及实际图库保全')
s=s.replace('beforeMockEnqueues,4','beforeMockEnqueues,2')
s=s.replace('const current=facts.get(placeNameKey(g.entity.canonical_name)),old=', 'const current=facts.get(placeNameKey(sid===5392?GATE_NAME:g.entity.canonical_name)),old=')
a=s.index("    assert.equal(current.category,'美食')");b=s.index('\n  }',a)
s=s[:a]+'''    assert.equal(current.category,'文化');assert.equal(current.placeType,'photo_spot');
    assert.equal(current.mentionCount,old.mentionCount);assert.equal(current.visitMinutes,old.visitMinutes);
    assert.equal(current.lat,old.lat);assert.equal(current.lng,old.lng);
    if(sid===5392){assert.equal(current.visitMinutes,30);assert.ok(!facts.has(placeNameKey('起凤桥八号')));}
''' +s[b:]
s=s.replace('scopesAdded:3,confirmed:7,pendingRestaurantMentions:[12893],readOnlySources:1,','scopesAdded:1,confirmed:2,pendingAdded:0,readOnlySources:1,gateMinutes:30,')
s=s.replace('coordinatesCleared:1','coordinatesCleared:0')
s=s.replace("enqueueMeaning:'四店实际均无图，三店完整scope阻止回退，华祥普通消费保持，mock4→1；旧3/1/2图库保持，真实队列未写入。'", "enqueueMeaning:'桥及门洞实际无图，门洞完整scope阻止回退，桥普通消费保持，mock2→1；旧3/1/2图库保持，真实队列未写入。'")
marker='  assert.equal(queued,1);'
s=s.replace(marker, "  assert.equal(await lookup(GATE_NAME),null);\n  for(const id of [undefined,GATE_ID]) {const result=index.resolve('济南','起凤桥八号',id);assert.ok(result.status!=='resolved'||result.canonicalPlaceId!==GATE_ID);}\n"+marker)
with (root/'verify-bridge-text-consumption.test.mts').open('x',encoding='utf-8') as f:f.write(s)
s=(root/'check-last-restaurants-inputs.py').read_text(encoding='utf-8')
s=s.replace('第64批','第65批').replace('batch-64','batch-65').replace("'batch':64","'batch':65").replace('last-restaurants','bridge-text')
s=s.replace("digest(n.img_analysis or [])==detail['analysisSha256']", "digest(n.img_analysis)==detail['analysisSha256']")
s=s.replace("            assert cat.resolve(by_id[12893])['status']=='review'\n",'')
s=s.replace('cat.scope_for_source(5345)','cat.scope_for_source(5479)')
s=s.replace("'notes':3,'notesWithExistingAnalysis':2,'nullAnalysisNotes':[2602],'sources':4,'mentions':10", "'notes':6,'notesWithExistingAnalysis':5,'nullAnalysisNotes':[2813],'sources':2,'mentions':9")
s=s.replace('readOnlyHuaXiangPreserved','readOnlyBridgePreserved').replace("'relationSourceRevision':38", "'relationSourceRevision':39")
with (root/'check-bridge-text-inputs.py').open('x',encoding='utf-8') as f:f.write(s)
config=root/'tsconfig.verify-joint.json';v=json.loads(config.read_text(encoding='utf-8'))
v['include'] += ['./verify-bridge-text-data.mts','./verify-bridge-text-consumption.test.mts','./verify-bridge-text-photo-preflight.test.mts','./bridge-text-assertions.ts']
config.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
