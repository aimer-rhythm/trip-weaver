import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';

const file=process.argv[2];assert.ok(file&&/scope-\d{2}\.json$/.test(file),'提供scope-NN.json');
const bytes=await readFile(file),scope=JSON.parse(bytes),out=file.replace(/\.json$/,'.md');
const escape=value=>String(value??'').replaceAll('|','｜').replace(/[\r\n]+/g,' ');
const labels={attraction:'景点',food:'美食',cafe:'咖啡/饮品',market:'购物',photo_spot:'机位'};
const cities=[...new Set(scope.selected.map(s=>s.place.city))].sort();
const s=scope.summary,lines=['# 本轮重点清洗清单','',
  '本清单确定清洗范围，不表示所有地点身份已核实。长尾待审保留原状；原始数据与现有身份防护继续保留。','',
  `用户排除的城市/数据桶：${scope.policy.excludedCities?.join('、')||'无'}。`,'',
  `来源：[${path.basename(file)}](${path.basename(file)})；SHA256：\`${createHash('sha256').update(bytes).digest('hex')}\`。`,
  `配额入选${s.quotaSelected}，必去额外补入${s.referenceAdded}，共${s.primary}主体；另有${s.dependencies}依赖，对应${s.sourceRows}源行。`,
  `范围内${s.inScopeReviews.rows}审核行/${s.inScopeReviews.entityPairs}实体对，提及${s.inScopeReviews.mentions}、图片${s.inScopeReviews.images}；范围外${s.pendingDeferred}行保留。`,
  `范围外包含${s.quarantinedReviewRows}条已隔离来源的归属待审，以及${s.deferredOtherRows}条普通长尾待审；两者不混称未处理问题。`,
  `人工排除${s.manuallyExcluded}项单列治理，必去待核${s.referenceNeedsReview}项，下游独立参考保留${s.preservedReferences}项。`,'',
  '| 城市 | 景点 | 美食 | 咖啡/饮品 | 购物 | 机位 | 额外必去 | 依赖 | 待审行 |',
  '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |'];
for(const city of cities){
  const groups=scope.quotaGroups.filter(g=>g.city===city),rows=scope.selected.filter(r=>r.place.city===city);
  const quota=new Set(groups.flatMap(g=>g.selectedIds));
  lines.push(`| ${city} | ${Object.keys(labels).map(b=>groups.find(g=>g.bucket===b)?.selectedIds.length??0).join(' | ')} | ${rows.filter(r=>!quota.has(r.place.id)).length} | ${scope.dependencies.filter(d=>d.city===city).length} | ${scope.scopedReviews.filter(r=>r.city===city).length} |`);
}
for(const city of cities){
  lines.push('',`## ${city}`,'');
  for(const [bucket,label] of Object.entries(labels)){
    const rows=scope.selected.filter(r=>r.place.city===city&&r.place.bucket===bucket);
    lines.push(`### ${label}`,'','| 地点 | 推荐分 | 入选原因 | 稳定ID |','| --- | ---: | --- | --- |');
    for(const row of rows)lines.push(`| ${escape(row.place.name)} | ${row.place.score} | ${escape(row.reasons.join('；'))} | ${row.place.id} |`);
  }
  lines.push('','### 必要身份依赖','','| 地点 | 原因 | 稳定ID |','| --- | --- | --- |');
  for(const d of scope.dependencies.filter(d=>d.city===city))lines.push(`| ${escape(d.name)} | ${escape(d.reasons.join('；'))} | ${d.id} |`);
  lines.push('','### 范围内待审','','| 审核行 | 对象 | 当前证据结论 |','| --- | --- | --- |');
  for(const r of scope.scopedReviews.filter(r=>r.city===city))lines.push(`| ${r.id} | ${escape(r.detail.names?.join(' / ')??r.detail.reason)} | ${escape(r.detail.assessment?.explanation??'待补证')} |`);
}
lines.push('','## 必去参考缺口','','相似名称不能自动认领；未通过资格的参考保持待核。','',
  '| 城市 | 名称 | 原因 | 参考文件 |','| --- | --- | --- | --- |');
for(const r of scope.referenceNeedsReview)lines.push(`| ${r.city} | ${escape(r.name)} | ${escape(r.status)} | ${escape(r.file)} |`);
lines.push('','## 人工排除与独立治理','','从配额排除不等于已完成业务库隔离；已应用批次以各项证据说明为准。','',
  '| 城市 | 名称 | 证据 | 稳定ID |','| --- | --- | --- | --- |');
for(const r of scope.manuallyExcluded)lines.push(`| ${r.city} | ${escape(r.name)} | ${escape(r.evidence)} | ${r.id} |`);
await writeFile(out,lines.join('\n')+'\n',{flag:'wx'});
console.log(JSON.stringify({file:out,...s}));
