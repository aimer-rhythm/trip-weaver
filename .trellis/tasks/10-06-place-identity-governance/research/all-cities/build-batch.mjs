// 只把逐项人工核实的选择转换为版本化决策，不按相似度自动作决定。
import fs from 'node:fs';
import { createHash } from 'node:crypto';
const base = new URL('./', import.meta.url);
const read = name => JSON.parse(fs.readFileSync(new URL(name, base), 'utf8'));
const batch = process.argv[2] || 'batch-01';
if (!/^batch-\d{2}(?:-v\d+)?$/.test(batch)) throw new Error('批次名称不合法');
const snapshot = read('source-snapshot.json');
const hash = createHash('sha256').update(fs.readFileSync(new URL('source-snapshot.json', base))).digest('hex');
const supplementPath=new URL(`${batch}-supplements.json`,base);
const supplements=fs.existsSync(supplementPath)?read(`${batch}-supplements.json`):[];
for(const file of supplements) {
  if(!/^[a-z0-9-]+\.json$/.test(file)) throw new Error('补充证据文件名不合法');
  for(const entity of read(file).entities) {
    if(snapshot.entities.some(e=>e.entity_id===entity.entity_id)) throw new Error('补充证据不能覆盖冻结实体');
    snapshot.entities.push(entity);
  }
  for(const review of read(file).reviews || []) {
    if(snapshot.reviews.some(r=>String(r.id)===String(review.id))) throw new Error('补充审核不能覆盖冻结记录');
    snapshot.reviews.push(review);
  }
}
const entities = new Map(snapshot.entities.map(e => [e.entity_id, e]));
const reviews = new Map(snapshot.reviews.map(r => [Number(r.id), r]));
const used = new Set();
const decisions = read(`${batch}-selections.json`).map((item, index) => {
  const selected = item.reviews.map(id => { const row = reviews.get(id); if (!row) throw new Error(`未知审核 ${id}`); return row; });
  const ids = [...new Set([...selected.flatMap(r => r.detail.entityIds),...(item.entityIds || [])])];
  const members = ids.map(id => entities.get(id));
  if(members.some(e=>!e)) throw new Error('实体缺少冻结源证据');
  // 全目录补查会发现候选图未连边的同体主体；必须显式给城市及冻结实体。
  const city = selected[0]?.city || item.city;
  if (!city || !members.length) throw new Error('独立决策需要城市及冻结实体');
  if (selected.some(review => review.city !== city)) throw new Error('审核跨城');
  if (members.some(e => e.city !== city || used.has(e.entity_id))) throw new Error('跨城或批次组重叠');
  ids.forEach(id => used.add(id));
  const roots = members.filter(e => e.canonical_name === item.primary);
  if (roots.length !== 1) throw new Error(`主记录有歧义 ${item.primary}`);
  const root = roots[0];
  const source = root.places.find(p => Number(p.id) === Number(root.primary_place_id));
  if (!source) throw new Error('缺失主源记录');
  const sourceGeometry = source.latitude != null && source.longitude != null ? {
    lat:Number(source.latitude.toFixed(6)), lng:Number(source.longitude.toFixed(6)),
    address:source.address || '', geoStatus:'reviewed_source',
  } : {lat:null, lng:null, geoStatus:'unresolvable'};
  const geometry = {...sourceGeometry, ...item.overrides};
  if (('lat' in geometry) !== ('lng' in geometry)
    || ((geometry.lat == null) !== (geometry.lng == null))) throw new Error('经纬度必须成对');
  const evidence = [{kind:'reviewed_source_snapshot',file:'all-cities/source-snapshot.json',sha256:hash,
    reviewIds:item.reviews,conclusion:item.reason,
    sourcePlaceIds:members.flatMap(e=>e.places.map(p=>p.id)),
    mentions:members.flatMap(e=>e.mentions.filter(m=>e.places.some(p=>p.name===m.name)).slice(0,4)
      .map(m=>({id:m.id,name:m.name,quote:m.evidence_text || m.reason,sourceUrl:m.source_url})))},
    {kind:'primary_source_geometry',sourcePlaceId:source.id,coordinateSystem:'GCJ-02',
      conclusion:item.geometryReason || '选取已核实主体的现有定位，不平均冲突坐标；原成员坐标保留供追溯。',
      original:sourceGeometry,...geometry}];
  for (const file of item.sources || []) {
    const fetched = read(file);
    if (!fetched.ok || !fetched.content) throw new Error(`来源抓取无正文 ${file}`);
    evidence.push({kind:'published_source',url:fetched.url,file:`all-cities/${file}`,
      sha256:createHash('sha256').update(fs.readFileSync(new URL(file,base))).digest('hex')});
  }
  for(const file of supplements.filter(file=>read(file).entities.some(e=>ids.includes(e.entity_id)))) {
    evidence.push({kind:'reviewed_supplemental_entity',file:`all-cities/${file}`,
      sha256:createHash('sha256').update(fs.readFileSync(new URL(file,base))).digest('hex'),conclusion:item.reason});
  }
  for (const context of item.contexts || []) {
    const rows = read(context.file);
    const selected = context.mentionIds.map(id => rows.find(row => String(row.mention_id) === String(id)));
    if (selected.some(row => !row)) throw new Error(`原文提及缺失 ${context.file}`);
    evidence.push({kind:'reviewed_full_note_context',file:`all-cities/${context.file}`,
      sha256:createHash('sha256').update(fs.readFileSync(new URL(context.file,base))).digest('hex'),
      mentionIds:context.mentionIds,conclusion:item.reason});
  }
  return {key:`all-cities-20261006-${batch}-${String(index+1).padStart(3,'0')}`,city,
    entityId:root.entity_id,mergeEntityIds:ids.filter(id=>id!==root.entity_id),
    canonicalName:item.canonicalName || root.canonical_name,
    expectedRevisions:Object.fromEntries(members.map(e=>[e.entity_id,e.revision])),
    overrides:geometry,evidence};
});
fs.writeFileSync(new URL(`${batch}-decisions.json`,base),JSON.stringify(decisions,null,2)+'\n');
console.log(JSON.stringify({groups:decisions.length,members:used.size,
  byCity:[...new Set(decisions.map(d=>d.city))].map(city=>({city,groups:decisions.filter(d=>d.city===city).length,
    redirected:decisions.filter(d=>d.city===city).reduce((n,d)=>n+d.mergeEntityIds.length,0)}))},null,2));
