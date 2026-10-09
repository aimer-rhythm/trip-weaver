// 单独复核此前返回unavailable的撤回项；保持生产超时，记录请求状态但不记录凭据或URL。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { Client } from 'pg';
import { parse } from 'dotenv';
import { createQueryEmbedder } from '../../../../../apps/server/src/integrations/queryEmbedding.ts';
import { createPlaceRetriever } from '../../../../../apps/server/src/generation/placeRetrieval.ts';
const label=process.argv[2]; assert.match(label??'',/^recheck-\d{2}$/);
const file=new URL(`batch-36/sync-01/withdrawal-vectors-${label}.json`,import.meta.url);
assert.ok(!fs.existsSync(file));
const settings={...parse(fs.readFileSync('apps/server/.env')),...process.env};
const client=new Client({connectionString:settings.DATABASE_URL,connectionTimeoutMillis:10000});
const requests=[];
const embed=createQueryEmbedder({baseUrl:settings.EMBEDDING_BASE_URL||settings.SITE_LLM_BASE_URL||'',
  apiKey:settings.EMBEDDING_API_KEY||settings.SITE_LLM_API_KEY||'',model:settings.EMBEDDING_MODEL||'cf/bge-m3',dims:Number(settings.EMBEDDING_DIMS||1024)},
  {fetch:async(...args)=>{const started=Date.now();try{const response=await fetch(...args);requests.push({status:response.status,elapsedMs:Date.now()-started});return response;}
    catch(error){requests.push({error:error.name,elapsedMs:Date.now()-started});throw error;}}});
const report={readOnly:true,productionTimeoutUnchanged:true,at:new Date().toISOString(),probes:[],requests,failures:[]};
try {
  await client.connect();await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const retrieve=createPlaceRetriever({query:(sql,args)=>client.query(sql,args),embed});
  for(const id of ['033a692df5218d571ddd2cca8a8c91e3','8808e16f1472d0df17bed729a2e54e83']) {
    const row=(await client.query('SELECT id,name,verified,payload FROM canonical_places WHERE city=$1 AND id=$2',['济南',id])).rows[0];
    assert.ok(row?.payload.identityWithdrawal && row.verified===false);
    let diagnostics;
    const hits=await retrieve([row.name],{city:'济南',vector:'force',limit:48,onDiagnostics:d=>{diagnostics=d;}});
    const probe={id,name:row.name,diagnostics,excluded:!hits.some(p=>p.canonicalPlaceId===id)};
    report.probes.push(probe);
    if(diagnostics?.vector!=='used'||!probe.excluded) report.failures.push(probe);
  }
} finally {await client.query('ROLLBACK').catch(()=>{});await client.end();}
fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report));if(report.failures.length)process.exitCode=1;
