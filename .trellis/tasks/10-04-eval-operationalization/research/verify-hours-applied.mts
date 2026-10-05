// 应用后的独立只读核对：源库保留字段、完整冻结三表与候选预览必须一致。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Client } from 'pg';
import { hash, writeJson } from '../../../../eval/artifacts';
import { readFrozen } from '../../../../eval/frozenKnowledge';
import { sourceConfiguration } from '../../../../eval/exportKnowledge';
import type { HoursBackup } from './hoursPatch';

const application = 'eval/runs/hours-apply-1791173395975';
const backup: HoursBackup & { sourceId: string } = JSON.parse(fs.readFileSync(`${application}/backup.json`, 'utf8'));
const original = readFrozen('eval/knowledge-snapshots/kb-2026-10-05-matrix');
const candidate = readFrozen('eval/knowledge-snapshots/kb-2026-10-05-hours-preview-v2');
const applied = readFrozen('eval/knowledge-snapshots/kb-2026-10-05-hours-applied');
assert.equal(original.contentHash, 'f5a31c5092769d093bbcd4f6eca7e265c3111b480d42c238b02be9b89b9cb3c6');
assert.equal(applied.sourceId, original.sourceId);
assert.equal(applied.contentHash, candidate.contentHash, '实际源库导出必须与批准预览全量一致');
assert.equal(hash(applied.data.evidence), hash(original.data.evidence));
assert.equal(hash(applied.data.relations), hash(original.data.relations));
const withoutHours = (places: typeof applied.data.places) => places.map((place) => {
  const row = structuredClone(place);
  if (row.payload) delete row.payload.openHours;
  return row;
});
assert.equal(hash(withoutHours(applied.data.places)), hash(withoutHours(original.data.places)));
const focused = ['奎星楼街', '锦里', '成都博物馆'].map((name) => {
  const place = applied.data.places.find((p) => p.city === '成都' && p.name === name);
  assert.ok(place, `未找到 ${name}`);
  const hours = place.payload?.openHours as Record<string, unknown>;
  return { id: place.id, name, status: hours.status, scope: hours.scope,
    closedWeekdays: hours.closedWeekdays ?? [], openTime: hours.openTime ?? null, closeTime: hours.closeTime ?? null };
});
assert.equal(focused[0]!.status, 'unknown');
assert.deepEqual(focused[0]!.closedWeekdays, []);
assert.deepEqual(focused[1]!.closedWeekdays, []);
assert.equal(focused[1]!.status, 'attributed');
assert.deepEqual(focused[2]!.closedWeekdays, [1]);
const config = sourceConfiguration(), url = new URL(config.url);
assert.equal(hash({ host: url.hostname, port: url.port || '5432', database: url.pathname }), backup.sourceId);
const client = new Client({ connectionString: config.url, options: '-c default_transaction_read_only=on',
  connectionTimeoutMillis: 8000, statement_timeout: 30000, application_name: 'tripweaver-hours-readback' });
try {
  await client.connect();
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const rows = (await client.query<{ id: string; hours: unknown; protectedHash: string }>(`
    SELECT p.id,COALESCE(p.payload->'openHours','null'::jsonb) AS hours,
      md5(jsonb_build_array(to_jsonb(p)-'payload',COALESCE(p.payload,'{}'::jsonb)-'openHours')::text) AS "protectedHash"
    FROM canonical_places p WHERE p.id=ANY($1::text[]) ORDER BY p.id`, [backup.rows.map((r) => r.id)])).rows;
  assert.equal(rows.length, 402);
  for (const row of rows) {
    assert.equal(hash(row.hours), hash(backup.changes.find((c) => c.id === row.id)!.after));
    assert.equal(row.protectedHash, backup.rows.find((r) => r.id === row.id)!.protectedHash);
  }
  await client.query('COMMIT');
  const result = { checkedAt: new Date().toISOString(), application, sourceId: backup.sourceId,
    originalKnowledgeHash: original.contentHash, appliedKnowledgeHash: applied.contentHash,
    snapshot: applied.name, candidateMatchesActualSource: true, rowsReadBack: rows.length,
    sourceNonHoursFieldsUnchanged: true, exportedNonHoursFieldsUnchanged: true,
    evidenceRelationsAndVectorsUnchanged: true, originalKnowledgeUnchanged: true,
    focused, limits: ['源库读回仅核对本次 402 行；冻结副本不含图片，图片保护由源行非营业字段 hash 验证。',
      '未读取用户历史表；补丁 SQL 只更新 canonical_places.payload.openHours。'] };
  const file = `${application}/verification-${Date.now()}.json`;
  writeJson(file, result);
  console.log(JSON.stringify({ file, ...result }, null, 2));
} finally { await client.end(); }
