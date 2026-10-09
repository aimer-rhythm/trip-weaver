import assert from 'node:assert/strict';
export const FURONG_ID='747792d1b5834255f5feaa6c2dc62925';
export const FURONG_WARNING='美食：别在芙蓉街买小吃，又贵又不正宗！';
export function assertFurongRow(p:any,old:any,_sid:number,evidence:any[],prior:any[]) {
  for(const k of ['id','name','category','lat','lng','verified'])assert.equal(p[k],old[k],k);
  assert.equal(p.payload.identity.revision,4);assert.equal(old.payload.identity.revision,3);
  assert.deepEqual(p.payload.identity.memberIds,old.payload.identity.memberIds);
  for(const k of ['aliases','address','geoStatus','xhsPlaceType','typicalVisitMinutes','reservation','reservationNote','reservationEvidence','reservationConflict','price'])
    assert.deepEqual(p.payload[k],old.payload[k],k);
  assert.equal(p.category,'文化');assert.equal(p.payload.xhsPlaceType,'other');assert.equal(p.payload.typicalVisitMinutes,30);
  assert.equal(p.payload.mentionCount,28);assert.equal(p.payload.mentionSources.length,28);
  assert.ok(!p.payload.mentionSources.some((m:any)=>[12904,12948].includes(m.mentionId)));
  assert.ok(p.payload.mentionSources.some((m:any)=>m.mentionId===11699));
  assert.deepEqual(p.payload.imageIdentity.approved,[]);
  assert.ok(old.payload.tips.some((t:string)=>t.includes('别在芙蓉街买小吃')&&t.includes('山东博物馆')));
  assert.deepEqual(p.payload.tips,[FURONG_WARNING]);assert.deepEqual(p.payload.themes,[]);
  const oldHours=structuredClone(old.payload.openHours);
  assert.equal(oldHours.review.length,1);assert.equal(oldHours.review[0].subject,'山东博物馆');
  oldHours.review=[];assert.deepEqual(p.payload.openHours,oldHours);
  assert.deepEqual(p.payload.content.highlights,old.payload.content.highlights);
  for(const e of prior)assert.ok(evidence.some(x=>x.kind===e.kind&&x.content===e.content),'旧有效语料丢失');
  for(const content of [FURONG_WARNING,'人最多，拥挤，不宜推婴儿车','小吃逛逛就行，不必特意吃'])
    assert.ok(evidence.some(e=>e.kind==='xhs_warning'&&e.content===content));
  assert.equal(evidence.length,27);assert.equal(prior.length,5);
  const consumed=JSON.stringify({content:p.payload.content,reasons:p.payload.topReasons,tips:p.payload.tips,evidence});
  for(const bad of ['茶香排骨','糖醋鲤鱼','三刷认证','量大便宜','晚上去小吃街方便','山东博物馆周一闭馆','自带空瓶'])assert.ok(!consumed.includes(bad),bad);
}
