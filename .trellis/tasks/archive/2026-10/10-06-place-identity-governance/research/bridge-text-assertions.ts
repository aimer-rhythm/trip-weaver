import assert from 'node:assert/strict';
export const GATE_ID='fd7c5d9a0af5a1ec9515743d6f05bce5',GATE_NAME='起凤桥八号门洞';
export function assertBridgeTextRow(p:any,old:any,sid:number,evidence:any[],prior:any[]) {
  for(const k of ['id','category','verified','lat','lng'])assert.equal(p[k],old[k],k);
  assert.equal(p.category,'文化');assert.equal(p.payload.xhsPlaceType,'photo_spot');
  for(const k of ['address','geoStatus','typicalVisitMinutes','reservation','reservationNote','reservationEvidence','reservationConflict','price','tips','mentionCount'])assert.deepEqual(p.payload[k],old.payload[k],k);
  assert.deepEqual(p.payload.content.highlights,old.payload.content.highlights);assert.deepEqual(evidence,prior);
  if(sid===5479) {
    assert.equal(p.name,old.name);
    for(const k of ['identity','aliases','openHours','themes','mentionSources','topReasons'])assert.deepEqual(p.payload[k],old.payload[k],k);
    const content=structuredClone(old.payload.content);content.compiledAt=p.payload.content.compiledAt;assert.deepEqual(p.payload.content,content);
    assert.equal(evidence.length,4);assert.ok(evidence.some(e=>e.kind==='xhs_warning'&&e.content==='人多，可改拍西侧灯笼亭子'));
    return;
  }
  assert.equal(sid,5392);assert.equal(p.name,GATE_NAME);assert.equal(p.payload.identity.revision,3);assert.equal(old.payload.identity.revision,1);
  assert.deepEqual(p.payload.aliases,[GATE_NAME]);assert.deepEqual(p.payload.identity.memberNames,[GATE_NAME]);
  assert.ok(p.payload.identity.memberIds.includes(GATE_ID));assert.equal(p.payload.identity.memberIds.length,old.payload.identity.memberIds.length+1);
  const hours=structuredClone(old.payload.openHours);hours.subject=GATE_NAME;assert.deepEqual(p.payload.openHours,hours);
  assert.deepEqual(p.payload.themes,[]);assert.deepEqual(p.payload.imageIdentity.approved,[]);
  assert.deepEqual(p.payload.mentionSources.map((m:any)=>m.mentionId).sort((a:number,b:number)=>a-b),[11458,12724]);
  assert.equal(p.payload.typicalVisitMinutes,30);assert.equal(evidence.length,2);assert.equal(p.payload.content.highlights.length,1);
  assert.deepEqual(p.payload.topReasons,old.payload.topReasons);
}
