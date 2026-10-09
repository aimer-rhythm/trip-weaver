from pathlib import Path
root=Path(__file__).resolve().parent
s=(root/'verify-remaining-food-data.mts').read_text(encoding='utf-8').replace('第60批','第61批').replace('batch-60','batch-61').replace('remaining-food','built-place')
s=s.replace('57,58,59,60]','57,58,59,60,61]')
a=s.index("    const west=");b=s.index("    let used=''",a)
s=s[:a]+'''    const wall=eid==='66c835ba565f34cbd12206d7169c8da1',withdrawn=eid==='dc445410375df79cab73ba2b18448910',ordinary=!wall&&!withdrawn;
    assert.equal(p.name,g.entity.canonical_name);assert.equal((p.payload?.identity as any).revision,g.entity.revision+(ordinary?0:1));
    assert.deepEqual(p.payload?.aliases,g.entity.aliases);assert.equal((p.payload?.identity as any).memberIds.length,1);
    const evidence=(await db.query('SELECT kind,content FROM research_evidence WHERE place_id=$1 AND kind LIKE $2',[eid,'xhs_%'])).rows;
    const stored=(await db.query("SELECT embedding IS NOT NULL embedded,payload->>'embeddedText' text FROM canonical_places WHERE id=$1",[eid])).rows[0];
    if(withdrawn) {
      assert.equal(p.verified,false);assert.equal(p.category,'其他');assert.equal(p.payload?.xhsPlaceType,undefined);assert.equal(p.lat,null);assert.equal(p.lng,null);
      assert.deepEqual(p.payload?.identityWithdrawal,{version:1,revision:2,reason:'unavailable_source',candidateIds:[]});
      assert.deepEqual(p.payload?.mentionSources,[]);assert.deepEqual((p.payload?.imageIdentity as any).approved,[]);assert.equal(evidence.length,0);assert.equal(stored.embedded,false);
      for(const field of ['content','topReasons','address','openHours','reservation','reservationNote','price','tips','typicalVisitMinutes'])assert.ok(!p.payload?.[field],p.name+'/'+field);
      const prior=library.tables.research_evidence.filter((e:any)=>e.place_id===eid&&e.kind.startsWith('xhs_'));assert.equal(prior.length,1);
    } else {
      assert.equal(p.verified,true);assert.equal(p.category,old.category);assert.equal(p.payload?.xhsPlaceType,old.payload.xhsPlaceType);
      assert.equal(stored.embedded,true);assert.equal(stored.text,placeEmbeddingText(p));
      if(wall) {
        assert.equal(p.lat,null);assert.equal(p.lng,null);assert.equal(p.payload?.address,'');assert.equal(p.payload?.geoStatus,'unresolvable');
        assert.deepEqual((p.payload?.mentionSources as any[]).map(m=>m.mentionId),[12688]);assert.equal(p.payload?.mentionCount,1);
        assert.deepEqual((p.payload?.content as any).highlights,old.payload.content.highlights);assert.deepEqual(p.payload?.topReasons,old.payload.topReasons);
        assert.deepEqual(evidence,[{kind:'xhs_reason',content:'热门拍照打卡点'}]);
        assert.equal(old.payload.tips.length,2);assert.ok(old.payload.tips.some((t:string)=>t.includes('喜艾gelato'))&&old.payload.tips.some((t:string)=>t.includes('月下观棠')));
        assert.equal(p.payload?.tips,undefined);assert.deepEqual(p.payload?.themes,[]);
        for(const field of ['openHours','reservation','reservationNote','reservationEvidence','reservationConflict','price','typicalVisitMinutes'])assert.deepEqual(p.payload?.[field],old.payload[field]);
      } else {
        assert.equal(p.lat,old.lat);assert.equal(p.lng,old.lng);assert.equal(p.payload?.address,old.payload.address);assert.equal(p.payload?.mentionSources,undefined);
        for(const field of fields.filter(f=>f!=='identity'&&f!=='content'))assert.deepEqual(p.payload?.[field],old.payload[field]);
        const content=structuredClone(old.payload.content);content.compiledAt=(p.payload?.content as any).compiledAt;assert.deepEqual(p.payload?.content,content);
        const prior=library.tables.research_evidence.filter((e:any)=>e.place_id===eid&&e.kind.startsWith('xhs_')).map((e:any)=>({kind:e.kind,content:e.content}));
        assert.deepEqual(new Set(evidence.map(e=>JSON.stringify(e))),new Set(prior.map((e:any)=>JSON.stringify(e))));
      }
    }
''' + s[b:]
a=s.index('    const boundaries=');b=s.index('  const fallbackObservedAtChanges',a)
s=s[:a]+'''    const boundaries=wall?['济南墙','月下观棠','喜艾gelato(老商埠店)']:withdrawn?['淘子外单（经四万达店）','淘子外单（高新店）','淘子外单（西市场店）']:[p.name+'停车场',p.name+'入口',p.name+'（高新店）'];
    for(const id of [undefined,...(p.payload?.identity as any).memberIds])for(const name of boundaries){const resolved=index.resolve(city,name,id);assert.ok(resolved.status!=='resolved'||resolved.canonicalPlaceId!==eid);boundaryProbes++;}
    results.push({entityId:eid,name:p.name,withdrawn,ordinaryUnchanged:ordinary,confirmed:wall?1:0,pending:withdrawn?1:0,preciseLocationNewlyVerified:false});
  }
''' + s[b:]
s=s.replace('assignments.length,310','assignments.length,312').replace('graph.manifest.revision,34','graph.manifest.revision,35').replace('pending.length,126','pending.length,127')
a=s.index('  const newPending=');b=s.index('\n  assert.deepEqual(pending.filter',a);s=s[:a]+'  const newPending=[11536];'+s[b:]
s=s.replace('audit/run-59/snapshot','audit/run-60/snapshot').replace('audit/run-58/snapshot','audit/run-59/snapshot').replace('added.length,9','added.length,1').replace('const sourceIds=[5378,5377,5384,5401]','const sourceIds=[5954,5400]')
a=s.index('  const report={');b=s.index('\n  await writeFile(output',a)
s=s[:a]+'''  const report={batch:61,readOnly:true,at:new Date().toISOString(),consumedFieldsVerified:exported.length,fields,results,assignmentRows:312,pendingMentions:127,
    scopesAdded:2,confirmed:1,pendingAdded:1,coordinatesCleared:0,withdrawals:1,withdrawnCoordinatesRemoved:1,newPreciseLocations:0,categoriesCorrected:0,readOnlyBoundaryPending:5,sqlProbes,boundaryProbes,realVectorProbes:realVectors.length,realVectors,graph:19,directEdges:3,
    relationEvidenceAndStrengthPreserved:true,priorReviewRowsPreserved:true,rawDerivedCachesPreserved:true,confirmedFactsAndDatesPreserved:true,unresolvedBranchFactsRemoved:true,foreignWallTipsRemoved:2,
    fallbackObservedAtChanges,trips,imageComparison:'deferred_by_user',fullReviewPassed:false,failures:[]};''' + s[b:]
with (root/'verify-built-place-data.mts').open('x',encoding='utf-8') as f:f.write(s)
s=(root/'verify-remaining-food-consumption.test.mts').read_text(encoding='utf-8').replace('batch-60','batch-61').replace('remaining-food','built-place').replace('三裸名餐饮撤回、济南西明确提及及陈氏普通消费保持','文字墙外来提示隔离、商店分店待审及其余五主体消费保持')
s=s.replace("['老商埠','经三路','老舍故居','超意兴','春水锅贴','草包包子','天天过年','陈氏肥蛤']","['老商埠','经三路','老舍故居',...source.groups.map((g:any)=>g.entity.canonical_name)]").replace('beforeMockEnqueues,5','beforeMockEnqueues,7')
a=s.index('    const eid=g.entity.entity_id,west=');b=s.index('  for(const [name,value] of before)',a)
s=s[:a]+'''    const eid=g.entity.entity_id,wall=eid==='66c835ba565f34cbd12206d7169c8da1',withdrawn=eid==='dc445410375df79cab73ba2b18448910';
    const current=facts.get(placeNameKey(g.entity.canonical_name)),old=before.get(placeNameKey(g.entity.canonical_name));assert.ok(old);
    const p=(await pool.query('SELECT name,payload,verified,category,lat,lng FROM canonical_places WHERE id=$1',[eid])).rows[0];
    const previous=library.tables.canonical_places.find((p:any)=>p.id===eid);
    const evidence=(await pool.query('SELECT kind,content FROM research_evidence WHERE place_id=$1 AND kind LIKE $2',[eid,'xhs_%'])).rows;
    if(withdrawn) {
      assert.equal(current,undefined);assert.equal(p.verified,false);assert.equal(p.lat,null);assert.equal(p.lng,null);assert.equal(evidence.length,0);
      assert.deepEqual(p.payload.mentionSources,[]);assert.deepEqual(p.payload.identityWithdrawal,{version:1,revision:2,reason:'unavailable_source',candidateIds:[]});
    } else {
      assert.ok(current);assert.equal(current.canonicalPlaceId,eid);assert.equal(current.placeType,old.placeType);assert.equal(current.category,old.category);
      if(wall) {
        assert.equal(current.mentionCount,1);assert.equal(current.lat,undefined);assert.equal(current.lng,undefined);
        assert.equal(p.payload.address,'');assert.equal(p.payload.geoStatus,'unresolvable');assert.deepEqual(p.payload.mentionSources.map((m:any)=>m.mentionId),[12688]);
        assert.deepEqual(p.payload.content.highlights,previous.payload.content.highlights);assert.equal(p.payload.tips,undefined);
        assert.equal(previous.payload.tips.length,2);assert.deepEqual(evidence,[{kind:'xhs_reason',content:'热门拍照打卡点'}]);
      } else {
        assert.deepEqual(current,old);assert.equal(p.payload.mentionSources,undefined);assert.equal(p.payload.address,previous.payload.address);
        const oldContent=structuredClone(previous.payload.content);oldContent.compiledAt=p.payload.content.compiledAt;assert.deepEqual(p.payload.content,oldContent);
        const prior=library.tables.research_evidence.filter((e:any)=>e.place_id===eid&&e.kind.startsWith('xhs_')).map((e:any)=>({kind:e.kind,content:e.content}));
        assert.deepEqual(new Set(evidence.map(e=>JSON.stringify(e))),new Set(prior.map((e:any)=>JSON.stringify(e))));
      }
    }
  }
''' + s[b:]
s=s.replace("['超意兴','春水锅贴','草包包子','天天过年','陈氏肥蛤']","source.groups.map((g:any)=>g.entity.canonical_name)").replace('assert.equal(queued,1)','assert.equal(queued,5)')
a=s.index('  const report={');b=s.index('\n  await writeFile(new URL',a)
s=s[:a]+'''  const report={batch:61,isolated:true,synthetic:false,fullCityPlaces:JSON.parse(exportBytes.toString('utf8')).places.length,
    actualPlaceFacts:true,priorGovernedFactsPreserved:true,confirmedIdentityPreserved:true,confirmedContentAndEvidencePreserved:true,withdrawnFactExclusionVerified:true,readOnlyBoundaryPending:5,withdrawals:1,
    coordinatesCleared:0,withdrawnCoordinatesRemoved:1,categoriesCorrected:0,addressesCorrected:0,foreignWallTipsRemoved:2,independentIdentityPreserved:true,media,canonicalized,
    independentSourceDigestUnchanged:true,mockEnqueueCalls:{before:beforeMockEnqueues,after:afterMockEnqueues},actualEnqueues:0,
    enqueueMeaning:'七主体实际无图，两完整scope阻止补图，mock7→5；其余五主体保持，旧3/1/2图库保持，真实队列未写入。',
    imageComparison:'deferred_by_user',failures:[]};''' + s[b:]
with (root/'verify-built-place-consumption.test.mts').open('x',encoding='utf-8') as f:f.write(s)
