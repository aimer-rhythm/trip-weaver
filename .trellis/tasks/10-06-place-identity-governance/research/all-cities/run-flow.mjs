// 从应用库只读冻结公共地点身份字段，在本次创建的临时库运行完整消费链路。
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {Client} from 'pg';
import {parse} from 'dotenv';
import assert from 'node:assert/strict';
const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'../../../../..');
const label=process.argv[2];assert.match(label ?? '',/^run-\d{2}$/);
const overlayFolder=process.argv[3] ? path.resolve(process.argv[3]) : null;
const folder=path.join(here,'flow',label);assert.ok(!fs.existsSync(folder),'验收证据不覆盖');
fs.mkdirSync(folder,{recursive:true});
if(process.env.IDENTITY_FLOW_TARGETS) {
  const bytes=fs.readFileSync(process.env.IDENTITY_FLOW_TARGETS);
  const ranking=JSON.parse(bytes.toString('utf8'));
  assert.deepEqual(ranking.cityScope,['北京','济南']);
  assert.ok(ranking.cities.every(city=>city.top30.length===30));
  fs.writeFileSync(path.join(folder,'target-ranking.json'),bytes,{flag:'wx'});
}
const settings=parse(fs.readFileSync(path.join(root,'apps/server/.env')));
const source=new Client({connectionString:settings.DATABASE_URL,connectionTimeoutMillis:10000});
await source.connect();
try {
  await source.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const rows=(await source.query(`SELECT id,city,name,category,lat,lng,verified,source,
    jsonb_strip_nulls(jsonb_build_object('identity',payload->'identity','aliases',payload->'aliases',
      'canonicalRedirectTo',payload->'canonicalRedirectTo','components',payload->'components',
      'identityWithdrawal',payload->'identityWithdrawal','imageIdentity',payload->'imageIdentity',
      'mentionSources',payload->'mentionSources','adcode',payload->'adcode')) payload FROM canonical_places ORDER BY city,id`)).rows;
  let overlay=null;
  if(overlayFolder) {
    const bytes=fs.readFileSync(path.join(overlayFolder,'report.json'));
    const preview=JSON.parse(bytes.toString('utf8'));
    assert.equal(preview.isolated,true);assert.equal(preview.reverseRollback,true);
    const ids=[];
    for(const file of preview.files) {
      assert.equal(path.basename(file.file),file.file);
      const bytes=fs.readFileSync(path.join(overlayFolder,file.file));
      assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256);
      for(const p of JSON.parse(bytes.toString('utf8')).places) {
        const i=rows.findIndex(r=>r.id===p.id && r.city===file.city);
        assert.ok(i>=0,'预演覆盖对象须存在于只读实库快照');assert.ok(!ids.includes(p.id));
        rows[i]={...rows[i],...p,city:file.city};ids.push(p.id);
      }
    }
    overlay={plannedOnly:true,folder:overlayFolder,reportHash:createHash('sha256').update(bytes).digest('hex'),ids};
  }
  const snapshot={capturedAt:new Date().toISOString(),scope:'public_place_identity_only',...(overlay?{overlay}:{}),rows};
  const bytes=JSON.stringify(snapshot,null,2)+'\n';
  fs.writeFileSync(path.join(folder,'identity-snapshot.json'),bytes);
  fs.writeFileSync(path.join(folder,'snapshot-manifest.json'),JSON.stringify({sha256:createHash('sha256').update(bytes).digest('hex'),
    cities:[...new Set(rows.map(r=>r.city))],rows:rows.length,...(overlay?{overlay}:{})},null,2)+'\n');
  const associationRows=(await source.query('SELECT city,manifest,relations,available_ids FROM place_relation_snapshots ORDER BY city')).rows;
  const associationBytes=JSON.stringify({capturedAt:snapshot.capturedAt,rows:associationRows},null,2)+'\n';
  fs.writeFileSync(path.join(folder,'association-snapshot.json'),associationBytes);
  const manifestPath=path.join(folder,'snapshot-manifest.json');
  const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
  manifest.associationSnapshotSha256=createHash('sha256').update(associationBytes).digest('hex');
  fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
} finally {await source.query('ROLLBACK');await source.end();}
// 从已应用台账冻结负例，而不是由名称相似度推测独立/组成关系。
const upstreamSettings=parse(fs.readFileSync(path.resolve(root,'../xhs-travel-pipeline/.env')));
const upstream=new Client({connectionString:upstreamSettings.DATABASE_URL.replace('postgresql+asyncpg:','postgresql:'),connectionTimeoutMillis:10000});
await upstream.connect();
try {
  await upstream.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const reviews=(await upstream.query(`SELECT id,city,detail FROM place_entity_review
    WHERE status='REJECTED' AND detail->'assessment'->>'verdict' IN ('distinct','part_of') ORDER BY city,id`)).rows;
  const relations=reviews.map(r=>({reviewId:r.id,city:r.city,entityIds:r.detail.entityIds,
    verdict:r.detail.assessment.verdict,explanation:r.detail.assessment.explanation}));
  const bytes=JSON.stringify({capturedAt:new Date().toISOString(),relations},null,2)+'\n';
  fs.writeFileSync(path.join(folder,'reviewed-relations.json'),bytes);
  const manifestPath=path.join(folder,'snapshot-manifest.json');
  const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
  manifest.reviewedRelationsSha256=createHash('sha256').update(bytes).digest('hex');
  fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
} finally {await upstream.query('ROLLBACK');await upstream.end();}
const database=`place_identity_test_${Date.now()}`;
const admin=new Client({connectionString:'postgres://postgres@127.0.0.1:18798/postgres'});
await admin.connect();
await admin.query(`CREATE DATABASE "${database}"`);
try {
  const log=fs.createWriteStream(path.join(folder,'flow.log'));
  const child=spawn(process.execPath,['--import','tsx',path.join(here,'verify-flow.mts'),folder],{
    cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,
      DATABASE_URL:`postgres://postgres@127.0.0.1:18798/${database}`,MASTER_KEY:'a'.repeat(64),
      DOTENV_CONFIG_PATH:path.join(folder,'nonexistent.env'),SITE_LLM_BASE_URL:'',SITE_LLM_API_KEY:'',SITE_LLM_MODEL:'',
      EMBEDDING_BASE_URL:'',EMBEDDING_API_KEY:'',AMAP_KEY:'',TIANDITU_KEY:'',SEARCH_API_KEY:'',
      PEXELS_API_KEY:'',UNSPLASH_ACCESS_KEY:'',PIXABAY_API_KEY:'',QWEATHER_KEY:'',QWEATHER_API_HOST:''}});
  child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
  child.stdout.pipe(process.stdout);child.stderr.pipe(process.stderr);
  process.exitCode=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
  await new Promise(resolve=>log.end(resolve));
} finally {
  assert.match(database,/^place_identity_test_\d+$/);
  await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);
  await admin.end();
  fs.writeFileSync(path.join(folder,'cleanup.json'),JSON.stringify({database,removed:true,at:new Date().toISOString()})+'\n');
}
