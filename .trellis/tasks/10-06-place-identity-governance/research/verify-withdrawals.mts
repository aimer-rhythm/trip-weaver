import assert from 'node:assert/strict';
import {makeSampleTrip, uid} from '@tripweaver/shared';
import {pool} from '../../../../apps/server/src/db/client';
import {loadPlaceIdentityIndex} from '../../../../apps/server/src/services/placeIdentityService';
import {buildResearchTools, type ResearchOutcome} from '../../../../apps/server/src/generation/tools/researchTools';
import {createPlaceRetriever} from '../../../../apps/server/src/generation/placeRetrieval';
import {getNullPoiSource} from '../../../../apps/server/src/integrations/nullPoiSource';
import {getNullSearchSource} from '../../../../apps/server/src/integrations/websearch/searchSource';
import {bindEditPlaceIdentities} from '../../../../apps/server/src/chat/placeIdentity';
import {normalizeEditOps, editActivityDrafts} from '../../../../apps/server/src/chat/editOps';
import {createTrip, getTrip} from '../../../../apps/server/src/services/tripService';

/** 仅由隔离测试调用；撤回主体必须有独立探针，不能随verified目录过滤而消失。 */
export async function verifyWithdrawal(city: string, id: string) {
  assert.match(process.env.DATABASE_URL ?? '', /127\.0\.0\.1:18798\/place_identity_test_\d+$/);
  const row = (await pool.query('SELECT id,name,verified,payload,lat,lng FROM canonical_places WHERE city=$1 AND id=$2', [city,id])).rows[0];
  assert.ok(row?.payload.identityWithdrawal); assert.equal(row.verified,false);
  const index = await loadPlaceIdentityIndex(city);
  assert.ok(!index.groups.flat().some(p => p.id === id));
  const expected = row.payload.identityWithdrawal.candidateIds.length ? 'ambiguous' : 'unresolved';
  assert.equal(index.resolve(city,row.name).status,expected);
  assert.equal(index.resolve(city,row.name,id).status,expected);
  const retrieve = createPlaceRetriever({query:(sql,args)=>pool.query(sql,args),embed:async()=>null});
  const hits = await retrieve([row.name],{city,vector:'off',limit:48});
  assert.ok(!hits.some(p => p.canonicalPlaceId === id));
  const outcome: ResearchOutcome = {pool:[],summary:'',locations:new Map()};
  const tools = buildResearchTools({destination:city,verifiedPlaces:hits,outcome,foodSearch:true,
    poiSource:getNullPoiSource(),searchSource:getNullSearchSource(),searchWebMax:1,reviewedCover:async()=>null,retrieve});
  const add = tools.find(t => t.name === 'add_candidate')!;
  assert.equal((await add.execute('withdrawn-id',{name:row.name,placeId:id,category:'food',intro:'旧泛名不能作为门店'})).details.ok,false);
  assert.equal((await add.execute('withdrawn-name',{name:row.name,category:'food',intro:'裸名也不能复活'})).details.ok,false);
  assert.equal(outcome.pool.length,0);
  const trip=makeSampleTrip(); trip.destination=city;
  Object.assign(trip.days[0]!.activities[0]!,{name:row.name,canonicalPlaceId:id});
  const user=uid();
  await pool.query("INSERT INTO users(id,email,password_hash,created_at) VALUES($1,$2,'',now())",[user,`${user}@identity.test`]);
  const saved=await createTrip(user,trip);
  const copy=bindEditPlaceIdentities(saved,[],index,'保留原有行程');
  assert.deepEqual(copy,saved);
  const next=await createTrip(user,copy,saved.id);
  assert.equal(next.days[0]!.activities[0]!.canonicalPlaceId,id);
  assert.deepEqual(await getTrip(user,saved.id),saved);
  assert.deepEqual(await getTrip(user,next.id),next);
  const ops=normalizeEditOps([{kind:'add_activity',dayIndex:1,activity:{name:row.name,category:'美食'}}]);
  assert.throws(()=>bindEditPlaceIdentities(saved,editActivityDrafts(ops),index,`添加${row.name}`), /待核实|多个同名|具体分店/);
  return {id,name:row.name,resolution:expected,sqlExcluded:true,nameRejected:true,oldIdRejected:true,
    persistence:true,historicalIdentityPreserved:true,newEditRejected:true};
}
