// 仅在明确已应用批次的版本范围内延续人工清洗分类，不自动接受其他并发实体变化。
import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const root=new URL('./',import.meta.url),dir=process.argv[2];assert.ok(dir);
const folder=pathToFileURL(dir.replace(/[\\/]?$/,'/'));
const input=JSON.parse(await readFile(new URL('input.json',folder),'utf8'));
const prior=JSON.parse(await readFile(new URL('cleaning-scope/run-1791371057197/classification-review-01.json',root),'utf8'));
const allowed=new Map();
for(const batch of ['28','29']){
  const result=JSON.parse(await readFile(new URL(`all-cities/batch-${batch}-applied.json`,root),'utf8'));assert.equal(result.apply,true);
  for(const c of result.changes)for(const e of c.entities)allowed.set(e.entity_id,{revision:e.revision,batch});
}
const changes=prior.map(c=>{
  const e=input.entities.find(e=>e.entity_id===c.entityId),applied=allowed.get(c.entityId);assert.ok(e&&!e.redirect_to);
  assert.equal(e.revision,applied?.revision??c.revision,'非本批次实体变化须重新复核');
  return {...c,revision:e.revision,evidence:c.evidence.replaceAll('priority-evidence-01.json',
    '../run-1791371057197/priority-evidence-01.json')+(applied?.batch==='28'?' 产品类别已在batch28修正为美食。':
      applied?.batch==='29'?' 已在batch29隔离并撤回成都候选，原始归属待审保留。':'')};
});
await writeFile(new URL('classification-review-02.json',folder),JSON.stringify(changes,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({corrections:changes.length,governedVersions:changes.filter(c=>allowed.has(c.entityId)).length}));
