// 默认只读核对；--apply 仅应用用户已审阅的成都 v2 预览，不导入应用客户端、不迁移。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { Client } from 'pg';
import { hash, writeJson } from '../../../../../../eval/artifacts';
import { readFrozen } from '../../../../../../eval/frozenKnowledge';
import { sourceConfiguration } from '../../../../../../eval/exportKnowledge';
import { patchHours, HoursPatchConflict, type HoursChange } from './hoursPatch';

const { values } = parseArgs({ options: { apply: { type: 'boolean', default: false } }, strict: true });
const previewFile = 'eval/runs/hours-preview-2026-10-05-v2/preview.json';
const preview = JSON.parse(fs.readFileSync(previewFile, 'utf8'));
const original = readFrozen('eval/knowledge-snapshots/kb-2026-10-05-matrix');
const candidate = readFrozen('eval/knowledge-snapshots/kb-2026-10-05-hours-preview-v2');
assert.equal(original.contentHash, 'f5a31c5092769d093bbcd4f6eca7e265c3111b480d42c238b02be9b89b9cb3c6');
assert.equal(preview.originalKnowledgeHash, original.contentHash);
assert.equal(preview.candidateKnowledgeHash, candidate.contentHash);
assert.equal(preview.changedRows, 402);
assert.equal(preview.semanticChanges, 25);
const afterById = new Map(candidate.data.places.map((p) => [p.id, p]));
const changes: HoursChange[] = original.data.places.flatMap((p) => {
  const updated = afterById.get(p.id);
  assert.ok(updated);
  const before = p.payload?.openHours ?? null, after = updated.payload?.openHours ?? null;
  if (hash(before) === hash(after)) return [];
  assert.equal(p.city, '成都');
  assert.equal(p.name, updated.name);
  assert.equal(p.source, updated.source);
  return [{ id: p.id, name: p.name, city: p.city, source: p.source, before, after }];
});
assert.equal(changes.length, 402);
assert.equal(hash(changes.map(({ city: _city, source: _source, ...rest }) => rest)),
  hash(preview.changes.map(({ semanticChanged: _flag, ...rest }: { semanticChanged: boolean }) => rest)));
const config = sourceConfiguration();
const url = new URL(config.url);
assert.equal(hash({ host: url.hostname, port: url.port || '5432', database: url.pathname }), original.sourceId, '目标库与原预览来源不一致');
const out = `eval/runs/hours-${values.apply ? 'apply' : 'preflight'}-${Date.now()}`;
fs.mkdirSync(out);
const client = new Client({ connectionString: config.url, connectionTimeoutMillis: 8000,
  application_name: 'tripweaver-approved-hours-patch',
  ...(values.apply ? {} : { options: '-c default_transaction_read_only=on' }) });
try {
  await client.connect();
  const result = await patchHours(client, changes, values.apply ? 'apply' : 'dry-run', async (backup) => {
    // wx 拒绝覆盖已有备份；写入与 fsync 必须成功，才允许数据库 UPDATE。
    const fd = fs.openSync(`${out}/backup.json`, 'wx');
    try { fs.writeFileSync(fd, JSON.stringify({ previewFile, sourceId: original.sourceId, ...backup }, null, 2)); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
  });
  writeJson(`${out}/result.json`, { ...result, sourceId: original.sourceId, previewFile, previewFileHash: hash(preview), checkedAt: new Date().toISOString() });
  console.log(JSON.stringify({ out, ...result }, null, 2));
} catch (error) {
  const conflict = error instanceof HoursPatchConflict;
  const diagnostic = { outcome: 'FAILED_OR_NOT_APPLIED', type: error instanceof Error ? error.name : 'unknown',
    ...(conflict ? { conflicts: error.conflicts } : {}),
    message: conflict ? error.message : '操作失败；未自动重试，请核对备份和数据库当前字段。' };
  writeJson(`${out}/error.json`, diagnostic);
  console.error(JSON.stringify({ out, ...diagnostic })); process.exitCode = 1;
} finally { await client.end(); }
