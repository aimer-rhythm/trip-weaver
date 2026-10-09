// 固定本轮已验证的范围入口；不标记任务完成，不提交或修改业务库。
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {buildCleaningScope,type ScopeInput,type BucketCorrection} from './cleaning-scope.mjs';

const root=new URL('./',import.meta.url),relative='cleaning-scope/run-1791372788231/scope-05.json';
const bytes=await readFile(new URL(relative,root));
const scope=JSON.parse(bytes.toString('utf8'));
const inputBytes=await readFile(new URL('cleaning-scope/run-1791372788231/input.json',root));
assert.equal(createHash('sha256').update(inputBytes).digest('hex'),scope.inputSha256);
const {inputSha256,corrections,generatedAt,...result}=scope;
assert.ok(isDeepStrictEqual(result,buildCleaningScope(JSON.parse(inputBytes.toString('utf8')) as ScopeInput,
  corrections as BucketCorrection[])),'重建清单与冻结输出不一致');
const flow=JSON.parse(await readFile(new URL('all-cities/flow/run-31/report.json',root),'utf8'));
const cleanup=JSON.parse(await readFile(new URL('all-cities/flow/run-31/cleanup.json',root),'utf8'));
assert.equal(flow.failures.length,0);assert.equal(flow.cities.length,12);assert.equal(cleanup.removed,true);
for(const batch of [28,29]){
  const applied=JSON.parse(await readFile(new URL(`all-cities/batch-${batch}-applied.json`,root),'utf8'));
  const sync=JSON.parse(await readFile(new URL(`all-cities/batch-${batch}/sync-01/sync-state.json`,root),'utf8'));
  const verified=JSON.parse(await readFile(new URL(`all-cities/batch-${batch}/sync-01/verification-vectors.json`,root),'utf8'));
  assert.equal(applied.apply,true);assert.equal(verified.vectors,true);assert.equal(verified.failures.length,0);
  for(const city of Object.values(sync.cities) as Array<Record<string,unknown>>)assert.ok(city.importedAt&&city.relationsImportedAt&&city.embeddingRunAt);
}
const pointer={version:1,scopeFile:'run-1791372788231/scope-05.json',
  scopeSha256:createHash('sha256').update(bytes).digest('hex'),inputSha256,
  reportFile:'run-1791372788231/scope-05.md',policy:scope.policy,summary:scope.summary,
  latestAppliedEntityBatch:29,latestFlow:'../all-cities/flow/run-31',latestAudit:'../all-cities/audit/run-27',
  userAcceptance:false,taskStatus:'in_progress',activatedAt:new Date().toISOString()};
await writeFile(new URL('cleaning-scope/current.json',root),JSON.stringify(pointer,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({scope:relative,sha256:pointer.scopeSha256,summary:scope.summary,taskStatus:pointer.taskStatus}));
