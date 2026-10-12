// 为身份取证冻结指定原图；上游只读、不调用抽取模型、不更新产品图片。
// 参数：<新目录名> <rawNoteId:零起图片索引,...> ...
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {Client} from 'pg';
import {parse} from 'dotenv';
const here=path.dirname(fileURLToPath(import.meta.url));
const [label,...args]=process.argv.slice(2);
assert.match(label??'',/^[a-z0-9-]+$/);
const sourceFile=args[0]==='--source'?args.splice(0,2)[1]:null;
if(sourceFile) assert.match(sourceFile,/^[a-z0-9-]+\.json$/);
assert.ok(args.length,'须显式指定原笔记及图片序号');
const targets=args.flatMap(arg=>{
  assert.match(arg,/^\d+:\d+(?:,\d+)*$/);
  const [id,indices]=arg.split(':');return indices.split(',').map(index=>({noteId:id,index:Number(index)}));
});
assert.equal(new Set(targets.map(t=>`${t.noteId}:${t.index}`)).size,targets.length,'重复图片');
const folder=path.join(here,label);assert.ok(!fs.existsSync(folder),'原图证据不覆盖，失败复核采用新目录');
const inputs=[];
let rows,sourceSnapshot=null;
if(sourceFile) {
  const bytes=fs.readFileSync(path.join(here,sourceFile));
  const source=JSON.parse(bytes);assert.equal(source.upstreamReadOnly,true);
  rows=source.notes.filter(n=>n.ok);
  sourceSnapshot={file:sourceFile,sha256:createHash('sha256').update(bytes).digest('hex')};
} else {
  const env=parse(fs.readFileSync(path.resolve(here,'../../../../../../xhs-travel-pipeline/.env')));
  const db=new Client({connectionString:env.DATABASE_URL.replace('postgresql+asyncpg:','postgresql:'),connectionTimeoutMillis:10000});
  await db.connect();
  try {
    await db.query('BEGIN READ ONLY');
    await db.query("SET LOCAL statement_timeout='15s'");
    rows=(await db.query('SELECT id,title,source_url,img_urls FROM raw_note WHERE id=ANY($1::bigint[])',[[...new Set(targets.map(t=>t.noteId))]])).rows;
  } finally {await db.query('ROLLBACK');await db.end();}
}
for(const target of targets) {
    const note=rows.find(n=>String(n.id)===target.noteId);assert.ok(note,'原笔记不存在');
    const url=new URL(note.img_urls?.[target.index]);
    assert.ok(['http:','https:'].includes(url.protocol)&&url.hostname.endsWith('.xhscdn.com')&&!url.username&&!url.password,'仅取已存原笔记的公开图片CDN');
    const originalUrlSha256=createHash('sha256').update(url.href).digest('hex');
    // 旧采集保存HTTP地址，固定同一CDN及路径升级HTTPS，不绕过鉴权或更改签名。
    const upgradedHttps=url.protocol==='http:';url.protocol='https:';
    const source=new URL(note.source_url);source.search='';
    inputs.push({...target,title:note.title,sourceUrl:source.href,originalUrlSha256,upgradedHttps,url});
}
fs.mkdirSync(folder);
const results=await Promise.all(inputs.map(async({url,...entry})=>{
  const source=url.href;const clean=new URL(source);clean.search='';
  const record={...entry,page:entry.index+1,imageUrl:clean.href,sourceUrlSha256:createHash('sha256').update(source).digest('hex')};
  try {
    const response=await fetch(source,{redirect:'error',signal:AbortSignal.timeout(20000)});
    if(!response.ok) return {...record,ok:false,status:response.status};
    const type=response.headers.get('content-type')?.split(';')[0];
    const ext={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[type];
    if(!ext) return {...record,ok:false,error:'unexpected_content_type',contentType:type};
    const chunks=[];let length=0;
    for await(const chunk of response.body) {
      length+=chunk.byteLength;assert.ok(length<=20*1024*1024,'image_too_large');chunks.push(chunk);
    }
    const data=Buffer.concat(chunks);assert.ok(data.length,'empty_image');
    const file=`note-${entry.noteId}-p${String(entry.index+1).padStart(2,'0')}.${ext}`;
    fs.writeFileSync(path.join(folder,file),data,{flag:'wx'});
    return {...record,ok:true,file,sha256:createHash('sha256').update(data).digest('hex'),bytes:data.length,contentType:type};
  } catch(error) {return {...record,ok:false,error:error.name==='TimeoutError'?'timeout':'download_failed'};}
}));
fs.writeFileSync(path.join(folder,'manifest.json'),JSON.stringify({capturedAt:new Date().toISOString(),upstreamReadOnly:true,sourceSnapshot,indexBase:0,images:results},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({folder:label,images:results.map(({noteId,index,ok,file,status,error})=>({noteId,index,ok,file,status,error}))}));
if(results.some(r=>!r.ok)) process.exitCode=1;
