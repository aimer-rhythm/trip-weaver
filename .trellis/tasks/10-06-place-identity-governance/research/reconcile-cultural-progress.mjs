// 新独立图库证据暴露前批媒体核查缺口；保留身份结果，重新打开对应原入选行。
import fs from 'node:fs';
import assert from 'node:assert/strict';
const url = file => new URL(file, import.meta.url);
const read = file => JSON.parse(fs.readFileSync(url(file), 'utf8'));
const write = (file, data, exclusive = true) => fs.writeFileSync(url(file), JSON.stringify(data, null, 2) + '\n', { flag: exclusive ? 'wx' : 'w' });
const pointer = read('cleaning-scope/current.json');
assert.equal(pointer.cityReviewLedgers['济南'], '../priority-cities/济南/review-06.json');
const ledger = read('priority-cities/济南/review-06.json');
const scan = read('priority-cities/济南/cultural-downstream-check-03.json');
const catalog = scan.independentLibrary.catalogNames.find(c => c.name === '超然楼');
assert.equal(catalog.images, 10);
const towerRows = ledger.rows.filter(r => r.currentEntityId === 'd4a51a5df56f78c9de0713d86ea8c00c');
assert.equal(towerRows.length, 2);
for (const row of towerRows) {
  row.status = 'reviewed_identity_independent_media_pending';
  row.dimensions.media = '10_independent_source_images_pending_visual_review';
  row.followup += '本轮实查独立目录另有10图，前批已导入图库为空不足以完成媒体自查；身份归一与位置结论保留，独立图库待逐图核查。';
  row.evidenceFiles.push('priority-cities/济南/cultural-downstream-check-03.json');
}
assert.ok(!scan.independentLibrary.catalogNames.some(c => [c.name, ...c.aliases].some(n => ['宽厚里', '宽厚里美食街'].includes(n))));
for (const row of ledger.rows.filter(r => r.currentEntityId === 'bc2769d509f6d8d42166e81b8db8131b')) {
  row.dimensions.media = 'no_current_images_and_no_matching_independent_catalog';
  row.evidenceFiles.push('priority-cities/济南/cultural-downstream-check-03.json');
}
ledger.createdAt = new Date().toISOString(); ledger.previousLedger = 'priority-cities/济南/review-06.json';
Object.assign(ledger.summary, { fullyReviewed: 4, remainingPrimaryToReview: 90, otherPendingPrimaryRows: 86,
  reopenedIndependentMediaRows: 2, fullyReviewedMeaning: 'AI完成自查4原入选行：宽厚里两旧行归一为1主体，加本轮两博物馆；超然楼两行身份归一已完成，但独立图库10图待核，重新计入未完成。用户未验收。',
  scopeProgressMeaning: '98原入选行保留：4非地点、4行完成AI自查；90未完成中4行泉池/公园部分治理，其余86继续，包含超然楼2行独立媒体待核及教堂1行位置待核。' });
write('priority-cities/济南/review-07.json', ledger);
fs.writeFileSync(url('priority-cities/济南/review-07.md'), '# 济南98项重点清单核查台账（独立图库覆盖纠正后）\n\n'
  + ledger.summary.scopeProgressMeaning + '原7项待定位保持，教堂参考点另待核。整城未验收。\n\n'
  + '| 原入选名称 | 现行名称 | 版本 | 进度 | 说明 |\n| --- | --- | ---: | --- | --- |\n'
  + ledger.rows.map(r => `| ${r.name} | ${r.currentName ?? r.name} | ${r.currentRevision} | ${r.status} | ${r.followup} |`).join('\n') + '\n', { flag: 'wx' });
write('cleaning-scope/current-before-media-reconciliation.json', pointer);
const progress = '实体批次仍截至34且已双同步，无batch35。两博物馆完成AI自查，教堂主体/图片已核但位置待核。独立图库02已正式应用4绑定/1错误正例撤销，原17拒绝和201历史行程不变。新增独立目录证据表明超然楼10图未有逐图自查记录，相关2原入选行恢复媒体待核，原身份归一保持。review-07保留98行：4非地点、4行AI自查（宽厚里两行+两博物馆）、90未完成（4行泉池/公园部分治理，其余86）。scope06固定978主体+56依赖/1135源；50实体对+56提及=106范围内待审及4必去缺口不变。未验收，不提交归档。';
pointer.cityReviewLedgers['济南'] = '../priority-cities/济南/review-07.json';
pointer.progressNote = progress; pointer.progressUpdatedAt = new Date().toISOString();
write('cleaning-scope/current.json', pointer, false);
const task = read('../task.json'); task.notes = '云南不处理，继续九城。' + progress + '见research/jinan-cultural-review-20261008.md；01-v2至34及独立图片01/02禁止重放。';
write('../task.json', task, false);
const prdPath = url('../prd.md');
fs.writeFileSync(prdPath, fs.readFileSync(prdPath, 'utf8').replace('## 已知事实\n', '## 已知事实\n\n### 最新进展：文化地点自查与独立媒体覆盖纠正\n\n' + progress + '详见[文化地点核查](research/jinan-cultural-review-20261008.md)。以下为历史快照。\n'));
const resume = url('nine-cities-continuation-20261007.md');
fs.writeFileSync(resume, fs.readFileSync(resume, 'utf8').replace('## 本轮断点\n', '## 本轮断点\n\n当前以review-07为准。' + progress + '下一步超然楼10图与教堂位置，再继续普通地点和其余八城。以下为历史断点。\n'));
const reportPath = url('jinan-cultural-review-20261008.md');
const report = fs.readFileSync(reportPath, 'utf8');
fs.writeFileSync(reportPath, report.slice(0, report.indexOf('## 续作')) + '## 续作与覆盖纠正\n\n'
  + progress + '\n\n原review-06的6行自查/88未完成已被新证据纠正：超然楼相关两行在第32批的媒体结论只有已导入图库为空，不能覆盖当前独立目录10图；保持已确认主体与位置，单独重新打开媒体核查。宽厚里两行在本轮12目录完整扫描中无名称或别名匹配目录，原自查结果保留。\n\n'
  + '原7项待定位和教堂参考点继续。123独立图源中仅本轮22图完成此轮逐图核查，其他101图不能计作已核；下一步优先补超然楼10图和教堂定位，再推进普通地点及其他八城。最新整体flow/run-36、audit/run-32；新相关变更才运行下一轮37/33。没有待同步步骤或遗留进程。\n');
console.log(JSON.stringify({ ledger: 'review-07', fullyReviewed: 4, nonPlace: 4, remaining: 90, reopenedMediaRows: 2 }));
