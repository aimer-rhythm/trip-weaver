from pathlib import Path
import json
root=Path(__file__).resolve().parent
def replace(p,a,b):
    assert a in p,a
    return p.replace(a,b)
p=(root/'verify-food-branches-data.mts').read_text(encoding='utf-8')
for a,b in [
 ('第53批','第57批'),('batch-53','batch-57'),('food-branches','restaurant-branches'),
 ('[36,40,41,42,43,44,45,46,47,48,49,52,53]','[36,40,41,42,43,44,45,46,47,48,49,52,53,54,"55-v2","56-v2",57]'),
 ('vectorProbes.length,2','vectorProbes.length,3'),
 ("const expectedMentions=eid==='cc3ebff96b9f814d82ef808324a42400'?[11709]:[11635,12886];","const expectedMentions=g.mentionIds.filter((id:number)=>![11481,11525,12741,12798].includes(id));"),
 ("assert.equal(p.lat,old.lat);assert.equal(p.lng,old.lng);assert.equal(p.payload?.address,old.payload.address);","assert.ok(old.lat&&old.lng);assert.equal(p.lat,null);assert.equal(p.lng,null);assert.equal(p.payload?.address,decision.overrides.address);assert.equal(p.payload?.geoStatus,'unresolvable');assert.equal((p.payload?.identity as any).memberIds.length,2);"),
 ('/口味单调|作者不喜欢|具体菜品未详述|乱收费/','/位于Day2路线中，是济南鲁菜代表|济南特色美食店铺推荐|骨汤浓郁，拉面劲道牛肉大块/'),
 ('assert.equal(content.highlights.length,expectedMentions.length===1?3:2);','assert.equal(content.highlights.length,1);'),
 ("assert.deepEqual(evidence.map(e=>e.content).sort(),[...(expected.payload?.topReasons as string[])].sort());","assert.deepEqual(evidence.map(e=>e.content).sort(),source.mentions.filter((m:any)=>expectedMentions.includes(m.id)).map((m:any)=>m.reason).sort());\n    const priorEvidence=library.tables.research_evidence.filter((e:any)=>e.place_id===eid&&e.kind.startsWith('xhs_'));assert.equal(priorEvidence.length,g.mentionIds.length);\n    const isolated=(await read('all-cities/batch-57/scope-preview-1791495417422987800/xhs-places-济南.json')).places.find((r:any)=>r.id===eid);\n    const isolatedContent=structuredClone(isolated.payload.content);isolatedContent.compiledAt=content.compiledAt;assert.deepEqual(content,isolatedContent);"),
 ("locationPreservedNotNewlyVerified:true","unsupportedBranchPointClearedPreciseLocationPending:true"),
 ('assignments.length,278','assignments.length,293'),('graph.manifest.revision,27','graph.manifest.revision,31'),
 ('pending.length,112','pending.length,116'),('[11708,12846,12890]','[11481,11525,12741,12798]'),
 ('run-51','run-55'),('run-52','run-56'),('newReviews.length,3','newReviews.length,4'),
 ('batch:53','batch:57'),('assignmentRows:278,pendingMentions:112','assignmentRows:293,pendingMentions:116'),
 ('scopesAdded:2,confirmed:3,pendingAdded:3,coordinatesCleared:0','scopesAdded:3,confirmed:4,pendingAdded:4,coordinatesCleared:3'),
 ('addressesAdded:0','addressesCorrected:3'),('realVectorProbes:2,graph:18','realVectorProbes:3,graph:19'),
 ('relationEvidenceAndStrengthPreserved:true','priorRelationEvidenceAndStrengthPreserved:true,weakRelationAdded:1'),
 ('本批隔离三条未确认分店提及的内容','本批隔离四条未确认分店提及的内容')
]:p=replace(p,a,b)
start=p.index('    const boundaries=');end=p.index('    for(const name',start)
p=p[:start]+"""    const boundaries=eid==='84929fb3085880c48c0cebb71aae3ad4'?['燕喜堂（金菊巷店）','燕喜堂（CBD店）旁','燕喜堂（泉城路店）']:
      eid==='58d542ebe18a1dd3505b7cdc60db030c'?['刘小忙把子肉（馆驿街店）','刘小忙把子肉（联四路）旁','刘小忙把子肉（制锦市店）']:
      ['亮亮拉面（经六路店）','亮亮拉面（小纬十一路）','亮亮拉面（经十一路）旁'];
"""+p[end:]
p=replace(p,"  assert.deepEqual(graph.relations,library.tables.place_relation_snapshots[0].relations);","""  const previousGraph=library.tables.place_relation_snapshots[0].relations;
  for(const r of previousGraph)assert.ok(graph.relations.some((n:any)=>JSON.stringify(n)===JSON.stringify(r)));
  const added=graph.relations.filter((r:any)=>!previousGraph.some((n:any)=>JSON.stringify(n)===JSON.stringify(r)));
  assert.equal(added.length,1);assert.equal(added[0].strength,'weak');assert.equal(added[0].noteCount,1);
  assert.deepEqual([added[0].fromEntityId,added[0].toEntityId].sort(),['6ed737543bd4e4f550f0fd357c9e8c71','84929fb3085880c48c0cebb71aae3ad4'].sort());
  assert.equal(added[0].evidence[0].noteId,2830);assert.equal(added[0].evidence[0].quote,'燕喜堂（CBD店）→山东博物馆');""")
with (root/'verify-restaurant-branches-data.mts').open('x',encoding='utf-8') as f:f.write(p)
p=(root/'verify-park-culture-consumption.test.mts').read_text(encoding='utf-8')
for a,b in [('batch-56-v2','batch-57'),('park-culture','restaurant-branches'),('公园合计时长排除、文化主体位置和独立身份、既有图库保持','明确餐饮分店与四条待审内容隔离、原有事实图库保持'),("'济南环城公园','四窟万象','关帝庙'","'燕喜堂','刘小忙把子肉','亮亮拉面'")]:p=replace(p,a,b)
start=p.index('    const eid=g.entity.entity_id,decision=');end=p.index('  for(const [name,value] of before)',start)
p=p[:start]+"""    const eid=g.entity.entity_id,decision=decisions.find((d:any)=>d.entityId===eid);
    const expectedMentions=g.mentionIds.filter((id:number)=>![11481,11525,12741,12798].includes(id));
    const current=facts.get(placeNameKey(decision.canonicalName)),old=before.get(placeNameKey(g.entity.canonical_name));assert.ok(current&&old);
    assert.equal(current.canonicalPlaceId,eid);assert.equal(current.placeType,'food');assert.equal(current.category,'美食');
    assert.equal(current.mentionCount,expectedMentions.length);assert.equal(old.mentionCount,g.mentionIds.length);assert.ok(old.lat&&old.lng);assert.ok(current.lat==null&&current.lng==null);
    for(const name of decision.aliases)assert.deepEqual(facts.get(placeNameKey(name)),current);
    assert.equal(current.visitMinutes,undefined);
    const p=(await pool.query('SELECT name,payload FROM canonical_places WHERE id=$1',[eid])).rows[0];
    const expected=JSON.parse(exportBytes.toString('utf8')).places.find((r:any)=>r.id===eid);
    assert.deepEqual(p.payload.content,expected.payload.content);assert.deepEqual(p.payload.topReasons,expected.payload.topReasons);
    assert.equal(p.payload.address,decision.overrides.address);assert.equal(p.payload.geoStatus,'unresolvable');
    const evidence=(await pool.query('SELECT kind,content FROM research_evidence WHERE place_id=$1 AND kind LIKE $2',[eid,'xhs_%'])).rows;
    assert.deepEqual(evidence.map(e=>e.content).sort(),source.mentions.filter((m:any)=>expectedMentions.includes(m.id)).map((m:any)=>m.reason).sort());
    assert.doesNotMatch(JSON.stringify({facts:current,payload:p.payload,evidence}),/位于Day2路线中，是济南鲁菜代表|济南特色美食店铺推荐|骨汤浓郁，拉面劲道牛肉大块/);
    assert.deepEqual(p.payload.mentionSources.map((m:any)=>m.mentionId).sort((a:number,b:number)=>a-b),expectedMentions);
  }
"""+p[end:]
p=replace(p,"  assert.equal(await lookup('共青团路关帝庙'),null);assert.equal(queued,0);","  for(const d of decisions)assert.equal(await lookup(d.canonicalName),null);assert.equal(queued,0);")
p=replace(p,"batch:56,variant:'v2'","batch:57")
p=replace(p,'contentAndEvidencePreserved:true,groupDurationExcluded:true,historicLocationPreserved:true,negativeMentionPreserved:true','confirmedContentAndEvidencePreserved:true,pendingContentExcluded:4')
p=replace(p,'coordinatesCleared:1,categoriesCorrected:0,naturalCategoryExplicitlyPreserved:true,addressesCorrected:1','coordinatesCleared:3,categoriesCorrected:0,addressesCorrected:3')
p=replace(p,'完整scope后3个原名及庙新名均无图','完整scope后3个原名及分店新名均无图')
with (root/'verify-restaurant-branches-consumption.test.mts').open('x',encoding='utf-8') as f:f.write(p)
path=root/'tsconfig.verify-joint.json';config=json.loads(path.read_text(encoding='utf-8'))
for name in ['verify-restaurant-branches-data.mts','verify-restaurant-branches-consumption.test.mts','verify-restaurant-branches-photo-preflight.test.mts']:
    assert './'+name not in config['include'];config['include'].append('./'+name)
path.write_text(json.dumps(config,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
