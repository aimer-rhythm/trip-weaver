// 只生成营业字段修复预览和可验证的候选冻结版；不连接生产库、不应用到现有行程。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { hash, writeJson } from '../../../../eval/artifacts';
import { readFrozen, saveFrozen, type FrozenData } from '../../../../eval/frozenKnowledge';
import { verifyFrozenImport } from '../../../../eval/knowledgeVerification';

const out = 'eval/runs/hours-preview-2026-10-05-v2';
fs.mkdirSync(out);
const source = 'eval/runs/hours-preview-2026-10-05/chengdu-export-v2.json';
const exported = JSON.parse(fs.readFileSync(source, 'utf8'));
const original = readFrozen('eval/knowledge-snapshots/kb-2026-10-05-matrix');
const updated = structuredClone(original);
const incoming = new Map<string, { name: string; payload: Record<string, any> }>(exported.places.map((p: any) => [p.id, p]));
const fields = (hours: any) => ({ openTime: hours?.openTime ?? null, closeTime: hours?.closeTime ?? null,
  closedWeekdays: hours?.closedWeekdays ?? [], note: hours?.note ?? '' });
const changes: Array<{ id: string; name: string; semanticChanged: boolean; before: unknown; after: unknown }> = [];
// goldset 是地点来源，不代表它的每个 payload 字段都来自金集。
// seed-canonical-places 只写 caseId/activity；顶层旧 openHours.evidence 是上游附加字段。
const upstreamHours = (p: FrozenData['places'][number]) => p.source === 'xhs' ||
  (p.source === 'goldset' && p.payload?.openHours && typeof p.payload.openHours === 'object'
    && Array.isArray((p.payload.openHours as { evidence?: unknown }).evidence));
for (const place of updated.data.places) {
  if (place.city !== '成都' || !upstreamHours(place) || place.payload?.canonicalRedirectTo) continue;
  const next = incoming.get(place.id);
  if (!next || next.name !== place.name) continue;
  const before = place.payload?.openHours ?? null;
  const after = next.payload.openHours ?? null;
  if (hash(before) === hash(after)) continue;
  changes.push({ id: place.id, name: place.name, semanticChanged: hash(fields(before)) !== hash(fields(after)), before, after });
  place.payload = { ...place.payload };
  if (after) place.payload.openHours = after;
  else delete place.payload.openHours;
}
const withoutHours = (p: FrozenData['places'][number]) => {
  const copy = structuredClone(p); if (copy.payload) delete copy.payload.openHours; return copy;
};
assert.equal(hash(original.data.places.map(withoutHours)), hash(updated.data.places.map(withoutHours)), '只能修改营业字段');
assert.equal(hash(original.data.evidence), hash(updated.data.evidence), '独立证据内容和向量不动');
assert.equal(hash(original.data.relations), hash(updated.data.relations));
updated.name = 'kb-2026-10-05-hours-preview-v2';
updated.exportedAt = new Date().toISOString();
updated.sourceId = `hours-preview:${original.contentHash}`;
updated.contentHash = hash(updated.data);
const directory = saveFrozen(updated);
const verification = await verifyFrozenImport(updated, process.env.EVAL_PG_ADMIN_URL, false);
writeJson(`${out}/candidate-verification.json`, verification);
const semantic = changes.filter((c) => c.semanticChanged);
const summary = { status: 'PREVIEW_NOT_APPLIED', source, sourceHash: hash(fs.readFileSync(source).toString()),
  originalKnowledgeHash: original.contentHash, candidateKnowledgeHash: updated.contentHash, candidateDirectory: directory,
  exportedPlaces: exported.places.length, changedRows: changes.length, semanticChanges: semantic.length,
  metadataOnly: changes.length - semantic.length,
  goldsetEnrichmentFields: changes.filter((c) => original.data.places.find((p) => p.id === c.id)?.source === 'goldset').map((c) => ({ id: c.id, name: c.name })),
  protectedOtherSources: original.data.places.filter((p) => p.city === '成都' && !upstreamHours(p)).map((p) => ({ id: p.id, name: p.name, source: p.source })),
  newIdsNotApplied: exported.places.filter((p: any) => !original.data.places.some((q) => q.id === p.id)).map((p: any) => ({ id: p.id, name: p.name })),
  vectorRebuildRequired: false,
  vectorReason: 'embed-backfill.ts 的地点输入仅 city/name/category，证据输入仅 kind/content；本预览均未改，所有地点/证据向量原样保留并经隔离回导 hash 验证。',
  limits: ['仅映射同ID同名地点的上游openHours字段。goldset地点上有旧evidence结构的顶层openHours属于上游附加字段，金集自己的activity字段和来源身份不动。',
    '原截断证据保存在 before；当前来源缺少可核对主语时标未知，不臆断街区一定开放。',
    '候选冻结版仅供隔离验证，生产应用须审核具体清单，不能全量重导覆盖其他字段或独立来源。'], changes };
const jinli = updated.data.places.find((p) => p.name === '锦里' && p.city === '成都')!;
const museum = updated.data.places.find((p) => p.name === '成都博物馆' && p.city === '成都')!;
assert.deepEqual((jinli.payload?.openHours as any).closedWeekdays, [], '锦里误归属规则必须进入预览');
assert.deepEqual((museum.payload?.openHours as any).closedWeekdays, [1], '明确主体的博物馆周一闭馆仍保留');
writeJson(`${out}/preview.json`, summary);
const label = (h: any) => h?.status === 'unknown' ? '未知（归属待审）' : h?.text || '未提供';
const report = ['# 成都营业信息修复预览', '', '**尚未应用生产知识库或历史行程。**', '',
  `当前上游导出 ${summary.exportedPlaces} 地点；映射原冻结版后 ${changes.length} 行营业元数据变化，其中 ${semantic.length} 行营业规则变化、${summary.metadataOnly} 行只增加归属元数据。`, '',
  '| 地点 | 旧规则 | 预览规则 | 稳定 ID |', '| --- | --- | --- | --- |',
  ...semantic.map((row) => `| ${row.name} | ${label(row.before)} | ${label(row.after)} | ${row.id} |`), '',
  '逐行旧值、新值、完整原句、来源及拒绝原因见 [preview.json](preview.json)。来源未知不等于已核实开放；原裁剪证据不能恢复的完整原句没有补造。', '',
  `原知识 hash：${original.contentHash}。候选 hash：${updated.contentHash}。`, '',
  summary.vectorReason, '', '候选版三表隔离导入、回导 hash、城市检索和向量查询通过：[验证](candidate-verification.json)。', '',
  ...summary.limits.map((line) => `- ${line}`), ''].join('\n');
fs.writeFileSync(`${out}/preview.md`, report, { flag: 'wx' });
console.log(JSON.stringify({ out, directory, changedRows: changes.length, semanticChanges: semantic.length,
  affected: semantic.map((c) => ({ name: c.name, before: label(c.before), after: label(c.after) })) }, null, 2));
