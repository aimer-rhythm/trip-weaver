import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const url = f => new URL(f, import.meta.url);
const read = f => JSON.parse(fs.readFileSync(url(f), 'utf8'));
const write = (f, value, exclusive = true) => fs.writeFileSync(url(f), JSON.stringify(value, null, 2) + '\n', { flag: exclusive ? 'wx' : 'w' });
const pointer = read('cleaning-scope/current.json');
assert.equal(pointer.cityReviewLedgers['济南'], '../priority-cities/济南/review-08.json');
const packet = read('priority-cities/济南/landmark-source-packet-01.json');
const upstream = read('priority-cities/济南/landmark-upstream-check-01.json');
const downstream = read('priority-cities/济南/landmark-downstream-check-01.json');
const geoFile = 'priority-cities/济南/geo-06.json';
const geoBytes = fs.readFileSync(url(geoFile)); const geo = JSON.parse(geoBytes);
assert.deepEqual(upstream.failures, []); assert.deepEqual(downstream.failures, []);
assert.equal(packet.mentions.length, 69); assert.equal(packet.notes.length, 38);
const groups = packet.groups.map(group => {
  const name = group.entity.canonical_name;
  const rows = packet.mentions.filter(m => group.mentionIds.includes(m.id)).map(m => ({
    mentionId: m.id, rawNoteId: m.raw_note_id, inputHash: m.inputHash, originalName: m.name,
    evidenceText: m.evidence_text, sourceType: m.place_type,
    conclusion: m.id === 11420 ? 'hotel_region_not_square_pending_scope' : 'subject_identity_supported',
    explanation: m.id === 11420 ? '原文为泉城广场附近住宿推荐区域，提取类型hotel；不认领为广场游览事实，不猜具体酒店。'
      : [12984, 12985].includes(m.id) ? '原文说明登高拍摄，但名称指画面中的广场/解放阁；不把未命名摄影楼顶并入被摄地标。'
      : m.id === 11449 ? '原文文庙位于曲水亭街后、大明湖前，明确南门进北门出；与大明湖路214号府学文庙南北门及本体对应，保留现有全名，不自动新增所有裸名别称。'
      : [11587, 11697, 12906, 12909].includes(m.id) ? '餐厅或酒店文章明确将此地标列为附近可步行到达的景点；主语区分，不把餐馆/住宿事实转给地标。'
      : '已读完整原文，路线、建筑描写或广场游览描述指此现行主体；周边机位、公交站、商业体与子设施不授予同义身份。',
  }));
  const probe = downstream.entities.find(e => e.entityId === group.entity.entity_id); assert.ok(probe);
  const map = geo.find(g => (name === '泉城广场' ? g.name === '中国济南泉城广场国际艺术广场' : g.name === name)
    && Number(g.gcj02.latitude.toFixed(6)) === probe.lat && Number(g.gcj02.longitude.toFixed(6)) === probe.lng);
  assert.ok(map);
  assert.equal(probe.sourceImages, 0); assert.equal(probe.independentImages, 0); assert.equal(probe.mediaReviewRequired, false);
  return { entityId: group.entity.entity_id, name, revision: 1, mentions: rows,
    mapReference: { sourceFile: geoFile, sourceSha256: createHash('sha256').update(geoBytes).digest('hex'), name: map.name,
      address: map.address, coordinateSystem: map.coordinateSystem, originalLonLat: map.lonlat, gcj02: map.gcj02 },
    fullReviewPassed: name !== '泉城广场', semanticPendingMentions: rows.filter(r => r.mentionId === 11420).map(r => r.mentionId) };
});
write('priority-cities/济南/landmark-source-review-01.json', { sourceFile: packet.sourceFile, sourceSha256: packet.sourceSha256,
  reviewedAt: new Date().toISOString(), fullNotesRead: 38, mentionsRead: 69, groups,
  applied: false, note: '此为只读人工核查结论，尚无新治理批次；泉城广场11420待执行scope，不计入已正式入队106行。' });
const ledger = read('priority-cities/济南/review-08.json');
for (const group of groups) {
  const row = ledger.rows.find(r => r.entityId === group.entityId); assert.ok(row);
  row.currentRevision = 1; row.currentEntityId = group.entityId; row.currentName = group.name;
  row.status = group.fullReviewPassed ? 'reviewed_identity' : 'reviewed_sources_scope_required';
  row.dimensions = { identity: group.fullReviewPassed ? 'reviewed_same_entity' : 'mixed_hotel_region_requires_scope',
    category: 'reviewed_source_category', location: 'reviewed_reference_point', media: 'no_upstream_imported_or_independent_images' };
  row.evidenceFiles = [...new Set([...(row.evidenceFiles ?? []), 'priority-cities/济南/landmark-source-review-01.json',
    'priority-cities/济南/landmark-upstream-check-01.json', 'priority-cities/济南/landmark-downstream-check-01.json', 'priority-cities/济南/landmark-photo-sources-01.json', geoFile])];
  row.followup = group.fullReviewPassed
    ? `${group.mentions.length}条提及及完整原文已核查，主体与设施边界明确；当前类别、本体参考点、旧ID、SQL首位及真实向量通过，三类图库均无匹配图。AI自查完成，待用户验收。`
    : '33提及完整核查，32条主体有证据；11420为广场附近住宿区域，错误hotel提取须新增scope隔离，不指定猜测酒店。本体参考点、SQL/向量及图库核查通过，但该源尚未完成清洗；未创建batch35。';
}
ledger.createdAt = new Date().toISOString(); ledger.previousLedger = 'priority-cities/济南/review-08.json';
Object.assign(ledger.summary, { fullyReviewed: 8, remainingPrimaryToReview: 86, otherPendingPrimaryRows: 82,
  reviewedOrdinaryPrimaryRows: 4, unappliedSemanticFindings: 1,
  fullyReviewedMeaning: 'AI自查8原入选行：宽厚里两行、超然楼两行、两博物馆、解放阁与府学文庙，共6現行主体；用户未验收。',
  scopeProgressMeaning: '98原入选行保留：4非地点、8行AI自查；86未完成中4行泉池/公园部分治理，其余82继续，含教堂位置与泉城广场住宿区域待治理。' });
write('priority-cities/济南/review-09.json', ledger);
fs.writeFileSync(url('priority-cities/济南/review-09.md'), '# 济南98项重点清单核查台账（公共地标只读核查后）\n\n' + ledger.summary.scopeProgressMeaning
  + '原7待定位保持；整城未验收。\n\n| 原入选名称 | 现行名称 | 版本 | 进度 | 说明 |\n| --- | --- | ---: | --- | --- |\n'
  + ledger.rows.map(r => `| ${r.name} | ${r.currentName ?? r.name} | ${r.currentRevision} | ${r.status} | ${r.followup} |`).join('\n') + '\n', { flag: 'wx' });
write('cleaning-scope/current-before-landmark-review.json', pointer);
const progress = '实体批次截至34且已双同步，无batch35；独立图片03已应用，01至03禁止重放。超然楼四图及两名三图展示通过，原13分配、原目录与201历史行程不变。三处地标69提及/38原文已核查：解放阁、济南府学文庙完成AI自查；泉城广场11420为附近住宿区域hotel误提取，须新增scope治理，尚未正式入队。review-09：98原入选行保留，4非地点、8行AI自查（6现行主体）、86未完成（4行泉池/公园部分治理，其余82）。原7待定位及教堂位置继续。scope06固定978主体+56依赖/1135源，正式范围内106待审及4必去缺口保持，另1条新发现未应用问题单列。未验收，不提交归档。';
pointer.cityReviewLedgers['济南'] = '../priority-cities/济南/review-09.json';
pointer.unappliedFindings = [{ city: '济南', entityId: '8cc25e536e67519c958ee54248ead04f', mentionId: 11420,
  sourceId: 5354, status: 'requires_scope_governance', evidence: '../priority-cities/济南/landmark-source-review-01.json', countedInCurrentReviewRows: false }];
pointer.progressNote = progress; pointer.progressUpdatedAt = new Date().toISOString(); write('cleaning-scope/current.json', pointer, false);
const task = read('../task.json'); task.notes = '云南不处理，继续九城。' + progress + '见research/jinan-landmark-review-20261008.md；实体01-v2至34禁止重放。';
write('../task.json', task, false);
const prd = url('../prd.md'); fs.writeFileSync(prd, fs.readFileSync(prd, 'utf8').replace('## 已知事实\n', '## 已知事实\n\n### 最新进展：公共地标自查及泉城广场住宿区域问题\n\n' + progress + '详见[本轮公共地标核查](research/jinan-landmark-review-20261008.md)。以下为历史快照。\n'));
const resume = url('nine-cities-continuation-20261007.md'); fs.writeFileSync(resume, fs.readFileSync(resume, 'utf8').replace('## 本轮断点\n', '## 本轮断点\n\n当前以review-09为准。' + progress + '下一步泉城广场33提及scope治理，再继续普通重点地点；教堂有新边界证据后补位置，随后其余八城。以下为历史断点。\n'));
console.log(JSON.stringify({ ledger: 'review-09', fullyReviewed: 8, nonPlace: 4, remaining: 86, unappliedFindings: 1 }));
