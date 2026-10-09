// 记录已逐篇核查的三个公园，不应用实体/图片决定，不提交或归档。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const url = file => new URL(file, import.meta.url);
const bytes = file => fs.readFileSync(url(file));
const read = file => JSON.parse(bytes(file));
const hash = data => createHash('sha256').update(data).digest('hex');
const write = (file, value, exclusive = true) => fs.writeFileSync(url(file), JSON.stringify(value, null, 2) + '\n', { flag: exclusive ? 'wx' : 'w' });
const dir = 'priority-cities/济南/';
const pointer = read('cleaning-scope/current.json');
assert.equal(pointer.cityReviewLedgers['济南'], '../' + dir + 'review-10.json');
assert.equal(pointer.latestAppliedEntityBatch, 35);
assert.equal(pointer.latestIndependentPhotoBatch, 3);
assert.equal(pointer.userAcceptance, false);
assert.deepEqual(pointer.unappliedFindings, []);
const upstream = read(dir + 'park-upstream-check-01.json');
const downstream = read(dir + 'park-downstream-check-01.json');
const photos = read(dir + 'park-photo-sources-01.json');
assert.deepEqual(upstream.failures, []); assert.deepEqual(downstream.failures, []);
assert.equal(upstream.groups.length, 3);
assert.equal(photos.cityAssignments, 9); assert.equal(photos.sourceImages, 123);
assert.deepEqual(photos.warnings, []);
assert.deepEqual(downstream.trips, { count: 201, digest: 'e01d67cbf42a62fc595f4ef052f99e75' });
const source = read(upstream.sourceFile);
assert.equal(hash(bytes(upstream.sourceFile)), upstream.sourceSha256);
assert.equal(upstream.rawSourcesUnchanged, 107); assert.equal(upstream.originalMentionsUnchanged, 662);
assert.equal(upstream.originalNotesUnchanged, 82);
assert.equal(hash(bytes('cleaning-scope/' + pointer.scopeFile)), pointer.scopeSha256);
const ids = new Set(upstream.groups.map(g => g.entityId));
const frozenGroups = source.groups.filter(g => ids.has(g.entity.entity_id));
const mentionIds = new Set(frozenGroups.flatMap(g => g.mentionIds));
assert.equal(mentionIds.size, 3);
const mentions = source.mentions.filter(m => mentionIds.has(m.id));
const noteIds = new Set(mentions.map(m => m.raw_note_id));
const notes = source.notes.filter(n => noteIds.has(n.id));
assert.equal(notes.length, 3);
const supplemental = upstream.supplementalImageFactNotes;
assert.deepEqual(supplemental.map(n => n.note.id).sort((a, b) => a - b), [2547, 2549, 2568, 2798]);
const fullNoteIds = [...new Set([...noteIds, ...supplemental.map(n => n.note.id)])].sort((a, b) => a - b);
assert.equal(fullNoteIds.length, 6);
const sourcePacket = { readOnly: true, capturedAt: upstream.capturedAt, sourceFile: upstream.sourceFile,
  sourceSha256: upstream.sourceSha256, upstreamCheckFile: dir + 'park-upstream-check-01.json',
  upstreamCheckSha256: hash(bytes(dir + 'park-upstream-check-01.json')),
  groups: frozenGroups, mentions, notes, supplementalImageFactNotes: supplemental,
  fullNoteIds, note: '3条地点提及及3篇对应原文；另扫描全城普通图片事实池，补入4篇相关记录，去重共6篇。图片文字是既有分析记录，未宣称本轮查看了原图。' };
const exportFile = 'all-cities/batch-35/sync-01/xhs-places-济南.json';
const exported = read(exportFile);
assert.equal(hash(bytes(exportFile)), read('all-cities/batch-35/sync-01/sync-state.json').cities['济南'].exportHash);
const geoFile = dir + 'geo-07.json'; const geo = read(geoFile);
const explanations = {
  11531: 'note2573明确经三路→中山公园→纬四路，并直接写中山公园里安静、可淘二手货。没有把古着店、图书馆或园内摊位认领为公园同义名；原始reason/evidence_text与看点的主语一致。',
  11376: 'note2576在天天过年之后明确去济南森林公园逛林赏湖，随后写环湖木栈道及观景台，最后另列腊山河廊道。保留原文体验为弱证据，不把餐厅鲁菜评价或腊山河归公园，不凭路线创建栈道/观景台别名。',
  12782: 'note2798在济南9景点拍照清单中明确列泉城公园；reason“济南公园，适合拍照”是对应语境的概述，fact_value为空。泉城广场、泉城公园站和其他八处景点均不认领为同一主体。',
};
const groups = upstream.groups.map(group => {
  const probe = downstream.entities.find(e => e.entityId === group.entityId); assert.ok(probe);
  const photo = photos.entities.find(e => e.entityId === group.entityId); assert.ok(photo);
  assert.equal(probe.category, '自然'); assert.equal(probe.mediaReviewRequired, false);
  assert.equal(probe.sourceImages, 0); assert.equal(probe.independentImages, 0);
  assert.equal(probe.independentBindings, 0); assert.equal(photo.independentSources.length, 0);
  assert.equal(probe.vector.diagnostics.vector, 'used'); assert.equal(probe.vector.firstId, group.entityId);
  const map = geo.find(g => g.name === group.name && Number(g.gcj02.latitude.toFixed(6)) === probe.lat
    && Number(g.gcj02.longitude.toFixed(6)) === probe.lng); assert.ok(map);
  const place = exported.places.find(p => p.id === group.entityId); assert.ok(place);
  const reviewedMentions = mentions.filter(m => group.mentions.some(r => r.mentionId === m.id)).map(m => {
    assert.ok(explanations[m.id]);
    return { mentionId: m.id, rawNoteId: m.raw_note_id, inputHash: m.inputHash,
      originalName: m.name, reason: m.reason, evidenceText: m.evidence_text, factValue: m.fact_value,
      conclusion: 'subject_and_consumed_fields_supported_by_source', explanation: explanations[m.id] };
  });
  return { entityId: group.entityId, name: group.name, revision: group.revision, mentions: reviewedMentions,
    mapReference: { sourceFile: geoFile, sourceSha256: hash(bytes(geoFile)), name: map.name, address: map.address,
      coordinateSystem: map.coordinateSystem, originalLonLat: map.lonlat, gcj02: map.gcj02 },
    currentFacts: { topReasons: place.payload.topReasons, content: place.payload.content,
      openHours: place.payload.openHours, price: place.payload.price ?? null, reservation: place.payload.reservation },
    policyAssessment: group.name === '泉城公园'
      ? 'note2549图片2的text_content与key_info均明确标注泉城公园免费、全天开放；note2568图片2/3另有免费记录。博物馆9:00-17:00在openHours.review标other_entity，预约保持unknown。note2547的泉城公园站是交通位置，不作为公园政策来源。仅确认来源主体归属，未认定社区攻略为当前官方政策。'
      : '没有从其他地点或全城无主语图片提示获得费用、开放时间或预约政策；当前openHours/reservation保持unknown。',
    mediaAssessment: '上游管理图库、下游当前及旧ID图片字段、实际独立图库均无匹配；没有新增图片分配。',
    fullReviewPassed: true, userAccepted: false };
});
const review = { reviewedAt: new Date().toISOString(), sourceFile: upstream.sourceFile, sourceSha256: upstream.sourceSha256,
  sourcePacketFile: dir + 'park-source-packet-01.json', exportFile, exportSha256: hash(bytes(exportFile)),
  mentionsRead: 3, fullNotesRead: 6, fullNoteIds, groups, applied: false,
  conclusion: '三项完成当前版本的身份/类别/参考位置/事实归属/图库自查；未新增治理决定、未确认最新政策或用户验收。' };
const ledger = read(dir + 'review-10.json');
const oldIds = ledger.rows.map(r => r.entityId);
for (const group of groups) {
  const row = ledger.rows.find(r => r.entityId === group.entityId); assert.ok(row); assert.equal(row.status, 'pending');
  row.currentEntityId = group.entityId; row.currentName = group.name; row.currentRevision = group.revision;
  row.status = 'reviewed_identity';
  row.dimensions = { identity: 'reviewed_same_entity', category: 'reviewed_source_category',
    location: 'reviewed_reference_point', media: 'no_upstream_imported_or_independent_images',
    consumedFacts: 'reviewed_source_subject_attribution' };
  row.evidenceFiles = [...new Set([...(row.evidenceFiles ?? []), dir + 'park-source-review-01.json',
    dir + 'park-source-packet-01.json', dir + 'park-upstream-check-01.json', dir + 'park-downstream-check-01.json',
    dir + 'park-photo-sources-01.json', geoFile])];
  row.followup = '完整提及及事实来源已核查，保留公园本体稳定ID、自然类别及地图参考点；入口/设施独立，SQL/真实向量/旧ID通过，三类图库均无匹配。AI自查完成，待用户验收。';
}
assert.deepEqual(ledger.rows.map(r => r.entityId), oldIds); assert.equal(oldIds.length, 98);
const reviewed = ledger.rows.filter(r => ['reviewed_identity', 'reviewed_same_entity', 'reviewed_alias_redirect'].includes(r.status)).length;
assert.equal(reviewed, 11);
ledger.createdAt = review.reviewedAt; ledger.previousLedger = dir + 'review-10.json';
Object.assign(ledger.summary, { fullyReviewed: 11, remainingPrimaryToReview: 83, otherPendingPrimaryRows: 78,
  reviewedOrdinaryPrimaryRows: 7,
  fullyReviewedMeaning: 'AI自查11原入选行对应9现行主体：宽厚里两行、超然楼两行、两博物馆、解放阁、府学文庙及三个公园；用户未验收。',
  scopeProgressMeaning: '98原入选行保留：4非地点、11行AI自查；83未完成中5行部分治理（4行泉池/公园和泉城广场1行），其余78继续。三组受控来源共59提及待审。' });
const progress = '三个公园（中山公园、泉城公园、济南森林公园）完成AI自查：3条完整提及及图片事实补充来源去重6篇已核，保留revision1、自然类别与本体位置；三类图库无匹配，SQL/真实向量/12边界负例及201历史行程通过。review-11保留98行：4非地点、11行AI自查（9现行主体）、83未完成，其中5行部分治理，其余78继续。原7待定位及教堂位置不变。实体截至35、图片截至03，无batch36或待同步步骤；flow37/audit33仍是最新全城回归。scope06固定978主体+56依赖/1135源，50实体对+59提及=109待审及4必去缺口保持。云南不处理，未验收，不提交归档。';
const exclusive = [dir + 'park-source-packet-01.json', dir + 'park-source-review-01.json', dir + 'review-11.json',
  dir + 'review-11.md', 'cleaning-scope/current-before-park-review.json'];
for (const file of exclusive) assert.equal(fs.existsSync(url(file)), false, file);
write(exclusive[0], sourcePacket); write(exclusive[1], review); write(exclusive[2], ledger);
fs.writeFileSync(url(exclusive[3]), '# 济南98项重点清单核查台账（三个公园自查后）\n\n' + ledger.summary.scopeProgressMeaning
  + '原7待定位及教堂位置保持；整城未验收。\n\n| 原入选名称 | 现行名称 | 版本 | 进度 | 说明 |\n| --- | --- | ---: | --- | --- |\n'
  + ledger.rows.map(r => `| ${r.name} | ${r.currentName ?? r.name} | ${r.currentRevision} | ${r.status} | ${r.followup} |`).join('\n') + '\n', { flag: 'wx' });
write(exclusive[4], pointer);
pointer.cityReviewLedgers['济南'] = '../' + dir + 'review-11.json';
pointer.progressNote = progress; pointer.progressUpdatedAt = review.reviewedAt;
write('cleaning-scope/current.json', pointer, false);
const task = read('../task.json'); assert.equal(task.status, 'in_progress');
task.notes = progress + '见research/jinan-park-review-20261008.md。'; write('../task.json', task, false);
const prd = url('../prd.md'); fs.writeFileSync(prd, fs.readFileSync(prd, 'utf8').replace('## 已知事实\n',
  '## 已知事实\n\n### 最新进展：三个公园完成AI自查\n\n' + progress + '详见[公园核查记录](research/jinan-park-review-20261008.md)。以下为历史快照。\n'));
const resume = url('nine-cities-continuation-20261007.md'); fs.writeFileSync(resume, fs.readFileSync(resume, 'utf8').replace('## 本轮断点\n',
  '## 本轮断点\n\n当前以review-11为准。' + progress + '下一步继续济南泉群/街巷等未核项目，随后其余八城；所有旧实体与图片批次禁止重放。以下为历史断点。\n'));
console.log(JSON.stringify({ ledger: 'review-11', newlyReviewed: 3, fullyReviewed: 11, nonPlace: 4, remaining: 83, newEntityBatch: false }));
