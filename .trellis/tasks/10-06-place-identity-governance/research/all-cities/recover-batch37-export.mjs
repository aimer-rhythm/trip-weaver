// 原导出已成功、校验器在普通来源预期上失败；重新校验并登记原文件，不重新导出。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validateScopeExpectations,validateBatchExport} from './sync-contract.mjs';
const url=f=>new URL(f,import.meta.url);
const read=f=>JSON.parse(fs.readFileSync(url(f),'utf8'));
const hash=f=>createHash('sha256').update(fs.readFileSync(url(f))).digest('hex');
const folder='batch-37/sync-01/';
assert.ok(!fs.existsSync(url(folder+'sync-state.json')));
const applied=read('batch-37-applied.json');assert.equal(applied.apply,true);assert.equal(applied.changes.length,5);
const decisions=read('batch-37-decisions.json'),expectations=read('batch-37-export-expectations.json');
validateScopeExpectations(decisions,[],expectations);
const data=read(folder+'xhs-places-济南.json'),graph=read(folder+'xhs-place-relations-济南.json');
validateBatchExport(data,'济南',decisions,expectations);
assert.equal(data.places.length,228);assert.deepEqual(data.relationIdentity,graph.relationIdentity);
assert.equal(data.relationIdentity.revision,11);
const report={batch:'batch-37',reexported:false,reason:'原文件已生成；普通来源玛瑙泉无mentionSources，修正导出预期校验后通过',
  exportHash:hash(folder+'xhs-places-济南.json'),relationHash:hash(folder+'xhs-place-relations-济南.json'),recoveredAt:new Date().toISOString()};
const state={batch:'batch-37',decisionHash:hash('batch-37-decisions.json'),expectationsHash:hash('batch-37-export-expectations.json'),
  cities:{'济南':{exportHash:report.exportHash,relationHash:report.relationHash,exportedAt:report.recoveredAt,places:228,relationSnapshotRevision:11}}};
fs.writeFileSync(url(folder+'export-recovery.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
fs.writeFileSync(url(folder+'sync-state.json'),JSON.stringify(state,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report));
