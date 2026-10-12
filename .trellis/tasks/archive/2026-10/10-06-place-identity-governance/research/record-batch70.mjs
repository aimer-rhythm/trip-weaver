// 仅登记已应用并核验的第70批。默认只预检；--apply写台账，不操作业务库、提交或归档。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const url = p => new URL(p, import.meta.url);
const read = p => JSON.parse(fs.readFileSync(url(p), 'utf8'));
const json = value => JSON.stringify(value, null, 2) + '\n';
const hash = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const dir = 'priority-cities/成都/', folder = 'all-cities/batch-70/sync-01/';
const id = '8a433260acdd259716088f8009e0fbdc', at = new Date().toISOString();
const reportFile = 'batch70-chengdu-jinli-20261009.md';
const pointer = read('cleaning-scope/current.json'), before = structuredClone(pointer), task = read('../task.json');
assert.equal(pointer.latestAppliedEntityBatch, 69);
assert.equal(pointer.latestFlow, '../all-cities/flow/run-71');
assert.equal(pointer.latestAudit, '../all-cities/audit/run-68');
assert.deepEqual(pointer.pendingVerification, [{ batch: 70, city: '成都', kind: 'applied_upstream_pending_dual_sync_and_full_verification', evidence: '../all-cities/batch-70-applied.json' }]);
assert.equal(pointer.cityReviewLedgers['成都'], '../' + dir + 'review-06.json');
assert.equal(pointer.cityReviewLedgers['济南'], '../priority-cities/济南/review-45.json');
assert.equal(task.status, 'in_progress'); assert.equal(pointer.taskStatus, 'in_progress');
assert.equal(pointer.userAcceptance, false);
assert.equal(pointer.imageComparisonPolicy.status, 'deferred_by_user');
assert.equal(pointer.mapCredentialGate.status, 'rotation_required');
const frozen = read('cleaning-scope/' + pointer.scopeFile);
assert.equal(hash(url('cleaning-scope/' + pointer.scopeFile)), pointer.scopeSha256);
assert.deepEqual([frozen.selected.length, frozen.dependencies.length, frozen.sourceIds.length], [978, 56, 1135]);
assert.ok(frozen.selected.every(r => r.place.city !== '云南'));
const source = read('all-cities/batch-70-source.json'), scope = read('all-cities/batch-70-scope-decisions.json');
assert.equal(hash(url('all-cities/batch-70-source.json')), '21f57b6b992060060171b5f474872c968443148fc616e62ba79e155386b2c597');
assert.deepEqual([source.sources.length, source.mentions.length, source.noteDetails.length], [2, 43, 28]);
assert.equal(scope.length, 1); assert.equal(scope[0].sourcePlaceId, 1689);
assert.equal(scope[0].assignments.length, 17); assert.equal(scope[0].textWarnings.length, 3);
assert.equal(scope[0].assignments.filter(a => a.entityId === id).length, 16);
assert.deepEqual(scope[0].assignments.filter(a => a.entityId === null).map(a => a.mentionId), [3702]);
assert.equal(read('all-cities/batch-70-decisions.json').length, 1);
for (const kind of ['preview', 'applied']) assert.equal(read(`all-cities/batch-70-${kind}.json`).changes.length, 2);
assert.equal(read('all-cities/batch-70-applied.json').apply, true);
const syncState = read(folder + 'sync-state.json'), sync = syncState.cities['成都'];
for (const k of ['exportedAt', 'importedAt', 'relationsImportedAt', 'embeddingRunAt']) assert.ok(sync[k]);
assert.equal(sync.relationSnapshotRevision, 10);
assert.equal(sync.exportHash, '1aa2c7b74c7e64868511ec8f0a614857a52c11d38a5cd81a41cfe74058f3010f');
assert.equal(sync.relationHash, 'b96811192f45ccbe6efddf38685777ba0cda2beaa66ecf74f9f83ef5715f01e9');
assert.equal(hash(url(folder + 'xhs-places-成都.json')), sync.exportHash);
assert.equal(hash(url(folder + 'xhs-place-relations-成都.json')), sync.relationHash);
for (const [key, file] of [['decisionHash', 'decisions'], ['scopeDecisionHash', 'scope-decisions'], ['expectationsHash', 'export-expectations']]) assert.equal(syncState[key], hash(url(`all-cities/batch-70-${file}.json`)));
const exports = read(folder + 'xhs-places-成都.json'); assert.equal(exports.places.length, 392);
const consumptionFile = folder + 'jinli-consumption-1791515645917.json';
const postFile = folder + 'post-import-check-1791512691144.json';
const dualFile = folder + 'preview-成都/preview-1791512338639.json';
const isolatedFile = 'all-cities/batch-70/scope-preview-1791512008187072400/report.json';
const actual = read(dir + 'jinli-downstream-check-01.json'), inputs = read(dir + 'jinli-inputs-check-01.json');
const consumption = read(consumptionFile), post = read(postFile), dual = read(dualFile), isolated = read(isolatedFile);
const exported = read(dir + 'jinli-export-check-01.json'), vectors = read(folder + 'verification-vectors.json');
const pre = read(folder + 'pre-import-check.json'), delta = read(folder + 'preview-成都/relation-delta.json');
const flow = read('all-cities/flow/run-72/report.json'), audit = read('all-cities/audit/run-69/report.json');
for (const r of [actual, inputs, consumption, post, dual, isolated, exported, vectors, pre, flow, audit]) assert.deepEqual(r.failures, []);
for (const [k, v] of Object.entries({ consumedFieldsVerified: 392, allOtherPlacesPreserved: 391, sqlProbes: 2, boundaryProbes: 21, realVectorProbes: 1, confirmed: 16, pendingAdded: 1, textWarnings: 3, currentEvidence: 18, originalWarningsPreserved: 7, oldOpinionEvidencePreserved: 6, oldValidHighlightsAndDatesPreserved: 3, wrongAreaHighlightRemoved: 1, graph: 49, directEdges: 14, coordinatesCleared: 0, preciseLocationsResolved: 0 })) assert.equal(actual[k], v);
for (const k of ['subareaNameRemoved', 'noTravelInclusiveDurationAdded', 'wuhouAllFieldsPreserved', 'relationChangesExplained', 'oldReviewsPreserved']) assert.equal(actual[k], true);
assert.equal(actual.fullReviewPassed, false);
for (const k of ['actualPlaceFacts', 'allOtherFactsPreserved', 'allOldMediaReturnsPreserved', 'wuhouAllFactsPreserved', 'independentSourceDigestPreserved']) assert.equal(consumption[k], true);
assert.deepEqual(consumption.removedFactNameKeys, []);
assert.deepEqual(consumption.removedComponentIntentNameKeys, ['锦里古街主巷']);
assert.equal(consumption.componentIntentBoundaryProbes, 3); assert.equal(consumption.correctedNameKeys, 2);
assert.equal(consumption.oldCanonicalMediaProbes, 372); assert.equal(consumption.nonEmptyOldMedia.length, 11);
assert.ok(consumption.nonEmptyOldMedia.every(p => p.count === 1));
assert.deepEqual(consumption.oldNameMockEnqueues, { before: 358, after: 357 });
assert.equal(consumption.subareaUnknownNameMockEnqueues, 1); assert.equal(consumption.actualEnqueues, 0);
assert.deepEqual(consumption.targetFactMedia, [
  { name: '武侯祠', galleryCount: 0, hasCover: false, actualLookupPhotos: 0 },
  { name: '锦里', galleryCount: 0, hasCover: false, actualLookupPhotos: 0 },
  { name: '人民公园', galleryCount: 1, hasCover: true, actualLookupPhotos: 0 },
]);
for (const [k, v] of Object.entries({ rawAndDerivedSourcesPreserved: 127, notes: 86, oldAssignmentsPreserved: 47, cityWideAssignmentRows: 64, confirmedAssignmentsAdded: 16, pendingAssignmentsAdded: 1, exactTextWarningsStored: 3, originalMentionsUnchanged: 490 })) assert.equal(inputs[k], v);
for (const k of ['originalSummariesPreserved', 'rawJsonHashesPreserved', 'analysisHashesAndNullPreserved', 'publicationAndCollectionTimesPreserved', 'noteTextStatusAndSourceUrlsPreserved', 'wuhouNoScope', 'relationChangesExplained']) assert.equal(inputs[k], true);
assert.equal(inputs.nullAnalysisNotes.length, 8);
assert.deepEqual(inputs.relationAmbiguities, [{ mentionId: 3961, noteId: 884, reason: 'ambiguous_text_occurrence', positions: 2 }, { mentionId: 4155, noteId: 912, reason: 'ambiguous_text_occurrence', positions: 2 }, { mentionId: 4209, noteId: 950, reason: 'ambiguous_text_occurrence', positions: 2 }]);
assert.ok(pre.cities[0].unchangedSincePreview); assert.ok(Date.parse(pre.at) < Date.parse(sync.importedAt));
for (const [k, v] of Object.entries({ oldRowsPreserved: 411, photoFieldsPreserved: 130, independentPhotos: 0, untouchedRetained: 5 })) assert.equal(post.cities[0][k], v);
assert.deepEqual(post.trips, pre.trips); assert.deepEqual(post.trips, { count: 201, digest: 'e01d67cbf42a62fc595f4ef052f99e75' });
for (const k of ['idempotent', 'reverseRollback', 'originalSourcesAndMentionsUnchanged', 'sourceDatesAndAnalysisUnchanged', 'noTravelInclusiveDurationAdded', 'wuhouAllConsumedFieldsPreserved', 'parentHasNoUnreviewedSubareaNames']) assert.equal(isolated[k], true);
assert.deepEqual([isolated.sources, isolated.mentions, isolated.fullNotes, isolated.scopeChanges, isolated.typeChanges, isolated.assignmentChanges, isolated.newEntities, isolated.withdrawals, isolated.totalWarningEvidence], [2, 43, 28, 1, 1, 17, 0, 0, 10]);
assert.ok(dual.reverseRollback && dual.oldRowsPreserved && dual.photosPreserved);
assert.deepEqual([delta.before, delta.after, delta.directBefore, delta.directAfter, delta.changed.length, delta.removed.length], [49, 49, 15, 14, 1, 0]);
assert.deepEqual(delta.changed[0].evidence.map(e => e.noteId), [945]);
const stats = { positive: flow.cities.reduce((n, c) => n + c.probes.length, 0), boundaries: flow.cities.reduce((n, c) => n + c.negativeProbes.length, 0), withdrawals: flow.cities.reduce((n, c) => n + c.withdrawalProbes.length, 0), pending: audit.cities.reduce((n, c) => n + (c.statuses.PENDING ?? 0), 0) };
assert.deepEqual(stats, { positive: 339, boundaries: 113, withdrawals: 52, pending: 314 });
assert.equal(read('all-cities/flow/run-72/cleanup.json').removed, true);
assert.equal(audit.sha256, '060b9922aa4d5376e54f7f325eefddf947a4e65374c33412da270a6e74e2228a');
assert.equal(hash(url('all-cities/audit/run-69/report.json')), '1d0b7b0b2eca13181bfc1a3e028db6e34469d3b228a41127f4680c66d6e8e7ba');
assert.match(fs.readFileSync(url('upstream-full-place_identity_test_1791511771084.log'), 'utf8'), /752 passed, 1 deselected/);
for (const log of ['upstream-stage-place_identity_test_1791511723510.log', 'upstream-installed-place_identity_test_1791512005091.log']) assert.match(fs.readFileSync(url(log), 'utf8'), /2 passed/);
assert.match(fs.readFileSync(url('downstream-place_identity_test_1791515632298.log'), 'utf8'), /pass 1/);
const install = read('upstream-install.json'); assert.equal(install.files.length, 66);
for (const f of install.files) for (const path of [url('upstream/' + f.path), 'D:/Project/xhs-travel-pipeline/' + f.path]) assert.equal(hash(path), f.after);
assert.deepEqual(install.files.filter(f => f.before !== f.after).map(f => f.path).sort(), ['app/clean/place_export.py', 'tests/test_place_identity.py', 'tests/test_planning_exclusion_db.py']);
const ledger = read(dir + 'review-06.json'), oldLedger = structuredClone(ledger), target = ledger.rows.find(r => r.entityId === id);
assert.equal(target.currentRevision, 1); assert.equal(target.status, 'pending');
Object.assign(target, { currentRevision: 3, status: 'reviewed_scope_partial', currentCategory: '文化', currentPlaceType: 'market', reviewBatch: 70, changeBatch: 70, textReviewBatch: 70,
  dimensions: { ...target.dimensions, identity: 'reviewed_sixteen_mentions_subarea_pending', category: 'reviewed_market_culture', consumedFacts: 'reviewed_original_opinions_preserved_independent_duration_unknown' },
  confirmedMentions: 16, pendingMentions: 1, pendingMentionIds: [3702], supplementalNoteIds: [948], textWarnings: 3,
  reviewEvidence: [dir + 'jinli-source-review-01.json', dir + 'jinli-downstream-check-01.json', dir + 'jinli-inputs-check-01.json', consumptionFile, isolatedFile],
  followup: '第70批16确认/主巷3702待审，住宿片区reason/evidence和含打车75分钟正式排除；3原评价、7原负评、6旧观点语料及3有效看点日期保全，现18语料。细类market、文化粗类与旧点保持；主巷退出子项检索，未新增别名或主巷实体。原价/预约片段留在历史原文，当前政策未新核，独立时长未知；定位和媒体待核。' });
for (let i = 0; i < ledger.rows.length; i++) if (ledger.rows[i].entityId !== id) assert.deepEqual(ledger.rows[i], oldLedger.rows[i]);
assert.deepEqual(ledger.dependencyRows, oldLedger.dependencyRows);
assert.deepEqual(ledger.rows.map(r => [r.entityId, r.name]).sort(), frozen.selected.filter(r => r.place.city === '成都').map(r => [r.place.id, r.place.name]).sort());
assert.equal(ledger.rows.filter(r => r.status === 'pending').length, 104);
assert.equal(ledger.rows.filter(r => r.status === 'reviewed_scope_partial').length, 4);
ledger.createdAt = at; ledger.previousLedger = dir + 'review-06.json';
Object.assign(ledger.summary, { partiallyReviewedScopeRows: 4, otherPendingPrimaryRows: 104, governedScopeMentions: 25, pendingScopeMentions: 1, cityWideAssignmentRowsAfterBatch: 64,
  fullyReviewedMeaning: '113固定主体及3依赖不变，0完整自查、113未完成：4部分scope、4位置部分、1类别部分、104其余。',
  cityWideAssignmentMeaning: '初始39分配，第66批增加2、第69批增加6、第70批增加17，共64；不等于完整复核113主体。' });
const progress = '第70批锦里已完成真实来源预演、正式应用及双同步：17提及16确认/主巷1待审，住宿片区2字段与含交通75分钟排除；3原评价逐字保全，7原负评、6旧观点语料、3有效看点日期保持，现18语料/10警示。细类attraction改market，文化粗类、原名/根ID/旧点保持；revision1→3，既有别名补登记兼容ID。受控v2组合仅用当前合同memberNames，不放宽名称排除门禁，不作主巷excludeNames；普通facts前后均无主巷，删除的是includeComponents检索入口。上游66文件中3变更、无迁移，752通过/1真实地图检查排除，暂存/已安装专项各2通过。392地点/49关系版本10双同步，2SQL/1真实向量/21普通边界和3子项边界通过；武侯祠原网页及全部消费保持。武侯祠—锦里因884/912/950各有两个同名位置，仅保留945关系证据，direct15→14。127源/490提及/86笔记原文日期分析保持，47旧分配加17为64；411旧行/130旧图片字段/201行程保持，130不代表新增3图。372主名实际图库返回全等、11处各1图，mock358→357、主巷额外mock1、真实队列0。全仓/扩展typecheck通过；flow72为339正例/113边界/52撤回零失败，audit69为314PENDING。成都review07仍0完整/113未完成（4部分scope、4位置部分、1类别部分、104其余），济南review45保持。184范围待审=50固定实体对＋济南133提及＋成都主巷1，原成都39提及按历史分类；4必去缺口、978＋56/1135固定范围不变。锦里发现已部分解决，主巷仍待审，另5项发现未应用。实体70/元数据01/图片03，无待同步验证；图片暂缓、地图凭据待轮换、未验收不提交归档。';
Object.assign(pointer, { latestAppliedEntityBatch: 70, latestFlow: '../all-cities/flow/run-72', latestAudit: '../all-cities/audit/run-69', pendingVerification: [], progressNote: progress, progressUpdatedAt: at,
  latestReviewEvidence: { city: '成都', file: '../' + dir + 'jinli-downstream-check-01.json', supplement: '../' + dir + 'jinli-source-review-01.json', fullReviewsAdded: 0, partiallyReviewedScope: 1, fullReviewsReopened: 0 } });
pointer.cityReviewLedgers['成都'] = '../' + dir + 'review-07.json';
assert.deepEqual([pointer.currentScopeReviews.currentReviewRows, pointer.currentScopeReviews.addedPendingMentions], [183, 133]);
Object.assign(pointer.currentScopeReviews, { currentReviewRows: 184, addedPendingMentions: 134, meaning: '50固定重点实体对＋济南133提及待审＋成都主巷3702待审1，共184；成都既有39提及待审仍按原台账分类。4必去缺口保持。' });
pointer.currentScopeReviews.evidence.push('../' + dir + 'jinli-source-review-01.json');
assert.equal(pointer.unappliedFindings.length, 6); assert.equal(pointer.unappliedFindings.filter(f => f.entityId === id).length, 1);
pointer.unappliedFindings = pointer.unappliedFindings.filter(f => f.entityId !== id); assert.equal(pointer.unappliedFindings.length, 5);
pointer.resolvedFindings.push({ entityId: id, name: '锦里', status: 'resolved_scope_facts_and_planning_boundary_batch70_subarea_location_media_pending', resolvedByEntityBatch: 70, evidence: '../' + dir + 'jinli-downstream-check-01.json', confirmed: 16, pending: 1, pendingMentionIds: [3702], textWarnings: 3, scopeChanged: true, coordinatesCleared: false, preciseLocationResolved: false, fullReviewPassed: false });
pointer.latestPlanningNameProtocol = { entityBatch: 70, kind: 'scoped_v2_complex_contract_names_only', installedFiles: 66, changedFiles: 3, migration: null, design: '../planning-excluded-names-design-20261009.md', tests: '../upstream-full-place_identity_test_1791511771084.log', installedTests: '../upstream-installed-place_identity_test_1791512005091.log', realSourcePreview: '../' + isolatedFile, actualConsumer: '../' + consumptionFile, pendingNameExclusionProtectionPreserved: true };
for (const key of ['summary', 'scopeSha256', 'inputSha256', 'policy', 'latestIndependentPhotoBatch', 'latestMetadataRefresh', 'cityMetadataRefreshes', 'unappliedMetadataFindings', 'resolvedMetadataFindings', 'latestNoteTextWarningProtocol', 'mapCredentialGate', 'imageComparisonPolicy']) assert.deepEqual(pointer[key], before[key]);
assert.equal(pointer.cityReviewLedgers['济南'], before.cityReviewLedgers['济南']);
task.notes = progress + '见research/' + reportFile + '。';
const quality = { batch: 70, at, stats, rootTypecheck: { passed: true, terminalSession: 47545, provenance: '前一连续会话实际命令退出0，本次未重复运行' }, extendedTypecheck: { passed: true, terminalSession: 6931, provenance: '最终consumer修正后实际命令退出0，本次未重复运行' }, installedManifestHashesVerified: 66, installedFilesChanged: 3, upstreamTests: { passed: 752, deselected: 1 }, stagedPlanningTests: 2, installedPlanningTests: 2, newMigration: false,
  sourceFile: 'all-cities/batch-70-source.json', sourceSha256: hash(url('all-cities/batch-70-source.json')), exportSha256: sync.exportHash, relationSha256: sync.relationHash,
  consumptionFile, postFile, dualFile, isolatedFile, inputsFile: dir + 'jinli-inputs-check-01.json', actualConsumptionTestPassed: true, reverseRollback: true, scopesAdded: 1, assignmentsAdded: 17, confirmedAdded: 16, pendingAdded: 1, categoryChanges: 1, coordinatesCleared: 0, preciseLocationsResolved: 0,
  chengdu: { primary: 113, dependencies: 3, fullyReviewed: 0, remaining: 113, partialScope: 4, partialLocation: 4, partialCategory: 1, otherPending: 104, governedScopeMentions: 25, pendingScopeMentions: 1, cityWideAssignments: 64 }, jinanLedgerPreserved: 'review-45', currentScopeReviewRows: 184, unappliedFindings: 5, oldCanonicalMediaProbes: 372, targetFactMedia: consumption.targetFactMedia, removedFactNameKeys: [], removedComponentIntentNameKeys: ['锦里古街主巷'], oldNameMockEnqueues: consumption.oldNameMockEnqueues, subareaUnknownNameMockEnqueues: 1, actualEnqueues: 0, fullReviewPassed: false, imageComparison: 'deferred_by_user', mapCredentialStatus: 'rotation_required', userAcceptance: false, failures: [] };
const report = `# 第70批：锦里范围、原评价与组合名称边界\n\n${progress}\n\n## 可核对的变化\n\n| 项目 | 治理前 | 治理后 |\n| --- | --- | --- |\n| 原主体名/稳定根ID | 锦里 / ${id} | 保持 |\n| 有效提及 | 17 | 16，主巷3702单独待审 |\n| 类别 | 文化 / attraction | 文化 / market |\n| 看点 | 含住宿片区错误看点 | 保全3条有效看点及日期，排除1条住宿片区看点 |\n| 原观点 | 7条负评、6条旧观点语料 | 全部保留，补3条完整原评价，现18语料/10警示 |\n| 独立停留时长 | 无 | 仍无；4061含打车75分钟不能新增为独立时长 |\n| 主巷入口 | 普通facts已无，includeComponents仍能借母项检索 | 三种子项名称/ID入口均退出；原名及提及保留待审 |\n| 武侯祠—锦里关系 | 4篇证据，direct | 945一篇、weak；总关系仍49 |\n\n[来源逐项审阅](${dir}jinli-source-review-01.json)保持prepared历史状态；正式应用及最终结果以[本批核验](${dir}jinli-final-verification-01.json)为准。3822住宿片区reason与evidence_text按subject_mismatch排除，4061按group_duration排除分钟，不删原文或作者意见。3条补充评价为910/image5、902/image5、948/image2整段原句；948保留编号、评分、换行及全部观点。936额外段落只保存在原分析，未剪成新警示，也未声称全文新增消费。\n\n[组合名称设计](planning-excluded-names-design-20261009.md)对已有mentionSources的v2组合使用当前合同memberNames，未受控v2保留原行为并过滤已有排除名，v1保持。禁止假确认主巷、放宽validate_name_exclusions或借静态planning补回待审子项。此次未提交excludeNames、未新增实体、未改原名/根ID或坐标；现有锦里古街别名补登记合法兼容hash ID。\n\n[关系原输入核对](${dir}jinli-inputs-check-01.json)实测884/3961、912/4155、950/4209各有两个同名位置，按既有ambiguous_text_occurrence退出关系证据。观点语料均保留。武侯祠全部字段、旧web profile与未治理150分钟保持，不能把关系降级归因于主巷待审删三条边。\n\n## 验证与保全\n\n[真实2源43提及/28全文重建](${isolatedFile})、正式事务预演、[全城双导入预演](${dualFile})均通过，含幂等和逆序回滚。[全城导出](${dir}jinli-export-check-01.json)392地点符合预期，391其他地点逐字段保持；[实库检查](${dir}jinli-downstream-check-01.json)2SQL、1真实向量、21常规边界通过。[实际facts与图库消费](${consumptionFile})另核3个includeComponents边界、372原主名图库实际返回，以及锦里两名称键预期的type/recommendScore/mentionCount/themes变化；其他facts保持。\n\n[输入保全](${dir}jinli-inputs-check-01.json)覆盖127原始及派生源、490提及、85旧笔记加补充948共86篇的原文、raw_json、日期与analysis空值形态；旧47分配加17为64。[同步后核验](${postFile})411旧行、130旧媒体字段、0独立绑定、201行程保持。130媒体字段包含前批茶社空字段，不能解释为新增照片。实际11处各1图返回全等，武侯祠/锦里facts和lookup无图，人民公园facts旧1图和封面保留、专用lookup仍空。mock358→357只停止锦里补图，未知主巷另计mock1，真实队列0；没有查看图片。\n\n上游全套752通过/1真实地图项排除，暂存和已安装规划专项各2通过；安装清单66文件散列与上游逐一相同，本次3文件变更，无迁移。全仓typecheck会话47545、最终扩展typecheck会话6931均已退出0。[flow72](all-cities/flow/run-72/report.json)339正例/113边界/52撤回零失败，临时库已清理；[audit69](all-cities/audit/run-69/report.json)314PENDING，其中成都47=7实体对＋40提及。失败预演与验证日志保留：待审名不能排除、合成变体复用change_key、误以为普通facts曾含主巷；均修正方案或夹具后重新通过，未放松业务边界。\n\n## 续作断点\n\n当前实体70/flow72/audit69，成都review07、济南review45，无待同步项。下一实体71/flow73/audit70，成都下一review08；不得重放第70批、旧编号协议登记或应用导入。成都完整自查仍0；5项未应用发现包括原济南3项、人民公园和武侯祠，锦里主巷转正式待审而非完整解决。下一步优先处理武侯祠web profile审阅绑定与事实排除，现有profile保全机制尚未应用，不直接改缓存，也不把冲突网页口径拼为现行政策。978＋56/1135固定范围、4必去缺口及图片暂缓政策保持，未验收不提交归档。\n\n来源SHA：${quality.sourceSha256}。导出SHA：${sync.exportHash}。关系SHA：${sync.relationHash}。\n`;
const prd = fs.readFileSync(url('../prd.md'), 'utf8'), continuation = fs.readFileSync(url('nine-cities-continuation-20261007.md'), 'utf8');
const range = /^- 用户最新明确：\*\*云南不处理，继续其他城市直到验收通过\*\*。[^\n]*$/m; assert.ok(range.test(prd));
const nextPrd = prd.replace(range, '- 用户最新明确：**云南不处理，继续其他城市直到验收通过**。九城固定978主体＋56依赖/1135源，184范围待审及4必去缺口。第70批锦里16确认/主巷1待审、3原评价保全，组合检索边界已修正；剩5项未应用发现。成都review07仍113未完成（4部分scope、4位置部分、1类别部分、104其余），济南review45仍76未完成。图片暂缓、地图凭据待轮换，未获用户验收。').replace('## 已知事实\n', '## 已知事实\n\n### 最新进展：第70批锦里范围与组合名称边界\n\n' + progress + '见[第70批记录](research/' + reportFile + ')。以下为历史快照。\n');
const nextContinuation = continuation.replace('## 本轮断点\n', '## 本轮断点\n\n当前实体70/flow72/audit69；成都review07、济南review45。' + progress + '下一实体71/flow73/audit70，成都下一review08，不重放70。见[' + reportFile + '](' + reportFile + ')。以下为历史断点。\n');
assert.notEqual(nextPrd, prd); assert.notEqual(nextContinuation, continuation);
const fresh = new Map([['cleaning-scope/current-before-batch70-record.json', json(before)], [reportFile, report], [dir + 'review-07.json', json(ledger)], [dir + 'review-07.md', '# 成都113项重点台账（第70批）\n\n' + progress + '\n\n| 原名称 | 当前名称 | 版本 | 进度 | 说明 |\n| --- | --- | ---: | --- | --- |\n' + ledger.rows.map(r => `| ${r.name} | ${r.currentName} | ${r.currentRevision} | ${r.status} | ${r.followup} |`).join('\n') + '\n'], [dir + 'jinli-final-verification-01.json', json(quality)]]);
for (const p of fresh.keys()) assert.ok(!fs.existsSync(url(p)), p + '已存在，禁止重放');
assert.ok(fs.readFileSync(new URL('../../../spec/server/backend/place-identity.md', import.meta.url), 'utf8').includes('## 60.'));
const replacements = new Map([['../task.json', json(task)], ['../prd.md', nextPrd], ['nine-cities-continuation-20261007.md', nextContinuation]]);
for (const kind of ['implement', 'check']) {
  const p = `../${kind}.jsonl`, original = fs.readFileSync(url(p), 'utf8');
  assert.equal(original.trim().split('\n').length, kind === 'implement' ? 57 : 56);
  const entries = [{ file: '.trellis/tasks/10-06-place-identity-governance/research/' + reportFile, reason: '第70批锦里完整scope与组合入口修正已双同步；review07/flow72/audit69，不重放、不看图、未验收不提交归档' }, { file: '.trellis/tasks/10-06-place-identity-governance/research/planning-excluded-names-design-20261009.md', reason: '受控v2组合仅用当前合同名称；保持待审名排除门禁、v1兼容及普通facts与子项检索入口区别' }];
  for (const entry of entries) assert.ok(!original.includes(entry.file));
  replacements.set(p, original.trimEnd() + '\n' + entries.map(e => JSON.stringify(e) + '\n').join(''));
}
if (process.argv.includes('--apply')) {
  for (const [p, value] of fresh) fs.writeFileSync(url(p), value, { flag: 'wx' });
  for (const [p, value] of replacements) fs.writeFileSync(url(p), value);
  fs.writeFileSync(url('cleaning-scope/current.json'), json(pointer));
}
console.log(JSON.stringify({ apply: process.argv.includes('--apply'), batch: 70, ledger: 'review-07', installedHashes: 66, stats, currentScopeReviewRows: 184, unappliedFindings: 5, pendingVerification: [], userAcceptance: false }));
