// 只读评估清洗配额；不导出地点、不发布关系、不更改业务数据。
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Client } from 'pg';
import { parse } from 'dotenv';

const root = new URL('./', import.meta.url);
const config = parse(await readFile('../xhs-travel-pipeline/.env'));
const client = new Client({ connectionString: config.DATABASE_URL.replace('postgresql+asyncpg:', 'postgresql:'), connectionTimeoutMillis: 10000 });
const key = value => String(value ?? '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();
const sum = (rows, field) => rows.reduce((total, row) => total + Number(row[field] || 0), 0);
const pct = (part, whole) => whole ? +(100 * part / whole).toFixed(1) : null;
const rank = (a, b) => b.score - a.score || b.sources - a.sources || b.quality - a.quality || a.id.localeCompare(b.id);
const groupBy = (rows, field) => {
  const result = new Map();
  for (const row of rows) {
    const k = field(row);
    if (!result.has(k)) result.set(k, []);
    result.get(k).push(row);
  }
  return result;
};
try {
  await client.connect();
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await client.query("SET LOCAL statement_timeout='30s'");
  const rows = (await client.query(`SELECT p.id,p.city,p.name,p.normalized_name,p.place_type,p.theme_tags,
    p.latitude,p.longitude,p.is_active,p.geo_status,p.quality_score,s.recommend_score,s.mention_count_30d,s.source_count,
    m.entity_id FROM canonical_place p LEFT JOIN place_summary s ON s.canonical_place_id=p.id
    LEFT JOIN place_entity_member m ON m.place_id=p.id ORDER BY p.city,p.id`)).rows;
  const entities = (await client.query(`SELECT entity_id,city,canonical_name,primary_place_id,aliases,legacy_ids,status,redirect_to,revision FROM place_entity`)).rows;
  const reviews = (await client.query(`SELECT id,city,status,detail FROM place_entity_review WHERE status='PENDING' ORDER BY id`)).rows;
  await client.query('ROLLBACK');
  const byId = new Map(entities.map(e => [e.entity_id, e]));
  const resolve = id => {
    let entity = byId.get(id);
    const seen = new Set();
    while (entity?.redirect_to) {
      if (seen.has(entity.entity_id)) throw new Error('身份重定向环');
      seen.add(entity.entity_id); entity = byId.get(entity.redirect_to);
    }
    return entity;
  };
  const eligible = rows.filter(p => p.is_active && p.latitude !== null && p.longitude !== null
    && p.quality_score >= 0 && p.recommend_score !== null && resolve(p.entity_id)?.status === 'ACTIVE');
  // 已确认同体先归一；用当前主源分数，主源不合格时用最高分成员，不重复相加旧别名分。
  const roots = [...groupBy(eligible, p => resolve(p.entity_id).entity_id)].map(([id, members]) => {
    const entity = byId.get(id);
    const sorted = members.toSorted((a,b) => Number(b.recommend_score)-Number(a.recommend_score) || a.id-b.id);
    const representative = members.find(p => p.id === entity.primary_place_id) ?? sorted[0];
    return { id, city: entity.city, name: entity.canonical_name, type: representative.place_type || 'other',
      themes: [...new Set(members.flatMap(p => p.theme_tags ?? []))], score: Number(representative.recommend_score),
      mentions: Number(representative.mention_count_30d || 0), sources: Number(representative.source_count || 0),
      quality: Number(representative.quality_score || 0), lat: representative.latitude, lng: representative.longitude,
      aliases: [...new Set([entity.canonical_name, ...entity.aliases, ...members.map(p => p.name)])],
      sourceIds: members.map(p => p.id), legacyIds: entity.legacy_ids };
  });
  const groups = groupBy(roots, p => `${p.city}\t${p.type}`);
  for (const list of groups.values()) list.sort(rank);
  const budgets = [20,30,40,50];
  const selections = new Map(budgets.map(n => [n, [...groups.values()].flatMap(list => list.slice(0,n))]));
  const reviewPairs = new Map();
  for (const r of reviews) if (Array.isArray(r.detail?.entityIds)) {
    const ids = [...new Set(r.detail.entityIds.map(id => resolve(id)?.entity_id).filter(Boolean))].sort();
    if (ids.length === 2) reviewPairs.set(ids.join(':'), {city:r.city, ids});
  }
  const golden = [];
  for (const file of (await readdir('eval/snapshots')).filter(f => f.endsWith('.json')).sort()) {
    const data = JSON.parse(await readFile(`eval/snapshots/${file}`, 'utf8'));
    for (const day of data.trip?.days ?? []) for (const a of day.activities ?? []) {
      if (a.name) golden.push({city:data.trip.destination, name:a.name});
    }
  }
  const goldNames = [...new Map(golden.map(a => [`${a.city}:${key(a.name)}`,a])).values()];
  const exactMatch = (a,p) => a.city === p.city && p.aliases.some(n => key(n) === key(a.name));
  const matchable = goldNames.filter(a => roots.some(p => exactMatch(a,p)));
  const snapshot = {capturedAt:new Date().toISOString(), readOnly:true, eligibility:'is_active + 非空坐标 + quality_score>=0 + summary + 当前根ACTIVE',
    scorePolicy:'先按现存稳定根去重；优先主源分数，不累加成员；未按原文重新评分', rows, entities, reviews};
  const bytes = JSON.stringify(snapshot,null,2);
  const stamp = Date.now();
  const inputFile = `topn-scope-input-${stamp}.json`;
  await writeFile(new URL(inputFile,root),bytes,{flag:'wx'});
  const result = {readOnly:true,capturedAt:snapshot.capturedAt,input:{file:inputFile,sha256:createHash('sha256').update(bytes).digest('hex')},
    eligibility:snapshot.eligibility,scorePolicy:snapshot.scorePolicy, rawRows:rows.length,eligibleSources:eligible.length,
    eligibleEntities:roots.length,cities:[...new Set(roots.map(p=>p.city))].sort(),
    types:[...groupBy(roots,p=>p.type)].map(([type,list])=>({type,count:list.length,oneSource:list.filter(p=>p.sources<=1).length})),
    budgets:budgets.map(n=>{
      const selected=selections.get(n),ids=new Set(selected.map(p=>p.id));
      const pairs=[...reviewPairs.values()].filter(p=>p.ids.some(id=>ids.has(id)));
      return {n,entities:selected.length,reductionPct:pct(roots.length-selected.length,roots.length),
        mentionCoveragePct:pct(sum(selected,'mentions'),sum(roots,'mentions')),
        oneSource:selected.filter(p=>p.sources<=1).length,pendingPairsTouching:pairs.length,
        goldExactNamesIncluded:matchable.filter(a=>selected.some(p=>exactMatch(a,p))).length};
    }),
    goldset:{distinctNames:goldNames.length,exactMatchableEligibleNames:matchable.length,
      meaning:'仅精确名称/已有别名覆盖金集的代理指标，不代表真实使用率；未匹配项单列'},
    cityBudgets:[...groupBy(roots,p=>p.city)].map(([city,list])=>({city,eligible:list.length,
      budgets:budgets.map(n=>{const selected=selections.get(n).filter(p=>p.city===city);return {n,entities:selected.length,
        mentionCoveragePct:pct(sum(selected,'mentions'),sum(list,'mentions'))};})})),
    groups:[...groups].map(([k,list])=>({city:list[0].city,type:list[0].type,total:list.length,
      rank30Score:list[29]?.score??null,rank50Score:list[49]?.score??null,
      tieAt30:list.length>30&&list[29].score===list[30].score,
      boundaryTieSize:list[29]?list.filter(p=>p.score===list[29].score).length:0,
      budgets:budgets.map(n=>({n,count:Math.min(n,list.length),mentionCoveragePct:pct(sum(list.slice(0,n),'mentions'),sum(list,'mentions'))})),
      ranked:list.map((p,i)=>({...p,rank:i+1}))})),
    adaptiveBudgets:[
      {attraction:50,food:30,cafe:10,photo_spot:20,market:15},
      {attraction:50,food:30,cafe:10,photo_spot:10,market:10},
      {attraction:30,food:30,cafe:10,photo_spot:10,market:10},
    ].map(quotas=>{
      const selected=[...groups.values()].flatMap(list=>list.slice(0,quotas[list[0].type]??0));
      return {quotas,entities:selected.length,reductionPct:pct(roots.length-selected.length,roots.length),
        mentionCoveragePct:pct(sum(selected,'mentions'),sum(roots,'mentions'))};
    }),
    tieSummary:{groupsOver30:[...groups.values()].filter(list=>list.length>30).length,
      tiesAt30:[...groups.values()].filter(list=>list.length>30&&list[29].score===list[30].score).length},
    themeBudget30:{entities:new Set([...groupBy(roots.flatMap(p=>(p.themes.length?p.themes:['无主题']).map(theme=>({...p,theme}))),p=>`${p.city}:${p.theme}`)
      .values()].flatMap(list=>list.toSorted(rank).slice(0,30).map(p=>p.id))).size},
    unmatchedGoldNames:goldNames.filter(a=>!matchable.includes(a))};
  const file=`topn-scope-assessment-${stamp}.json`;
  await writeFile(new URL(file,root),JSON.stringify(result,null,2),{flag:'wx'});
  for (const {n,entities:count} of result.budgets) {
    const selected=selections.get(n);
    if (new Set(selected.map(p=>p.id)).size!==count || [...groupBy(selected,p=>`${p.city}:${p.type}`).values()].some(list=>list.length>n)) {
      throw new Error('预算清单存在重复实体或超额');
    }
  }
  console.log(JSON.stringify({file,...Object.fromEntries(['rawRows','eligibleSources','eligibleEntities','budgets','goldset','adaptiveBudgets','tieSummary','themeBudget30'].map(k=>[k,result[k]]))},null,2));
} finally { await client.end(); }
