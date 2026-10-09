// 日期修订不改变身份回归输入；核对当前实库与已通过flow52、audit48的完整输入。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Client} from 'pg';
import {parse} from 'dotenv';
const url=p=>new URL(p,import.meta.url),read=p=>JSON.parse(fs.readFileSync(url(p),'utf8'));
const previous=read('all-cities/flow/run-52/identity-snapshot.json'),association=read('all-cities/flow/run-52/association-snapshot.json');
const oldAudit=read('all-cities/audit/run-48/snapshot.json'),audit=read('all-cities/audit/run-49/snapshot.json');
for(const key of ['entities','scopes','scopeSources','reviews'])assert.deepEqual(audit[key],oldAudit[key]);
const config=parse(fs.readFileSync('apps/server/.env'));
const db=new Client({connectionString:config.DATABASE_URL,connectionTimeoutMillis:10000});
try {
  await db.connect();await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const rows=(await db.query(`SELECT id,city,name,category,lat,lng,verified,source,
    jsonb_strip_nulls(jsonb_build_object('identity',payload->'identity','aliases',payload->'aliases',
      'canonicalRedirectTo',payload->'canonicalRedirectTo','components',payload->'components',
      'identityWithdrawal',payload->'identityWithdrawal','imageIdentity',payload->'imageIdentity',
      'mentionSources',payload->'mentionSources','adcode',payload->'adcode')) payload FROM canonical_places ORDER BY city,id`)).rows;
  assert.deepEqual(rows,previous.rows);
  const associations=(await db.query('SELECT city,manifest,relations,available_ids FROM place_relation_snapshots ORDER BY city')).rows;
  assert.deepEqual(associations,association.rows);
  const manifest=read('upstream-install.json');assert.equal(manifest.files.length,61);
  for(const file of manifest.files)for(const path of [url('upstream/'+file.path),'D:/Project/xhs-travel-pipeline/'+file.path])
    assert.equal(createHash('sha256').update(fs.readFileSync(path)).digest('hex'),file.after);
  const flow=read('all-cities/flow/run-52/report.json');assert.deepEqual(flow.failures,[]);
  const report={metadataRun:1,readOnly:true,at:new Date().toISOString(),identityRows:rows.length,associationCities:associations.length,
    flowInputUnchanged:true,flowReexecuted:false,reusedFlow:'all-cities/flow/run-52',
    upstreamAuditInputUnchanged:true,newAudit:'all-cities/audit/run-49',installedFilesVerified:61,
    changedInstalledFiles:manifest.files.filter(f=>f.changed).map(f=>f.path),imageComparison:'deferred_by_user',failures:[]};
  fs.writeFileSync(url('metadata/content-dates-01/identity-preservation.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify(report));
}finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
