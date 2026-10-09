from pathlib import Path
root=Path(__file__).resolve().parent
p=root/'verify-remaining-food-data.mts';assert not p.exists()
s=(root/'verify-river-outdoors-data.mts').read_text(encoding='utf-8')
s=s.replace('第58批实际库核对：河道错误提示隔离，五普通户外主体保持。','第60批实际库核对：未定位品牌撤回、济南西提及保留、陈氏只读。').replace('batch-58','batch-60').replace('river-outdoors','remaining-food').replace('ordinary-outdoors','remaining-food')
s=s.replace('"56-v2",57,58]','"56-v2",57,58,59,60]').replace('vectorProbes.length,0','vectorProbes.length,1')
start=s.index('    const river=eid');end=s.index('  const fallbackObservedAtChanges',start)
s=s[:start]+'''    const west=eid==='b8880b34d9a4e56942c76ea7a4e5555c',ordinary=eid==='d342ff3eb8d541f17253786d0dd148fa',withdrawn=!west&&!ordinary;
    assert.equal(p.name,g.entity.canonical_name);assert.equal((p.payload?.identity as any).revision,west?3:ordinary?1:2);
    assert.deepEqual(p.payload?.aliases,g.entity.aliases);assert.equal((p.payload?.identity as any).memberIds.length,1);
    const evidence=(await db.query('SELECT kind,content FROM research_evidence WHERE place_id=$1 AND kind LIKE $2',[eid,'xhs_%'])).rows;
    const stored=(await db.query("SELECT embedding IS NOT NULL embedded,payload->>'embeddedText' text FROM canonical_places WHERE id=$1",[eid])).rows[0];
    if(withdrawn) {
      assert.equal(p.verified,false);assert.equal(p.category,'其他');assert.equal(p.payload?.xhsPlaceType,undefined);assert.equal(p.lat,null);assert.equal(p.lng,null);
      assert.deepEqual(p.payload?.identityWithdrawal,{version:1,revision:2,reason:'unavailable_source',candidateIds:[]});
      assert.deepEqual(p.payload?.mentionSources,[]);assert.deepEqual((p.payload?.imageIdentity as any).approved,[]);assert.equal(evidence.length,0);assert.equal(stored.embedded,false);
      for(const field of ['content','topReasons','address','openHours','reservation','reservationNote','price','tips','typicalVisitMinutes'])assert.ok(!p.payload?.[field],p.name+'/'+field);
    } else {
      assert.equal(p.verified,true);assert.equal(p.category,'美食');assert.equal(p.payload?.xhsPlaceType,'food');
      assert.equal(stored.embedded,true);assert.equal(stored.text,placeEmbeddingText(p));
      if(west) {
        assert.equal(p.lat,null);assert.equal(p.lng,null);assert.equal(p.payload?.address,'济南西周边');assert.equal(p.payload?.geoStatus,'unresolvable');
        assert.deepEqual((p.payload?.mentionSources as any[]).map(m=>m.mentionId),[11375]);assert.equal(p.payload?.mentionCount,1);
        assert.deepEqual((p.payload?.content as any).highlights,old.payload.content.highlights.slice(0,2));
        assert.deepEqual(evidence,[{kind:'xhs_reason',content:'20年老店，本地人推荐，菜品美味分量足'}]);
        assert.ok(!JSON.stringify(p.payload).includes('本地人私藏20年老牌鲁菜馆，家常菜地道入味，分量实在性价比高'));
        for(const field of ['openHours','reservation','reservationNote','reservationEvidence','reservationConflict','price','tips','typicalVisitMinutes'])assert.deepEqual(p.payload?.[field],old.payload[field]);
      } else {
        assert.equal(p.lat,old.lat);assert.equal(p.lng,old.lng);assert.equal(p.payload?.address,old.payload.address);assert.equal(p.payload?.mentionSources,undefined);
        for(const field of fields.filter(f=>f!=='identity'&&f!=='content'))assert.deepEqual(p.payload?.[field],old.payload[field]);
        const content=structuredClone(old.payload.content);content.compiledAt=(p.payload?.content as any).compiledAt;assert.deepEqual(p.payload?.content,content);
        const prior=library.tables.research_evidence.filter((e:any)=>e.place_id===eid&&e.kind.startsWith('xhs_')).map((e:any)=>({kind:e.kind,content:e.content}));
        assert.deepEqual(new Set(evidence.map(e=>JSON.stringify(e))),new Set(prior.map((e:any)=>JSON.stringify(e))));
      }
    }
    let used='';const hits=await retrieve([p.name],{city,vector:'force',limit:8,onDiagnostics:d=>{used=d.vector;}});assert.equal(used,'used');
    if(withdrawn)assert.ok(hits.every(h=>h.canonicalPlaceId!==eid));else assert.equal(hits[0]?.canonicalPlaceId,eid);
    realVectors.push({name:p.name,entityId:eid,vector:used,withdrawn});
    for(const name of p.payload?.aliases as string[]) {
      const hits=await retrieve([name],{city,vector:'off',limit:24});sqlProbes++;
      if(withdrawn)assert.ok(hits.every(h=>h.canonicalPlaceId!==eid));else assert.equal(hits[0]?.canonicalPlaceId,eid);
      for(const id of [undefined,...(p.payload?.identity as any).memberIds]) {
        const result=index.resolve(city,name,id);
        if(withdrawn){assert.equal(result.status,'unresolved');if(result.status==='unresolved')assert.equal(result.reason,'withdrawn');}
        else{assert.equal(result.status,'resolved');if(result.status==='resolved')assert.equal(result.canonicalPlaceId,eid);}
      }
    }
    const boundaries=west?['天天过年（梁庄店）','天天过年（沂蒙路店）','天天过年停车场']:ordinary?['陈氏鲁菜','陈氏肥蛤停车场','老船长小海鲜']:
      [p.name+'（总店）',p.name+'（大明湖店）',p.name+'停车场'];
    for(const id of [undefined,...(p.payload?.identity as any).memberIds])for(const name of boundaries){const resolved=index.resolve(city,name,id);assert.ok(resolved.status!=='resolved'||resolved.canonicalPlaceId!==eid);boundaryProbes++;}
    results.push({entityId:eid,name:p.name,withdrawn,ordinaryUnchanged:ordinary,confirmed:west?1:ordinary?2:0,pending:ordinary?0:west?1:g.mentionIds.length,preciseLocationNewlyVerified:false});
  }
''' +s[end:]
s=s.replace('assignments.length,295','assignments.length,310').replace('graph.manifest.revision,32','graph.manifest.revision,34').replace('pending.length,116','pending.length,126')
s=s.replace("assert.deepEqual(pending,library.tables.place_relation_snapshots[0].manifest.sourceState.mentions.filter((m:any)=>m.status==='review'));", "const newPending=[11391,11477,11524,12737,11384,11526,11480,12740,12806];\n  assert.deepEqual(pending.filter((m:any)=>!newPending.includes(m.mentionId)),library.tables.place_relation_snapshots[0].manifest.sourceState.mentions.filter((m:any)=>m.status==='review'));")
s=s.replace("run-56/snapshot.json","run-58/snapshot.json").replace("run-57/snapshot.json","run-59/snapshot.json")
s=s.replace('  assert.deepEqual(audit.reviews,priorAudit.reviews);', '''  const added=audit.reviews.filter((r:any)=>!priorAudit.reviews.some((p:any)=>p.id===r.id));
  assert.equal(added.length,9);assert.ok(added.every((r:any)=>r.status==='PENDING'));
  assert.deepEqual(added.map((r:any)=>r.detail.mentionId).sort((a:number,b:number)=>a-b),[...newPending].sort((a,b)=>a-b));
  assert.deepEqual(audit.reviews.filter((r:any)=>!added.some((a:any)=>a.id===r.id)),priorAudit.reviews);''')
s=s.replace('const sourceIds=[5477]','const sourceIds=[5378,5377,5384,5401]').replace('g.entity.primary_place_id===5477','sourceIds.includes(g.entity.primary_place_id)')
start=s.index('  for(const item of source.supplementalImageFactNotes)');end=s.index('  const trips=',start)
s=s[:start]+s[end:]
s=s.replace('batch:58','batch:60').replace('assignmentRows:295,pendingMentions:116','assignmentRows:310,pendingMentions:126')
s=s.replace('scopesAdded:1,confirmed:2,pendingAdded:0,coordinatesCleared:0','scopesAdded:4,confirmed:1,pendingAdded:9,coordinatesCleared:1,withdrawals:3,withdrawnCoordinatesRemoved:3')
s=s.replace('ordinaryReviewed:5','ordinaryReviewed:1').replace('wrongTipExcluded:true,contentAndEvidencePreserved:true,supplementalImageTextPreserved:true','confirmedFactsAndDatesPreserved:true,unresolvedBranchFactsRemoved:true')
s=s.replace('for(const g of source.sources)','for(const g of source.groups.flatMap((g:any)=>g.sources))')
p.write_text(s,encoding='utf-8')
t=root/'verify-remaining-food-times.py';assert not t.exists()
s=(root/'verify-night-market-times.py').read_text(encoding='utf-8').replace('night-market','remaining-food').replace("source=json.loads((root/'all-cities/batch-59-source.json')","source=json.loads((root/'priority-cities/济南/remaining-food-source-packet-01.json')").replace("'batch':59","'batch':60").replace("'notes':4","'notes':7")
t.write_text(s,encoding='utf-8')
