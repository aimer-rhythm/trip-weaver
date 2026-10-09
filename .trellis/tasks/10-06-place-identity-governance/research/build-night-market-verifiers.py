"""从既有实库核查器生成本批专项核查；只生成一次。"""
from pathlib import Path
root=Path(__file__).resolve().parent
p=root/'verify-night-market-data.mts';assert not p.exists()
s=(root/'verify-restaurant-branches-data.mts').read_text(encoding='utf-8')
s=s.replace('第57批实际消费：同名多位置范围、明确提及保留、旧分配和来源日期保持。','第59批实际消费：迁址名称地址、旧导航待审、三条负评保留。')
s=s.replace('batch-57','batch-59').replace('restaurant-branches','night-market').replace('"56-v2",57]','"56-v2",57,58,59]')
s=s.replace('vectorProbes.length,3','vectorProbes.length,1').replace("'themes','address','geoStatus'","'themes','address','geoStatus','price','tips'")
start=s.index('    const expectedMentions=g.mentionIds.filter')
end=s.index('    for(const name of p.payload?.aliases',start)
s=s[:start]+'''    const expectedMentions=[11571,11607,12647,12825];
    assert.equal((p.payload?.identity as any).revision,3);assert.equal(p.name,decision.canonicalName);
    assert.equal(p.category,'购物');assert.equal(p.payload?.xhsPlaceType,'market');assert.equal(p.verified,true);
    assert.equal(p.lat,old.lat);assert.equal(p.lng,old.lng);assert.equal(p.payload?.address,'祝舜路555号');
    assert.equal(p.payload?.geoStatus,old.payload.geoStatus);assert.equal((p.payload?.identity as any).memberIds.length,2);
    assert.deepEqual([...(p.payload?.aliases as string[])].sort(),[...decision.aliases].sort());
    assert.equal(old.payload.mentionCount,5);assert.equal(p.payload?.mentionCount,4);
    assert.deepEqual((p.payload?.mentionSources as any[]).map(m=>m.mentionId).sort((a,b)=>a-b),expectedMentions);
    assert.equal(p.payload?.typicalVisitMinutes,undefined);assert.deepEqual(p.payload?.themes,[]);assert.deepEqual((p.payload?.imageIdentity as any).approved,[]);
    const staleReason=source.mentions.find((m:any)=>m.id===11464).reason;
    assert.match(old.payload.content.intro,/祝舜路1469号/);assert.match(old.payload.content.intro,/祝甸站B口/);
    assert.doesNotMatch(JSON.stringify(p.payload),/祝舜路1469号|祝甸站/);assert.ok(!JSON.stringify(p.payload).includes(staleReason));
    const content=p.payload?.content as any;
    assert.deepEqual(content.highlights,old.payload.content.highlights.slice(2));assert.equal(content.highlights.length,1);
    const evidence=(await db.query('SELECT kind,content FROM research_evidence WHERE place_id=$1 AND kind LIKE $2',[eid,'xhs_%'])).rows;
    const expectedEvidence=source.mentions.filter((m:any)=>expectedMentions.includes(m.id)).map((m:any)=>({kind:m.sentiment==='negative'?'xhs_warning':'xhs_reason',content:m.reason}));
    assert.deepEqual(new Set(evidence.map(e=>JSON.stringify(e))),new Set(expectedEvidence.map((e:any)=>JSON.stringify(e))));
    assert.equal(evidence.length,4);assert.equal(evidence.filter(e=>e.kind==='xhs_warning').length,3);
    const priorEvidence=library.tables.research_evidence.filter((e:any)=>e.place_id===eid&&e.kind.startsWith('xhs_'));
    assert.equal(priorEvidence.length,5);assert.ok(priorEvidence.some((e:any)=>e.content===staleReason));assert.ok(!evidence.some(e=>e.content===staleReason));
    const isolated=(await read('all-cities/batch-59/scope-preview-1791496913081962100/xhs-places-济南.json')).places.find((r:any)=>r.id===eid);
    const isolatedContent=structuredClone(isolated.payload.content);isolatedContent.compiledAt=content.compiledAt;assert.deepEqual(content,isolatedContent);
    for(const field of ['price','tips','reservation','reservationNote','reservationEvidence','reservationConflict'])assert.deepEqual(p.payload?.[field],old.payload[field]);
    assert.deepEqual(p.payload?.openHours,{...old.payload.openHours,subject:p.name});
    const boundaries=['环联夜市（祝舜路1469号）','环联夜市旧址','环联1904火车夜市停车场','环联夜市公交站','大学城夜市','济南老商埠','八涧堡站'];
''' +s[end:]
s=s.replace('unsupportedBranchPointClearedPreciseLocationPending:true','coordinatesPreservedNotNewlyVerified:true')
s=s.replace('assignments.length,293','assignments.length,300').replace('graph.manifest.revision,31','graph.manifest.revision,33')
start=s.index('  const previousGraph=');end=s.index('  const sourceIds=',start)
s=s[:start]+'''  assert.deepEqual(graph.relations,library.tables.place_relation_snapshots[0].relations);
  const pending=graph.manifest.sourceState.mentions.filter((m:any)=>m.status==='review');assert.equal(pending.length,117);
  assert.deepEqual(pending.filter((m:any)=>m.mentionId!==11464),library.tables.place_relation_snapshots[0].manifest.sourceState.mentions.filter((m:any)=>m.status==='review'));
  const priorAudit=await read('all-cities/audit/run-57/snapshot.json'),audit=await read('all-cities/audit/run-58/snapshot.json');
  const newReviews=audit.reviews.filter((r:any)=>!priorAudit.reviews.some((old:any)=>old.id===r.id));
  assert.equal(newReviews.length,1);assert.equal(newReviews[0].detail.mentionId,11464);assert.equal(newReviews[0].status,'PENDING');
  assert.deepEqual(audit.reviews.filter((r:any)=>!newReviews.some((n:any)=>n.id===r.id)),priorAudit.reviews);
''' +s[end:]
s=s.replace('batch:57','batch:59').replace('assignmentRows:293,pendingMentions:116','assignmentRows:300,pendingMentions:117')
s=s.replace('scopesAdded:3,confirmed:4,pendingAdded:4,coordinatesCleared:3','scopesAdded:1,confirmed:4,pendingAdded:1,coordinatesCleared:0')
s=s.replace('addressesCorrected:3','addressesCorrected:1').replace('realVectorProbes:3','realVectorProbes:1').replace('weakRelationAdded:1','weakRelationAdded:0')
s=s.replace('rawDerivedCachesPreserved:true,confirmedFactsPreserved:true','rawDerivedCachesPreserved:true,confirmedFactsPreserved:true,negativeConfirmed:3,positiveConfirmed:1,staleNavigationRemoved:true,coordinatesPreservedNotNewlyVerified:true')
s=s.replace('本批隔离四条未确认分店提及的内容','本批隔离一条带旧址导航事实的提及内容')
p.write_text(s,encoding='utf-8')
