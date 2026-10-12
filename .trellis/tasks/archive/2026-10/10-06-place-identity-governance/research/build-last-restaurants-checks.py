from pathlib import Path
import json
root=Path(__file__).resolve().parent
s=(root/'verify-furong-consumption.test.mts').read_text(encoding='utf-8')
s=s.replace("import {assertFurongRow} from './furong-assertions';","import {assertRestaurantRow,RESTAURANT_PLAN} from './last-restaurants-assertions';")
s=s.replace('batch-63','batch-64').replace('furong','last-restaurants').replace('batch:63','batch:64').replace('assertFurongRow','assertRestaurantRow')
s=s.replace("test('芙蓉街原文警示、两餐馆隔离、独立停留与实际图库消费'","test('三家餐馆地址限定、原评价和华祥只读保全与实际图库消费'")
s=s.replace('beforeMockEnqueues,1','beforeMockEnqueues,4')
s=s.replace("    assert.equal(current.category,'文化');assert.equal(current.placeType,'other');\n    assert.equal(current.mentionCount,28);assert.equal(current.visitMinutes,30);\n    assert.deepEqual(current.lat,old.lat);assert.deepEqual(current.lng,old.lng);", "    assert.equal(current.category,'美食');assert.equal(current.placeType,'food');\n    const plan=RESTAURANT_PLAN[sid];assert.equal(current.mentionCount,plan?.mentions.length??old.mentionCount);\n    assert.equal(current.visitMinutes,old.visitMinutes);\n    if(plan?.clear){assert.ok(current.lat==null&&current.lng==null);}else{assert.equal(current.lat,old.lat);assert.equal(current.lng,old.lng);}")
s=s.replace('assert.equal(queued,0);','assert.equal(queued,1);')
s=s.replace('    textWarnings:1,fieldExcludedMentionIds:[11699],pendingRestaurantMentions:[12904,12948],duration:30,','    scopesAdded:3,confirmed:7,pendingRestaurantMentions:[12893],readOnlySources:1,')
s=s.replace('coordinatesCleared:0','coordinatesCleared:1').replace("enqueueMeaning:'芙蓉街实际无图，完整scope阻止补图，mock1→0；旧3/1/2图库保持，真实队列未写入。'", "enqueueMeaning:'四店实际均无图，三店完整scope阻止回退，华祥普通消费保持，mock4→1；旧3/1/2图库保持，真实队列未写入。'")
with (root/'verify-last-restaurants-consumption.test.mts').open('x',encoding='utf-8') as f:f.write(s)
s=(root/'verify-furong-data.mts').read_text(encoding='utf-8')
s=s.replace("import {assertFurongRow,FURONG_ID} from './furong-assertions';","import {assertRestaurantRow} from './last-restaurants-assertions';")
s=s.replace('furong','last-restaurants').replace('batch-63','batch-64').replace('batch:63','batch:64').replace('61,62,63]','61,62,63,64]')
s=s.replace("const currentScope=(await read('all-cities/batch-64-scope-decisions.json'))[0];", "const currentScopes=await read('all-cities/batch-64-scope-decisions.json');")
s=s.replace('vectorProbes.length,1','vectorProbes.length,4').replace("assert.equal(vectors.cities[0].vectorProbes[0].diagnostics.vector,'used');", "assert.ok(vectors.cities[0].vectorProbes.every((p:any)=>p.diagnostics.vector==='used')); ")
a=s.index('  const p=byId.get(FURONG_ID)');b=s.index('  for(const original of library.tables.canonical_places)',a)
s=s[:a]+'''  const targetIds=source.groups.map((g:any)=>g.entity.entity_id);
  const index=createPlaceIdentityIndex(rows.filter(p=>p.verified||p.payload?.identityWithdrawal));
  const retrieve=createPlaceRetriever({query:(sql,args)=>db.query(sql,args),embed:async()=>null});
  let sqlProbes=0,boundaryProbes=0;
  for(const g of source.groups) {
    const eid=g.entity.entity_id,sid=g.entity.primary_place_id,p=byId.get(eid),old=library.tables.canonical_places.find((r:any)=>r.id===eid);assert.ok(p&&old);
    const evidence=(await db.query('SELECT kind,content FROM research_evidence WHERE place_id=$1 AND kind LIKE $2',[eid,'xhs_%'])).rows;
    const prior=library.tables.research_evidence.filter((e:any)=>e.place_id===eid&&e.kind.startsWith('xhs_')).map((e:any)=>({kind:e.kind,content:e.content}));
    assertRestaurantRow(p,old,sid,evidence,prior);
    const stored=(await db.query("SELECT embedding IS NOT NULL embedded,payload->>'embeddedText' text FROM canonical_places WHERE id=$1",[eid])).rows[0];
    assert.equal(stored.embedded,true);assert.equal(stored.text,placeEmbeddingText(p));
    const ids=[undefined,...(p.payload!.identity as any).memberIds];
    for(const name of p.payload!.aliases as string[]) {
      const hits=await retrieve([name],{city,vector:'off',limit:24});assert.equal(hits[0]?.canonicalPlaceId,eid);sqlProbes++;
      for(const id of ids){const r=index.resolve(city,name,id);assert.ok(r.status==='resolved');assert.equal(r.canonicalPlaceId,eid);}
    }
    for(const id of ids)for(const name of ['许记排骨（其他路店）','桥下把子肉（其他路店）','蜗牛叔叔的食堂（其他路店）','穆香斋','芙蓉街','老商埠']) {
      const r=index.resolve(city,name,id);assert.ok(r.status!=='resolved'||r.canonicalPlaceId!==eid);boundaryProbes++;
    }
  }
''' +s[b:]
s=s.replace('original.id!==FURONG_ID','!targetIds.includes(original.id)')
s=s.replace('assignments.length,348','assignments.length,356')
a=s.index("  const row=(await up.query('SELECT source_hash");b=s.index("  const graph=",a)
s=s[:a]+'''  for(const scope of currentScopes) {
    const row=(await up.query('SELECT source_hash,revision,change_key,text_warnings FROM place_identity_scope WHERE place_id=$1',[scope.sourcePlaceId])).rows[0];
    assert.equal(row.source_hash,scope.expectedSourceHash);assert.equal(row.revision,1);assert.equal(row.change_key,scope.key);assert.equal(row.text_warnings,null);
  }
''' +s[b:]
s=s.replace('graph.manifest.revision,37','graph.manifest.revision,38').replace('pending.length,132','pending.length,133')
s=s.replace('![12904,12948].includes(m.mentionId)','m.mentionId!==12893')
s=s.replace("'all-cities/audit/run-61/snapshot.json'","'all-cities/audit/run-62/snapshot.json'").replace("audit=await read('all-cities/audit/run-62/snapshot.json')","audit=await read('all-cities/audit/run-63/snapshot.json')")
s=s.replace('added.length,2','added.length,1').replace('[12904,12948]','[12893]').replace('Number(r.place_id)!==5353','![5331,5343,5340].includes(Number(r.place_id))')
s=s.replace('assignmentRows:348,pendingMentions:132','assignmentRows:356,pendingMentions:133')
s=s.replace('scopesAdded:1,confirmed:28,pendingAdded:2,textWarnings:1,fieldExcludedMentionIds:[11699],coordinatesCleared:0','scopesAdded:3,confirmed:7,pendingAdded:1,readOnlySources:1,coordinatesCleared:1')
s=s.replace('realVectorProbes:1','realVectorProbes:4')
s=s.replace("  const pending=graph.manifest", "  assert.deepEqual(graph.relations,library.tables.place_relation_snapshots[0].relations);\n  const pending=graph.manifest")
with (root/'verify-last-restaurants-data.mts').open('x',encoding='utf-8') as f:f.write(s)
config=root/'tsconfig.verify-joint.json';v=json.loads(config.read_text(encoding='utf-8'))
v['include'] += ['./verify-last-restaurants-data.mts','./verify-last-restaurants-consumption.test.mts','./verify-last-restaurants-photo-preflight.test.mts','./last-restaurants-assertions.ts']
config.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
