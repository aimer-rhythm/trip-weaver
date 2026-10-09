import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=new URL('./',import.meta.url),folder=new URL('cleaning-scope/run-1791371057197/',root);
const bytes=await readFile(new URL('priority-evidence-01.json',folder)),evidence=JSON.parse(bytes);
const hash=createHash('sha256').update(bytes).digest('hex');
assert.equal(hash,'11ab88baf96107c4b8f321fefeaa3721b5b463815aa37caaa60407626208d371');
const baseline=JSON.parse(await readFile(new URL('all-cities/batch-28-baseline.json',root),'utf8'));
const corrections=JSON.parse(await readFile(new URL('classification-review-01.json',folder),'utf8'));
const notes={
  '天棒老火锅（老店）':30,'绍友老火锅':30,'王胖娃面':30,'唐红英火锅（临江门店）':30,
  '秋孃孃火锅':30,'惠火锅（解放碑店）':30,'秋姐三样菜':30,
  '烤匠麻辣烤鱼（观音桥大融城店）':174,'莲藕抄手':174,'李若桃':28,'一只酸奶牛':28,'孔二火锅':291,
};
const decisions=[];
for(const [name,noteId] of Object.entries(notes)){
  const entity=baseline.entities.find(e=>e.canonical_name===name);assert.ok(entity);
  const correction=corrections.find(c=>c.entityId===entity.entity_id);assert.equal(entity.revision,correction.revision);
  const note=evidence.notes.find(n=>Number(n.id)===noteId);assert.ok(note&&note.city==='重庆');
  const quote=note.desc.split(/\r?\n/).find(line=>line.includes(name));assert.ok(quote);
  const pair=evidence.pairs.find(p=>p.source.entity_id===entity.entity_id);assert.ok(pair);
  assert.ok(pair.mentions.some(m=>Number(m.raw_note_id)===noteId));
  assert.notEqual(entity.overrides.category,'美食');
  decisions.push({key:`all-cities-20261007-batch-28-${String(decisions.length+1).padStart(3,'0')}`,
    city:'重庆',entityId:entity.entity_id,mergeEntityIds:[],canonicalName:name,aliases:[],
    expectedRevisions:{[entity.entity_id]:entity.revision},overrides:{category:'美食'},evidence:[{
      kind:'reviewed_food_category',file:'cleaning-scope/run-1791371057197/priority-evidence-01.json',sha256:hash,
      sourcePlaceId:Number(pair.source.id),noteId,quote,
      mentionIds:pair.mentions.filter(m=>Number(m.raw_note_id)===noteId).map(m=>Number(m.id)),
      conclusion:`原文明确${correction.bucket==='cafe'?'奶茶/酸奶饮品':'餐饮'}；产品类别纠正为美食，清洗桶为${correction.bucket}。本批不认领新别名、不改变分店归属和原始提及。`,
    }]});
}
await writeFile(new URL('all-cities/batch-28-decisions.json',root),JSON.stringify(decisions,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({batch:'batch-28',categoryCorrections:decisions.length,merges:0,names:decisions.map(d=>d.canonicalName)}));
