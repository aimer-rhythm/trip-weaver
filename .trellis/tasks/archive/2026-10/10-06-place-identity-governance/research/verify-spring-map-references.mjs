// 核对当前坐标与地图本体参考点，只证明位置来源一致，不替代主体/类别/范围自查。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Client } from 'pg';
import { parse } from 'dotenv';
const url=f=>new URL(f,import.meta.url);
const read=f=>JSON.parse(fs.readFileSync(url(f),'utf8'));
const geo=read('priority-cities/济南/geo-08.json');
const packet=read('priority-cities/济南/spring-source-packet-01.json');
const client=new Client({connectionString:parse(fs.readFileSync('apps/server/.env')).DATABASE_URL,connectionTimeoutMillis:10000});
const report={readOnly:true,at:new Date().toISOString(),scope:'map_reference_consistency_only',geoFile:'priority-cities/济南/geo-08.json',
  geoSha256:createHash('sha256').update(fs.readFileSync(url('priority-cities/济南/geo-08.json'))).digest('hex'),matches:[],failures:[]};
try {
  await client.connect();await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  for(const group of packet.groups) {
    const entity=group.entity,source=packet.sources.find(s=>group.sourceIds.includes(s.id));assert.ok(source);
    const row=(await client.query('SELECT id,name,category,lat,lng,verified,payload FROM canonical_places WHERE city=$1 AND id=$2',['济南',entity.entity_id])).rows[0];
    assert.ok(row&&row.verified&&!row.payload.canonicalRedirectTo&&!row.payload.identityWithdrawal);
    const candidates=geo.filter(p=>p.query===entity.canonical_name&&p.name===entity.canonical_name&&p.matched);
    const matched=candidates.find(p=>Number(p.gcj02.latitude.toFixed(6))===row.lat&&Number(p.gcj02.longitude.toFixed(6))===row.lng);
    assert.ok(matched,entity.canonical_name);
    assert.equal(Number(source.lat.toFixed(6)),row.lat);assert.equal(Number(source.lng.toFixed(6)),row.lng);
    report.matches.push({entityId:row.id,name:row.name,revision:row.payload.identity.revision,category:row.category,
      lat:row.lat,lng:row.lng,address:matched.address,sameNamedCandidates:candidates.length,
      otherCandidateNames:[...new Set(geo.filter(p=>p.query===row.name&&p.name!==row.name).map(p=>p.name))],
      originalPointPreserved:true,fullReviewPassed:false});
  }
} finally {await client.query('ROLLBACK').catch(()=>{});await client.end();}
fs.writeFileSync(url('priority-cities/济南/spring-map-reference-check-01.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report));
