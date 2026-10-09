// 实际库只读核验：导出契约、全部已治理别名/旧 ID、SQL、真实向量和照片保留。
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {Client} from 'pg';
import {parse} from 'dotenv';
import {createPlaceIdentityIndex, placeNames, identityStrings, placeIdentity} from '../../../../../apps/server/src/lib/placeIdentity';
import {placeEmbeddingText} from '../../../../../apps/server/src/lib/placeEmbeddingText';
import {filterIdentityImages} from '../../../../../apps/server/src/services/placeImagePolicy';
import {readImageGallery} from '../../../../../apps/server/src/lib/imageGallery';
import {createPlaceRetriever, type RetrievalDiagnostics} from '../../../../../apps/server/src/generation/placeRetrieval';
import {createQueryEmbedder} from '../../../../../apps/server/src/integrations/queryEmbedding';
import type {PlaceRow} from '../../../../../apps/server/src/generation/retrievalRanking';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here,'../../../../..');
const [batch, attempt = 'sync-03'] = process.argv.slice(2);
assert.match(batch ?? '', /^batch-\d{2}(?:-v\d+)?$/);
assert.match(attempt, /^sync-\d{2}$/);
const vectors = process.argv.includes('--vectors');
const option = (key:string) => process.argv.includes(key) ? process.argv[process.argv.indexOf(key)+1] : undefined;
const cityFilter=option('--city');
const label=option('--label');
if(label) assert.match(label,/^[a-z0-9-]+$/);
const vectorIds=option('--ids')?.split(',');
if(vectorIds) assert.ok(vectorIds.length&&vectorIds.every(id=>/^[a-f0-9]{32}$/.test(id)));
const folder = path.join(here,batch!,attempt);
const state = JSON.parse(fs.readFileSync(path.join(folder,'sync-state.json'),'utf8'));
const decisions = JSON.parse(fs.readFileSync(path.join(here,`${batch}-decisions.json`),'utf8'));
const settings = {...parse(fs.readFileSync(path.join(root,'apps/server/.env'))),...process.env};
const db = new Client({connectionString:settings.DATABASE_URL,connectionTimeoutMillis:10000});
const embed = createQueryEmbedder({baseUrl:settings.EMBEDDING_BASE_URL || settings.SITE_LLM_BASE_URL || '',
  apiKey:settings.EMBEDDING_API_KEY || settings.SITE_LLM_API_KEY || '',model:settings.EMBEDDING_MODEL || 'cf/bge-m3',
  dims:Number(settings.EMBEDDING_DIMS || 1024)});
type Row = PlaceRow & {embedded:boolean};
const report = {verifiedAt:new Date().toISOString(),batch,attempt,vectors,readOnly:true,
  vectorIds:vectorIds ?? null,
  scope:cityFilter ?? 'all-exported-cities',
  cities:[] as Record<string,unknown>[],failures:[] as Record<string,unknown>[]};
const check = (ok:unknown,city:string,kind:string,detail:unknown) => {
  if(!ok) report.failures.push({city,kind,detail});
};
await db.connect();
try {
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const retrieve = createPlaceRetriever({query:(sql,args)=>db.query(sql,args),embed});
  if(cityFilter) assert.ok(state.cities[cityFilter],'指定城市不在冻结批次中');
  for (const city of Object.keys(state.cities).filter(city=>!cityFilter || city===cityFilter)) {
    assert.ok(state.cities[city].importedAt,'城市尚未导入');
    const file = path.join(folder,`xhs-places-${city}.json`);
    const hash = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    assert.equal(hash,state.cities[city].exportHash,'冻结导出已被改写');
    const exported = JSON.parse(fs.readFileSync(file,'utf8')).places as PlaceRow[];
    const rows = (await db.query<Row>('SELECT id,city,name,category,lat,lng,source,verified,payload,embedding IS NOT NULL embedded FROM canonical_places WHERE city=$1',[city])).rows;
    const byId = new Map(rows.map(row=>[row.id,row]));
    const index = createPlaceIdentityIndex(rows.filter(r=>r.verified || r.payload?.identityWithdrawal));
    const active = rows.filter(row=>!row.payload?.canonicalRedirectTo && row.verified);
    const withdrawals=[];
    for (const place of exported) {
      const actual = byId.get(place.id);
      check(actual && !actual.payload?.canonicalRedirectTo,city,'exported_root_missing',place.name);
      if (!actual) continue;
      for(const field of ['name','category','lat','lng','verified'] as const) check(actual[field]===place[field],city,'field_mismatch',
        {name:place.name,field,expected:place[field],actual:actual[field]});
      const contract = placeIdentity({...place,city});
      const actualContract = placeIdentity(actual);
      for(const field of ['version','entityId','canonicalName','revision','kind'])
        check(contract[field]===actualContract[field],city,'identity_mismatch',{name:place.name,field});
      if(place.payload?.identityWithdrawal) {
        const expected=place.payload.identityWithdrawal as {candidateIds:string[]};
        const status=expected.candidateIds.length ? 'ambiguous' : 'unresolved';
        check(isDeepStrictEqual(actual.payload?.identityWithdrawal,place.payload.identityWithdrawal),city,'withdrawal_mismatch',place.id);
        check(!actual.embedded && actual.payload?.embeddedText==null,city,'withdrawal_vector_retained',place.id);
        check(actual.payload?.content==null && actual.payload?.typicalVisitMinutes==null,city,'withdrawal_fact_retained',place.id);
        check(Array.isArray(actual.payload?.mentionSources) && actual.payload.mentionSources.length===0,city,'withdrawal_mentions_retained',place.id);
        for(const member of [undefined,...identityStrings(contract.memberIds)])
          check(index.resolve(city,place.name,member).status===status,city,'withdrawal_reference_restored',{id:place.id,member});
        const hits=await retrieve([place.name],{city,vector:'off',limit:48});
        check(!hits.some(p=>p.canonicalPlaceId===place.id),city,'withdrawal_sql_recalled',place.id);
        let diagnostics:RetrievalDiagnostics|undefined;
        if(vectors) {
          const hits=await retrieve([place.name],{city,vector:'force',limit:48,onDiagnostics:d=>{diagnostics=d;}});
          check(diagnostics?.vector==='used',city,'withdrawal_vector_unused',{id:place.id,diagnostics});
          check(!hits.some(p=>p.canonicalPlaceId===place.id),city,'withdrawal_vector_recalled',place.id);
        }
        withdrawals.push({id:place.id,name:place.name,status,sqlExcluded:!hits.some(p=>p.canonicalPlaceId===place.id),diagnostics});
        continue;
      }
      for(const member of identityStrings(contract.memberIds)) {
        const resolved = index.resolve(city,place.name,member);
        check(resolved.status==='resolved' && resolved.canonicalPlaceId===place.id,city,'legacy_id_mismatch',{name:place.name,member});
      }
      if(vectors) check(actual.embedded && actual.payload?.embeddedText===placeEmbeddingText(actual),city,'stale_embedding',place.name);
    }
    const probes = [];
    for(const decision of decisions.filter((d:{city:string})=>d.city===city)) {
      const actual = byId.get(decision.entityId);
      if(!actual) continue;
      const names = placeNames(actual);
      for(const name of decision.excludeNames ?? []) {
        check(!names.includes(name),city,'excluded_alias_restored',{name,id:actual.id});
        for(const id of [undefined,actual.id,...decision.mergeEntityIds]) {
          const resolved=index.resolve(city,name,id);
          check(resolved.status!=='resolved' || resolved.canonicalPlaceId!==actual.id,city,'excluded_name_bound',{name,id});
        }
      }
      for(const name of names) {
        const bound = index.resolve(city,name);
        check(bound.status==='resolved' && bound.canonicalPlaceId===actual.id,city,'alias_identity',{name,expected:actual.id,status:bound.status});
        const hits = await retrieve([name],{city,vector:'off',limit:8});
        check(hits[0]?.canonicalPlaceId===actual.id,city,'sql_first',{name,expected:actual.id,actual:hits[0]?.canonicalPlaceId});
        check(new Set(hits.map(p=>p.canonicalPlaceId)).size===hits.length,city,'sql_duplicate',name);
        probes.push({name,id:hits[0]?.canonicalPlaceId});
      }
    }
    const vectorProbes = [];
    if(vectors) {
      // 每个治理实体至少一个非主名走生产查询超时和真实向量，不将 SQL 命中冒充向量成功。
      const targets=vectorIds ? vectorIds.map(id=>({entityId:id})) : decisions.filter((d:{city:string})=>d.city===city);
      for(const decision of targets) {
        const actual = byId.get(decision.entityId);
        check(actual,city,'vector_target_missing',decision.entityId);
        if(!actual) continue;
        const name = placeNames(actual).find(name=>name!==actual.name) ?? actual.name;
        let diagnostics:RetrievalDiagnostics|undefined;
        const hits = await retrieve([name],{city,vector:'force',limit:8,onDiagnostics:value=>{diagnostics=value;}});
        check(diagnostics?.vector==='used' && diagnostics.vectorHits>0,city,'vector_unused',{name,diagnostics});
        check(hits[0]?.canonicalPlaceId===actual.id,city,'vector_first',{name,expected:actual.id,actual:hits[0]?.canonicalPlaceId});
        check(new Set(hits.map(p=>p.canonicalPlaceId)).size===hits.length,city,'vector_duplicate',name);
        vectorProbes.push({name,id:hits[0]?.canonicalPlaceId,diagnostics});
      }
    }
    const importedHash = createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0,32);
    const audits = (await db.query(`SELECT id,before_state FROM place_identity_imports
      WHERE city=$1 AND content_hash=$2 AND rolled_back_at IS NULL ORDER BY created_at`,[city,importedHash])).rows;
    check(audits.length>0,city,'audit_missing',importedHash);
    let photosChecked=0;
    for(const old of audits[0]?.before_state.places ?? []) {
      const current = byId.get(old.id);
      check(current,city,'historical_row_lost',old.id);
      if(!current) continue;
      if(current.payload?.imageIdentity !== undefined) {
        const gallery=readImageGallery(current.payload.imageGallery);
        const approved=filterIdentityImages(current,gallery);
        check(approved.length===gallery.length,city,'unapproved_image_retained',current.id);
        check(current.payload.coverImage===(approved[0]?.key ?? null) && current.payload.amapPhoto===null,
          city,'unapproved_cover_retained',current.id);
        continue; // 未确认旧图片应被撤回；原图片快照仍在审计中。
      }
      for(const field of ['coverImage','amapPhoto']) {
        const value=old.payload?.[field];
        if(value==null) continue;
        photosChecked++;
        const gallery = Array.isArray(current.payload?.imageGallery) ? current.payload.imageGallery : [];
        check(current.payload?.[field]===value || gallery.some((p:{key:string})=>p.key===value),city,'photo_lost',{id:old.id,field});
      }
      const before=Array.isArray(old.payload?.imageGallery)?old.payload.imageGallery:[];
      const after=Array.isArray(current.payload?.imageGallery)?current.payload.imageGallery:[];
      for(const photo of before) {
        photosChecked++;
        check(after.some((value:{key:string})=>value.key===photo.key),city,'gallery_photo_lost',{id:old.id,key:photo.key});
      }
    }
    for(const row of rows.filter(r=>r.payload?.canonicalRedirectTo)) {
      const target=byId.get(String(row.payload?.canonicalRedirectTo));
      check(target && !target.payload?.canonicalRedirectTo,city,'broken_redirect',row.id);
    }
    report.cities.push({city,exported:exported.length,total:rows.length,active:active.length,
      embedded:active.filter(r=>r.embedded).length,probes,vectorProbes,withdrawals,photosChecked,audits:audits.map(a=>a.id)});
    console.log(JSON.stringify({city,exported:exported.length,aliases:probes.length,vectors:vectorProbes.length,
      failures:report.failures.filter(f=>f.city===city).length}));
  }
} finally {await db.query('ROLLBACK');await db.end();}
fs.writeFileSync(path.join(folder,`verification-${vectors?'vectors':'sql'}${label?`-${label}`:''}.json`),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({cities:report.cities.length,failures:report.failures.length}));
if(report.failures.length) process.exitCode=1;
