// 保存本轮实图与真实抽取复现；未应用治理，不能增加完整自查数。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const url = f => new URL(f, import.meta.url);
const read = f => JSON.parse(fs.readFileSync(url(f), 'utf8'));
const hash = f => createHash('sha256').update(fs.readFileSync(url(f))).digest('hex');
const write = (f, v, exclusive = true) => fs.writeFileSync(url(f), JSON.stringify(v, null, 2) + '\n', { flag: exclusive ? 'wx' : 'w' });
const dir = 'priority-cities/济南/';
const pointer = read('cleaning-scope/current.json');
assert.equal(pointer.latestAppliedEntityBatch, 38);
assert.equal(pointer.cityReviewLedgers['济南'], '../' + dir + 'review-15.json');
assert.equal(pointer.userAcceptance, false);
assert.deepEqual(pointer.pendingVerification, []);
assert.equal(hash('cleaning-scope/' + pointer.scopeFile), pointer.scopeSha256);
const bridge = read(dir + 'bridge-source-packet-01.json');
const outer = read(dir + 'outer-source-packet-01.json');
const actual = read(dir + 'outer-findings-check-01.json');
assert.deepEqual(actual.failures, []);
assert.equal(actual.verifiedMentionCount, 14);
assert.equal(actual.durationReproduction.length, 2);
assert.equal(actual.trips.digest, 'e01d67cbf42a62fc595f4ef052f99e75');
const refresh = read('all-cities/jinan-bridge-note-refresh-01.json');
assert.equal(refresh.notes.length, 4);
assert.ok(refresh.notes.every(n => n.ok && n.textUnchanged));
const details = {
  'jinan-bridge-images-01/note-2570-p08.webp': '正文明确14:30–15:00起凤桥八号（p8），原图为圆形门洞和水道；旁有起凤桥介绍牌。30分钟是该处独立拍照时段，不是组合时长。',
  'jinan-bridge-images-01/note-2618-p01.webp': '四宫格为超然楼、泉标、解放阁等，不能单据该封面识别桥体或门洞。',
  'jinan-bridge-images-01/note-2618-p02.webp': '作者把夜间圆形门洞照片与起凤桥八号标签直接连接；正文小标题起凤桥、导航八号相互对应。',
  'jinan-bridge-images-02/note-2800-p02.webp': '与2570第8页同一圆形门洞：双龙屋脊、右上红色脱落墙面、起凤桥介绍牌和水道侧墙一致。既有图片分析的月波文字不能据此当作另一个桥名。',
  'jinan-bridge-images-02/note-2813-p09.webp': '同一门洞、桥栏和介绍牌；左侧门牌清楚写起凤桥街8号。原文以起凤桥为拍照点，能确认该摄影场景，不能据此将整个8号院或经营主体认领为桥。',
  'jinan-bridge-images-02/note-2624-p15.webp': '原文起风桥错字所配照片为同一门洞，左侧8号门牌、右侧起凤桥介绍牌与泉巷牌一致。补齐此前只有路线文字的来源证据。',
};
const imageRows = [];
for (const folder of ['jinan-bridge-images-01', 'jinan-bridge-images-02']) {
  const prefix = 'all-cities/' + folder + '/';
  const manifest = read(prefix + 'manifest.json');
  assert.equal(manifest.sourceSnapshot.sha256, hash('all-cities/' + manifest.sourceSnapshot.file));
  for (const im of manifest.images) {
    assert.ok(im.ok); assert.equal(hash(prefix + im.file), im.sha256);
    const observation = details[folder + '/' + im.file];
    imageRows.push({ noteId: Number(im.noteId), page: im.page, file: prefix + im.file, sha256: im.sha256,
      inspection: observation ? 'individual_image' : 'contact_sheet_overview',
      observation: observation ?? '仅用于整篇图序和取景概览，不能据缩略图单独作实体或坐标裁定。' });
  }
}
assert.equal(imageRows.length, 51);
assert.equal(imageRows.filter(r => r.inspection === 'individual_image').length, 6);
const reused = 'all-cities/jinan-streets-images-02/note-2817-p13.webp';
const visualFile = dir + 'bridge-visual-review-01.json';
const mentionExplanations = {
  11437: '2618正文导航八号，p2照片标注八号，支持门洞拍照场景；桥本体与机位的身份边界仍须区分。',
  12714: '同2618的另一提取记录；不能把重复提取视为两篇独立证据。',
  11626: '2624正文写起风桥，p15可确认拍到同一8号门牌旁门洞；古桥描述与摄影背景的实体范围尚不能只靠同场景判等。',
  12920: '同2624的另一提取记录，照片补证有效，不能增加独立来源数。',
  12585: '2813 p9明确同一门洞及8号门牌，拍照描述有对应实景；影视取景说法仅保留原文弱证据，不以百科合成叙述升级。',
  12693: '2817 p1导航八号、p13起凤桥标签与同门洞对应。桥、门洞、街道和8号院的物理范围不能因路线点相同而整体合并。',
  12841: '2800 p2–6展示同一门洞，原文人多改拍西侧灯笼亭子是替代机位提示；不能吞入灯笼亭子，也不能把照片都说成拍于该亭。',
  11458: '2570正文14:30–15:00、p8门洞均明确；30分钟属于单独摄影时段，保留；没有茶馆消费或住宿主体。',
  12724: '同2570重复提取，保留原提及，不把两个30分钟累加为60分钟。',
};
write(visualFile, { readOnly: true, sourceFile: dir + 'bridge-source-packet-01.json', sourceSha256: hash(dir + 'bridge-source-packet-01.json'),
  downloaded: 51, contactSheetOverview: 48, individuallyInspectedNewFiles: 6, rows: imageRows,
  reusedIndividualImages: [{ file: reused, sha256: hash(reused), observation: '再次放大核对；上半是街道路牌，下半是门洞、水道及短跨石栏结构，桥体和摄影背景是可区分对象。' }],
  mediaBoundary: '取证原图未加入产品图库，不新增图片绑定；完整主体自查数不变。',
  publicEvidence: [{ file: dir + 'bridge-sina-01.md', sha256: hash(dir + 'bridge-sina-01.md'),
    url: 'https://www.sina.cn/news/detail/5075037528785326.html', quote: '起凤桥#济南·起凤桥八号[地点]#',
    use: '2024摄影帖显示桥名与八号定位标签同用；只能作定位用法旁证，不能认定桥体、门洞和院内经营主体全部同义。' },
    { file: dir + 'bridge-baike-01.md', sha256: hash(dir + 'bridge-baike-01.md'),
      use: '仅供发现来源链接；方位与大众日报报道相反，影视与跨地区内容混杂，不作精确定位或合并依据。' }],
  searchResults: ['search-streets-05.json', 'search-streets-06.json', 'search-streets-07.json', 'search-streets-08.json'].map(f => {
    const r = read(dir + f); return { file: dir + f, sha256: hash(dir + f), ok: r.ok, error: r.error,
      use: r.ok ? '仅使用候选来源再fetch；生成content只是检索意图，不作事实' : '超时终态保留，不重放覆盖' };
  }),
});
const bridgeFile = dir + 'bridge-source-review-01.json';
write(bridgeFile, { readOnly: true, reviewedAt: new Date().toISOString(), sourceFile: dir + 'bridge-source-packet-01.json',
  sourceSha256: hash(dir + 'bridge-source-packet-01.json'), visualFile,
  fullNoteIdsRead: [...new Set([...bridge.notes.map(n => n.id), ...bridge.supplementalImageFactNotes.map(n => n.note.id)])].sort((a,b) => a-b),
  mentions: bridge.mentions.map(m => ({ mentionId: m.id, noteId: m.raw_note_id, inputHash: m.inputHash, explanation: mentionExplanations[m.id] })),
  conclusion: '门洞摄影场景已由六篇直接原文及实图互证，8号门牌可见；桥体、门洞与8号院身份边界仍待审，不整组合并、不新建月波桥、不改变七条起凤桥提及分配。',
  fullReviewPassed: false, userAcceptance: false });
const outerFile = dir + 'outer-source-review-01.json';
const findings = [
  { entityId: '29f4a4b260878eb8d9143b15b8fca54f', name: '灵岩寺', sourceId: 5475, mentionIds: [11686],
    status: 'confirmed_bad_derived_duration_unapplied', quote: actual.durationReproduction[0].sentence,
    conclusion: '唯一提及无时长，但旧图片正文和摘要各把半天不够/不建议安排提炼为180分钟。上下游实库均为180，须清理派生时长并保护有效主体；不能把劝退条件解释成推荐游览时长。',
    next: '修复build_visit_duration在截窗前丢失否定/行程预算语义的问题，保留阳性时长回归；存量可按完整scope保留11686并仅消费已确认提及，清旧180分钟。需隔离幂等/倒序回滚、正式应用与完整双同步。' },
  { entityId: '69b816cda273f29ed9296314fbe6f52d', name: '明水古城', sourceId: 5481, mentionIds: [11508,12581,12786],
    status: 'consumed_fact_attribution_needs_review',
    quote: '济南是一座“慢得恰好”的城市——泉水泡茶可品闲适，登高怀古可抒豪情，市井烟火中藏着千年文脉。',
    conclusion: '2616标题和2798章丘条目明确主体；12581取整座济南的概述作单点看点，已进入下游intro。需复核字段范围，不能只确认提及了古城就宣布事实正确；地图裸名暂无结果，不能直接判定地点不存在。' },
  { entityId: 'abc624edea07111dc19aa79dfbb18289', name: '济南野生动物园', sourceId: 5974, mentionIds: [12787],
    status: 'location_and_shortened_description_pending',
    conclusion: '2798原文明写野生动物园，现行intro却简称济南动物园；地图同时返回章丘野生动物世界与天桥区济南动物园，不能授予彼此别名。现坐标与野生动物世界候选不同，尚未证明错点，不按差距自动修改。' },
];
write(outerFile, { readOnly: true, sourceFile: dir + 'outer-source-packet-01.json', sourceSha256: hash(dir + 'outer-source-packet-01.json'),
  fullNoteIdsRead: outer.notes.map(n => n.id).sort((a,b) => a-b), mentionsRead: 5, findings,
  actualCheck: dir + 'outer-findings-check-01.json', fullReviewPassed: false, applied: false, userAcceptance: false });
const ledger = read(dir + 'review-15.json');
const originalIds = ledger.rows.map(r => r.entityId);
for (const g of bridge.groups) {
  const row = ledger.rows.find(r => r.entityId === g.entity.entity_id); assert.ok(row);
  row.dimensions = { ...row.dimensions, identity: 'bridge_gate_courtyard_boundary_pending',
    location: g.entity.canonical_name === '起凤桥八号' ? 'gate_at_number8_visually_confirmed_reference_only' : 'current_point_is_street_poi_bridge_point_pending',
    media: 'no_upstream_imported_or_independent_images' };
  row.followup = '六篇直接来源原图已补齐门洞场景，8号门牌和起凤桥介绍牌可见；桥面、门洞、八号院不能整组判等。保持现行身份，后续逐提及明确摄影对象与桥体归属；未完成自查。';
  row.evidenceFiles = [...new Set([...(row.evidenceFiles ?? []), bridgeFile, visualFile, dir + 'bridge-photo-sources-01.json', dir + 'geo-12.json'])];
}
for (const finding of findings) {
  const row = ledger.rows.find(r => r.entityId === finding.entityId); assert.ok(row);
  row.followup = finding.conclusion;
  row.dimensions = { ...row.dimensions, consumedFacts: finding.status, media: 'no_upstream_imported_or_independent_images' };
  row.evidenceFiles = [...new Set([...(row.evidenceFiles ?? []), outerFile, dir + 'outer-findings-check-01.json', dir + 'outer-photo-sources-01.json', dir + 'geo-13.json'])];
}
assert.deepEqual(ledger.rows.map(r => r.entityId), originalIds);
assert.equal(ledger.rows.length, 98);
assert.equal(ledger.summary.fullyReviewed, 18);
assert.equal(ledger.summary.remainingPrimaryToReview, 76);
ledger.createdAt = new Date().toISOString(); ledger.previousLedger = dir + 'review-15.json';
ledger.summary.unappliedSemanticFindings = 1;
write(dir + 'review-16.json', ledger);
const progress = '桥/八号9提及、去重10篇全文已核，新增51张原图取证（48图概览、6张单独放大，另复看旧1张）；门洞在8号门牌旁已互证，桥/门洞/院落仍不整组合并。另核灵岩寺、明水古城、济南野生动物园5提及/4原文；真实复现灵岩寺半天不够/不建议安排被截窗抽成180分钟，上下游均存在，尚未修复。明水古城12581整城概述误归属疑点、动物园简称和位置待核。review16仍98项：4非地点、18行AI自查（16主体）、76未完成，其中6行部分scope治理；新增1项确定的派生时长问题未应用。实体至38、图片03，flow40/audit36及110正式待审、4必去缺口保持，无batch39或未同步步骤。14提及与201历史行程实库只读核验通过。云南不处理，未验收，不提交归档。';
fs.writeFileSync(url(dir + 'review-16.md'), '# 济南98项重点清单核查台账（桥与外围景点补查）\n\n' + progress + '\n\n| 原入选名称 | 版本 | 进度 | 说明 |\n| --- | ---: | --- | --- |\n' + ledger.rows.map(r => `| ${r.name} | ${r.currentRevision} | ${r.status} | ${r.followup} |`).join('\n') + '\n', {flag:'wx'});
write('cleaning-scope/current-before-bridge-outer-review.json', pointer);
pointer.cityReviewLedgers['济南'] = '../' + dir + 'review-16.json';
pointer.progressNote = progress; pointer.progressUpdatedAt = ledger.createdAt;
pointer.latestReviewEvidence = {file: '../' + outerFile, fullReviewsAdded: 0, partiallyReviewed: 5};
pointer.latestReadOnlyFindings = {file: '../' + bridgeFile, outerFile: '../' + outerFile,
  bridgeGateBoundaryPending: true, liuPhotoMentionPending: 12692,
  noteRefresh: '../all-cities/jinan-bridge-note-refresh-01.json', downloadedOriginalImages: 51,
  webSearchStatus: 'search07_stream_returned_links_and_sina_fetched;search05_06_08_timed_out;reference04_12_fetch_failed'};
pointer.unappliedFindings = [{...findings[0], evidence: '../' + dir + 'outer-findings-check-01.json'}];
write('cleaning-scope/current.json', pointer, false);
const task = read('../task.json'); assert.equal(task.status, 'in_progress');
task.notes = progress + '见research/jinan-bridge-outer-findings-20261008.md。'; write('../task.json', task, false);
for (const [file, marker, content] of [
  ['../prd.md', '## 已知事实\n', '\n### 最新进展：桥体补证及灵岩寺派生时长问题\n\n' + progress + '见[补查记录](research/jinan-bridge-outer-findings-20261008.md)。以下为历史快照。\n'],
  ['nine-cities-continuation-20261007.md', '## 本轮断点\n', '\n当前以review16为准。' + progress + '下一步先修灵岩寺派生时长入口及存量，再继续其余济南/八城重点。以下为历史断点。\n'],
]) {
  const text = fs.readFileSync(url(file), 'utf8'); assert.ok(text.includes(marker));
  fs.writeFileSync(url(file), text.replace(marker, marker + content));
}
for (const name of ['implement', 'check']) {
  const file = url(`../${name}.jsonl`), entry = {file: '.trellis/tasks/10-06-place-identity-governance/research/jinan-bridge-outer-findings-20261008.md',
    reason: 'review16：桥与八号原图补齐但边界待审；灵岩寺劝退半天被抽为180分钟已真实复现，下一步修入口和存量，无batch39，不重放旧批次'};
  assert.ok(!fs.readFileSync(file, 'utf8').includes(entry.file)); fs.appendFileSync(file, JSON.stringify(entry) + '\n');
}
console.log(JSON.stringify({ledger:'review-16', newlyFullyReviewed:0, confirmedUnappliedFindings:1, entityBatch:38, businessWrites:0}));
