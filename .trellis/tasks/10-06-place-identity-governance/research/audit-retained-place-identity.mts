// 只读核查本次完整导出外仍可检索的旧行；不凭名字相似自动合并或刷新向量。
import { readFile, writeFile } from 'node:fs/promises';
import { Client } from 'pg';
import { parse } from 'dotenv';
import { placeNameKey } from '@tripweaver/shared';
import { placeNames, type IdentityPlace } from '../../../../apps/server/src/lib/placeIdentity';

const root = new URL('./', import.meta.url);
const config = parse(await readFile('apps/server/.env'));
const sourceConfig = parse(await readFile('../xhs-travel-pipeline/.env'));
const down = new Client({ connectionString: config.DATABASE_URL, connectionTimeoutMillis: 10000 });
const up = new Client({ connectionString: sourceConfig.DATABASE_URL!.replace('postgresql+asyncpg:', 'postgresql:'), connectionTimeoutMillis: 10000 });
type Entity = {entity_id:string;city:string;canonical_name:string;aliases:string[];legacy_ids:string[];
  revision:number;status:string;redirect_to:string|null;primary_place_id:number|null;overrides:Record<string,unknown>|null};
type Row = IdentityPlace & {source:string;lat:number|null;lng:number|null;has_embedding:boolean;embedded_text:string|null;available_ids:string[]|null};
try {
  await down.connect(); await up.connect();
  await down.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await up.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const entities = (await up.query<Entity>(`SELECT entity_id,city,canonical_name,aliases,legacy_ids,revision,status,redirect_to,primary_place_id,overrides
    FROM place_entity ORDER BY city,entity_id`)).rows;
  const sourcePlaces=(await up.query('SELECT id,name,normalized_name,address,latitude,longitude,amap_poi_id FROM canonical_place')).rows;
  const sourceById=new Map(sourcePlaces.map(row=>[row.id,row]));
  const byId = new Map(entities.map(e=>[e.entity_id,e]));
  const rootOf = (entity:Entity) => {
    let current = entity; const seen = new Set<string>();
    while(current.redirect_to && byId.has(current.redirect_to)) {
      if(seen.has(current.entity_id)) throw new Error('上游身份重定向出现环');
      seen.add(current.entity_id); current = byId.get(current.redirect_to)!;
    }
    return current;
  };
  const rows = (await down.query<Row>(`SELECT p.id,p.city,p.name,p.source,p.lat,p.lng,
    jsonb_strip_nulls(jsonb_build_object('identity',p.payload->'identity','aliases',p.payload->'aliases',
      'address',p.payload->'address','adcode',p.payload->'adcode')) payload,
    p.embedding IS NOT NULL has_embedding,p.payload->>'embeddedText' embedded_text,s.available_ids
    FROM canonical_places p LEFT JOIN place_relation_snapshots s ON s.city=p.city
    WHERE p.verified=TRUE AND p.payload->>'canonicalRedirectTo' IS NULL
      AND NOT (coalesce(p.payload,'{}'::jsonb) ? 'identityWithdrawal') ORDER BY p.city,p.id`)).rows;
  const describe = (entity:Entity) => ({ id:entity.entity_id,name:entity.canonical_name,revision:entity.revision,
    status:entity.status,primaryPlaceId:entity.primary_place_id });
  const result = rows.filter(row=>row.available_ids && !row.available_ids.includes(row.id)).map(row=>{
    const nameKeys = new Set(placeNames(row).map(placeNameKey));
    const candidates = entities.filter(e=>e.city===row.city);
    const idOwners = [...new Map(candidates.filter(e=>e.entity_id===row.id || (e.legacy_ids ?? []).includes(row.id))
      .map(e=>{const root=rootOf(e);return [root.entity_id,root] as const;})).values()];
    const nameOwners = [...new Map(candidates.filter(e=>[e.canonical_name,...(e.aliases ?? [])].some(name=>nameKeys.has(placeNameKey(name))))
      .map(e=>{const root=rootOf(e);return [root.entity_id,root] as const;})).values()];
    const localNameOwners=rows.filter(other=>other.city===row.city && other.id!==row.id
      && placeNames(other).some(name=>nameKeys.has(placeNameKey(name)))).map(other=>({id:other.id,name:other.name}));
    const own = idOwners.find(e=>e.entity_id===row.id);
    const category = idOwners.some(e=>e.entity_id!==row.id) ? 'upstream_other_root'
      : own ? 'registered_not_exported' : nameOwners.length ? 'name_owner_without_id_claim' : 'downstream_only';
    const stripped=(name:string)=>{
      const key=placeNameKey(name),cityKey=placeNameKey(row.city);
      return key.startsWith(cityKey)?key.slice(cityKey.length):key;
    };
    const key=stripped(row.name);
    const reviewCandidates=candidates.filter(e=>e.status==='ACTIVE'&&!e.redirect_to).flatMap(e=>{
      const score=Math.max(0,...[e.canonical_name,...(e.aliases ?? [])].map(name=>{
        const other=stripped(name);
        return Math.min(key.length,other.length)>=2 && (key.includes(other)||other.includes(key))
          ? Math.min(key.length,other.length)/Math.max(key.length,other.length):0;
      }));
      return score>=0.45?[{...describe(e),score,source:sourceById.get(e.primary_place_id),overrides:e.overrides}]:[];
    }).sort((a,b)=>b.score-a.score).slice(0,6);
    const {available_ids:_available,...stored} = row;
    return {...stored,category,idOwners:idOwners.map(describe),nameOwners:nameOwners.map(describe),localNameOwners,
      reviewCandidates,reviewCandidatesAreEvidence:false};
  });
  const summary:Record<string,number>={};
  for(const row of result) summary[row.category]=(summary[row.category] ?? 0)+1;
  const report={readOnly:true,capturedAt:new Date().toISOString(),rows:result,summary,
    missingInputRecords:result.filter(r=>r.has_embedding&&!r.embedded_text).length,
    localNameConflicts:result.filter(r=>r.localNameOwners.length).length};
  const file=new URL(`retained-place-identity-${Date.now()}.json`,root);
  await writeFile(file,JSON.stringify(report,null,2),{flag:'wx'});
  console.log(JSON.stringify({file:file.pathname,summary,missingInputRecords:report.missingInputRecords,
    localNameConflicts:report.localNameConflicts,rows:result.map(r=>({id:r.id,city:r.city,name:r.name,source:r.source,
      category:r.category,reviewCandidates:r.reviewCandidates.map(c=>({id:c.id,name:c.name,sourceId:c.primaryPlaceId,
        address:c.overrides?.address ?? c.source?.address,lat:c.overrides?.lat ?? c.source?.latitude,lng:c.overrides?.lng ?? c.source?.longitude}))}))}));
} finally {await down.query('ROLLBACK').catch(()=>{});await up.query('ROLLBACK').catch(()=>{});await down.end();await up.end();}
