// 正式全城导出对照经过逐字段审阅的真实来源隔离结果；不输出媒体URL。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const root=new URL('./',import.meta.url),read=p=>JSON.parse(fs.readFileSync(new URL(p,root),'utf8'));
const stable=p=>{const v=structuredClone(p);if(v.payload?.content)delete v.payload.content.compiledAt;return v;};
const folder='all-cities/batch-70/sync-01/',isolated='all-cities/batch-70/scope-preview-1791512008187072400/';
const proof=read(isolated+'report.json');assert.deepEqual(proof.failures,[]);assert.ok(proof.idempotent&&proof.reverseRollback);
const old=read('all-cities/batch-69/sync-01/xhs-places-成都.json').places,expected=read(isolated+'xhs-places-成都.json').places;
const bytes=fs.readFileSync(new URL(folder+'xhs-places-成都.json',root)),output=JSON.parse(bytes).places;
assert.equal(createHash('sha256').update(bytes).digest('hex'),read(folder+'sync-state.json').cities['成都'].exportHash);
assert.equal(output.length,392);assert.deepEqual(output.map(p=>p.id).sort(),old.map(p=>p.id).sort());
const id='8a433260acdd259716088f8009e0fbdc';
for(const p of output)assert.deepEqual(stable(p),stable((p.id===id?expected:old).find(v=>v.id===p.id)),p.name+'全字段');
const before=read('all-cities/batch-69/sync-01/xhs-place-relations-成都.json'),after=read(folder+'xhs-place-relations-成都.json');
const key=e=>[e.fromEntityId,e.toEntityId].sort().join('|');
const changed=after.relations.filter(e=>JSON.stringify(e)!==JSON.stringify(before.relations.find(o=>key(o)===key(e))));
const removed=before.relations.filter(e=>!after.relations.some(o=>key(o)===key(e)));
const report={batch:70,exportedPlaces:392,allOtherPlacesPreserved:391,targetEqualsReviewedIsolatedExport:true,
  relationBefore:before.relations.length,relationAfter:after.relations.length,directBefore:before.relations.filter(r=>r.strength==='direct').length,
  directAfter:after.relations.filter(r=>r.strength==='direct').length,changedEdges:changed.map(e=>({from:e.fromEntityId,to:e.toEntityId,evidence:e.evidence})),removedEdges:removed,
  failures:[]};
fs.writeFileSync(new URL('priority-cities/成都/jinli-export-check-01.json',root),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({batch:70,exportedPlaces:392,otherPlacesPreserved:391,relations:[report.relationBefore,report.relationAfter],direct:[report.directBefore,report.directAfter],changedEdges:changed.length,removedEdges:removed.length,failures:[]}));
