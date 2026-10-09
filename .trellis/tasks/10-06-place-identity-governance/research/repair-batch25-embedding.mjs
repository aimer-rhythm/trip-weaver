// 仅通过正式导入/回填入口修复batch25的派生向量；不重放上游治理、不改冻结sync状态。
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../..');
const folder=path.join(root,'.trellis/tasks/10-06-place-identity-governance/research/all-cities/batch-25/sync-01');
const reportFile=path.join(folder,'embedding-repair-01.json');
assert.ok(!fs.existsSync(reportFile),'修复报告已存在，不能盲重跑');
const state=JSON.parse(fs.readFileSync(path.join(folder,'sync-state.json'),'utf8'));
const run=async(args,logName)=>{
  const output=fs.createWriteStream(path.join(folder,logName),{flags:'wx'});
  const child=spawn(process.execPath,args,{cwd:path.join(root,'apps/server'),windowsHide:true,stdio:['ignore','pipe','pipe']});
  child.stdout.pipe(output,{end:false});child.stderr.pipe(output,{end:false});
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
  await new Promise(resolve=>output.end(resolve));assert.equal(code,0,logName);
};
const report={startedAt:new Date().toISOString(),upstreamReplay:false,cities:[]};
for(const [city,item] of Object.entries(state.cities)) {
  assert.ok(item.importedAt);
  const file=path.join(folder,`xhs-places-${city}.json`);
  assert.equal(createHash('sha256').update(fs.readFileSync(file)).digest('hex'),item.exportHash);
  await run(['--import','tsx','scripts/seed-xhs-places.ts',file],`repair-01-import-${city}.log`);
  await run(['--import','tsx','scripts/embed-backfill.ts','--tables','places','--city',city],`repair-01-embed-${city}.log`);
  report.cities.push({city,hash:item.exportHash,importedAndBackfilled:true});
}
fs.writeFileSync(reportFile,JSON.stringify({...report,completedAt:new Date().toISOString()},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report));
