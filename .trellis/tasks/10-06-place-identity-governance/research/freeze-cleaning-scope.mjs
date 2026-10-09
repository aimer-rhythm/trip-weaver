// 冻结重点清洗输入；业务库只读，不生成/发布新的地点或关系快照。
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Client} from 'pg';
import {parse} from 'dotenv';
const root=new URL('./',import.meta.url);
const upEnv=parse(await readFile('../xhs-travel-pipeline/.env'));
const downEnv=parse(await readFile('apps/server/.env'));
const up=new Client({connectionString:upEnv.DATABASE_URL.replace('postgresql+asyncpg:','postgresql:'),connectionTimeoutMillis:10000});
const down=new Client({connectionString:downEnv.DATABASE_URL,connectionTimeoutMillis:10000});
try {
  await up.connect();await down.connect();
  await up.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await down.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await up.query("SET LOCAL statement_timeout='30s'");await down.query("SET LOCAL statement_timeout='30s'");
  const sources=(await up.query(`SELECT p.id,p.city,p.name,p.normalized_name,p.place_type,p.theme_tags,p.address,p.adcode,
    p.latitude,p.longitude,p.geo_status,p.is_active,p.quality_score,s.recommend_score,s.mention_count_30d,s.source_count,s.top_reasons,
    m.entity_id FROM canonical_place p LEFT JOIN place_summary s ON s.canonical_place_id=p.id
    LEFT JOIN place_entity_member m ON m.place_id=p.id ORDER BY p.city,p.id`)).rows;
  const entities=(await up.query('SELECT entity_id,city,canonical_name,primary_place_id,aliases,legacy_ids,status,redirect_to,revision,overrides FROM place_entity ORDER BY city,entity_id')).rows;
  const reviews=(await up.query('SELECT id,city,fingerprint,status,detail FROM place_entity_review ORDER BY city,id')).rows;
  const scopes=(await up.query('SELECT place_id,city,name_keys,entity_ids,withdrawal_entity_ids,revision FROM place_identity_scope ORDER BY city,place_id')).rows;
  const scopeSources=(await up.query('SELECT place_id,scope_place_id,source_hash FROM place_identity_scope_source ORDER BY scope_place_id,place_id')).rows;
  const assignments=(await up.query('SELECT mention_id,scope_place_id,entity_id,input_hash,revision FROM place_mention_assignment ORDER BY mention_id')).rows;
  const places=(await down.query(`SELECT id,city,name,category,source,verified,lat,lng,jsonb_strip_nulls(jsonb_build_object(
    'identity',payload->'identity','canonicalRedirectTo',payload->'canonicalRedirectTo','aliases',payload->'aliases',
    'identityWithdrawal',payload->'identityWithdrawal','mentionSources',payload->'mentionSources','components',payload->'components',
    'recommendScore',payload->'recommendScore','xhsPlaceType',payload->'xhsPlaceType','address',payload->'address')) payload
    FROM canonical_places ORDER BY city,id`)).rows;
  const relationSnapshots=(await down.query('SELECT city,manifest,available_ids FROM place_relation_snapshots ORDER BY city')).rows;
  const golden=[];
  for (const file of (await readdir('eval/snapshots')).filter(f=>f.endsWith('.json')).sort()) {
    const bytes=await readFile(`eval/snapshots/${file}`),data=JSON.parse(bytes.toString('utf8'));
    for (const day of data.trip?.days??[]) for (const a of day.activities??[]) if (a.name) golden.push({
      file,sha256:createHash('sha256').update(bytes).digest('hex'),city:data.trip.destination,
      name:a.name,category:a.category,canonicalPlaceId:a.canonicalPlaceId??null});
  }
  const input={readOnly:true,capturedAt:new Date().toISOString(),sources,entities,reviews,scopes,scopeSources,assignments,
    downstream:{places,relationSnapshots},golden};
  const bytes=JSON.stringify(input,null,2)+'\n';
  const folder=new URL(`cleaning-scope/run-${Date.now()}/`,root);await mkdir(folder,{recursive:true});
  await writeFile(new URL('input.json',folder),bytes,{flag:'wx'});
  await writeFile(new URL('input-hash.json',folder),JSON.stringify({sha256:createHash('sha256').update(bytes).digest('hex')},null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({folder:folder.pathname,sources:sources.length,entities:entities.length,reviews:reviews.length,places:places.length,golden:golden.length}));
} finally {
  await up.query('ROLLBACK').catch(()=>{});await down.query('ROLLBACK').catch(()=>{});
  await up.end();await down.end();
}
