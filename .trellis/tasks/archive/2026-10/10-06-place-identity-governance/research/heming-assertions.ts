// 茶社全字段消费预期；只采用已冻结提及和逐字跨行意见。
import assert from 'node:assert/strict';
export const HEMING_ID='726ded184fe71d5b6ad1642e0e60d3f1';
export const HEMING_WARNING='可以不去\n鹤鸣茶社';
export function stableHemingPlace(p:any){const value=structuredClone(p);if(value.payload?.content)delete value.payload.content.compiledAt;return value;}
export function expectedHemingExport(prior:any,source:any){
  assert.equal(prior.id,HEMING_ID);assert.equal(prior.payload.identity.revision,1);
  const expected=stableHemingPlace(prior),rows=[...source.mentions].sort((a:any,b:any)=>-a.confidence+b.confidence||a.id-b.id);
  assert.equal(rows.length,6);expected.payload.identity.revision=2;
  expected.payload.mentionSources=rows.map((m:any)=>({mentionId:m.id,noteId:m.raw_note_id,inputHash:m.inputHash}));
  expected.payload.imageIdentity={version:1,mode:'reviewed',entityId:HEMING_ID,revision:2,approved:[]};
  expected.payload.topReasons=rows.filter((m:any)=>m.mention_type==='recommend').map((m:any)=>m.reason).slice(0,3);
  expected.payload.tips=[HEMING_WARNING];
  expected.evidence=rows.map((m:any)=>({kind:m.mention_type==='warning'?'xhs_warning':'xhs_reason',content:m.reason,sourceUrl:m.source_url}));
  expected.evidence.push({kind:'xhs_warning',content:HEMING_WARNING,sourceUrl:source.noteDetails.find((n:any)=>n.id===877).sourceUrl});
  assert.equal(expected.evidence.length,7);for(const old of prior.evidence)assert.ok(expected.evidence.some((e:any)=>JSON.stringify(e)===JSON.stringify(old)));
  assert.equal(expected.payload.content.highlights.length,4);assert.equal(expected.payload.typicalVisitMinutes,undefined);
  assert.equal(expected.payload.openHours.status,'unknown');assert.equal(expected.payload.reservation,'unknown');
  return expected;
}
