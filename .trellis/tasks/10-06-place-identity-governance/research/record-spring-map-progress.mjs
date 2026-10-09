import fs from 'node:fs';
import assert from 'node:assert/strict';
const url=f=>new URL(f,import.meta.url);
const read=f=>JSON.parse(fs.readFileSync(url(f),'utf8'));
const pointer=read('cleaning-scope/current.json');
assert.equal(pointer.latestAppliedEntityBatch,36);assert.equal(pointer.cityReviewLedgers['济南'],'../priority-cities/济南/review-13.json');
const map=read('priority-cities/济南/spring-map-reference-check-01.json');assert.equal(map.matches.length,5);assert.deepEqual(map.failures,[]);
assert.ok(map.matches.every(m=>m.originalPointPreserved&&!m.fullReviewPassed));
const retry=read('all-cities/batch-36/sync-01/withdrawal-vectors-recheck-02.json');assert.equal(retry.failures.length,2);
fs.writeFileSync(url('cleaning-scope/current-before-spring-map-check.json'),JSON.stringify(pointer,null,2)+'\n',{flag:'wx'});
pointer.pendingVerification[0].evidence='../all-cities/batch-36/sync-01/withdrawal-vectors-recheck-02.json';
pointer.latestReadOnlyFindings={file:'../spring-map-review-20261008.md',mapReferenceMatches:5,fullReviewsAdded:0,
  webSearchStatus:'configured_model_no_available_channel',evidence:'../priority-cities/济南/spring-map-reference-check-01.json'};
const extra='第36批后补查五泉地图参考点，5处现行坐标均与同名泉体POI一致，未增加完整自查数量；网页主搜索模型无可用通道，公开页面补证继续。甜沫儿向量第二次专门复核仍超时。见research/spring-map-review-20261008.md。';
pointer.progressNote+=' '+extra;pointer.progressUpdatedAt=new Date().toISOString();
fs.writeFileSync(url('cleaning-scope/current.json'),JSON.stringify(pointer,null,2)+'\n');
const task=read('../task.json');assert.equal(task.status,'in_progress');task.notes+=' '+extra;
fs.writeFileSync(url('../task.json'),JSON.stringify(task,null,2)+'\n');
for(const [file,marker] of [['../prd.md','## 已知事实\n'],['nine-cities-continuation-20261007.md','## 本轮断点\n']]) {
  const text=fs.readFileSync(url(file),'utf8');assert.ok(text.includes(marker));
  fs.writeFileSync(url(file),text.replace(marker,marker+'\n### 第36批后只读补查\n\n'+extra+'review-13、实体36、flow38/audit34和110范围内待审保持。以下为前序记录。\n'));
}
console.log(JSON.stringify({entityBatch:36,ledger:'review-13',mapReferences:5,fullReviewsAdded:0,pendingVector:'甜沫儿'}));
