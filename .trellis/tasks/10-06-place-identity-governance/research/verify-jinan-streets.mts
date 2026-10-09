// 第38批后四处街巷/桥梁只读检查；链路通过不自动授予主体自查结论。
import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { Client } from 'pg';
import { parse } from 'dotenv';
import { Value } from '@sinclair/typebox/value';
import { placeNameKey } from '@tripweaver/shared';
import { createPlaceIdentityIndex, identityStrings, placeIdentity, placeNames } from '../../../../apps/server/src/lib/placeIdentity';
import { placeEmbeddingText } from '../../../../apps/server/src/lib/placeEmbeddingText';
import { createPlaceRetriever, type RetrievalDiagnostics } from '../../../../apps/server/src/generation/placeRetrieval';
import { createQueryEmbedder } from '../../../../apps/server/src/integrations/queryEmbedding';
import type { PlaceRow } from '../../../../apps/server/src/generation/retrievalRanking';
import { loadIndependentPhotoSources } from '../../../../apps/server/src/services/independentPhotoSources';
import { ReviewedCatalogSchema, reviewedCatalogFile } from '../../../../apps/server/src/integrations/reviewedPhotos';
import { validateRelationManifest, validateBoundRelations } from '../../../../apps/server/src/services/placeRelationIdentity';
const read = async (f: string) => JSON.parse(await readFile(new URL(f, import.meta.url), 'utf8'));
const hash = async (f: string) => createHash('sha256').update(await readFile(new URL(f, import.meta.url))).digest('hex');
const attempt = process.argv[2] ?? '01'; assert.match(attempt, /^\d{2}$/);
const output = new URL(`priority-cities/济南/streets-downstream-check-${attempt}.json`, import.meta.url);
await readFile(output).then(() => { throw new Error('旧证据不能覆盖'); }, (e: NodeJS.ErrnoException) => { if (e.code !== 'ENOENT') throw e; });
const folder = 'all-cities/batch-38/sync-01/';
const sync = (await read(folder + 'sync-state.json')).cities['济南'];
assert.ok(sync.importedAt && sync.relationsImportedAt && sync.embeddingRunAt);
assert.equal(await hash(folder + 'xhs-places-济南.json'), sync.exportHash);
const exported = (await read(folder + 'xhs-places-济南.json')).places as PlaceRow[];
const before = await read(folder + 'preview-济南/library-before.json');
const packet = await read('priority-cities/济南/streets-source-packet-01.json');
assert.equal(packet.groups.length, 4); assert.equal(packet.mentions.length, 13); assert.deepEqual(packet.failures, []);
const geo09 = await read('priority-cities/济南/geo-09.json');
const geo11 = await read('priority-cities/济南/geo-11.json');
const negatives: Record<string, string[]> = {
  '起凤桥': ['起凤桥街', '起凤桥八号', '起凤泉', '腾蛟泉', '起风桥·五号院'],
  '起凤桥街': ['起凤桥', '起凤桥八号', '起凤泉', '西更道街'],
  '西更道街': ['源泉', '碧玉泉', '曲水亭街', '观泉新中餐', '簪花少女墙', '老舍笔下的济南墙'],
  '百花桥': ['百花洲', '大明湖', '百花桥(大明湖景区)', '涌泉胡同'],
};
const settings = { ...parse(await readFile('apps/server/.env')), ...process.env };
const client = new Client({ connectionString: settings.DATABASE_URL, connectionTimeoutMillis: 10000 });
const upSettings = parse(await readFile('D:/Project/xhs-travel-pipeline/.env'));
assert.ok(upSettings.DATABASE_URL, '上游数据库未配置');
const upstream = new Client({ connectionString: upSettings.DATABASE_URL.replace('postgresql+asyncpg:', 'postgresql:'), connectionTimeoutMillis: 10000 });
const embed = createQueryEmbedder({ baseUrl: settings.EMBEDDING_BASE_URL || settings.SITE_LLM_BASE_URL || '',
  apiKey: settings.EMBEDDING_API_KEY || settings.SITE_LLM_API_KEY || '', model: settings.EMBEDDING_MODEL || 'cf/bge-m3', dims: Number(settings.EMBEDDING_DIMS || 1024) });
const report = { readOnly: true, batch: 38, capturedAt: new Date().toISOString(), entities: [] as Record<string, unknown>[],
  failures: [] as Record<string, unknown>[], independentLibrary: {} as Record<string, unknown>, preserved: {} as Record<string, unknown> };
const check = (ok: unknown, kind: string, detail: unknown) => { if (!ok) report.failures.push({ kind, detail }); };
try {
  await client.connect(); await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await upstream.connect(); await upstream.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const rows = (await client.query<PlaceRow & { embedded: boolean }>('SELECT id,city,name,category,lat,lng,verified,source,payload,embedding IS NOT NULL embedded FROM canonical_places WHERE city=$1', ['济南'])).rows;
  const index = createPlaceIdentityIndex(rows.filter(r => r.verified || r.payload?.identityWithdrawal));
  const retrieve = createPlaceRetriever({ query: (sql, args) => client.query(sql, args), embed });
  const snapshot = (await client.query('SELECT manifest,relations FROM place_relation_snapshots WHERE city=$1', ['济南'])).rows[0];
  const manifest = validateRelationManifest(snapshot.manifest, '济南');
  const graph = validateBoundRelations(snapshot.relations, manifest);
  assert.equal(manifest.revision, 12); assert.equal(graph.length, 20); assert.equal(graph.filter(e => e.strength === 'direct').length, 9);
  const oldManifest = validateRelationManifest(before.tables.place_relation_snapshots[0].manifest, '济南');
  const pending = oldManifest.sourceState.mentions.filter(m => m.status === 'review'); assert.equal(pending.length, 60);
  for (const m of pending) check(isDeepStrictEqual(manifest.sourceState.mentions.find(n => n.mentionId === m.mentionId), m), 'pending_changed', m.mentionId);
  const oldScopes = await read('all-cities/batch-36-scope-decisions.json');
  const assignments = (await upstream.query('SELECT mention_id,scope_place_id,entity_id,input_hash,revision,change_key,fact_exclusions FROM place_mention_assignment WHERE mention_id=ANY($1::int[]) ORDER BY mention_id', [oldScopes.flatMap((s: any) => s.assignments.map((a: any) => a.mentionId))])).rows;
  assert.equal(assignments.length, 11);
  for (const s of oldScopes) for (const e of s.assignments) {
    const a = assignments.find(a => Number(a.mention_id) === e.mentionId); assert.ok(a);
    assert.equal(Number(a.scope_place_id), s.sourcePlaceId); assert.equal(a.entity_id, e.entityId);
    assert.equal(a.input_hash, e.inputHash); assert.equal(a.change_key, s.key); assert.equal(a.revision, 1);
    assert.deepEqual(a.fact_exclusions, e.factExclusions ?? null);
  }
  const library = await loadIndependentPhotoSources('济南');
  const catalogDirectory = path.dirname(reviewedCatalogFile('济南', '_'));
  const files = (await readdir(catalogDirectory)).filter(f => /^[a-f0-9]{64}\.json$/.test(f));
  const catalogs = await Promise.all(files.map(async f => JSON.parse(await readFile(path.join(catalogDirectory, f), 'utf8')) as unknown));
  check(catalogs.every(c => Value.Check(ReviewedCatalogSchema, c)), 'invalid_catalog', files);
  check(library.warnings.length === 0 && library.reviewed.length === files.length, 'catalog_coverage', library.warnings);
  const bindings = (await client.query('SELECT image_key,entity_id FROM independent_photo_assignments WHERE city=$1', ['济南'])).rows;
  report.independentLibrary = { catalogFiles: files.length, reviewedCatalogs: library.reviewed.length, sourceImages: library.sources.length, bindings: bindings.length, warnings: library.warnings };
  for (const group of packet.groups) {
    const name: string = group.entity.canonical_name, eid: string = group.entity.entity_id;
    const row = rows.find(r => r.id === eid), frozen = exported.find(r => r.id === eid);
    const old = before.tables.canonical_places.find((r: any) => r.id === eid); assert.ok(row && frozen && old);
    const revision = name === '西更道街' ? 3 : group.entity.revision;
    for (const k of ['name', 'category', 'lat', 'lng', 'verified'] as const) check(row[k] === frozen[k], 'export_field', { name, k });
    check(row.verified && row.category === '文化' && placeIdentity(row).revision === revision, 'status_category_revision', name);
    check(row.embedded && row.payload?.embeddedText === placeEmbeddingText(row), 'stale_embedding', name);
    const { nameKeys, ...declaration } = placeIdentity(row);
    check(isDeepStrictEqual(declaration, placeIdentity(frozen)), 'identity_export', name);
    check(isDeepStrictEqual(nameKeys, [...new Set([...identityStrings(placeIdentity(frozen).memberNames), ...identityStrings(frozen.payload?.aliases)].map(placeNameKey))]), 'name_keys', name);
    check(isDeepStrictEqual(row.payload?.aliases, old.payload.aliases), 'aliases_changed', name);
    for (const k of ['content', 'topReasons', 'openHours', 'price', 'tips', 'reservation', 'reservationNote', 'reservationEvidence', 'typicalVisitMinutes', 'mentionCount', 'recommendScore', 'themes']) {
      check(isDeepStrictEqual(row.payload?.[k], frozen.payload?.[k]), 'consumed_fact_export', { name, k });
    }
    const content = row.payload?.content;
    assert.ok(content && typeof content === 'object' && 'intro' in content);
    check(content.intro === old.payload.content?.intro, 'description_changed', name);
    check(row.payload?.typicalVisitMinutes === old.payload.typicalVisitMinutes, 'duration_changed', name);
    if (name === '西更道街') check(row.payload?.typicalVisitMinutes === 60, 'street_duration', name);
    const reference = name === '西更道街' ? geo11.find((p: any) => p.query === name && p.name === name)
      : name === '起凤桥街' || name === '百花桥' ? geo09.find((p: any) => p.query === name && p.name === name) : null;
    if (reference) {
      // 原源先舍入六位，再由consolidate_places应用实体override；本批override保留原精度。
      const expectedLat = name === '西更道街' ? reference.gcj02.latitude : Number(reference.gcj02.latitude.toFixed(6));
      const expectedLng = name === '西更道街' ? reference.gcj02.longitude : Number(reference.gcj02.longitude.toFixed(6));
      check(row.lat === expectedLat && row.lng === expectedLng, 'reviewed_reference', name);
      check(row.payload?.address === reference.address, 'reviewed_address', name);
    }
    const ids = [...new Set([row.id, ...identityStrings(placeIdentity(row).memberIds), ...rows.filter(r => r.payload?.canonicalRedirectTo === row.id).map(r => r.id)])];
    const sql = [];
    for (const n of placeNames(row)) {
      for (const id of [undefined, ...ids]) { const r = index.resolve('济南', n, id); check(r.status === 'resolved' && r.canonicalPlaceId === row.id, 'name_legacy', { n, id }); }
      const hits = await retrieve([n], { city: '济南', vector: 'off', limit: 8 });
      check(hits[0]?.canonicalPlaceId === row.id, 'sql_first', n);
      check(new Set(hits.map(h => h.canonicalPlaceId)).size === hits.length, 'sql_duplicate', n);
      sql.push({ name: n, firstId: hits[0]?.canonicalPlaceId });
    }
    let diagnostics: RetrievalDiagnostics | undefined;
    const hits = await retrieve([name], { city: '济南', vector: 'force', limit: 8, onDiagnostics: d => { diagnostics = d; } });
    check(diagnostics?.vector === 'used' && diagnostics.vectorHits > 0 && hits[0]?.canonicalPlaceId === row.id, 'live_vector', { name, diagnostics, firstId: hits[0]?.canonicalPlaceId });
    for (const mid of group.mentionIds) {
      const m = manifest.sourceState.mentions.find(m => m.mentionId === mid), origin = packet.mentions.find((m: any) => m.id === mid);
      check(m?.status === 'resolved' && m.entityId === eid && m.revision === revision && m.inputHash === origin.inputHash, 'mention_binding', mid);
    }
    for (const n of negatives[name]!) { const r = index.resolve('济南', n); check(r.status !== 'resolved' || r.canonicalPlaceId !== eid, 'boundary', { name, n }); }
    const images = library.sources.filter(s => [s.catalogName, ...s.aliases].some(n => { const r = index.resolve('济南', n); return r.status === 'resolved' && r.canonicalPlaceId === eid; }));
    const bound = bindings.filter(b => ids.includes(b.entity_id));
    for (const r of rows.filter(r => ids.includes(r.id))) for (const k of ['coverImage', 'amapPhoto', 'imageGallery']) {
      const v = r.payload?.[k]; check(v == null || Array.isArray(v) && !v.length, 'existing_media_needs_review', { name, id: r.id, k });
    }
    check(images.length === 0 && bound.length === 0 && packet.images.length === 0, 'media_coverage', name);
    report.entities.push({ name, entityId: eid, revision, sql, vector: { diagnostics, firstId: hits[0]?.canonicalPlaceId },
      legacyIds: ids, mentions: group.mentionIds.length, lat: row.lat, lng: row.lng, address: row.payload?.address,
      referenceStatus: reference ? 'reviewed_reference_point' : 'bridge_vs_gate_location_pending',
      negativeNames: negatives[name], sourceImages: images.length, boundImages: bound.length, fullReviewPassed: false });
    console.log(JSON.stringify({ name, revision, sqlNames: sql.length, mentions: group.mentionIds.length, vector: diagnostics?.vector }));
  }
  const trips = (await client.query("SELECT count(*)::int count,md5(COALESCE(string_agg(h,'' ORDER BY h),'')) digest FROM (SELECT md5(to_jsonb(t)::text) h FROM trips t) x")).rows[0];
  assert.deepEqual(trips, (await read(folder + 'pre-import-check.json')).trips); assert.equal(trips.count, 201);
  report.preserved = { priorAssignments: 11, factExclusions: assignments.filter(a => a.fact_exclusions).length, pendingMentions: 60, trips, relations: graph.length, strongRelations: 9 };
} finally {
  await client.query('ROLLBACK').catch(() => {}); await client.end();
  await upstream.query('ROLLBACK').catch(() => {}); await upstream.end();
}
await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ output: output.pathname, failures: report.failures }));
if (report.failures.length) process.exitCode = 1;
