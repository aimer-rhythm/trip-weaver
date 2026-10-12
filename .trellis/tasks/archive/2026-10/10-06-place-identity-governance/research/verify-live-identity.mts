// 实际知识库验收探针：SQL 检索→分批候选→排程→Trip→单点编辑；不保存行程。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { pool } from '../../../../apps/server/src/db/client';
import { createPlaceRetriever } from '../../../../apps/server/src/generation/placeRetrieval';
import { embedQuery } from '../../../../apps/server/src/integrations/embedding';
import { buildResearchTools, type ResearchOutcome } from '../../../../apps/server/src/generation/tools/researchTools';
import { getNullPoiSource } from '../../../../apps/server/src/integrations/nullPoiSource';
import { getNullSearchSource } from '../../../../apps/server/src/integrations/websearch/searchSource';
import { applyDeterministicSchedule } from '../../../../apps/server/src/generation/scheduling/buildDraft';
import { DraftTrip } from '../../../../apps/server/src/generation/draft';
import { applyItineraryEdits } from '../../../../apps/server/src/chat/editOps';
import type { GenerateForm } from '../../../../packages/shared/src/index';

const city = '济南';
const names = ['大明湖','大明湖景区','大明湖公园','老商埠','经三路老商埠','老商埠·经三路','融汇老商埠'];
const client = await pool.connect();
try {
  await client.query('BEGIN READ ONLY');
  const retrieve = createPlaceRetriever({ query: (sql, args) => client.query(sql,args), embed: async () => null });
  const probes = [];
  const places = [];
  for (const name of names) {
    const hits = await retrieve([name], { city, vector:'off', limit: 8 });
    const expected = name.includes('大明湖') ? '550d6810857b4487aae8ce39c9ee093b' : '46bf462d545dc6435d6de296ba099d0f';
    assert.equal(hits[0]?.canonicalPlaceId, expected, name);
    assert.equal(hits.filter(p => p.canonicalPlaceId === expected).length, 1);
    places.push(hits[0]!);
    probes.push({query:name, id:hits[0]!.canonicalPlaceId, name:hits[0]!.name, category:hits[0]!.category,
      lat:hits[0]!.lat, lng:hits[0]!.lng});
  }
  const semanticRetrieve = createPlaceRetriever({ query: (sql, args) => client.query(sql,args), embed: embedQuery });
  const vectorProbes = [];
  for (const name of ['大明湖景区', '经三路老商埠']) {
    let diagnostics;
    const hits = await semanticRetrieve([name], { city, vector: 'force', limit: 8,
      onDiagnostics: value => { diagnostics = value; } });
    assert.equal(diagnostics?.vector, 'used', `${name}必须执行真实向量检索`);
    assert.ok(diagnostics.vectorHits > 0);
    assert.equal(hits[0]?.canonicalPlaceId, probes.find(probe => probe.query === name)!.id);
    assert.equal(new Set(hits.map(hit => hit.canonicalPlaceId)).size, hits.length);
    vectorProbes.push({ query: name, id: hits[0]!.canonicalPlaceId, diagnostics });
  }
  const outcome: ResearchOutcome = {pool:[], summary:'', locations:new Map()};
  const tools = buildResearchTools({destination:city, verifiedPlaces:places, outcome, poiSource:getNullPoiSource(),
    searchSource:getNullSearchSource(), searchWebMax:2, foodSearch:true, reviewedCover:async()=>null});
  const add = tools.find(t=>t.name==='add_candidate')!;
  for (let i=0;i<names.length;i++) {
    const result = await add.execute(`probe-${i}`, {name:names[i],placeId:places[i]!.id,
      category:'attraction', intro:'按已核实地点进行游览。'});
    assert.equal(result.details.ok,i===0 || i===3,names[i]);
  }
  const wrongCategory = await add.execute('wrong-category',{name:'经三路老商埠',placeId:places[3]!.id,
    category:'food',intro:'不能把历史街区作为餐厅重复添加。'});
  assert.equal(wrongCategory.details.ok,false);
  assert.equal(outcome.pool.length,2,'跨别名、跨分类、分批入池只保留两个实体');
  const form: GenerateForm = {destination:city,days:1,preferences:[],partySize:2,budgetLevel:'舒适',totalBudget:0,extraNotes:'',startDate:''};
  const draft = new DraftTrip(form);
  applyDeterministicSchedule({draft,form,pool:outcome.pool,locations:outcome.locations,longHaul:[],foodFocused:false,facts:new Map(),relations:new Map()});
  const trip = draft.toTrip();
  const activities = trip.days.flatMap(day=>day.activities);
  assert.equal(new Set(activities.filter(a=>a.canonicalPlaceId).map(a=>a.canonicalPlaceId)).size,2);
  const duplicated = applyItineraryEdits(trip,[{kind:'add_activity',dayIndex:1,activity:{name:'大明湖景区',category:'自然',
    canonicalPlaceId:'550d6810857b4487aae8ce39c9ee093b'}}]);
  assert.equal(duplicated.changed,false,'编辑不能用别名再次加点');
  const revisited = applyItineraryEdits(trip,[{kind:'add_activity',dayIndex:1,activity:{name:'大明湖夜游',category:'自然',allowRevisit:true,
    canonicalPlaceId:'550d6810857b4487aae8ce39c9ee093b'}}]);
  assert.equal(revisited.changed,true,'服务端确认重访意图时保留用户选择');
  const dbRows = (await client.query(`SELECT id,name,category,lat,lng,payload->>'canonicalRedirectTo' redirect,
    payload->'aliases' aliases,payload->'identity' identity,payload->>'coverImage' cover
    FROM canonical_places WHERE city=$1 AND (name LIKE '%商埠%' OR name LIKE '%大明湖%') ORDER BY id`,[city])).rows;
  const report = {verifiedAt:new Date().toISOString(),city,probes,vectorProbes,candidateCount:outcome.pool.length,
    activities:activities.map(({id,name,canonicalPlaceId})=>({id,name,canonicalPlaceId})),
    aliasEditRejected:!duplicated.changed,explicitRevisitAllowed:revisited.changed,rows:dbRows};
  fs.writeFileSync(new URL('./live-verification.json',import.meta.url),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
} finally {await client.query('ROLLBACK');client.release();await pool.end();}
