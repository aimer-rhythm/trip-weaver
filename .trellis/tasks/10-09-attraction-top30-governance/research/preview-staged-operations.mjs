// 暂存完整scope导出进入正式双导入及旧字段保全预演；不写业务库。
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
const here=path.dirname(fileURLToPath(import.meta.url));
const parent=path.resolve(here,'../../10-06-place-identity-governance/research');
const root=path.resolve(here,'../../../..');
const source=path.join(parent,'all-cities/batch-112-v2/preview-01');
const folder=path.join(source,'downstream-02');
assert.equal(JSON.parse(fs.readFileSync(path.join(source,'report.json'))).passed,true);
fs.mkdirSync(folder);
const baseline=JSON.parse(fs.readFileSync(path.join(parent,'all-cities/batch-115/sync-01/xhs-places-厦门.json'))).relationIdentity;
const stagedBefore=JSON.parse(fs.readFileSync(path.join(source,'before.json'))).relationIdentity;
assert.equal(stagedBefore.sourceHash,baseline.sourceHash,'暂存预演必须从现行完整来源状态开始');
assert.equal(stagedBefore.relationHash,baseline.relationHash);
const projection={reason:'一次性上游库未重建导出版本计数；下游预演副本模拟现行来源的下一版本，不作为正式导出',
  currentRevision:baseline.revision,projectedRevision:baseline.revision+1,originalExports:{}};
for(const name of ['xhs-places-厦门.json','xhs-place-relations-厦门.json']) {
  const bytes=fs.readFileSync(path.join(source,name)), data=JSON.parse(bytes);
  assert.notEqual(data.relationIdentity.sourceHash,baseline.sourceHash);
  projection.originalExports[name]={sha256:createHash('sha256').update(bytes).digest('hex'),revision:data.relationIdentity.revision};
  data.relationIdentity.revision=projection.projectedRevision;
  fs.writeFileSync(path.join(folder,name),JSON.stringify(data),{flag:'wx'});
}
fs.writeFileSync(path.join(folder,'version-projection.json'),JSON.stringify(projection,null,2),{flag:'wx'});
fs.writeFileSync(path.join(folder,'state.json'),JSON.stringify({city:'厦门',phase:'exported',placesImported:false,relationsImported:false}),{flag:'wx'});
async function run(args,name,env={}) {
  const log=fs.createWriteStream(path.join(folder,name),{flags:'wx'});
  const child=spawn(process.execPath,args,{cwd:root,windowsHide:true,env:{...process.env,...env},stdio:['ignore','pipe','pipe']});
  child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
  await new Promise(resolve=>log.end(resolve));
  assert.equal(code,0,`预演失败：${name}`);
}
await run(['--import','tsx',path.join(parent,'freeze-relation-city.mts'),folder],'freeze.log');
assert.deepEqual(JSON.parse(fs.readFileSync(path.join(folder,'library-before.json'))).tables.place_relation_snapshots[0].manifest,baseline,
  '当前业务来源不能在预演期间改变');
await run([path.join(parent,'run-tests.mjs'),path.join(parent,'verify-relation-city.test.mts')],'preview.log',
  {RELATION_CITY_FIXTURE:pathToFileURL(folder+path.sep).href,RELATION_CITY_PRESERVE_MEDIA:'1'});
console.log(JSON.stringify({batch:'batch-112-v2',downstreamPreview:true,folder}));
