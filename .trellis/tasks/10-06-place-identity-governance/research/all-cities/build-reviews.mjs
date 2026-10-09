// 将逐项核实的独立/组成/待补证据结论生成可预演、可回滚的审核请求。
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const base=new URL('./',import.meta.url);
const read=file=>JSON.parse(fs.readFileSync(new URL(file,base),'utf8'));
const hash=file=>createHash('sha256').update(fs.readFileSync(new URL(file,base))).digest('hex');
const batch=process.argv[2];
assert.match(batch ?? '',/^batch-\d{2}(?:-v\d+)?$/);
const snapshot=read('source-snapshot.json');
const supplementsFile=new URL(`${batch}-supplements.json`,base);
const supplements=fs.existsSync(supplementsFile)?read(`${batch}-supplements.json`):[];
for(const file of supplements) {
  assert.match(file,/^[a-z0-9-]+\.json$/);
  for(const entity of read(file).entities) {
    assert.ok(!snapshot.entities.some(e=>e.entity_id===entity.entity_id));snapshot.entities.push(entity);
  }
  for(const review of read(file).reviews || []) {
    assert.ok(!snapshot.reviews.some(r=>String(r.id)===String(review.id)));snapshot.reviews.push(review);
  }
}
const entities=new Map(snapshot.entities.map(e=>[e.entity_id,{...e}]));
const root=id=>{const seen=new Set();while(entities.get(id)?.redirect_to){assert.ok(!seen.has(id));seen.add(id);id=entities.get(id).redirect_to;}return entities.get(id);};
// 显式依赖已应用批次，不能从旧快照猜测当前根或手工递增版本。
const prerequisitesFile=new URL(`${batch}-prerequisites.json`,base);
const prerequisites=fs.existsSync(prerequisitesFile)?read(`${batch}-prerequisites.json`):[];
const priorSeen=new Set();
for(const prior of prerequisites) {
  assert.match(prior,/^batch-\d{2}(?:-v\d+)?$/);
  assert.ok(!priorSeen.has(prior),'依赖批次重复');
  const indirectFile=new URL(`${prior}-prerequisites.json`,base);
  for(const indirect of fs.existsSync(indirectFile)?read(`${prior}-prerequisites.json`):[])
    assert.ok(priorSeen.has(indirect),`${prior} 的历史依赖 ${indirect} 须显式列在它前面`);
  assert.ok(read(`${prior}-applied.json`).apply,`依赖批次未应用: ${prior}`);
  priorSeen.add(prior);
}
for(const decision of [...prerequisites,batch].flatMap(name=>read(`${name}-decisions.json`))) {
  const entity=entities.get(decision.entityId);assert.equal(entity.revision,decision.expectedRevisions[entity.entity_id]);
  entity.revision++;
  for(const id of decision.mergeEntityIds){const e=entities.get(id);assert.equal(e.revision,decision.expectedRevisions[id]);e.redirect_to=entity.entity_id;e.revision++;}
}
const used=new Set();
const usedPairs=new Set();
const decisions=read(`${batch}-review-selections.json`).map(item=>{
  assert.ok(!used.has(item.review));used.add(item.review);
  const review=snapshot.reviews.find(r=>Number(r.id)===item.review);assert.ok(review);
  const current=[...new Map(review.detail.entityIds.map(id=>{const e=root(id);return[e.entity_id,e];})).values()];
  assert.equal(current.length,2);
  const pair=current.map(e=>e.entity_id).sort().join(':');
  assert.ok(!usedPairs.has(pair),'同一现行实体对只能提交一项审核；用coveredReviews声明历史重复行');
  usedPairs.add(pair);
  const covered=(item.coveredReviews ?? []).map(id=>{
    assert.ok(!used.has(id),'历史重复行已分配');used.add(id);
    const row=snapshot.reviews.find(r=>Number(r.id)===id);assert.ok(row);
    assert.equal([...new Set(row.detail.entityIds.map(id=>root(id).entity_id))].sort().join(':'),pair,'覆盖行不是同一实体对');
    return row;
  });
  // 此转换器不推测 REVIEW 实体的释放时机；这种批次须从最新实库预演生成版本。
  assert.ok(current.every(e=>e.status==='ACTIVE'),'涉及隔离实体，请按逐步预演生成版本');
  const evidence=[{kind:'reviewed_source_snapshot',file:'all-cities/source-snapshot.json',sha256:hash('source-snapshot.json'),
    reviewIds:[item.review,...(item.coveredReviews ?? [])],conclusion:item.explanation,
    sourcePlaceIds:[...new Set([review,...covered].flatMap(row=>row.detail.entityIds.flatMap(id=>entities.get(id).places.map(p=>p.id))))]}];
  for(const file of supplements.filter(file=>(read(file).reviews || []).some(r=>[item.review,...(item.coveredReviews || [])].includes(Number(r.id))))) {
    evidence.push({kind:'reviewed_supplemental_review',file:`all-cities/${file}`,sha256:hash(file),conclusion:item.explanation});
  }
  for(const context of item.contexts ?? []) {
    const rows=read(context.file);assert.ok(context.mentionIds.every(id=>rows.some(r=>Number(r.mention_id)===id)));
    evidence.push({kind:'reviewed_full_note_context',file:`all-cities/${context.file}`,sha256:hash(context.file),
      mentionIds:context.mentionIds,conclusion:item.explanation});
  }
  for(const file of item.sources || []) {
    assert.match(file,/^[a-z0-9-]+\.json$/);
    const fetched=read(file);assert.ok(fetched.ok && fetched.content,'公开来源必须已抓取正文');
    evidence.push({kind:'published_source',url:fetched.url,file:`all-cities/${file}`,sha256:hash(file)});
  }
  return {key:`all-cities-20261006-${batch}-review-${item.review}`,city:review.city,reviewFingerprint:review.fingerprint,
    expectedRevisions:Object.fromEntries(current.map(e=>[e.entity_id,e.revision])),verdict:item.verdict,
    explanation:item.explanation,evidence,...(item.childEntityId?{childEntityId:item.childEntityId}:{})};
});
fs.writeFileSync(new URL(`${batch}-review-decisions.json`,base),JSON.stringify(decisions,null,2)+'\n');
console.log(JSON.stringify({decisions:decisions.length,byVerdict:Object.fromEntries(['distinct','part_of','uncertain'].map(v=>[v,decisions.filter(d=>d.verdict===v).length]))}));
