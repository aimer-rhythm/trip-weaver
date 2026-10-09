// 对已冻结的批次双导出做实际目录导入与倒序回滚预演，不能覆盖旧目录。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
const here=path.dirname(fileURLToPath(import.meta.url)),research=path.dirname(here),root=path.resolve(here,'../../../../..');
const batch=process.argv[2];assert.match(batch??'',/^batch-\d{2}(?:-v\d+)?$/);
const attempt=process.argv[3]??'sync-01';assert.match(attempt,/^sync-\d{2}$/);
const folder=path.join(here,batch,attempt);
const sync=JSON.parse(fs.readFileSync(path.join(folder,'sync-state.json')));
const summary=[];
async function run(args,logFile,env={}) {
  assert.ok(!fs.existsSync(logFile),'旧日志存在须先检查中断状态');
  const log=fs.createWriteStream(logFile,{flags:'wx'});
  const child=spawn(process.execPath,args,{cwd:root,env:{...process.env,...env},windowsHide:true,stdio:['ignore','pipe','pipe']});
  child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
  await new Promise(resolve=>log.end(resolve));
  assert.equal(code,0,logFile);
}
for(const city of Object.keys(sync.cities)) {
  assert.ok(sync.cities[city]?.exportHash && sync.cities[city]?.relationHash);
  const fixture=path.join(folder,`preview-${city}`);
  assert.ok(!fs.existsSync(fixture),'不能重写预演目录');fs.mkdirSync(fixture);
  for(const name of [`xhs-places-${city}.json`,`xhs-place-relations-${city}.json`]) fs.copyFileSync(path.join(folder,name),path.join(fixture,name),fs.constants.COPYFILE_EXCL);
  fs.writeFileSync(path.join(fixture,'state.json'),JSON.stringify({city,phase:'exported',placesImported:false,relationsImported:false}),{flag:'wx'});
  await run(['--import','tsx',path.join(research,'freeze-relation-city.mts'),fixture],path.join(fixture,'freeze.log'));
  await run([path.join(research,'run-tests.mjs'),path.join(research,'verify-relation-city.test.mts')],path.join(fixture,'preview.log'),
    {RELATION_CITY_FIXTURE:pathToFileURL(fixture+path.sep).href});
  const library=JSON.parse(fs.readFileSync(path.join(fixture,'library-before.json')));
  const before=library.tables.place_relation_snapshots[0].relations;
  const after=JSON.parse(fs.readFileSync(path.join(fixture,`xhs-place-relations-${city}.json`))).relations;
  const key=edge=>[edge.fromEntityId,edge.toEntityId].sort().join('|');
  const changes=after.filter(edge=>{const old=before.find(e=>key(e)===key(edge));
    return !old||old.strength!==edge.strength||!isDeepStrictEqual(old.evidence,edge.evidence);});
  const removed=before.filter(edge=>!after.some(e=>key(e)===key(edge)));
  const delta={city,before:before.length,after:after.length,directBefore:before.filter(r=>r.strength==='direct').length,
    directAfter:after.filter(r=>r.strength==='direct').length,changed:changes,removed};
  fs.writeFileSync(path.join(fixture,'relation-delta.json'),JSON.stringify(delta,null,2),{flag:'wx'});
  summary.push({city,preview:true,before:delta.before,after:delta.after,directBefore:delta.directBefore,directAfter:delta.directAfter,
    changed:changes.length,removed:removed.length});
  console.log(JSON.stringify(summary.at(-1)));
}
fs.writeFileSync(path.join(folder,'import-preview-summary.json'),JSON.stringify(summary,null,2),{flag:'wx'});
