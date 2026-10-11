// 真实107负例须在隔离库被拦，106正例仍须双导入/幂等/逆序回滚全过。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'../../../..');
const research=path.resolve(here,'../../10-06-place-identity-governance/research');
const output=path.join(here,'strict-media-preview-01');
fs.mkdirSync(output);
const results=[];
for(const [batch,city,shouldPass] of [['batch-107','厦门',false],['batch-106','上海',true]]) {
  const folder=path.join(output,batch);fs.mkdirSync(folder);
  const original=path.join(research,'all-cities',batch,'sync-01',`preview-${city}`);
  for(const name of ['state.json','library-before.json',`xhs-places-${city}.json`,`xhs-place-relations-${city}.json`])
    fs.copyFileSync(path.join(original,name),path.join(folder,name),fs.constants.COPYFILE_EXCL);
  const child=spawn(process.execPath,[path.join(research,'run-tests.mjs'),path.join(research,'verify-relation-city.test.mts')],
    {cwd:root,env:{...process.env,RELATION_CITY_FIXTURE:pathToFileURL(folder+path.sep).href,RELATION_CITY_PRESERVE_MEDIA:'1'},windowsHide:true,stdio:['ignore','pipe','pipe']});
  let log='';child.stdout.on('data',chunk=>log+=chunk);child.stderr.on('data',chunk=>log+=chunk);
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
  fs.writeFileSync(path.join(folder,'run.log'),log,{flag:'wx'});
  assert.equal(code===0,shouldPass,`严格媒体实际预演结果错误：${batch}`);
  if(!shouldPass) assert.ok(log.includes('旧图片字段变化：582cedb34ba4cbff94e3481f8e1e9acd/coverImage'),'须确实拦截旧封面回归');
  const previews=fs.readdirSync(folder).filter(name=>/^preview-\d+\.json$/.test(name));
  assert.equal(previews.length,shouldPass?1:0);
  results.push({batch,city,expectedPass:shouldPass,exitCode:code,expectedResultVerified:true});
  console.log(JSON.stringify(results.at(-1)));
}
fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({passed:true,isolated:true,results},null,2),{flag:'wx'});
