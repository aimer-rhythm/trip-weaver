"""复用真实消费探针，收紧为本批分店范围和既有日期/图库保全。"""
from pathlib import Path
root=Path(__file__).resolve().parent
p=(root/'verify-food-address-data.mts').read_text(encoding='utf-8').replace('第51批','第52批').replace('batch-51','batch-52').replace('food-address-downstream','qinji-downstream')
p=p.replace('47,48,49].map','47,48,49,52].map').replace('vectorProbes.length,6','vectorProbes.length,1')
a=p.index('    const reviewed=');b=p.index('  const fallbackObservedAtChanges',a)
p=p[:a]+'''    assert.equal((p.payload?.identity as any).revision,2);assert.equal(p.category,'美食');assert.equal(p.payload?.xhsPlaceType,'food');
    assert.equal(p.verified,true);assert.equal(p.lat,old.lat);assert.equal(p.lng,old.lng);assert.equal(p.payload?.address,old.payload.address);
    assert.deepEqual(p.payload?.aliases,old.payload.aliases);assert.equal(old.payload.mentionCount,4);assert.equal(p.payload?.mentionCount,2);
    assert.deepEqual((p.payload?.mentionSources as any[]).map(m=>m.mentionId).sort((a,b)=>a-b),[11364,12605]);
    assert.equal(p.payload?.typicalVisitMinutes,undefined);assert.deepEqual(p.payload?.themes,[]);
    assert.deepEqual((p.payload?.imageIdentity as any).approved,[]);
    assert.doesNotMatch(JSON.stringify(p.payload),/肉火烧去制锦市|其他去河边|具体菜品未详述/);
    assert.deepEqual(p.payload?.topReasons,['本地人推荐，有特色且味道好']);
    const content=p.payload?.content as any;assert.equal(content.intro,'本地人推荐，有特色且味道好。');assert.equal(content.highlights.length,1);
    assert.deepEqual(content.highlights[0],old.payload.content.highlights[0]);
    const evidence=(await db.query('SELECT kind,content FROM research_evidence WHERE place_id=$1 AND kind LIKE $2',[eid,'xhs_%'])).rows;
    assert.deepEqual(evidence,[{kind:'xhs_reason',content:'本地人推荐，有特色且味道好'}]);
    const boundaries=['秦记火烧（制锦市店）','秦记火烧（河边店）','制锦市','秦记火烧铜元局前街店','桥下把子肉'];
    const hits=await retrieve([p.name],{city,vector:'off',limit:24});assert.equal(hits[0]?.canonicalPlaceId,eid);sqlProbes++;
    for(const id of [undefined,...g.entity.legacy_ids]) {
      const resolved=index.resolve(city,p.name,id);assert.equal(resolved.status,'resolved');if(resolved.status==='resolved')assert.equal(resolved.canonicalPlaceId,eid);
      for(const name of boundaries){const r=index.resolve(city,name,id);assert.ok(r.status!=='resolved'||r.canonicalPlaceId!==eid);boundaryProbes++;}
    }
    results.push({entityId:eid,name:p.name,category:p.category,type:p.payload?.xhsPlaceType,confirmed:2,pending:2,locationPreservedNotNewlyVerified:true});
  }
''' +p[b:]
p=p.replace('assignments.length,268','assignments.length,272').replace('graph.manifest.revision,25','graph.manifest.revision,26')
p=p.replace('pending.length,107','pending.length,109').replace("assert.deepEqual(pending,library", "assert.deepEqual(pending.filter((m:any)=>![11664,12892].includes(m.mentionId)),library")
a=p.index("  const priorAudit=");b=p.index('  const trips=',a)
p=p[:a]+'''  const priorAudit=await read('all-cities/audit/run-50/snapshot.json'),audit=await read('all-cities/audit/run-51/snapshot.json');
  const newReviews=audit.reviews.filter((r:any)=>!priorAudit.reviews.some((old:any)=>old.id===r.id));
  assert.equal(newReviews.length,2);assert.deepEqual(newReviews.map((r:any)=>r.detail.mentionId).sort((a:number,b:number)=>a-b),[11664,12892]);
  assert.ok(newReviews.every((r:any)=>r.status==='PENDING'));
  assert.deepEqual(audit.reviews.filter((r:any)=>!newReviews.some((n:any)=>n.id===r.id)),priorAudit.reviews);
  assert.deepEqual(audit.scopes.filter((r:any)=>r.place_id!==5342),priorAudit.scopes);
  assert.deepEqual(audit.scopeSources.filter((r:any)=>r.scope_place_id!==5342),priorAudit.scopeSources);
''' +p[b:]
p=p.replace("folder+'import-audit-baseline.json'", "folder+'pre-import-check.json'")
p=p.replace('batch:51','batch:52').replace('assignmentRows:268,pendingMentions:107','assignmentRows:272,pendingMentions:109')
p=p.replace('scopesAdded:0,coordinatesCleared:6,newPreciseLocations:0,categoriesCorrected:0,addressesAdded:6', 'scopesAdded:1,confirmed:2,pendingAdded:2,coordinatesCleared:0,newPreciseLocations:0,categoriesCorrected:0,addressesAdded:0')
p=p.replace('realVectorProbes:6','realVectorProbes:1').replace('allReviewRowsPreserved:true','priorReviewRowsPreserved:true')
with (root/'verify-qinji-data.mts').open('x',encoding='utf-8') as f:f.write(p)

p=(root/'verify-food-address-consumption.test.mts').read_text(encoding='utf-8').replace('第51批','第52批').replace('batch-51','batch-52').replace('food-address-consumption','qinji-consumption')
p=p.replace("food-address-source-review-01.json", "qinji-source-review-01.json").replace("food-address-photo-metadata-01.json", "food-followup-photo-metadata-01.json")
p=p.replace("  const targetNames=reviewed.rows.map((r:any)=>r.name);", "  const targetNames=['秦记火烧'];")
p=p.replace('beforeMockEnqueues,6','beforeMockEnqueues,1')
a=p.index('  const targets=');b=p.index('  for(const [name,value] of before)',a)
p=p[:a]+'''  const targets=['53fc7a0204959595c1277e9c76915534'];
  const current=facts.get(placeNameKey('秦记火烧')),old=before.get(placeNameKey('秦记火烧'));assert.ok(current&&old);
  assert.equal(current.canonicalPlaceId,targets[0]);assert.equal(current.placeType,'food');assert.equal(current.category,'美食');
  assert.equal(old.mentionCount,4);assert.equal(current.mentionCount,2);assert.equal(current.lat,old.lat);assert.equal(current.lng,old.lng);
  assert.equal(current.visitMinutes,undefined);assert.doesNotMatch(JSON.stringify(current),/肉火烧去制锦市|其他去河边|具体菜品未详述/);
''' +p[b:]
a=p.index('  for(const p of kept)');b=p.index('  const lookup=makeLookup()',a)
p=p[:a]+'''  for(const p of kept){
    assert.equal(p.payload.content.intro,'本地人推荐，有特色且味道好。');assert.equal(p.payload.content.highlights.length,1);
    assert.deepEqual(p.payload.mentionSources.map((m:any)=>m.mentionId).sort((a:number,b:number)=>a-b),[11364,12605]);
  }
''' +p[b:]
p=p.replace('assert.equal(queued,beforeMockEnqueues);','assert.equal(queued,0);')
p=p.replace('batch:51','batch:52').replace('sourceContentPreserved:true,coordinatesCleared:6,categoriesCorrected:0,addressesAdded:6','confirmedContentPreserved:true,mixedBranchContentRemoved:true,coordinatesCleared:0,categoriesCorrected:0,addressesAdded:0')
p=p.replace('未新增scope的六无图主体按既有规则请求补图；前后各6次均被隔离测试回调截获，不写真实队列。','原无scope主体触发1次mock请求；新增scope后禁止未审核图片回退，after为0。两次实际返回均无图，真实队列未写入。')
with (root/'verify-qinji-consumption.test.mts').open('x',encoding='utf-8') as f:f.write(p)
