from pathlib import Path
root=Path(__file__).resolve().parent
p=root/'verify-remaining-food-consumption.test.mts';assert not p.exists()
s=(root/'verify-river-outdoors-consumption.test.mts').read_text(encoding='utf-8').replace('batch-58','batch-60').replace('river-outdoors','remaining-food').replace('ordinary-outdoors','remaining-food')
s=s.replace('河道解放阁提示隔离与五个普通户外主体、旧图库保持','三裸名餐饮撤回、济南西明确提及及陈氏普通消费保持')
s=s.replace("'护城河','东更道','珍池街','双忠祠街','西公界街','华山湖公园'","'超意兴','春水锅贴','草包包子','天天过年','陈氏肥蛤'")
s=s.replace('beforeMockEnqueues,6','beforeMockEnqueues,5')
start=s.index('  for(const g of source.groups)');end=s.index('  for(const [name,value] of before)',start)
s=s[:start]+'''  for(const g of source.groups) {
    const eid=g.entity.entity_id,west=eid==='b8880b34d9a4e56942c76ea7a4e5555c',ordinary=eid==='d342ff3eb8d541f17253786d0dd148fa',withdrawn=!west&&!ordinary;
    const current=facts.get(placeNameKey(g.entity.canonical_name)),old=before.get(placeNameKey(g.entity.canonical_name));assert.ok(old);
    const p=(await pool.query('SELECT name,payload,verified,category,lat,lng FROM canonical_places WHERE id=$1',[eid])).rows[0];
    const previous=library.tables.canonical_places.find((p:any)=>p.id===eid);
    const evidence=(await pool.query('SELECT kind,content FROM research_evidence WHERE place_id=$1 AND kind LIKE $2',[eid,'xhs_%'])).rows;
    if(withdrawn) {
      assert.equal(current,undefined);assert.equal(p.verified,false);assert.equal(p.lat,null);assert.equal(p.lng,null);assert.equal(evidence.length,0);
      assert.deepEqual(p.payload.mentionSources,[]);assert.deepEqual(p.payload.identityWithdrawal,{version:1,revision:2,reason:'unavailable_source',candidateIds:[]});
    } else {
      assert.ok(current);assert.equal(current.canonicalPlaceId,eid);assert.equal(current.placeType,'food');assert.equal(current.category,'美食');
      if(west) {
        assert.equal(current.mentionCount,1);assert.equal(current.lat,undefined);assert.equal(current.lng,undefined);
        assert.equal(p.payload.address,'济南西周边');assert.equal(p.payload.geoStatus,'unresolvable');assert.deepEqual(p.payload.mentionSources.map((m:any)=>m.mentionId),[11375]);
        assert.deepEqual(p.payload.content.highlights,previous.payload.content.highlights.slice(0,2));
        assert.deepEqual(evidence,[{kind:'xhs_reason',content:'20年老店，本地人推荐，菜品美味分量足'}]);
      } else {
        assert.deepEqual(current,old);assert.equal(p.payload.mentionSources,undefined);assert.equal(p.payload.address,previous.payload.address);
        const oldContent=structuredClone(previous.payload.content);oldContent.compiledAt=p.payload.content.compiledAt;assert.deepEqual(p.payload.content,oldContent);
        const prior=library.tables.research_evidence.filter((e:any)=>e.place_id===eid&&e.kind.startsWith('xhs_')).map((e:any)=>({kind:e.kind,content:e.content}));
        assert.deepEqual(new Set(evidence.map(e=>JSON.stringify(e))),new Set(prior.map((e:any)=>JSON.stringify(e))));
      }
    }
  }
''' +s[end:]
s=s.replace('assert.equal(queued,5)','assert.equal(queued,1)')
s=s.replace('batch:58','batch:60').replace('contentAndEvidencePreserved:true,wrongTipExcluded:true,ordinaryReviewed:5','confirmedContentAndEvidencePreserved:true,withdrawnFactExclusionVerified:true,ordinaryReviewed:1,withdrawals:3')
s=s.replace('coordinatesCleared:0','coordinatesCleared:1,withdrawnCoordinatesRemoved:3').replace('addressesCorrected:0','addressesCorrected:1')
s=s.replace('六个主体均无图，mock由6次变5次；只有护城河新增scope阻止旧补图，五个普通主体保持，旧3/1/2图库保持。真实队列未写入。','五餐饮主体实际无图，三撤回和一个完整scope阻止补图，mock5→1，普通陈氏保持；旧3/1/2图库保持，真实队列未写入。')
p.write_text(s,encoding='utf-8')
