// 三组图库差异中只修复已逐条核实的国博同体及景山旧ID；王府井不在本批。
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const filename = 'photo-catalog-identity-audit-1791347549032.json';
const bytes = await readFile(new URL(filename, import.meta.url));
const audit = JSON.parse(bytes), base = new URL('all-cities/', import.meta.url);
assert.equal(audit.readOnly, true);
const museum = '9848af6527dee0b6806678da781b39bf', short = '105e6caccc4d1de89542c455a2b205e7', park = '981bfe8125feb36e052dcfee1e0df8b5';
const original = audit.upstream.entities.find(e => e.entity_id === short);
assert.equal(original.revision, 1);
const places = audit.upstream.sources.filter(p => p.entity_id === short);
assert.equal(places.length, 1);
const mentions = audit.upstream.mentions.filter(m => places.some(p => p.normalized_name === m.normalized_name));
assert.equal(mentions.length, 4);
const supplement = { readOnly: true, sourceAudit: filename, entities: [{ ...original, places,
  mentions: mentions.map(m => ({ id:m.id, city:'北京', name:m.name, normalized_name:m.normalized_name, place_type:'attraction',
    reason:m.reason,evidence_text:m.evidence_text,note_id:m.raw_note_id,title:m.title,source_url:m.source_url })) }], reviews: [] };
const evidence = conclusion => ({kind:'reviewed_full_source_and_downstream_snapshot',file:filename,
  sha256:createHash('sha256').update(bytes).digest('hex'),conclusion});
const decisions = [
  { key:'all-cities-20261007-batch-26-001',city:'北京',entityId:museum,mergeEntityIds:[short],
    canonicalName:'国家博物馆',aliases:['国家博物馆','中国国家博物馆','国博'],expectedRevisions:{[museum]:1,[short]:1},
    overrides:{lat:39.905374,lng:116.401304,address:'东长安街16号天安门广场东侧',geoStatus:'reviewed_source'},
    evidence:[evidence('1300国博的4条原始提及3174/3363/4469/4885分别为展厅参观或北京景点/交通清单，没有西门设施语义。641明确国博「古代中国」展厅和入馆游览；395原文同一段先称国家博物馆后称国博，503同篇也交替使用。归并到主源686现有身份及场馆坐标，不沿用1300西门外北侧的地图匹配，不并入国博马年展或附近未具名面店。'),
      {kind:'reviewed_mentions',mentionIds:[1995,3018,3174,3363,4469,4885],noteIds:[395,503,641,691,1087,1122],
        quotes:['09:30-11:30📍国家博物馆（提前预约！！！）\n文化历史的熏陶，国博还是很有趣。','必看：「古代中国」展厅，16:00停止入馆，预留3h以上游览时间']} ] },
  { key:'all-cities-20261007-batch-26-002',city:'北京',entityId:park,mergeEntityIds:[],canonicalName:'景山公园',aliases:['景山'],
    expectedRevisions:{[park]:2},overrides:{},evidence:[evidence('3015/note503与4475/note1087的原名景山已归一到景山公园，归属源1063。下游遗留xhs记录bfcd828439fa9f1f7ff85ab8b155f934无v2身份，地址景山西街44号和坐标与1063完全相同。补已核实简称并由正式别名ID认领机制纳入该历史ID，不另造实体、不合并万春亭/前街/崇祯自缢处，不改已核实公园坐标。'),
      {kind:'reviewed_legacy_alias',mentionIds:[3015,4475],sourcePlaceId:1063,legacyId:'bfcd828439fa9f1f7ff85ab8b155f934',
        originalNames:['景山','景山'],normalizedNames:['景山公园','景山公园']}] },
];
for (const [name, value] of [
  ['beijing-batch26-supplement.json',supplement],
  ['batch-26-supplements.json',['beijing-batch26-supplement.json']],
  ['batch-26-prerequisites.json',['batch-06','batch-07','batch-21']],
  ['batch-26-decisions.json',decisions],
]) await writeFile(new URL(name,base), JSON.stringify(value,null,2),{flag:'wx'});
console.log(JSON.stringify({batch:'batch-26',decisions:decisions.length,merge:1,legacyAlias:1,apply:false}));
