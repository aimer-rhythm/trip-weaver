// 对实际下游字段只读核验；不导入带迁移的placeFacts，不声称已创建或实测用户路线。
import assert from 'node:assert/strict';
import { readFile, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Client } from 'pg';
import { parse } from 'dotenv';
const url = file => new URL(file, import.meta.url);
const read = async file => JSON.parse(await readFile(url(file), 'utf8'));
const dest = 'priority-cities/济南/spring-downstream-check-01.json';
await access(url(dest)).then(() => { throw new Error('保留旧证据'); }, error => { if (error.code !== 'ENOENT') throw error; });
const packetFile = 'priority-cities/济南/spring-source-packet-01.json';
const packet = await read(packetFile); assert.deepEqual(packet.failures, []);
const exportFile = 'all-cities/batch-35/sync-01/xhs-places-济南.json';
const exportBytes = await readFile(url(exportFile));
const exportHash = createHash('sha256').update(exportBytes).digest('hex');
assert.equal(exportHash, (await read('all-cities/batch-35/sync-01/sync-state.json')).cities['济南'].exportHash);
const exported = JSON.parse(exportBytes).places;
const affectedIds = new Set(packet.mentions.filter(m => packet.confirmedIssue.mentionIds.includes(m.id)).map(m => m.resolvedEntityId));
assert.equal(affectedIds.size, 4);
const client = new Client({ connectionString: parse(await readFile('apps/server/.env')).DATABASE_URL, connectionTimeoutMillis: 10000 });
const report = { readOnly: true, capturedAt: new Date().toISOString(), city: '济南', sourcePacketFile: packetFile,
  sourcePacketSha256: createHash('sha256').update(await readFile(url(packetFile))).digest('hex'),
  exportFile, exportHash, groups: [], trips: {}, findings: packet.confirmedIssue, failures: [] };
try {
  await client.connect(); await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const ids = packet.groups.map(g => g.entity.entity_id);
  const rows = (await client.query('SELECT id,city,name,category,lat,lng,verified,payload FROM canonical_places WHERE city=$1 AND id=ANY($2::text[])', ['济南', ids])).rows;
  assert.equal(rows.length, 5);
  for (const row of rows) {
    const exp = exported.find(p => p.id === row.id); assert.ok(exp);
    assert.equal(row.payload.identity.revision, 1); assert.equal(row.payload.canonicalRedirectTo, undefined);
    assert.equal(row.verified, true); assert.equal(row.payload.typicalVisitMinutes, exp.payload.typicalVisitMinutes);
    if (affectedIds.has(row.id)) assert.equal(row.payload.typicalVisitMinutes, 30);
    report.groups.push({ entityId: row.id, name: row.name, revision: 1, category: row.category,
      lat: row.lat, lng: row.lng, currentVisitMinutes: row.payload.typicalVisitMinutes ?? null,
      consumedBy: 'apps/server/src/generation/scheduling/placeFacts.ts:toFacts → visitMinutes',
      affectedByCombinedDuration: affectedIds.has(row.id) });
  }
  report.trips = (await client.query(`SELECT count(*)::int count,md5(COALESCE(string_agg(h,'' ORDER BY h),'')) digest
    FROM (SELECT md5(to_jsonb(t)::text) h FROM trips t) x`)).rows[0];
  assert.deepEqual(report.trips, { count: 201, digest: 'e01d67cbf42a62fc595f4ef052f99e75' });
} finally { await client.query('ROLLBACK').catch(() => {}); await client.end(); }
await writeFile(url(dest), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ file: dest, groups: report.groups.map(g => ({ name: g.name, currentVisitMinutes: g.currentVisitMinutes,
  affected: g.affectedByCombinedDuration })), failures: [] }));
