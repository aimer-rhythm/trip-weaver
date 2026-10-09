import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Client} from 'pg';
import {parse} from 'dotenv';
import {placeNameKey} from '@tripweaver/shared';
import {createPlaceIdentityIndex} from '../../../../apps/server/src/lib/placeIdentity';
import type {PlaceRow} from '../../../../apps/server/src/generation/retrievalRanking';

const read=async(p:string)=>JSON.parse(await readFile(new URL(p,import.meta.url),'utf8'));
const folder='all-cities/batch-43/sync-01/',city='济南';
const output=new URL('priority-cities/济南/main-sights-downstream-check-01.json',import.meta.url);
await readFile(output).then(()=>{throw new Error('证据不能覆盖');},(e:NodeJS.ErrnoException)=>{if(e.code!=='ENOENT')throw e;});
const sync=(await read(folder+'sync-state.json')).cities[city];assert.ok(sync.importedAt&&sync.relationsImportedAt&&sync.embeddingRunAt);
const bytes=await readFile(new URL(folder+'xhs-places-济南.json',import.meta.url));
assert.equal(createHash('sha256').update(bytes).digest('hex'),sync.exportHash);
const exported=JSON.parse(bytes.toString('utf8')).places as PlaceRow[];
const library=await read(folder+'preview-济南/library-before.json');
const source=await read('all-cities/batch-43-source.json');
const scopes=(await Promise.all([36,40,41,42,43].map(n=>read(`all-cities/batch-${n}-scope-decisions.json`)))).flat();
const vectors=await read(folder+'verification-vectors.json');assert.deepEqual(vectors.failures,[]);
assert.equal(vectors.cities[0].probes.length,2);assert.equal(vectors.cities[0].vectorProbes.length,2);
assert.ok(vectors.cities[0].vectorProbes.every((p:any)=>p.diagnostics.vector==='used'));
const config=parse(await readFile('apps/server/.env')),upConfig=parse(await readFile('D:/Project/xhs-travel-pipeline/.env'));
const db=new Client({connectionString:config.DATABASE_URL,connectionTimeoutMillis:10000});
const up=new Client({connectionString:upConfig.DATABASE_URL!.replace('postgresql+asyncpg:','postgresql:'),connectionTimeoutMillis:10000});
try {
  await db.connect();await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await up.connect();await up.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const rows=(await db.query<PlaceRow>('SELECT id,city,name,category,lat,lng,verified,source,payload FROM canonical_places WHERE city=$1',[city])).rows;
  const byId=new Map(rows.map(p=>[p.id,p]));
  const fields=['identity','aliases','xhsPlaceType','content','topReasons','openHours','reservation','reservationNote','reservationEvidence','reservationConflict','typicalVisitMinutes','mentionSources','themes'];
  for(const expected of exported) {
    const actual=byId.get(expected.id);assert.ok(actual);
    for(const k of ['name','category','lat','lng','verified'] as const)assert.equal(actual[k],expected[k]);
    for(const k of fields) {
      let value=expected.payload?.[k]??null;
      if(k==='identity'&&value) {
        const identity=value as {memberNames:string[]};
        value={...identity,nameKeys:[...new Set([...identity.memberNames,...(expected.payload?.aliases as string[]??[])].map(placeNameKey))]};
      }
      assert.deepEqual(actual.payload?.[k]??null,value,`${actual.name}/${k}`);
    }
  }
  const index=createPlaceIdentityIndex(rows.filter(p=>p.verified||p.payload?.identityWithdrawal));
  const results=[];
  for(const g of source.groups) {
    const eid=g.entity.entity_id,p=byId.get(eid);assert.ok(p);
    const old=library.tables.canonical_places.find((r:PlaceRow)=>r.id===eid);assert.ok(old);
    const s=scopes.find((s:any)=>s.sourcePlaceId===g.source.id);
    const assigned=s.assignments.filter((a:any)=>a.entityId).map((a:any)=>a.mentionId).sort((a:number,b:number)=>a-b);
    assert.equal((p.payload?.identity as any).revision,3);assert.equal(p.category,'自然');assert.equal(p.verified,true);
    assert.deepEqual(p.payload?.aliases,g.entity.aliases);assert.equal(p.lat,old.lat);assert.equal(p.lng,old.lng);
    assert.deepEqual((p.payload?.mentionSources as any[]).map(m=>m.mentionId).sort((a,b)=>a-b),assigned);
    const minutes=p.name==='黑虎泉'?50:null;assert.equal(p.payload?.typicalVisitMinutes??null,minutes);
    assert.equal(p.payload?.reservation,'unknown');assert.deepEqual(p.payload?.reservationEvidence,[]);
    assert.deepEqual((p.payload?.imageIdentity as any).approved,[]);
    for(const key of ['imageIdentity','imageGallery','coverImage','amapPhoto'])assert.equal(old.payload[key],undefined);
    const boundaries=p.name==='黑虎泉'?['玛瑙泉','黑虎泉游船码头','黑虎泉茶摊','环城公园','黑虎阁']:['千佛山山顶','兴国禅寺','四窟万象','千佛山美院门'];
    for(const id of [undefined,...g.entity.legacy_ids]) {
      const bound=index.resolve(city,p.name,id);assert.equal(bound.status,'resolved');
      if(bound.status==='resolved')assert.equal(bound.canonicalPlaceId,eid);
      for(const name of boundaries) {const r=index.resolve(city,name,id);assert.ok(r.status!=='resolved'||r.canonicalPlaceId!==eid);}
    }
    const evidence=(await db.query('SELECT content FROM research_evidence WHERE place_id=$1 AND kind LIKE $2',[eid,'xhs_%'])).rows;
    if(p.name==='黑虎泉') {
      assert.equal(old.payload.typicalVisitMinutes,60);assert.doesNotMatch(JSON.stringify(p.payload),/玛瑙泉|游玩1小时/);
      assert.ok(evidence.every(e=>!/玛瑙泉|游玩1小时/.test(e.content)));
      assert.ok(evidence.some(e=>/石雕虎首/.test(e.content)));
    } else {assert.equal(old.payload.typicalVisitMinutes,30);assert.ok(JSON.stringify(p.payload?.content).includes('俯瞰'));}
    results.push({entityId:eid,name:p.name,confirmed:assigned.length,pending:s.assignments.length-assigned.length,effectiveMinutes:minutes,boundaries});
  }
  const assignments=(await up.query('SELECT mention_id,entity_id,input_hash,revision,change_key,fact_exclusions FROM place_mention_assignment WHERE mention_id=ANY($1::int[])',
    [scopes.flatMap((s:any)=>s.assignments.map((a:any)=>a.mentionId))])).rows;assert.equal(assignments.length,141);
  for(const s of scopes)for(const a of s.assignments) {
    const actual=assignments.find(r=>Number(r.mention_id)===a.mentionId);assert.ok(actual);
    assert.equal(actual.entity_id,a.entityId);assert.equal(actual.input_hash,a.inputHash);assert.equal(actual.revision,1);
    assert.equal(actual.change_key,s.key);assert.deepEqual(actual.fact_exclusions,a.factExclusions??null);
  }
  const targets=new Set(results.map(r=>r.entityId));
  for(const old of library.tables.canonical_places)if(!targets.has(old.id)) {
    const actual=byId.get(old.id);assert.ok(actual);
    for(const k of ['typicalVisitMinutes','reservation','reservationEvidence','mentionSources'])assert.deepEqual(actual.payload?.[k]??null,old.payload?.[k]??null,`${old.name}/既有${k}`);
  }
  const graph=(await db.query('SELECT manifest,relations FROM place_relation_snapshots WHERE city=$1',[city])).rows[0];
  assert.equal(graph.manifest.revision,17);assert.equal(graph.relations.length,20);assert.equal(graph.relations.filter((r:any)=>r.strength==='direct').length,6);
  const prior=library.tables.place_relation_snapshots[0].manifest.sourceState.mentions.filter((m:any)=>m.status==='review');assert.equal(prior.length,77);
  for(const m of prior)assert.deepEqual(graph.manifest.sourceState.mentions.find((n:any)=>n.mentionId===m.mentionId),m);
  assert.equal(graph.manifest.sourceState.mentions.filter((m:any)=>m.status==='review').length,91);
  const trips=(await db.query("SELECT count(*)::int count,md5(COALESCE(string_agg(h,'' ORDER BY h),'')) digest FROM (SELECT md5(to_jsonb(t)::text) h FROM trips t) x")).rows[0];
  assert.deepEqual(trips,(await read(folder+'pre-import-check.json')).trips);assert.deepEqual(trips,{count:201,digest:'e01d67cbf42a62fc595f4ef052f99e75'});
  const report={batch:43,readOnly:true,at:new Date().toISOString(),consumedFieldsVerified:exported.length,fields,results,
    assignmentRows:141,priorPendingPreserved:77,pendingMentions:91,previousOtherDurationAndReservationFieldsPreserved:true,
    sqlProbes:2,realVectorProbes:2,graph:20,directEdges:6,trips,imageComparison:'deferred_by_user',fullReviewPassed:false,failures:[]};
  await writeFile(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
} finally {await db.query('ROLLBACK').catch(()=>{});await db.end();await up.query('ROLLBACK').catch(()=>{});await up.end();}
