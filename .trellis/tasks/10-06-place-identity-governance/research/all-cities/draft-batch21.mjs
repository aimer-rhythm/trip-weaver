// 仅纠正已核实原笔记的景山误写，保留真正的石景山游乐园独立身份。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {reviewedImageContexts} from './image-review-context.mjs';
const base=new URL('./',import.meta.url), batch='batch-21';
const read=file=>JSON.parse(fs.readFileSync(new URL(file,base),'utf8'));
const hash=file=>createHash('sha256').update(fs.readFileSync(new URL(file,base))).digest('hex');
for(const suffix of ['image-context','selections','review-selections','prerequisites','decisions','review-decisions','applied'])
  assert.ok(!fs.existsSync(new URL(`${batch}-${suffix}.json`,base)),`不能覆盖${suffix}`);
const imageFile=`${batch}-image-context.json`;
const observation='504 P2自然/公园类明确写景山公园（故宫对面），下方第7项同名并写俯瞰故宫全景的最佳地点；P1 Day1路线也明确天安门广场→故宫博物院→景山公园→南锣鼓巷。两图与正文第7点同一路线对应，证明该条石景山公园是景山公园的误写。仅用于身份判断，不采信图中门票/预约/营业时间为当前事实。';
const images=reviewedImageContexts(base,[{contextFile:'beijing-batch06-context.json',mentionId:3148,
  manifestFile:'beijing-chengdu-images-01/manifest.json',index:1,observations:observation}]);
const primary='981bfe8125feb36e052dcfee1e0df8b5';
const old='a94865355cdbf6fccfda6fc748b9e9fe';
const snapshotFile='audit/run-15/snapshot.json', snapshot=read(snapshotFile);
assert.equal(snapshot.readOnly,true);
for(const id of [primary,old]) {
  const row=snapshot.entities.find(e=>e.entity_id===id);
  assert.ok(row && row.status==='ACTIVE' && !row.redirect_to && row.revision===1);
}
const selections=[{reviews:[112],primary:'景山公园',
  reason:'石景山公园源1508只有3148/note504这一条提及。正文第7点写天安门、故宫和石景山公园，但同篇原图P1和P2均明确写景山公园，P2另标故宫对面、俯瞰故宫全景。现已直接看图确认本条误写，归并到景山公园现有稳定ID；不把真实首钢园内山体或石景山游乐园当同义。',
  geometryReason:'沿用景山公园主源1063的GCJ-02公园参考点39.925875/116.396551、景山西街44号，符合原图故宫对面及主源多篇俯瞰故宫描述。误匹配首钢园的1508旧点不参与平均。',
  contexts:[{file:imageFile,mentionIds:[3148]}]}];
const reviews=[{review:135,verdict:'distinct',
  explanation:'原审核石景山公园一侧已由504原图明确为故宫北侧景山公园；另一侧石景山乐园在batch-06已归入石景山游乐园。640原文把其列为商圈/主题乐园，与故宫对面俯瞰紫禁城的公园不属同一实体。两个现行根保持独立，不能按原误写共享石景山三字再次合并。',
  contexts:[{file:imageFile,mentionIds:[3148]},{file:'beijing-batch08-context.json',mentionIds:[3211]}]}];
for(const [suffix,data] of [['image-context',images],['selections',selections],['review-selections',reviews],['prerequisites',['batch-06','batch-07']]])
  fs.writeFileSync(new URL(`${batch}-${suffix}.json`,base),JSON.stringify(data,null,2)+'\n',{flag:'wx'});
for(const script of ['build-batch.mjs','build-reviews.mjs']) {
  const result=spawnSync(process.execPath,[fileURLToPath(new URL(script,base)),batch],{windowsHide:true,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);process.stdout.write(result.stdout);
}
const decisions=read(`${batch}-decisions.json`);
assert.equal(decisions.length,1);assert.equal(decisions[0].entityId,primary);
assert.deepEqual(decisions[0].mergeEntityIds,[old]);
assert.deepEqual(decisions[0].expectedRevisions,Object.fromEntries([primary,old].map(id=>[id,snapshot.entities.find(e=>e.entity_id===id).revision])));
decisions[0].evidence.push({kind:'reviewed_current_identity_snapshot',file:`all-cities/${snapshotFile}`,sha256:hash(snapshotFile),
  conclusion:'两主体当前仍为各自稳定根且revision=1，与冻结原源一致；现行游乐园根通过batch-06依赖重建。'});
fs.writeFileSync(new URL(`${batch}-decisions.json`,base),JSON.stringify(decisions,null,2)+'\n');
console.log(JSON.stringify({merges:1,distinctReviews:1,currentIdentitySnapshot:snapshotFile}));
