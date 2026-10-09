from pathlib import Path
import json
root=Path(__file__).resolve().parent
def rep(p,a,b):
    assert a in p,a
    return p.replace(a,b)
p=(root/'verify-park-culture-data.mts').read_text(encoding='utf-8')
for a,b in [('第56批实际库核对：故居与主题墙独立，旧语料和来源日期保持，距离描述仍待修','第58批实际库核对：河道错误提示隔离，五普通户外主体保持'),('batch-56-v2','batch-58'),('park-culture-downstream','river-outdoors-downstream'),
 ("source=await read('all-cities/batch-58-source.json')","source=await read('priority-cities/济南/ordinary-outdoors-source-packet-01.json')"),
 ('[36,40,41,42,43,44,45,46,47,48,49,52,53,54,"55-v2","56-v2"]','[36,40,41,42,43,44,45,46,47,48,49,52,53,54,"55-v2","56-v2",57,58]'),
 ('assert.equal(vectors.cities[0].vectorProbes.length,3)','assert.equal(vectors.cities[0].vectorProbes.length,0)'),
 ("'themes','address','geoStatus'","'themes','address','geoStatus','price','tips'"),
 ('assignments.length,285','assignments.length,295'),('graph.manifest.revision,30','graph.manifest.revision,32'),
 ('run-54','run-56'),('run-55','run-57'),
 ("const sourceIds=source.sources.map((g:any)=>g.source.id);","const sourceIds=[5477];"),
 ('batch-56-source-${sid}-scope-v2','batch-58-source-${sid}-scope')]:p=rep(p,a,b)
p=rep(p,"import type {PlaceRow}","import {createQueryEmbedder} from '../../../../apps/server/src/integrations/queryEmbedding';\nimport {placeEmbeddingText} from '../../../../apps/server/src/lib/placeEmbeddingText';\nimport type {PlaceRow}")
p=rep(p,"  const retrieve=createPlaceRetriever({query:(sql,args)=>db.query(sql,args),embed:async()=>{throw new Error('本探针只允许SQL检索');}});","""  const embed=createQueryEmbedder({baseUrl:config.EMBEDDING_BASE_URL||config.SITE_LLM_BASE_URL||'',apiKey:config.EMBEDDING_API_KEY||config.SITE_LLM_API_KEY||'',model:config.EMBEDDING_MODEL||'cf/bge-m3',dims:Number(config.EMBEDDING_DIMS||1024)});
  const retrieve=createPlaceRetriever({query:(sql,args)=>db.query(sql,args),embed});
  const realVectors:unknown[]=[];
""")
start=p.index('    const decision=decisions.find(');end=p.index('    for(const name of p.payload?.aliases',start)
p=p[:start]+"""    const river=eid==='4dfda3371793b69de15122bb7e330eac',park=eid==='80a33955c3f8381171f8493ae1ec0c4d',expectedMentions=g.mentionIds;
    assert.equal((p.payload?.identity as any).revision,river?2:1);assert.equal(p.name,g.entity.canonical_name);
    assert.equal(p.category,park?'自然':'文化');assert.equal(p.payload?.xhsPlaceType,'attraction');assert.equal(p.verified,true);
    assert.equal(p.lat,old.lat);assert.equal(p.lng,old.lng);assert.equal(p.payload?.address,old.payload.address);
    assert.deepEqual(p.payload?.aliases,g.entity.aliases);assert.equal((p.payload?.identity as any).memberIds.length,1);
    assert.equal(p.payload?.mentionCount,expectedMentions.length);assert.equal(old.payload.mentionCount,expectedMentions.length);
    if(river){assert.deepEqual((p.payload?.mentionSources as any[]).map(m=>m.mentionId).sort((a,b)=>a-b),expectedMentions);assert.deepEqual(p.payload?.themes,[]);}
    else{assert.equal(p.payload?.mentionSources,undefined);assert.deepEqual(p.payload?.themes,old.payload.themes);}
    assert.deepEqual(p.payload?.topReasons,old.payload.topReasons);
    const content=p.payload?.content as any,oldContent=structuredClone(old.payload.content);oldContent.compiledAt=content.compiledAt;assert.deepEqual(content,oldContent);
    const evidence=(await db.query('SELECT kind,content FROM research_evidence WHERE place_id=$1 AND kind LIKE $2 ORDER BY kind,content',[eid,'xhs_%'])).rows;
    const priorEvidence=library.tables.research_evidence.filter((e:any)=>e.place_id===eid&&e.kind.startsWith('xhs_')).map((e:any)=>({kind:e.kind,content:e.content}));
    assert.deepEqual(new Set(evidence.map(e=>JSON.stringify(e))),new Set(priorEvidence.map((e:any)=>JSON.stringify(e))));
    assert.equal(p.payload?.typicalVisitMinutes,undefined);assert.equal(p.payload?.price,undefined);assert.equal((p.payload?.openHours as any).status,'unknown');assert.equal(p.payload?.reservation,'unknown');
    if(river){assert.deepEqual(old.payload.tips,[(await read('priority-cities/济南/river-source-review-01.json')).wrongTip]);assert.equal(p.payload?.tips,undefined);assert.doesNotMatch(JSON.stringify(p.payload),/为纪念济南解放而建|登阁可看展览|扫码购票/);}
    else assert.equal(p.payload?.tips,undefined);
    const stored=(await db.query('SELECT embedding IS NOT NULL embedded,payload->>\'embeddedText\' text FROM canonical_places WHERE id=$1',[eid])).rows[0];
    assert.equal(stored.embedded,true);assert.equal(stored.text,placeEmbeddingText(p));
    let used='';const hits=await retrieve([p.name],{city,vector:'force',limit:8,onDiagnostics:d=>{used=d.vector;}});assert.equal(used,'used');assert.equal(hits[0]?.canonicalPlaceId,eid);realVectors.push({name:p.name,entityId:eid,vector:used});
    const boundaries=river?['解放阁','护城河游船','黑虎泉码头','济南环城公园']:park?['华山湖公园北门','济南森林公园','华山湖公园停车场']:
      [p.name+'停车场',p.name+'公交站',p.name==='东更道'?'西更道街':'东更道'];
"""+p[end:]
start=p.index('    results.push(');end=p.index('\n  }',start)
p=p[:start]+"    results.push({entityId:eid,name:p.name,category:p.category,type:p.payload?.xhsPlaceType,mentions:expectedMentions.length,revision:river?2:1,wrongTipExcluded:river,ordinaryUnchanged:!river,preciseLocationNewlyVerified:false});"+p[end:]
p=rep(p,'  for(const g of source.groups) {\n    const sid=',"  for(const g of source.groups.filter((g:any)=>g.entity.primary_place_id===5477)) {\n    const sid=")
p=rep(p,"  const trips=(await db.query", """  for(const item of source.supplementalImageFactNotes){
    const actual=(await up.query('SELECT id,note_id,city,title,\"desc\",img_analysis,status,source_url FROM raw_note WHERE id=$1',[item.note.id])).rows[0];
    assert.deepEqual({...actual,id:Number(actual.id)},item.note);
  }
  const trips=(await db.query""")
start=p.index('  const report={batch:');end=p.index('  await writeFile(output',start)
p=p[:start]+"""  const report={batch:58,readOnly:true,at:new Date().toISOString(),consumedFieldsVerified:exported.length,fields,results,assignmentRows:295,pendingMentions:116,
    scopesAdded:1,confirmed:2,pendingAdded:0,coordinatesCleared:0,newPreciseLocations:0,categoriesCorrected:0,ordinaryReviewed:5,sqlProbes,boundaryProbes,realVectorProbes:realVectors.length,realVectors,graph:19,directEdges:3,
    relationEvidenceAndStrengthPreserved:true,priorReviewRowsPreserved:true,rawDerivedCachesPreserved:true,wrongTipExcluded:true,contentAndEvidencePreserved:true,supplementalImageTextPreserved:true,
    fallbackObservedAtChanges,trips,imageComparison:'deferred_by_user',fullReviewPassed:false,failures:[]};
"""+p[end:]
# SQL字符串用双引号容纳JSON字段键的单引号。
p=rep(p,"'SELECT embedding IS NOT NULL embedded,payload->>'embeddedText' text FROM canonical_places WHERE id=$1'",'"SELECT embedding IS NOT NULL embedded,payload->>\'embeddedText\' text FROM canonical_places WHERE id=$1"')
with (root/'verify-river-outdoors-data.mts').open('x',encoding='utf-8') as f:f.write(p)
p=(root/'verify-park-culture-consumption.test.mts').read_text(encoding='utf-8')
for a,b in [('batch-56-v2','batch-58'),('park-culture','river-outdoors'),('公园合计时长排除、文化主体位置和独立身份、既有图库保持','河道解放阁提示隔离与五个普通户外主体、旧图库保持'),
 ("all-cities/batch-58-source.json","priority-cities/济南/ordinary-outdoors-source-packet-01.json"),
 ('river-outdoors-photo-metadata','ordinary-outdoors-photo-metadata'),
 ("'济南环城公园','四窟万象','关帝庙'","'护城河','东更道','珍池街','双忠祠街','西公界街','华山湖公园'"),
 ('beforeMockEnqueues,3','beforeMockEnqueues,6')]:p=rep(p,a,b)
start=p.index('    const eid=g.entity.entity_id,decision=');end=p.index('  for(const [name,value] of before)',start)
p=p[:start]+"""    const eid=g.entity.entity_id,river=eid==='4dfda3371793b69de15122bb7e330eac',park=eid==='80a33955c3f8381171f8493ae1ec0c4d';
    const current=facts.get(placeNameKey(g.entity.canonical_name)),old=before.get(placeNameKey(g.entity.canonical_name));assert.ok(current&&old);
    assert.equal(current.canonicalPlaceId,eid);assert.equal(current.placeType,'attraction');assert.equal(current.category,park?'自然':'文化');
    assert.equal(current.mentionCount,g.mentionIds.length);assert.equal(current.lat,old.lat);assert.equal(current.lng,old.lng);
    for(const name of g.entity.aliases)assert.deepEqual(facts.get(placeNameKey(name)),current);
    assert.equal(current.visitMinutes,undefined);
    const p=(await pool.query('SELECT name,payload FROM canonical_places WHERE id=$1',[eid])).rows[0];
    const previous=library.tables.canonical_places.find((p:any)=>p.id===eid),oldContent=structuredClone(previous.payload.content);
    oldContent.compiledAt=p.payload.content.compiledAt;assert.deepEqual(p.payload.content,oldContent);assert.deepEqual(p.payload.topReasons,previous.payload.topReasons);
    assert.equal(p.payload.address,previous.payload.address);
    if(river){assert.match(JSON.stringify(previous.payload.tips),/为纪念济南解放而建/);assert.equal(p.payload.tips,undefined);assert.doesNotMatch(JSON.stringify(current),/登阁可看展览|为纪念济南解放而建/);}
    else assert.deepEqual(current,old);
    const evidence=(await pool.query('SELECT kind,content FROM research_evidence WHERE place_id=$1 AND kind LIKE $2',[eid,'xhs_%'])).rows;
    const prior=library.tables.research_evidence.filter((e:any)=>e.place_id===eid&&e.kind.startsWith('xhs_')).map((e:any)=>({kind:e.kind,content:e.content}));
    assert.deepEqual(new Set(evidence.map(e=>JSON.stringify(e))),new Set(prior.map((e:any)=>JSON.stringify(e))));
    if(river)assert.deepEqual(p.payload.mentionSources.map((m:any)=>m.mentionId).sort((a:number,b:number)=>a-b),g.mentionIds);
    else assert.equal(p.payload.mentionSources,undefined);
  }
"""+p[end:]
p=rep(p,"  assert.equal(await lookup('共青团路关帝庙'),null);assert.equal(queued,0);","  assert.equal(queued,5);")
p=rep(p,"batch:56,variant:'v2'","batch:58")
p=rep(p,'contentAndEvidencePreserved:true,groupDurationExcluded:true,historicLocationPreserved:true,negativeMentionPreserved:true','contentAndEvidencePreserved:true,wrongTipExcluded:true,ordinaryReviewed:5')
p=rep(p,'coordinatesCleared:1,categoriesCorrected:0,naturalCategoryExplicitlyPreserved:true,addressesCorrected:1','coordinatesCleared:0,categoriesCorrected:0,addressesCorrected:0')
p=rep(p,'原3个普通主体均无图、触发3次mock；完整scope后3个原名及庙新名均无图、0次mock，旧3/1/2图库保持。真实队列未写入。','六个主体均无图，mock由6次变5次；只有护城河新增scope阻止旧补图，五个普通主体保持，旧3/1/2图库保持。真实队列未写入。')
with (root/'verify-river-outdoors-consumption.test.mts').open('x',encoding='utf-8') as f:f.write(p)
path=root/'tsconfig.verify-joint.json';config=json.loads(path.read_text(encoding='utf-8'))
for name in ['verify-river-outdoors-data.mts','verify-river-outdoors-consumption.test.mts','verify-river-photo-preflight.test.mts']:
    assert './'+name not in config['include'];config['include'].append('./'+name)
path.write_text(json.dumps(config,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
