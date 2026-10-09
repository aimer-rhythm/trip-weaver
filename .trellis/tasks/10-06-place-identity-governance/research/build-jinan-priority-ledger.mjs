// 当前98项的逐项核查台账；旧修复记录或单项坐标修正不等于全项验收。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const root=new URL('./',import.meta.url);
const read=file=>JSON.parse(fs.readFileSync(new URL(file,root),'utf8'));
const sourceFile='priority-cities/济南/run-1791385235272324900/sources.json';
const sourceBytes=fs.readFileSync(new URL(sourceFile,root));
const source=JSON.parse(sourceBytes);
assert.equal(source.images.length,0);
const changes=read('all-cities/batch-30-decisions.json');
const sync=read('all-cities/batch-30/sync-01/sync-state.json');
assert.ok(sync.cities.济南.importedAt&&sync.cities.济南.relationsImportedAt);
const exported=read('all-cities/batch-30/sync-01/xhs-places-济南.json').places;
const facts={
  '趵突泉':'混有主泉池与园区；旧酒店坐标已清空，审核364未解决。',
  '趵突泉公园':'需与裸名来源逐提及分配，不能直接同义合并。',
  '五龙潭':'混有整园、泉群及摄影语境，需与公园/主潭区分。',
  '五龙潭公园':'审核365需与裸名完整来源联合核实；原文明确园中有主潭。',
  '九转大肠':'note2560的两次提取均仅描述菜品，无具体店铺；待逐提及撤回。',
  '济南锅贴':'note2560的两次提取均仅描述三鲜馅锅贴，无店址；待逐提及撤回。',
  '甜沫儿':'note2560的两次提取描述小米面咸粥，无店铺；待逐提及撤回。',
  '老济南烧烤':'note2560仅描述羊肉串配扎啤，无具体门店归属；待逐提及隔离。',
  '尚泉尚水茶馆':'note2795实际机位为茶馆前平台，须补逐提及边界；错误济阳坐标已清空。',
  '老舍笔下的济南':'note2817将其列为路线机位，不能按文学概念直接丢弃；核对西更道街墙面。',
  '济南文字墙':'note2817可定老城区路线，具体墙面尚未定位；错误远端坐标已清空。',
  '济南墙':'note2797定位为百花洲西月下观棠旁街巷，具体墙面待核。',
  '夹心胡同':'note2566原名含融汇济南老商埠店，实际打卡爱心天桥；主体粒度及精确点待核。',
  '泉源之眼':'note2839原文确实如此拼写；不可直接套泉城之眼名称，准确位置与同体证据待核。',
  '大观园':'旧经二路728号坐标疑似其他POI；地图另有市中区大观园，须补原文与官方互证。',
  '山东大厦':'原文为酒店中庭摄影，酒店整体与中庭边界仍待核。',
  '超然楼':'与大明湖超然楼两条目录待核是否同体，需查各自全来源。',
  '大明湖超然楼':'与超然楼两条目录待核是否同体，需查各自全来源。',
  '宽厚里':'与宽厚里美食街两条目录待核，不能只按去后缀合并。',
  '宽厚里美食街':'与宽厚里两条目录待核，不能只按去后缀合并。',
};
const rows=source.groups.map(g=>{
  const e=g.entity,change=changes.find(d=>d.entityId===e.entity_id);
  const mentions=source.mentions.filter(m=>g.mentionIds.includes(m.id));
  const actual=exported.find(p=>p.id===e.entity_id);
  assert.ok(actual,`重点实体未导出：${e.canonical_name}`);
  if(change) for(const k of ['lat','lng'])assert.equal(actual[k],change.overrides[k]);
  return {entityId:e.entity_id,name:e.canonical_name,baselineRevision:e.revision,currentRevision:actual.payload.identity.revision,
    sourceIds:g.sourceIds,relatedSourceIds:g.relatedSourceIds,mentionIds:g.mentionIds,noteIds:[...new Set(mentions.map(m=>m.raw_note_id))],
    status:'pending',dimensions:{identity:'pending',category:'pending',
      location:change?(change.overrides.lat===null?'wrong_point_cleared_position_pending':'corrected_and_synced'):'pending',
      media:'pending'},upstreamImageCount:0,mediaBoundary:'上游冻结无图片；下游和独立图库须另行核验，不据0图判验收。',
    changeBatch:change?'batch-30':null,followup:facts[e.canonical_name]??'按完整重点清单核查主体边界、类别、位置、历史引用和图片。'};
});
assert.equal(rows.length,98);assert.equal(new Set(rows.map(r=>r.entityId)).size,98);
const result={city:'济南',createdAt:new Date().toISOString(),sourceFile,
  sourceSha256:createHash('sha256').update(sourceBytes).digest('hex'),scopeFile:source.scopeFile,
  scopeSha256:source.scopeSha256,basis:'保留scope06入选集合；修错后缺位置者仍在本台账，不能移出后宣称完成。',
  summary:{primary:98,fullyReviewed:0,locationCorrectedAndSynced:3,wrongPointClearedPositionPending:7},rows};
fs.writeFileSync(new URL('priority-cities/济南/review-01.json',root),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
const lines=['# 济南98项重点清单核查台账','','全部保留原入选集合；本表不把旧批次修复、单项坐标修正或原队列无待审当作整项验收。',
  '',`来源：${sourceFile}；实体版本以batch30同步为本表断点。`,
  '', '| 地点 | 版本 | 位置进度 | 下一步 |','| --- | ---: | --- | --- |',
  ...rows.map(r=>`| ${r.name} | ${r.currentRevision} | ${r.dimensions.location} | ${r.followup} |`)];
fs.writeFileSync(new URL('priority-cities/济南/review-01.md',root),lines.join('\n')+'\n',{flag:'wx'});
console.log(JSON.stringify(result.summary));
