// 登记第38批与三处完整AI自查；证据先验证，用户验收状态保持false。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const url = f => new URL(f, import.meta.url), read = f => JSON.parse(fs.readFileSync(url(f), 'utf8'));
const hash = f => createHash('sha256').update(fs.readFileSync(url(f))).digest('hex');
const write = (f, v, exclusive = true) => fs.writeFileSync(url(f), JSON.stringify(v, null, 2) + '\n', { flag: exclusive ? 'wx' : 'w' });
const pointer = read('cleaning-scope/current.json');
assert.equal(pointer.latestAppliedEntityBatch, 37);
assert.equal(pointer.cityReviewLedgers['济南'], '../priority-cities/济南/review-14.json');
const folder = 'all-cities/batch-38/sync-01/';
const sync = read(folder + 'sync-state.json').cities['济南'];
assert.ok(sync.importedAt && sync.relationsImportedAt && sync.embeddingRunAt);
assert.equal(hash(folder + 'xhs-places-济南.json'), sync.exportHash);
assert.equal(hash(folder + 'xhs-place-relations-济南.json'), sync.relationHash);
assert.equal(sync.places, 228); assert.equal(sync.relationSnapshotRevision, 12);
const vectors = read(folder + 'verification-vectors.json');
assert.equal(vectors.failures.length, 1);
assert.equal(vectors.failures[0].kind, 'withdrawal_vector_unused');
assert.equal(vectors.failures[0].detail.id, '8808e16f1472d0df17bed729a2e54e83');
const recheck = read(folder + 'withdrawal-vectors-recheck-02.json');
assert.deepEqual(recheck.failures, []); assert.equal(recheck.probes.length, 1);
assert.equal(recheck.probes[0].id, vectors.failures[0].detail.id);
assert.equal(recheck.probes[0].diagnostics.vector, 'used'); assert.ok(recheck.probes[0].excluded);
assert.equal(vectors.cities[0].withdrawals.length, 6);
assert.ok(vectors.cities[0].withdrawals.every(p => p.sqlExcluded && (p.diagnostics.vector === 'used' || p.id === recheck.probes[0].id)));
const checkFile = 'priority-cities/济南/streets-downstream-check-02.json', check = read(checkFile);
assert.deepEqual(check.failures, []); assert.equal(check.entities.length, 4);
assert.ok(check.entities.every(e => e.vector.diagnostics.vector === 'used'));
assert.equal(check.entities.reduce((n, e) => n + e.sql.length, 0), 5);
assert.equal(check.entities.reduce((n, e) => n + e.negativeNames.length, 0), 19);
assert.equal(check.preserved.priorAssignments, 11); assert.equal(check.preserved.factExclusions, 4); assert.equal(check.preserved.pendingMentions, 60);
assert.equal(check.independentLibrary.sourceImages, 123); assert.equal(check.independentLibrary.reviewedCatalogs, 12);
assert.equal(check.independentLibrary.bindings, 9);
const up = read('all-cities/batch-38-upstream-check.json'); assert.deepEqual(up.failures, []);
assert.equal(up.rawSourcesUnchanged, 107); assert.equal(up.originalMentionsUnchanged, 662);
const flow = read('all-cities/flow/run-40/report.json'); assert.deepEqual(flow.failures, []);
assert.equal(read('all-cities/flow/run-40/cleanup.json').removed, true);
const counts = flow.cities.reduce((v, c) => ({ positive: v.positive + c.probes.length, negative: v.negative + c.negativeProbes.length,
  withdrawal: v.withdrawal + c.withdrawalProbes.length }), { positive: 0, negative: 0, withdrawal: 0 });
assert.deepEqual(counts, { positive: 288, negative: 113, withdrawal: 47 });
const audit = read('all-cities/audit/run-36/report.json'); assert.deepEqual(audit.failures, []);
assert.equal(audit.cities.reduce((n, c) => n + (c.statuses.PENDING ?? 0), 0), 240);
const packetFile = 'priority-cities/济南/streets-source-packet-01.json', packet = read(packetFile);
const refreshFile = 'all-cities/jinan-streets-note-refresh-01.json', refresh = read(refreshFile);
assert.ok(refresh.notes.length === 4 && refresh.notes.every(n => n.ok && n.textUnchanged));
const imagesFolder = 'all-cities/jinan-streets-images-02/', manifest = read(imagesFolder + 'manifest.json');
assert.equal(manifest.sourceSnapshot.sha256, hash(refreshFile)); assert.equal(manifest.images.length, 19);
for (const im of manifest.images) { assert.ok(im.ok); assert.equal(hash(imagesFolder + im.file), im.sha256); }
const details = {
  'note-2817-p01.webp': '原路线地图将百花桥放在百花洲以南、后宰门街向西交会水道处；继续南行刘氏泉、起凤桥八号。不是大明湖园内另一同名桥。',
  'note-2817-p09.webp': '画面为老街狭窄水道的短跨石栏桥，文字明确“后宰门街往西走到【百花桥】【曲水亭街】”，并提及涌泉胡同。与geo09老城百花桥参考点相符。',
  'note-2817-p12.webp': '上半图明确刘氏泉石刻，下半图是带“新中餐”招牌及门牌1号的簪花少女餐厅外墙。是相邻但不同对象；不能把该墙等同泉体，也不能把整条混合摄影提及直接改绑餐厅。',
  'note-2817-p13.webp': '上半图明确起凤桥街路牌；下半图为圆形门洞、水道及横跨水道的结构。作者写“打卡起凤桥”，路线导航起凤桥八号；仍不足以界定提及指古桥本体、门洞还是整个摄影构图。',
  'note-2553-p01.webp': '实物蓝色路牌明确起凤桥街及东西走向；街道存在，不因一条来源写小桥流水就并入起凤桥。',
  'note-2570-p04.webp': '拍摄“总得来趟老舍笔下的济南”墙，与同篇西更道街5号说明一致；是沿街机位，不能当整条街的坐标。',
  'note-2570-p10.webp': '簪花少女画、花饰、门墙和新中餐招牌与2817第12页相同，与原文西更道街1号说明互证。仅确认摄影主语与街道联系，不把餐馆或画墙合并进泉体。',
};
const visualFile = 'priority-cities/济南/streets-visual-review-01.json';
write(visualFile, { readOnly: true, sourceRefresh: refreshFile, sourceRefreshSha256: hash(refreshFile), manifestFile: imagesFolder + 'manifest.json',
  manifestSha256: hash(imagesFolder + 'manifest.json'), noteTextsUnchanged: true, downloaded: 19, overviewInspected: 19, individuallyInspected: 7,
  rows: manifest.images.map(im => ({ noteId: Number(im.noteId), page: im.page, imageFile: imagesFolder + im.file, sha256: im.sha256,
    inspection: details[im.file] ? 'individual_image' : 'contact_sheet_overview', observation: details[im.file] ?? '仅作整篇图序与邻近景物概览，不单独据此裁定实体或坐标。' })),
  limitations: '这19张为原笔记取证图，不是产品图库绑定；原图01目录403失败保留。未下载的页码没有声称已看。中新网页正文乱码、search03模型合成回答存在错误，均不用于事实裁定。',
  publicEvidence: [{ url: 'https://news.qq.com/rain/a/20210413A00R8W00', file: 'priority-cities/济南/streets-qq-01.md',
    sha256: hash('priority-cities/济南/streets-qq-01.md'), quote: '起凤桥街是济南老城区的一条东西小巷，东起西更道西至芙蓉街，全长不足百米，却有着一桥两泉。',
    use: '大众日报2021年文章支持街道与桥、两泉分别存在；不据旧报道断定现今门店或精确坐标。' }],
});
const full = new Set(['西更道街', '起凤桥街', '百花桥']);
const conclusions = {
  '西更道街': '完整4提及/3原文及补充图片事实已核，独立60分钟保留；第38批从源泉错点改为同名街道参考点并双同步。两名/旧ID、真实向量、图库与边界通过，AI自查完成。',
  '起凤桥街': '2793明确以街道为条目；实物路牌、媒体报道及同名地图参考点互证。与起凤桥、八号门洞、起凤泉分别保留；实际来源/图库/SQL和向量通过，AI自查完成。',
  '百花桥': '2817第1/9页定位后宰门街向西至曲水亭街的水道桥，匹配老城同名地图点，排除大明湖园内另一候选。唯一提及、现行描述/图库/SQL和向量通过，AI自查完成。',
  '起凤桥': '7提及已读，原图确认至少部分摄影构图包含八号门洞及水道；街道与桥不是同义，现用点对应街道POI。继续核实桥本体与门洞机位及提及分配，不自动采用八号店点或合并街道，未完成自查。',
};
const ledger = read('priority-cities/济南/review-14.json'), reviewed = [];
const evidenceFiles = [packetFile, visualFile, checkFile, 'priority-cities/济南/geo-09.json', 'priority-cities/济南/geo-11.json',
  'priority-cities/济南/streets-location-review-01.json', 'priority-cities/济南/streets-photo-sources-01.json',
  'all-cities/batch-38-applied.json', 'all-cities/batch-38-upstream-check.json', folder + 'verification-vectors.json', folder + 'withdrawal-vectors-recheck-02.json'];
for (const e of check.entities) {
  const row = ledger.rows.find(r => r.entityId === e.entityId); assert.ok(row);
  row.currentRevision = e.revision; row.status = full.has(e.name) ? 'reviewed_identity' : 'pending';
  row.reviewBatch = 38; if (e.name === '西更道街') row.changeBatch = 38;
  row.dimensions = { ...row.dimensions, identity: full.has(e.name) ? 'reviewed_independent_subject' : 'bridge_gate_subject_pending',
    category: full.has(e.name) ? 'reviewed_cultural_street_or_bridge' : 'subject_pending',
    location: e.referenceStatus, media: 'no_upstream_imported_or_independent_images',
    consumedFacts: full.has(e.name) ? 'reviewed_source_subject_attribution' : 'bridge_gate_attribution_pending' };
  row.followup = conclusions[e.name]; row.evidenceFiles = [...new Set([...(row.evidenceFiles ?? []), ...evidenceFiles])];
  reviewed.push({ entityId: e.entityId, name: e.name, revision: e.revision, fullReviewPassed: full.has(e.name),
    mentionIds: packet.groups.find(g => g.entity.entity_id === e.entityId).mentionIds, conclusion: conclusions[e.name], dimensions: row.dimensions });
}
const fullNoteIds = [...new Set([...packet.notes.map(n => n.id), ...packet.supplementalImageFactNotes.map(s => s.note.id)])];
assert.equal(fullNoteIds.length, 14);
write('priority-cities/济南/streets-source-review-01.json', { city: '济南', batch: 38, sourceFile: packetFile, sourceSha256: hash(packetFile),
  fullNotesRead: fullNoteIds, mentionsRead: 13, fullyReviewed: 3, partiallyReviewed: 1, rows: reviewed, evidenceFiles,
  supplementalFinding: { entityName: '刘氏泉', mentionId: 12692, status: 'remain_pending', evidence: visualFile,
    conclusion: '原图同时有泉体标石与餐厅墙；簪花少女可确认是餐厅墙的摄影主体，保持null待审，不将该混合提及整条归泉或猜测新门店实体。' }, userAcceptance: false });
assert.equal(ledger.rows.length, 98);
const fullyReviewed = ledger.rows.filter(r => ['reviewed_identity', 'reviewed_same_entity', 'reviewed_alias_redirect'].includes(r.status)).length;
assert.equal(fullyReviewed, 18);
ledger.createdAt = new Date().toISOString(); ledger.previousLedger = 'priority-cities/济南/review-14.json';
Object.assign(ledger.summary, { fullyReviewed: 18, remainingPrimaryToReview: 76, otherPendingPrimaryRows: 70,
  locationCorrectedAndSynced: 4, reviewedOrdinaryPrimaryRows: 11,
  fullyReviewedMeaning: 'AI自查18原入选行对应16现行主体；本轮新增西更道街、起凤桥街、百花桥，用户未验收。',
  scopeProgressMeaning: '98原入选行保留：4非地点、18行AI自查、76未完成，其中6行部分scope治理，其余70继续。起凤桥桥/门洞仍待核，110范围内审核行不变。' });
write('priority-cities/济南/review-15.json', ledger);
const progress = '第38批西更道街位置从源泉POI改为同名街道参考点，revision3，完整地点/关系双同步及向量核验完成。原4提及、60分钟、107源/662提及/82原文、238旧行/39图片字段/9独立绑定及201历史行程保持。四处5名称SQL、4真实向量、19边界负例通过；趵突泉裸名向量超时经recheck02成功关闭，原失败保留。14篇全文/13提及及19张取证图（7张逐图放大）复核，西更道街、起凤桥街、百花桥AI自查通过；起凤桥桥/门洞及刘氏泉12692继续待核。review15：98项，4非地点、18行AI自查（16主体）、76未完成，其中6行部分scope治理，其余70；原7待定位及教堂位置保留。scope06固定978主体+56依赖/1135源；110待审及4必去缺口不变。flow40为288正例/113边界/47撤回0失败，audit36为240PENDING。实体至38、图片03禁止重放，无待同步步骤。云南不处理，未验收，不提交归档。';
fs.writeFileSync(url('priority-cities/济南/review-15.md'), '# 济南98项重点清单核查台账（第38批后）\n\n' + progress + '\n\n| 原入选名称 | 现行名称 | 版本 | 进度 | 说明 |\n| --- | --- | ---: | --- | --- |\n'
  + ledger.rows.map(r => `| ${r.name} | ${r.currentName ?? r.name} | ${r.currentRevision} | ${r.status} | ${r.followup} |`).join('\n') + '\n', { flag: 'wx' });
write('cleaning-scope/current-before-batch38.json', pointer);
Object.assign(pointer, { latestAppliedEntityBatch: 38, latestFlow: '../all-cities/flow/run-40', latestAudit: '../all-cities/audit/run-36',
  progressNote: progress, progressUpdatedAt: ledger.createdAt, latestReviewEvidence: { file: '../priority-cities/济南/streets-source-review-01.json', fullReviewsAdded: 3, partiallyReviewed: 1 },
  latestReadOnlyFindings: { file: '../priority-cities/济南/streets-visual-review-01.json', bridgeGateBoundaryPending: true, liuPhotoMentionPending: 12692,
    webSearchStatus: 'main_search_available_but_generated_claims_rejected;qq_page_fetched;second_search_timeout',
    noteRefresh: '../all-cities/jinan-streets-note-refresh-01.json', downloadedOriginalImages: 19 } });
pointer.cityReviewLedgers['济南'] = '../priority-cities/济南/review-15.json';
assert.deepEqual(pointer.pendingVerification, []);
pointer.resolvedVerification.push({ batch: 38, city: '济南', entityId: recheck.probes[0].id, name: '趵突泉', kind: 'withdrawal_live_vector',
  reason: 'production_timeout', verifiedByEntityBatch: 38, evidence: '../' + folder + 'withdrawal-vectors-recheck-02.json' });
write('cleaning-scope/current.json', pointer, false);
const task = read('../task.json'); assert.equal(task.status, 'in_progress'); task.notes = progress + '见research/batch38-jinan-streets-20261008.md。'; write('../task.json', task, false);
const prdFile = url('../prd.md'); let prd = fs.readFileSync(prdFile, 'utf8');
const start = prd.indexOf('- 用户最新明确：'), end = prd.indexOf('\n\n', start); assert.ok(start >= 0 && end > start);
prd = prd.slice(0, start) + '- 用户最新明确：**云南不处理，继续其他城市直到验收通过**。九城固定978主体＋56依赖/1135源，110范围内待审及4必去缺口。第38批已双同步，济南18行AI自查、76未完成；云南、89普通长尾和37已隔离错城来源归属不扩入主动范围，未获用户验收。' + prd.slice(end);
fs.writeFileSync(prdFile, prd.replace('## 已知事实\n', '## 已知事实\n\n### 最新进展：第38批西更道街位置与三处自查\n\n' + progress + '见[第38批记录](research/batch38-jinan-streets-20261008.md)。以下为历史快照。\n'));
const resume = url('nine-cities-continuation-20261007.md');
fs.writeFileSync(resume, fs.readFileSync(resume, 'utf8').replace('## 本轮断点\n', '## 本轮断点\n\n当前以review-15为准。' + progress + '下一新flow41/audit37；接续起凤桥桥/门洞和其余济南重点、其他八城。以下为历史断点。\n'));
for (const name of ['implement', 'check']) {
  const f = url(`../${name}.jsonl`), entry = { file: '.trellis/tasks/10-06-place-identity-governance/research/batch38-jinan-streets-20261008.md', reason: '第38批西更道街位置已双同步，三处自查通过；review15剩76项，桥/门洞和刘氏泉照片主体待核，禁止重放' };
  if (!fs.readFileSync(f, 'utf8').includes(entry.file)) fs.appendFileSync(f, JSON.stringify(entry) + '\n');
}
console.log(JSON.stringify({ batch: 38, fullyReviewed: 18, remaining: 76, ledger: 'review-15', counts, pendingVerification: [] }));
