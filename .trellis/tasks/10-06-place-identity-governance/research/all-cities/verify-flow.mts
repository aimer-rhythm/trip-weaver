import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {type GenerateForm,uid,placeNameKey} from '@tripweaver/shared';
import {placeNames,placeIdentity,identityStrings} from '../../../../../apps/server/src/lib/placeIdentity';
import {createPlaceRetriever} from '../../../../../apps/server/src/generation/placeRetrieval';
import {placeCategory,type PlaceRow} from '../../../../../apps/server/src/generation/retrievalRanking';
import {distanceKm,relatedPairKey,SCHEDULE_LIMITS} from '../../../../../apps/server/src/generation/scheduling/schedule';
import type { BoundRelation, RelationManifest } from '../../../../../apps/server/src/services/placeRelationIdentity';
const folder=process.argv[2]!;
const targetFile=path.join(folder,'target-ranking.json');
const targetRanking=fs.existsSync(targetFile)?JSON.parse(fs.readFileSync(targetFile,'utf8')):null;
assert.match(process.env.DATABASE_URL ?? '',/^postgres:\/\/postgres@127\.0\.0\.1:18798\/place_identity_test_\d+$/);
// 隔离校验完成后才允许导入带自动迁移副作用的应用模块。
const {pool}=await import('../../../../../apps/server/src/db/client');
const {buildResearchTools}=await import('../../../../../apps/server/src/generation/tools/researchTools');
const {getNullPoiSource}=await import('../../../../../apps/server/src/integrations/nullPoiSource');
const {getNullSearchSource}=await import('../../../../../apps/server/src/integrations/websearch/searchSource');
const {loadCityPlaceFacts}=await import('../../../../../apps/server/src/generation/scheduling/placeFacts');
const {loadPlaceRelations,resolveRelatedPairs}=await import('../../../../../apps/server/src/generation/scheduling/placeRelations');
const {loadPlaceIdentityIndex}=await import('../../../../../apps/server/src/services/placeIdentityService');
const {applyDeterministicSchedule}=await import('../../../../../apps/server/src/generation/scheduling/buildDraft');
const {DraftTrip}=await import('../../../../../apps/server/src/generation/draft');
const {bindEditPlaceIdentities}=await import('../../../../../apps/server/src/chat/placeIdentity');
const {normalizeEditOps,editActivityDrafts,applyItineraryEdits}=await import('../../../../../apps/server/src/chat/editOps');
const {createTrip,getTrip}=await import('../../../../../apps/server/src/services/tripService');
const {prepareImportedPlaces,reconcileImportedPlaces}=await import('../../../../../apps/server/src/services/placeImportIdentity');
const {verifyWithdrawal}=await import('../verify-withdrawals.mjs');
type Outcome=import('../../../../../apps/server/src/generation/tools/researchTools').ResearchOutcome;
const report={verifiedAt:new Date().toISOString(),isolated:true,testUserScope:'per-persistence-probe',cities:[] as Record<string,unknown>[],failures:[] as Record<string,unknown>[]};
// 独立场景不累计同一账号的行程配额；单场景的初稿、重访版本仍属于同一账号。
const createProbeUser=async()=>{
  const userId=uid();
  await pool.query('INSERT INTO users(id,email,password_hash,created_at) VALUES($1,$2,$3,now())',[userId,`${userId}@identity.test`,'']);
  return userId;
};
try {
  const file=fs.readFileSync(path.join(folder,'identity-snapshot.json'));
  const manifest=JSON.parse(fs.readFileSync(path.join(folder,'snapshot-manifest.json'),'utf8'));
  assert.equal(createHash('sha256').update(file).digest('hex'),manifest.sha256);
  const relationsFile=fs.readFileSync(path.join(folder,'reviewed-relations.json'));
  assert.equal(createHash('sha256').update(relationsFile).digest('hex'),manifest.reviewedRelationsSha256);
  const relations: {reviewId:string;city:string;entityIds:string[];verdict:string}[]=JSON.parse(relationsFile.toString()).relations;
  const rows:PlaceRow[]=JSON.parse(file.toString()).rows;
  let associationRows: {city:string;manifest:RelationManifest;relations:BoundRelation[]|null;available_ids:string[]}[]=[];
  if(manifest.associationSnapshotSha256) {
    const bytes=fs.readFileSync(path.join(folder,'association-snapshot.json'));
    assert.equal(createHash('sha256').update(bytes).digest('hex'),manifest.associationSnapshotSha256);
    associationRows=JSON.parse(bytes.toString()).rows;
    await pool.query('INSERT INTO place_relation_snapshots SELECT * FROM jsonb_populate_recordset(NULL::place_relation_snapshots,$1::jsonb)',[JSON.stringify(associationRows)]);
  }
  await pool.query(`INSERT INTO canonical_places(id,city,name,category,lat,lng,verified,source,payload,created_at)
    SELECT id,city,name,category,lat,lng,verified,source,payload,now() FROM jsonb_to_recordset($1::jsonb)
      AS p(id text,city text,name text,category text,lat double precision,lng double precision,verified boolean,source text,payload jsonb)`,[JSON.stringify(rows)]);
  const retrieve=createPlaceRetriever({query:(sql,args)=>pool.query(sql,args),embed:async()=>null});
  for(const city of manifest.cities as string[]) {
    const local=rows.filter(r=>r.city===city && r.verified);
    const index=await loadPlaceIdentityIndex(city);
    const roots=local.filter(r=>!r.payload?.canonicalRedirectTo);
    const facts=await loadCityPlaceFacts(city);
    const cityRelations=await loadPlaceRelations(city);
    const association=associationRows.find(row=>row.city===city);
    const availableIds=new Set(association?.available_ids ?? []);
    const expectedAssociations=(association?.relations ?? []).filter(r=>r.strength==='direct'
      && availableIds.has(r.fromEntityId)&&availableIds.has(r.toEntityId));
    assert.equal([...cityRelations.values()].reduce((n,neighbors)=>n+neighbors.length,0),expectedAssociations.length*2);
    for(const edge of expectedAssociations) {
      const candidates=[{name:edge.from,canonicalPlaceId:edge.fromEntityId},{name:edge.to,canonicalPlaceId:edge.toEntityId}];
      assert.ok(resolveRelatedPairs(cityRelations,candidates).has(relatedPairKey(edge.from,edge.to)),'关联端点须映射到两个独立候选ID');
    }
    let schedulePairMatches=0;
    // 餐饮排程要求有坐标及附近景点；使用冻结目录中的真实锚点，不编造坐标。
    const scheduleProbe=async(outcome:Outcome,targets:PlaceRow[],form:GenerateForm)=>{
      const excluded: {id:string;reason:string}[]=[];
      for(const food of targets.filter(r=>placeCategory(r.category)==='food')) {
        if(food.lat===null||food.lng===null||(food.lat===0&&food.lng===0)) {
          excluded.push({id:food.id,reason:'餐饮无已核实坐标，自动排程不选门店'});continue;
        }
        const point={lat:food.lat,lng:food.lng};
        const nearby=roots.filter(r=>placeCategory(r.category)==='attraction'&&r.lat!==null&&r.lng!==null)
          .map(r=>({row:r,km:distanceKm(point,{lat:r.lat!,lng:r.lng!})}))
          .filter(r=>r.km<=SCHEDULE_LIMITS.mealNearbyKm).sort((a,b)=>a.km-b.km)[0]?.row;
        if(!nearby) {excluded.push({id:food.id,reason:'冻结目录无附近景点锚点，自动排程不选门店'});continue;}
        if(outcome.pool.some(p=>p.canonicalPlaceId===nearby.id)) continue;
        const hits=await retrieve([nearby.name],{city,vector:'off',limit:48});
        const tools=buildResearchTools({destination:city,verifiedPlaces:hits,outcome,
          poiSource:getNullPoiSource(),searchSource:getNullSearchSource(),searchWebMax:1,reviewedCover:async()=>null});
        assert.equal((await tools.find(t=>t.name==='add_candidate')!.execute('meal-anchor',
          {name:nearby.name,placeId:nearby.id,category:'attraction',intro:'餐饮附近的实际景点锚点。'})).details.ok,true);
      }
      const draft=new DraftTrip(form);
      schedulePairMatches+=resolveRelatedPairs(cityRelations,outcome.pool).size;
      applyDeterministicSchedule({draft,form,pool:outcome.pool,locations:outcome.locations,longHaul:[],
        foodFocused:targets.some(r=>placeCategory(r.category)==='food'),facts,relations:cityRelations});
      const trip=draft.toTrip();
      for(const target of targets) {
        const expected=placeCategory(target.category)==='hotel'||excluded.some(e=>e.id===target.id)?0:1;
        assert.equal(trip.days.flatMap(d=>d.activities).filter(a=>a.canonicalPlaceId===target.id).length,expected,
          `${target.name}:排程身份 ${JSON.stringify({pool:outcome.pool.map(p=>({id:p.canonicalPlaceId,name:p.name})),
            days:trip.days.map(d=>d.activities.map(a=>({id:a.canonicalPlaceId,name:a.name,lat:a.lat,lng:a.lng})))})}`);
      }
      return {trip,excluded};
    };
    const associationFlowProbes=[];
    const eligibleAssociation=expectedAssociations.find(edge=>[edge.fromEntityId,edge.toEntityId].every(id=>{
      const place=roots.find(row=>row.id===id);
      return place && placeCategory(place.category)==='attraction' && place.lat!==null && place.lng!==null;
    }));
    if(eligibleAssociation) {
      try {
        const members=[eligibleAssociation.fromEntityId,eligibleAssociation.toEntityId].map(id=>roots.find(row=>row.id===id)!);
        const hits=[...new Map((await Promise.all(members.map(row=>retrieve([row.name],{city,vector:'off',limit:48}))))
          .flat().map(place=>[place.canonicalPlaceId,place])).values()];
        const outcome:Outcome={pool:[],summary:'',locations:new Map()};
        const tools=buildResearchTools({destination:city,verifiedPlaces:hits,outcome,poiSource:getNullPoiSource(),
          searchSource:getNullSearchSource(),searchWebMax:1,reviewedCover:async()=>null});
        const add=tools.find(tool=>tool.name==='add_candidate')!;
        for(const row of members) assert.equal((await add.execute(row.id,{name:row.name,placeId:row.id,
          category:'attraction',intro:'使用当前逐提及关系规划两个独立地点。'})).details.ok,true);
        assert.equal(resolveRelatedPairs(cityRelations,outcome.pool).size,1);
        const form:GenerateForm={destination:city,days:2,preferences:[],partySize:2,budgetLevel:'舒适',totalBudget:0,extraNotes:'',startDate:''};
        const scheduled=await scheduleProbe(outcome,members,form);
        const userId=await createProbeUser();
        const stored=await createTrip(userId,scheduled.trip);
        assert.deepEqual(await getTrip(userId,stored.id),stored);
        associationFlowProbes.push({ids:members.map(row=>row.id),candidate:true,matchedPairs:1,schedule:true,persistence:true,
          sameDay:stored.days.some(day=>members.every(row=>day.activities.some(activity=>activity.canonicalPlaceId===row.id)))});
      } catch(error) {report.failures.push({city,kind:'association_flow',message:error instanceof Error?error.message:String(error)});}
    }
    const ambiguous=new Map<string,{name:string;ids:Set<string>}>();
    let aliasesChecked=0,legacyIdsChecked=0;
    for(const row of roots) {
      for(const name of placeNames(row)) {
        const resolution=index.resolve(city,name);
        if(resolution.status!=='resolved'||resolution.canonicalPlaceId!==row.id) {
          report.failures.push({city,kind:'catalog_alias',id:row.id,name,status:resolution.status});
          if(resolution.status==='ambiguous') {
            const key=placeNameKey(name),item=ambiguous.get(key) ?? {name,ids:new Set<string>()};
            item.ids.add(row.id);ambiguous.set(key,item);
          }
        }
        aliasesChecked++;
      }
      for(const id of identityStrings(placeIdentity(row).memberIds)) {
        const resolution=index.resolve(city,row.name,id);
        if(resolution.status!=='resolved'||resolution.canonicalPlaceId!==row.id)
          report.failures.push({city,kind:'catalog_legacy_id',id:row.id,legacyId:id,status:resolution.status});
        legacyIdsChecked++;
      }
    }
    const componentRelations=roots.flatMap(root=>placeIdentity(root).kind==='complex'&&Array.isArray(root.payload?.components)
      ? root.payload.components.filter(c=>c&&typeof c==='object'&&typeof c.canonicalPlaceId==='string')
        .map(c=>({reviewId:`component:${root.id}:${c.canonicalPlaceId}`,city,entityIds:[root.id,c.canonicalPlaceId],verdict:'part_of'})) : []);
    const componentIds=new Set(componentRelations.flatMap(r=>r.entityIds));
    const targetIds=new Set<string>((targetRanking?.cities.find((c:{city:string})=>c.city===city)?.top30??[])
      .map((row:{entityId:string})=>row.entityId));
    assert.ok([...targetIds].every(id=>roots.some(row=>row.id===id)), '目标名单必须全部存在于当前有效目录');
    const selected=roots.filter(r=>Number(placeIdentity(r).revision)>1||componentIds.has(r.id)||targetIds.has(r.id));
    // 下游独有城市也使用实际目录；全名/别名审计覆盖全部记录，消费链路选前三个可游览点。
    if(!selected.length) selected.push(...roots.filter(r=>placeCategory(r.category)==='attraction').slice(0,3));
    const probes=[];
    for(const row of selected) {
      try {
        const names=placeNames(row);
        const hits=await retrieve([names[0]!],{city,vector:'off',limit:8});
        assert.equal(hits[0]?.canonicalPlaceId,row.id,`${row.name}: SQL首项`);
        const outcome:Outcome={pool:[],summary:'',locations:new Map()};
        const tools=buildResearchTools({destination:city,verifiedPlaces:hits,outcome,
          poiSource:getNullPoiSource(),searchSource:getNullSearchSource(),searchWebMax:1,foodSearch:true,reviewedCover:async()=>null});
        const add=tools.find(t=>t.name==='add_candidate')!;
        const category=placeCategory(row.category);
        for(let i=0;i<names.length;i++) {
          const result=await add.execute(`alias-${i}`,{name:names[i],category,intro:'按照已核实地点身份游览。'});
          assert.equal(result.details.ok,i===0,`${row.name}: ${names[i]}入池`);
        }
        const old=identityStrings(placeIdentity(row).memberIds).find(id=>id!==row.id);
        if(old) assert.equal((await add.execute('old-id',{name:row.name,placeId:old,category,intro:'旧引用不能重复添加。'})).details.ok,false);
        assert.equal(outcome.pool.length,1);assert.equal(outcome.pool[0]!.canonicalPlaceId,row.id);
        const foreign=rows.find(r=>r.city!==city && r.verified && !r.payload?.canonicalRedirectTo)!;
        assert.equal((await add.execute('cross-city',{name:foreign.name,placeId:foreign.id,category:placeCategory(foreign.category),intro:'跨城负例。'})).details.ok,false);
        const form:GenerateForm={destination:city,days:1,preferences:[],partySize:2,budgetLevel:'舒适',totalBudget:0,extraNotes:'',startDate:''};
        const scheduled=await scheduleProbe(outcome,[row],form);
        let trip=scheduled.trip;
        if(category==='hotel') {probes.push({id:row.id,name:row.name,aliases:names.length,hotelExcluded:true});continue;}
        if(scheduled.excluded.length) {
          // 未满足自动选餐条件的实体仍验证用户明确添加后的保存/编辑，不冒充自动排程成功。
          const ops=normalizeEditOps([{kind:'add_activity',dayIndex:1,activity:{name:row.name,category:'美食'}}]);
          const edited=applyItineraryEdits(bindEditPlaceIdentities(trip,editActivityDrafts(ops),index,`添加${row.name}`),ops);
          assert.equal(edited.changed,true);trip=edited.trip;
        }
        const userId=await createProbeUser();
        const stored=await createTrip(userId,trip);
        const restored=await getTrip(userId,stored.id);assert.deepEqual(restored,stored);
        const makeOps=()=>normalizeEditOps([{kind:'add_activity',dayIndex:1,activity:{name:names.at(-1),category:'美食'}}]);
        const duplicate=makeOps();
        const current=bindEditPlaceIdentities(restored!,editActivityDrafts(duplicate),index,`加上${names.at(-1)}`);
        assert.equal(applyItineraryEdits(current,duplicate).changed,false,`${row.name}:编辑去重`);
        const revisit=makeOps();
        const revisited=applyItineraryEdits(bindEditPlaceIdentities(restored!,editActivityDrafts(revisit),index,`再去${row.name}`),revisit);
        assert.equal(revisited.changed,true,`${row.name}:明确重访`);
        const revised=await createTrip(userId,revisited.trip,stored.id);
        assert.equal(revised.days.flatMap(d=>d.activities).filter(a=>a.canonicalPlaceId===row.id).length,2);
        assert.deepEqual(await getTrip(userId,stored.id),stored,'历史行程不能被新版本改写');
        probes.push({id:row.id,name:row.name,aliases:names.length,legacyId:old ?? null,candidate:true,
          schedule:!scheduled.excluded.length,scheduleExclusions:scheduled.excluded,persistence:true,edit:true,revisit:true});
      } catch(error) {report.failures.push({city,id:row.id,name:row.name,kind:'flow',message:error instanceof Error?error.message:String(error)});}
    }
    const ambiguityProtection=[];
    for(const {name,ids} of ambiguous.values()) {
      try {
        const hits=await retrieve([name],{city,vector:'off',limit:48});
        const members=roots.filter(r=>ids.has(r.id));
        assert.ok(members.every(r=>hits.some(h=>h.canonicalPlaceId===r.id)),'歧义候选须全部保留可选择的ID');
        const outcome:Outcome={pool:[],summary:'',locations:new Map()};
        const tools=buildResearchTools({destination:city,verifiedPlaces:hits,outcome,poiSource:getNullPoiSource(),
          searchSource:getNullSearchSource(),searchWebMax:1,foodSearch:true,reviewedCover:async()=>null});
        const add=tools.find(t=>t.name==='add_candidate')!;
        assert.equal((await add.execute('ambiguous-name',{name,category:placeCategory(members[0]!.category),intro:'歧义名称。'})).details.ok,false);
        for(const row of members) assert.equal((await add.execute(row.id,{name:row.name,placeId:row.id,
          category:placeCategory(row.category),intro:'已明确选择具体实体。'})).details.ok,true);
        assert.equal(new Set(outcome.pool.map(p=>p.canonicalPlaceId)).size,members.length);
        const form:GenerateForm={destination:city,days:1,preferences:[],partySize:2,budgetLevel:'舒适',totalBudget:0,extraNotes:'',startDate:''};
        const draft=new DraftTrip(form);draft.setSkeleton('歧义编辑验证',['第一天']);
        const ops=normalizeEditOps([{kind:'add_activity',dayIndex:1,activity:{name}}]);
        assert.throws(()=>bindEditPlaceIdentities(draft.toTrip(),editActivityDrafts(ops),index,`添加${name}`),/多个同名/);
        ambiguityProtection.push({name,ids:[...ids],nameOnlyRejected:true,explicitIdsPreserved:true,editRequiresDisambiguation:true});
      } catch(error) {report.failures.push({city,name,kind:'ambiguity_guard',message:error instanceof Error?error.message:String(error)});}
    }
    const negativeProbes=[],negativeUnavailable=[];
    for(const relation of [...relations.filter(r=>r.city===city),...componentRelations]) {
      try {
        const resolved=relation.entityIds.map(id=>index.resolve(city,'',id));
        if(resolved.some(r=>r.status!=='resolved')) {
          negativeUnavailable.push({reviewId:relation.reviewId,verdict:relation.verdict,reason:'部分源实体未导出，未冒充消费链路通过'});
          continue;
        }
        const ids=resolved.map(r=>r.status==='resolved'?r.canonicalPlaceId:'');
        assert.equal(new Set(ids).size,2,'已审核独立/组成实体不能合并');
        const members=ids.map(id=>roots.find(r=>r.id===id)!);assert.ok(members.every(Boolean));
        const hits=[...new Map((await Promise.all(members.map(r=>retrieve([r.name],{city,vector:'off',limit:48}))))
          .flat().map(p=>[p.canonicalPlaceId,p])).values()];
        assert.ok(ids.every(id=>hits.some(p=>p.canonicalPlaceId===id)),'SQL必须保留两个独立ID');
        const outcome:Outcome={pool:[],summary:'',locations:new Map()};
        const tools=buildResearchTools({destination:city,verifiedPlaces:hits,outcome,poiSource:getNullPoiSource(),
          searchSource:getNullSearchSource(),searchWebMax:1,foodSearch:true,reviewedCover:async()=>null});
        const add=tools.find(t=>t.name==='add_candidate')!;
        for(const row of members) assert.equal((await add.execute(row.id,{name:row.name,placeId:row.id,
          category:placeCategory(row.category),intro:'独立地点与组成区域保留具体身份。'})).details.ok,true);
        assert.equal(new Set(outcome.pool.map(p=>p.canonicalPlaceId)).size,2);
        const form:GenerateForm={destination:city,days:2,preferences:[],partySize:2,budgetLevel:'舒适',totalBudget:0,extraNotes:'',startDate:''};
        // 两家独立餐厅可能相距很远；每个场景保留两家候选，分别以目标餐厅附近
        // 的真实景点排程，验证两者都能保留身份，不要求择近策略用尽候选。
        const scheduleTargets=members.every(r=>placeCategory(r.category)==='food')?members.map(r=>[r]):[members];
        const scheduleScenarios=[];
        for(const targets of scheduleTargets) {
          const scheduled=await scheduleProbe({...outcome,pool:[...outcome.pool],locations:new Map(outcome.locations)},targets,form);
          scheduleScenarios.push({targetIds:targets.map(r=>r.id),
            selectedIds:scheduled.trip.days.flatMap(d=>d.activities).flatMap(a=>a.canonicalPlaceId?[a.canonicalPlaceId]:[]),
            exclusions:scheduled.excluded});
        }
        const editDraft=new DraftTrip(form);editDraft.setSkeleton('独立身份编辑验证',['第一天','第二天']);
        const ops=normalizeEditOps(members.map(row=>({kind:'add_activity',dayIndex:1,
          activity:{name:row.name,category:'景点',canonicalPlaceId:row.id,canonicalPlaceCity:city}})));
        const edited=applyItineraryEdits(bindEditPlaceIdentities(editDraft.toTrip(),editActivityDrafts(ops),index,'添加这两个独立地点'),ops);
        assert.equal(edited.trip.days.flatMap(d=>d.activities).filter(a=>ids.includes(a.canonicalPlaceId ?? '')).length,2);
        const userId=await createProbeUser();
        const stored=await createTrip(userId,edited.trip);
        const restored=await getTrip(userId,stored.id);assert.deepEqual(restored,stored);
        for(const id of ids) assert.equal(restored!.days.flatMap(d=>d.activities).filter(a=>a.canonicalPlaceId===id).length,1);
        negativeProbes.push({reviewId:relation.reviewId,verdict:relation.verdict,ids,candidate:true,
          schedule:scheduleScenarios.every(s=>!s.exclusions.length),
          scheduleExclusions:scheduleScenarios.flatMap(s=>s.exclusions),scheduleScenarios,edit:true,persistence:true});
      } catch(error) {report.failures.push({city,reviewId:relation.reviewId,kind:'negative_identity',message:error instanceof Error?error.message:String(error)});}
    }
    let importGuards:Record<string,unknown>|undefined;
    const client=await pool.connect();
    try {
      await client.query('BEGIN');
      const governed=rows.filter(r=>r.city===city && !r.payload?.canonicalRedirectTo && placeIdentity(r).version===2);
      const v2=governed.map(row=>({...row,payload:row.payload ?? undefined}));
      const prepared=await prepareImportedPlaces(client,city,v2);
      assert.equal(prepared.length,v2.length,'现行v2重导入必须接受');
      const old=rows.filter(r=>r.city===city && (r.payload?.canonicalRedirectTo || placeIdentity(r).version===2)).map(r=>({id:r.id,name:r.name}));
      assert.deepEqual(await prepareImportedPlaces(client,city,old),[],'旧格式不能复活旧ID或覆盖v2');
      await reconcileImportedPlaces(client,city,prepared);
      assert.equal(await reconcileImportedPlaces(client,city,prepared),0,'重导入不能重建重定向');
      const after=(await client.query('SELECT id,name,payload FROM canonical_places WHERE city=$1',[city])).rows;
      const redirected=after.filter(r=>r.payload?.canonicalRedirectTo);
      assert.ok(redirected.every(r=>after.some(p=>p.id===r.payload.canonicalRedirectTo&&!p.payload?.canonicalRedirectTo)));
      importGuards={accepted:v2.length,oldFormatSkipped:old.length,idempotent:true,singleHopRedirects:redirected.length,rolledBack:true};
    } catch(error) {report.failures.push({city,kind:'import_guards',message:error instanceof Error?error.message:String(error)});}
    finally {await client.query('ROLLBACK');client.release();}
    const withdrawalProbes=[];
    for(const row of rows.filter(r=>r.city===city && r.payload?.identityWithdrawal && !r.payload?.canonicalRedirectTo)) {
      try {withdrawalProbes.push(await verifyWithdrawal(city,row.id));}
      catch(error) {report.failures.push({city,id:row.id,kind:'withdrawal',message:error instanceof Error?error.message:String(error)});}
    }
    const targetCoverage={requested:targetIds.size,passed:probes.filter(p=>targetIds.has(p.id)).length,
      snapshotSha256:targetRanking?.snapshotSha256??null,ids:[...targetIds]};
    if(targetCoverage.passed!==targetCoverage.requested) report.failures.push({city,kind:'target_coverage',...targetCoverage});
    report.cities.push({city,roots:roots.length,aliasesChecked,legacyIdsChecked,probes,targetCoverage,ambiguityProtection,negativeProbes,negativeUnavailable,importGuards,withdrawalProbes,
      associationSnapshot:association?{revision:association.manifest.revision,algorithmVersion:association.manifest.sourceState.algorithmVersion,
        strongUsable:expectedAssociations.length,mappedPairs:expectedAssociations.length,schedulePairMatches,associationFlowProbes,
        scheduleUnavailable:expectedAssociations.length>0&&!eligibleAssociation?'没有双方均为已核实坐标景点的关系，不冒充排程覆盖':null}:null});
    console.log(JSON.stringify({city,roots:roots.length,flows:probes.length,failures:report.failures.filter(f=>f.city===city).length}));
  }
} finally {await pool.end();fs.writeFileSync(path.join(folder,'report.json'),JSON.stringify(report,null,2)+'\n');}
if(report.failures.length) process.exitCode=1;
