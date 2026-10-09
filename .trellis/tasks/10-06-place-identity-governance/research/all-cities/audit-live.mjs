// 只读冻结现行上游身份与审核台账；明确区分未审、已查但缺证据、已解决。
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {Client} from 'pg';
import {parse} from 'dotenv';
import {auditReviews} from './audit-reviews.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
const label=process.argv[2];assert.match(label ?? '',/^run-\d{2}$/);
const folder=path.join(here,'audit',label);assert.ok(!fs.existsSync(folder),'只读审计快照不能覆盖');
const env=parse(fs.readFileSync(path.resolve(here,'../../../../../../xhs-travel-pipeline/.env')));
const db=new Client({connectionString:env.DATABASE_URL.replace('postgresql+asyncpg:','postgresql:'),connectionTimeoutMillis:10000});
await db.connect();
try {
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const entities=(await db.query(`SELECT entity_id,city,canonical_name,revision,status,redirect_to,aliases
    FROM place_entity ORDER BY city,entity_id`)).rows;
  const reviews=(await db.query('SELECT id,city,fingerprint,status,detail FROM place_entity_review ORDER BY city,id')).rows;
  const scopes=(await db.query('SELECT place_id,city,name_keys,entity_ids,revision FROM place_identity_scope ORDER BY city,place_id')).rows;
  const scopeSources=(await db.query('SELECT place_id,scope_place_id,source_hash FROM place_identity_scope_source ORDER BY scope_place_id,place_id')).rows;
  const {reviews:current,cities:summaries,failures}=auditReviews(entities,reviews,scopes);
  const snapshot={capturedAt:new Date().toISOString(),readOnly:true,entities,scopes,scopeSources,reviews:current};
  const bytes=JSON.stringify(snapshot,null,2)+'\n';fs.mkdirSync(folder,{recursive:true});
  fs.writeFileSync(path.join(folder,'snapshot.json'),bytes);
  const report={capturedAt:snapshot.capturedAt,sha256:createHash('sha256').update(bytes).digest('hex'),cities:summaries,failures};
  fs.writeFileSync(path.join(folder,'report.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));if(failures.length)process.exitCode=1;
} finally {await db.query('ROLLBACK');await db.end();}
