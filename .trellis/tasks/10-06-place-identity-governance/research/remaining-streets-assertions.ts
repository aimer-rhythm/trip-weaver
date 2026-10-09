import assert from 'node:assert/strict';
const set=(v:any[])=>new Set(v.map(x=>JSON.stringify(x)));
export function assertRemainingStreetRow(p:any,old:any,sid:number,evidence:any[],prior:any[]) {
  assert.equal(p.name,old.name);assert.deepEqual(p.payload.aliases,old.payload.aliases);
  assert.deepEqual(p.payload.identity.memberIds,old.payload.identity.memberIds);
  assert.equal(p.payload.identity.revision,old.payload.identity.revision+(sid===5393?2:sid===6002?0:1));
  if(sid===5382) {
    assert.equal(old.verified,true);assert.ok(prior.length>0);assert.equal(p.verified,false);assert.equal(p.category,'其他');
    assert.equal(p.lat,null);assert.equal(p.lng,null);assert.deepEqual(p.payload.mentionSources,[]);assert.deepEqual(p.payload.imageIdentity.approved,[]);
    assert.deepEqual(p.payload.identityWithdrawal,{version:1,revision:2,reason:'unavailable_source',candidateIds:[]});assert.deepEqual(evidence,[]);
    assert.deepEqual(p.payload.themes,[]);
    for(const k of ['content','topReasons','address','openHours','reservation','reservationNote','price','tips','typicalVisitMinutes','xhsPlaceType'])assert.ok(!p.payload[k],k);
    return;
  }
  assert.equal(p.verified,true);assert.equal(p.lat,old.lat);assert.equal(p.lng,old.lng);
  assert.equal(p.payload.address,old.payload.address);assert.equal(p.payload.geoStatus,old.payload.geoStatus);
  assert.equal(p.category,sid===5403?'自然':sid===6002?old.category:'文化');
  assert.equal(p.payload.xhsPlaceType,[5353,5393].includes(sid)?'other':old.payload.xhsPlaceType);
  if(sid===5393) {
    assert.deepEqual(p.payload.mentionSources.map((m:any)=>m.mentionId).sort((a:number,b:number)=>a-b),[11460,12690,12726]);
    assert.equal(p.payload.typicalVisitMinutes,30);assert.equal(old.payload.typicalVisitMinutes,30);assert.equal(p.payload.mentionCount,3);
    assert.deepEqual(p.payload.content.highlights,old.payload.content.highlights);
    assert.deepEqual(set(evidence),set(['有济南府大字墙，适合拍照','有簪花济南文字墙，热门打卡点','可拍济南府大字墙'].map(content=>({kind:'xhs_reason',content}))));
    assert.deepEqual(p.payload.imageIdentity.approved,[]);
    for(const k of ['openHours','reservation','reservationNote','reservationEvidence','reservationConflict','price','tips'])assert.deepEqual(p.payload[k],old.payload[k],k);
  } else {
    assert.equal(p.payload.mentionSources,undefined);
    const clean=(payload:any)=>{const v=structuredClone(payload);for(const k of ['identity','xhsPlaceType','embeddedText'])delete v[k];if(v.content)delete v.content.compiledAt;return v;};
    assert.deepEqual(clean(p.payload),clean(old.payload));assert.deepEqual(set(evidence),set(prior));
    if(sid===5353) {
      assert.equal(old.category,'美食');assert.equal(old.payload.xhsPlaceType,'food');assert.equal(p.payload.typicalVisitMinutes,30);
      assert.ok(p.payload.tips.some((t:string)=>t.includes('别在芙蓉街买小吃')&&t.includes('山东博物馆周一闭馆')));
      for(const content of ['人最多，拥挤，不宜推婴儿车','小吃逛逛就行，不必特意吃'])assert.ok(evidence.some(e=>e.kind==='xhs_warning'&&e.content===content));
    }
    if(sid===5403){assert.equal(old.category,'文化');assert.deepEqual(p.payload.topReasons,['适合傍晚吹晚风散步']);assert.deepEqual(evidence,[]);}
  }
}
