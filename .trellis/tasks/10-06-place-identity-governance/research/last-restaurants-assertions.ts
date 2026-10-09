import assert from 'node:assert/strict';
export const RESTAURANT_PLAN:Record<number,{name:string;mentions:number[];address?:string;evidence:number;clear?:boolean}>={
  5331:{name:'许记排骨（县东巷71号）',mentions:[11353,12594],address:'县东巷71号',evidence:1,clear:true},
  5343:{name:'桥下把子肉（山大南路店）',mentions:[11365,11643,12606],address:'山大南路蜀易火锅隔壁',evidence:2},
  5340:{name:'蜗牛叔叔的食堂（泉城路店）',mentions:[11362,12603],evidence:1},
};
export function assertRestaurantRow(p:any,old:any,sid:number,evidence:any[],prior:any[]) {
  for(const k of ['id','category','verified'])assert.equal(p[k],old[k],k);
  assert.equal(p.category,'美食');assert.equal(p.payload.xhsPlaceType,'food');
  const plan=RESTAURANT_PLAN[sid];
  if(!plan) {
    for(const k of ['name','lat','lng'])assert.equal(p[k],old[k],k);
    for(const k of ['identity','aliases','address','geoStatus','openHours','themes','mentionSources','mentionCount','topReasons','tips','price','typicalVisitMinutes','reservation'])assert.deepEqual(p.payload[k],old.payload[k],k);
    const content=structuredClone(old.payload.content);content.compiledAt=p.payload.content.compiledAt;assert.deepEqual(p.payload.content,content);
    assert.deepEqual(evidence,prior);return;
  }
  assert.equal(old.payload.identity.revision,1);assert.equal(p.payload.identity.revision,3);assert.equal(p.name,plan.name);
  assert.ok(old.payload.identity.memberIds.every((id:string)=>p.payload.identity.memberIds.includes(id)));
  assert.equal(p.payload.identity.memberIds.length,old.payload.identity.memberIds.length+1);
  assert.ok(old.payload.aliases.every((name:string)=>p.payload.aliases.includes(name)));assert.ok(p.payload.aliases.includes(plan.name));
  assert.equal(p.payload.address,plan.address??old.payload.address);
  assert.equal(p.lat,plan.clear?null:old.lat);assert.equal(p.lng,plan.clear?null:old.lng);
  assert.equal(p.payload.geoStatus,plan.clear?'unresolvable':old.payload.geoStatus);
  for(const k of ['xhsPlaceType','typicalVisitMinutes','reservation','reservationNote','reservationEvidence','reservationConflict','price','tips'])assert.deepEqual(p.payload[k],old.payload[k],k);
  const hours=structuredClone(old.payload.openHours);hours.subject=plan.name;assert.deepEqual(p.payload.openHours,hours);
  assert.deepEqual(p.payload.themes,[]);assert.deepEqual(p.payload.imageIdentity.approved,[]);
  assert.deepEqual(p.payload.mentionSources.map((m:any)=>m.mentionId).sort((a:number,b:number)=>a-b),plan.mentions);
  assert.equal(p.payload.mentionCount,plan.mentions.length);
  assert.deepEqual(p.payload.content.highlights,old.payload.content.highlights.filter((h:any)=>sid!==5331||h.text!=='济南美食推荐，具体菜品未详述'));
  assert.equal(evidence.length,plan.evidence);
  assert.deepEqual(evidence,prior.filter((e:any)=>sid!==5331||e.content!=='济南美食推荐，具体菜品未详述'));
  const consumer=JSON.stringify({content:p.payload.content,reasons:p.payload.topReasons,evidence});
  assert.ok(!consumer.includes('济南美食推荐，具体菜品未详述'));
  assert.ok(consumer.includes('本地人推荐，有特色且味道好'));
}
