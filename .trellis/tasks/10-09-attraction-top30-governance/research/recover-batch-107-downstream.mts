// 仅通过既有审计API逆序撤回本次关系/地点导入；预演执行相同恢复后回滚事务。
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { parse } from 'dotenv';
import { captureIdentityImport, rollbackIdentityImport } from '../../../../apps/server/src/services/placeIdentityAudit';
import { readExport } from '../../../../apps/server/scripts/lib/exportFiles';
import { fileURLToPath } from 'node:url';

const apply = process.argv.includes('--apply');
const folder = new URL('../../10-06-place-identity-governance/research/all-cities/batch-107/sync-01/', import.meta.url);
const resultFile = new URL(`batch-107-downstream-recovery-${apply ? 'applied' : 'preview'}.json`, import.meta.url);
const read = async (url: URL) => JSON.parse(await readFile(url, 'utf8'));
const libraryBytes = await readFile(new URL('preview-厦门/library-before.json', folder));
const library = JSON.parse(libraryBytes.toString('utf8'));
const sync = (await read(new URL('sync-state.json', folder))).cities['厦门'];
const fixture = await read(new URL('preview-厦门/state.json', folder));
const preflight = await read(new URL('pre-import-check.json', folder));
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
assert.equal(createHash('sha256').update(libraryBytes).digest('hex'), fixture.libraryHash);
const pool = new Pool({connectionString: parse(await readFile('apps/server/.env')).DATABASE_URL, connectionTimeoutMillis: 10000});
const client = await pool.connect();
const sorted = (rows: Record<string, unknown>[], key: string) => [...rows].sort((a,b) => String(a[key]).localeCompare(String(b[key])));
const equal = (a: unknown, b: unknown, message: string) => assert.ok(isDeepStrictEqual(a,b), message);
const trips = async () => (await client.query(`SELECT count(*)::int count,md5(COALESCE(string_agg(h,'' ORDER BY h),'')) digest
  FROM (SELECT md5(to_jsonb(t)::text) h FROM trips t) x`)).rows[0];
const compareLibrary = async () => {
  const restored = await captureIdentityImport(client, '厦门');
  for (const [field, table, key] of [
    ['places','canonical_places','id'], ['evidence','research_evidence','id'],
    ['relations','place_relation','id'], ['independentPhotos','independent_photo_assignments','image_key'],
    ['relationSnapshots','place_relation_snapshots','city'],
  ] as const) equal(sorted(restored[field] ?? [], key), sorted(library.tables[table], key), `恢复未匹配冻结表：${table}`);
  equal(sorted([...(restored.imports ?? []), ...(restored.relationImports ?? [])], 'source'),
    sorted(library.tables.data_import.filter((row: { source: string }) => ['xhs_places','xhs_relations'].includes(row.source)), 'source'), '导入版本恢复不一致');
  equal(await trips(), preflight.trips, '旧行程变化');
  const place = restored.places.find(row => row.id === '582cedb34ba4cbff94e3481f8e1e9acd')!;
  const payload = place.payload as Record<string, unknown>;
  assert.ok(typeof payload.coverImage === 'string' && payload.coverImage.length > 0, '旧封面未恢复');
  assert.equal((payload.imageGallery as unknown[]).length, 1, '旧图库未恢复');
  return {stateHash: digest(restored), places: restored.places.length, coverRestored: true, galleryItems: 1, trips: await trips()};
};
try {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
  await client.query("SET LOCAL statement_timeout='30s'");
  const audits = (await client.query(`SELECT id,content_hash,created_at FROM place_identity_imports
    WHERE city=$1 AND rolled_back_at IS NULL ORDER BY created_at DESC LIMIT 2 FOR UPDATE`, ['厦门'])).rows;
  console.log(JSON.stringify({auditMetadata:audits}));
  const exportHashes = [];
  for (const [file, expected] of [[`xhs-place-relations-厦门.json`,sync.relationHash],[`xhs-places-厦门.json`,sync.exportHash]]) {
    const url = new URL(file,folder);
    assert.equal(createHash('sha256').update(await readFile(url)).digest('hex'), expected);
    exportHashes.push(readExport(fileURLToPath(url))?.contentHash);
  }
  equal(audits.map(row => row.content_hash), exportHashes, '最新两条审计不是第107批');
  const before = await captureIdentityImport(client, '厦门');
  equal(await trips(), preflight.trips, '回滚前旧行程已变化');
  if (apply) {
    const preview = await read(new URL('batch-107-downstream-recovery-preview.json', import.meta.url));
    assert.equal(preview.passed, true);
    assert.equal(preview.beforeStateHash, digest(before), '预演后库已变化');
    equal(preview.auditIds, audits.map(row => row.id), '预演审计ID不匹配');
  }
  for (const audit of audits) await rollbackIdentityImport(client, audit.id, true);
  const restored = await compareLibrary();
  await client.query(apply ? 'COMMIT' : 'ROLLBACK');
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  if (apply) await compareLibrary();
  else equal(await captureIdentityImport(client, '厦门'), before, '预演事务未完整撤销');
  await client.query('ROLLBACK');
  const report = {batch:'batch-107',apply,passed:true,libraryHash:fixture.libraryHash,
    auditIds:audits.map(row => row.id), beforeStateHash:digest(before), ...restored,
    reverseAuditRollback:true, fullLibraryPreserved:true, previewTransactionRestored:!apply};
  await writeFile(resultFile, JSON.stringify(report,null,2)+'\n', {flag:'wx'});
  console.log(JSON.stringify(report));
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  console.error(JSON.stringify({failed:true,errorType:error instanceof Error ? error.name : 'unknown',
    frames:error instanceof Error ? error.stack?.split('\n').filter(line=>line.includes('recover-batch-107-downstream.mts')) : []}));
  process.exitCode=1;
} finally {client.release(); await pool.end();}
