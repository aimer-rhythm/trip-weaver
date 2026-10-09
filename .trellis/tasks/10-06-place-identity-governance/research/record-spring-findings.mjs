import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const url = f => new URL(f, import.meta.url);
const read = f => JSON.parse(fs.readFileSync(url(f), 'utf8'));
const hash = f => createHash('sha256').update(fs.readFileSync(url(f))).digest('hex');
const write = (f, value, exclusive = true) => fs.writeFileSync(url(f), JSON.stringify(value, null, 2) + '\n', { flag: exclusive ? 'wx' : 'w' });
const dir = 'priority-cities/济南/';
const pointer = read('cleaning-scope/current.json');
assert.equal(pointer.cityReviewLedgers['济南'], '../' + dir + 'review-11.json');
assert.equal(pointer.latestAppliedEntityBatch, 35); assert.deepEqual(pointer.unappliedFindings, []);
assert.equal(pointer.currentScopeReviews.currentReviewRows, 109);
const packet = read(dir + 'spring-source-packet-01.json');
const down = read(dir + 'spring-downstream-check-01.json');
assert.equal(hash(dir + 'spring-source-packet-01.json'), down.sourcePacketSha256);
assert.deepEqual(packet.failures, []); assert.deepEqual(down.failures, []);
assert.equal(packet.groups.length, 5); assert.equal(packet.mentions.length, 12); assert.equal(packet.notes.length, 5);
const bad = new Set(packet.confirmedIssue.mentionIds); assert.equal(bad.size, 4);
const review = { reviewedAt: new Date().toISOString(), sourcePacket: dir + 'spring-source-packet-01.json',
  sourcePacketSha256: down.sourcePacketSha256, downstreamFile: dir + 'spring-downstream-check-01.json',
  mentionsRead: 12, fullNotesRead: 5, applied: false, fullReviewPassed: false,
  mentions: packet.mentions.map(m => ({ mentionId: m.id, rawNoteId: m.raw_note_id, entityId: m.resolvedEntityId,
    inputHash: m.inputHash, name: m.name, reason: m.reason, evidenceText: m.evidence_text, factValue: m.fact_value,
    conclusion: bad.has(m.id) ? 'incorrect_individual_duration_from_group' : m.id === 12692 ? 'photo_subject_boundary_pending' : 'source_subject_supported_remaining_dimensions_pending',
    explanation: bad.has(m.id) ? '原文四处合计0.5h，不支持每处30分钟；保留独立身份和原始事实，须实施字段级治理。'
      : m.id === 12692 ? '摄影路线将刘氏泉括注为簪花少女；后续核实泉体与附近拍照主体，不自动合并或排除。'
      : m.id === 12583 ? '原文明确王府池子并写濯缨泉；不自动增加别名，不据此认领趵突泉园内濯缨池。'
      : '名称及当前描述有完整原文支持；类别、位置、图库等尚未完成，保持待核。' })) };
const ledger = read(dir + 'review-11.json'); const beforeSummary = structuredClone(ledger.summary);
for (const group of packet.groups) {
  const row = ledger.rows.find(r => r.entityId === group.entity.entity_id); assert.ok(row); assert.equal(row.status, 'pending');
  const affected = group.mentionIds.filter(id => bad.has(id));
  row.status = affected.length ? 'reviewed_sources_fact_correction_required' : 'reviewed_sources_other_dimensions_pending';
  row.dimensions = { ...row.dimensions, identity: 'source_names_read_remaining_boundaries_pending',
    consumedFacts: affected.length ? 'group_duration_incorrectly_individual' : 'source_subject_read' };
  row.evidenceFiles = [...new Set([...(row.evidenceFiles ?? []), dir + 'spring-source-packet-01.json',
    dir + 'spring-source-review-01.json', dir + 'spring-downstream-check-01.json'])];
  row.followup = affected.length
    ? `原文2837将四处合计0.5h，提及${affected.join('、')}却抽为单点30分钟，下游仍消费；需字段级修正并保留独立身份，类别/位置/图库继续核查。`
    : '12771泉水游鱼描述已读完整原文；类别、位置及图库等仍待核，不计作完整自查。';
}
assert.equal(ledger.rows.length, 98);
assert.equal(ledger.rows.filter(r => ['reviewed_identity', 'reviewed_same_entity', 'reviewed_alias_redirect'].includes(r.status)).length, 11);
ledger.createdAt = review.reviewedAt; ledger.previousLedger = dir + 'review-11.json';
ledger.summary.unappliedSemanticFindings = 4;
assert.equal(beforeSummary.remainingPrimaryToReview, ledger.summary.remainingPrimaryToReview);
const files = [dir + 'spring-source-review-01.json', dir + 'review-12.json', dir + 'review-12.md', 'cleaning-scope/current-before-spring-findings.json'];
for (const f of files) assert.equal(fs.existsSync(url(f)), false, f);
write(files[0], review); write(files[1], ledger);
fs.writeFileSync(url(files[2]), '# 济南98项重点清单核查台账（泉群时长问题核实后）\n\n' + ledger.summary.scopeProgressMeaning
  + '另4条组合时长错误尚未应用修复，单列新发现；原7待定位及教堂位置保持，整城未验收。\n\n| 原入选名称 | 现行名称 | 版本 | 进度 | 说明 |\n| --- | --- | ---: | --- | --- |\n'
  + ledger.rows.map(r => `| ${r.name} | ${r.currentName ?? r.name} | ${r.currentRevision} | ${r.status} | ${r.followup} |`).join('\n') + '\n', { flag: 'wx' });
write(files[3], pointer);
pointer.cityReviewLedgers['济南'] = '../' + dir + 'review-12.json';
pointer.unappliedFindings = packet.mentions.filter(m => bad.has(m.id)).map(m => ({ city: '济南', entityId: m.resolvedEntityId,
  mentionId: m.id, rawNoteId: m.raw_note_id, sourceId: packet.groups.find(g => g.entity.entity_id === m.resolvedEntityId).sourceIds[0],
  inputHash: m.inputHash, status: 'requires_field_level_duration_governance',
  evidence: '../' + dir + 'spring-source-review-01.json', countedInCurrentReviewRows: false }));
const progress = '三个公园已完成AI自查；继续五处泉水地点12提及/5篇原文发现2837四处合计半小时被提取并导出为各自30分钟（12941至12944），上游与下游实库已只读证实。四条错误时长尚未应用，须字段级治理并保留独立主体；不能平分时长或撤回唯一来源的起凤泉来冒充完成。review-12保留98行：4非地点、11行AI自查（9主体）、83未完成，其中5行部分治理，其余78；原7待定位及教堂位置不变。实体截至35、图片截至03，无batch36或待同步步骤。scope06固定978主体+56依赖/1135源，正式109待审及4必去缺口不变，4条新发现单列。201历史行程不变；云南不处理，未验收，不提交归档。';
pointer.progressNote = progress; pointer.progressUpdatedAt = review.reviewedAt; write('cleaning-scope/current.json', pointer, false);
const task = read('../task.json'); assert.equal(task.status, 'in_progress'); task.notes = progress + '见research/jinan-spring-duration-findings-20261008.md。'; write('../task.json', task, false);
const prd = url('../prd.md'); fs.writeFileSync(prd, fs.readFileSync(prd, 'utf8').replace('## 已知事实\n',
  '## 已知事实\n\n### 最新进展：三个公园自查及泉群组合时长问题\n\n' + progress + '详见[组合时长核查](research/jinan-spring-duration-findings-20261008.md)。以下为历史快照。\n'));
const resume = url('nine-cities-continuation-20261007.md'); fs.writeFileSync(resume, fs.readFileSync(resume, 'utf8').replace('## 本轮断点\n',
  '## 本轮断点\n\n当前以review-12为准。' + progress + '下一步实施逐字段时长治理，再完成五处泉水地点其他维度，继续九城。以下为历史断点。\n'));
console.log(JSON.stringify({ ledger: 'review-12', fullyReviewed: 11, remaining: 83, unappliedDurationFindings: 4, entityBatch: 35 }));
