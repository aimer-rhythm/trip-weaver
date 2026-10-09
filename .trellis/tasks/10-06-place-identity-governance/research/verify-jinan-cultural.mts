// 现行三组文化地点只读核查：完整来源对应、全名/别名SQL、真实向量、旧ID及图库。
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

type Group = { entityId: string; name: string; revision: number; aliases: string[]; overrides: { lat: number; lng: number; address: string };
  referencePoint?: { lat: number; lng: number; address: string };
  sourceIds: number[]; mentions: { mentionId: number; entityId: string; inputHash: string }[]; upstreamManagedImageCount: number };
const read = async (file: string) => JSON.parse(await readFile(new URL(file, import.meta.url), 'utf8'));
const towerMode = process.argv.includes('--tower');
const landmarkMode = process.argv.includes('--landmarks');
const parkMode = process.argv.includes('--parks'); assert.ok([towerMode, landmarkMode, parkMode].filter(Boolean).length <= 1);
const args = process.argv.slice(2).filter(arg => !['--tower', '--landmarks', '--parks'].includes(arg)); assert.ok(args.length <= 1);
const prefix = parkMode ? 'park' : towerMode ? 'tower' : landmarkMode ? 'landmark' : 'cultural';
const batch = parkMode ? 'batch-35' : 'batch-34';
const upstream = await read(`priority-cities/济南/${prefix}-upstream-check-01.json`) as { groups: Group[]; failures: unknown[] };
assert.deepEqual(upstream.failures, []); assert.equal(upstream.groups.length, towerMode ? 1 : 3);
const attempt = args[0] ?? '01';
assert.match(attempt, /^\d{2}$/);
const destination = new URL(`priority-cities/济南/${prefix}-downstream-check-${attempt}.json`, import.meta.url);
await readFile(destination).then(() => { throw new Error('已有核查记录，禁止覆盖'); }, (error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
const settings = { ...parse(await readFile('apps/server/.env')), ...process.env };
const client = new Client({ connectionString: settings.DATABASE_URL, connectionTimeoutMillis: 10_000 });
const embed = createQueryEmbedder({ baseUrl: settings.EMBEDDING_BASE_URL || settings.SITE_LLM_BASE_URL || '',
  apiKey: settings.EMBEDDING_API_KEY || settings.SITE_LLM_API_KEY || '', model: settings.EMBEDDING_MODEL || 'cf/bge-m3',
  dims: Number(settings.EMBEDDING_DIMS || 1024) });
const report = { readOnly: true, city: '济南', verifiedAt: new Date().toISOString(),
  entities: [] as Record<string, unknown>[], independentLibrary: {} as Record<string, unknown>,
  trips: {} as Record<string, unknown>, failures: [] as Record<string, unknown>[] };
const check = (ok: unknown, kind: string, detail: unknown) => { if (!ok) report.failures.push({ kind, detail }); };
try {
  await client.connect();
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const rows = (await client.query<PlaceRow & { embedded: boolean }>('SELECT id,city,name,category,lat,lng,verified,source,payload,embedding IS NOT NULL embedded FROM canonical_places WHERE city=$1', ['济南'])).rows;
  const index = createPlaceIdentityIndex(rows.filter(r => r.verified || r.payload?.identityWithdrawal));
  const retrieve = createPlaceRetriever({ query: (sql, args) => client.query(sql, args), embed });
  const library = await loadIndependentPhotoSources('济南');
  const catalogDirectory = path.dirname(reviewedCatalogFile('济南', '_'));
  const files = await readdir(catalogDirectory).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return []; throw error; });
  const rawCatalogs = await Promise.all(files.filter(f => /^[a-f0-9]{64}\.json$/.test(f)).map(async name => ({
    file: name, data: JSON.parse(await readFile(path.join(catalogDirectory, name), 'utf8')) as unknown } )));
  check(rawCatalogs.every(c => Value.Check(ReviewedCatalogSchema, c.data)), 'invalid_independent_catalog', rawCatalogs.filter(c => !Value.Check(ReviewedCatalogSchema, c.data)).map(c => c.file));
  check(library.warnings.length === 0, 'independent_library_warning', library.warnings);
  check(library.reviewed.length === rawCatalogs.length, 'independent_catalog_not_loaded', { raw: rawCatalogs.length, loaded: library.reviewed.length });
  const bindings = (await client.query('SELECT image_key,entity_id FROM independent_photo_assignments WHERE city=$1', ['济南'])).rows;
  report.independentLibrary = { catalogDirectory, rawCatalogFiles: rawCatalogs.length, reviewedCatalogs: library.reviewed.length,
    selectedPlaces: library.selected?.places.length ?? 0, sourceImages: library.sources.length,
    metadataEligible: library.sources.filter(s => s.eligible).length, byteValidation: true, bindings: bindings.length,
    catalogNames: library.reviewed.map(c => ({ name: c.name, aliases: c.aliases, images: c.entries.length })), warnings: library.warnings };
  const snapshot = (await client.query('SELECT manifest,relations FROM place_relation_snapshots WHERE city=$1', ['济南'])).rows[0];
  const manifest = validateRelationManifest(snapshot.manifest, '济南');
  validateBoundRelations(snapshot.relations, manifest);
  assert.equal(manifest.revision, parkMode ? 9 : 8);
  const sync = (await read(`all-cities/${batch}/sync-01/sync-state.json`)).cities['济南'];
  const exportedBytes = await readFile(new URL(`all-cities/${batch}/sync-01/xhs-places-济南.json`, import.meta.url));
  assert.equal(createHash('sha256').update(exportedBytes).digest('hex'), sync.exportHash);
  const exported = JSON.parse(exportedBytes.toString('utf8')).places as PlaceRow[];
  for (const group of upstream.groups) {
    const actual = rows.find(r => r.id === group.entityId);
    assert.ok(actual, group.name);
    const frozen = exported.find(r => r.id === group.entityId); assert.ok(frozen);
    for (const key of ['name', 'category', 'lat', 'lng', 'verified'] as const) check(actual[key] === frozen[key], 'export_field_changed', { name: group.name, key });
    const expectedCategory = parkMode ? '自然' : group.name === '泉城广场' ? '娱乐' : '文化';
    check(actual.name === group.name && actual.verified && actual.category === expectedCategory, 'entity_status_category', group.name);
    check(placeIdentity(actual).revision === group.revision, 'entity_revision', group.name);
    const reference = towerMode || landmarkMode || parkMode ? group.referencePoint! : group.overrides;
    // export_to_tripweaver.py将位置输出为六位小数；原源精度另保留，不误报位置变更。
    const exportedCoordinate = (value: number) => Number(value.toFixed(6));
    check(actual.lat === exportedCoordinate(reference.lat) && actual.lng === exportedCoordinate(reference.lng), 'current_reference_point', group.name);
    check(actual.payload?.address === reference.address, 'current_address', group.name);
    check(actual.embedded && actual.payload?.embeddedText === placeEmbeddingText(actual), 'embedding_stale', group.name);
    if (parkMode) {
      for (const key of ['content', 'topReasons', 'price', 'tips', 'openHours', 'reservation', 'reservationNote',
        'reservationEvidence', 'reservationConflict', 'typicalVisitMinutes', 'mentionCount', 'recommendScore', 'themes']) {
        check(isDeepStrictEqual(actual.payload?.[key], frozen.payload?.[key]), 'consumed_fact_changed_since_export', { name: group.name, key });
      }
    }
    // 导入器按契约补nameKeys；分别验证源声明和派生索引，不能把合法派生字段当身份漂移。
    const { nameKeys, ...actualDeclaration } = placeIdentity(actual);
    check(isDeepStrictEqual(actualDeclaration, placeIdentity(frozen)), 'identity_changed_since_export', group.name);
    const expectedKeys = [...new Set([...identityStrings(placeIdentity(frozen).memberNames),
      ...identityStrings(frozen.payload?.aliases)].map(placeNameKey))];
    check(isDeepStrictEqual(nameKeys, expectedKeys), 'derived_name_keys', group.name);
    const names = placeNames(actual);
    check(names.length === group.aliases.length && group.aliases.every(n => names.includes(n)), 'alias_set', { name: group.name, names });
    const sql = [];
    const legacyIds = new Set([actual.id, ...identityStrings(placeIdentity(actual).memberIds),
      ...rows.filter(r => r.payload?.canonicalRedirectTo === actual.id).map(r => r.id)]);
    for (const name of names) {
      for (const id of [undefined, ...legacyIds]) {
        const resolved = index.resolve('济南', name, id);
        check(resolved.status === 'resolved' && resolved.canonicalPlaceId === actual.id, 'name_legacy_id', { name, id });
      }
      const hits = await retrieve([name], { city: '济南', vector: 'off', limit: 8 });
      check(hits[0]?.canonicalPlaceId === actual.id, 'sql_first', { name, actual: hits[0]?.canonicalPlaceId });
      check(new Set(hits.map(p => p.canonicalPlaceId)).size === hits.length, 'sql_duplicate', name);
      sql.push({ name, firstId: hits[0]?.canonicalPlaceId });
    }
    const alias = names.find(n => n !== actual.name) ?? actual.name;
    let diagnostics: RetrievalDiagnostics | undefined;
    const hits = await retrieve([alias], { city: '济南', vector: 'force', limit: 8, onDiagnostics: d => { diagnostics = d; } });
    check(diagnostics?.vector === 'used' && diagnostics.vectorHits > 0, 'vector_not_used', { name: alias, diagnostics });
    check(hits[0]?.canonicalPlaceId === actual.id, 'vector_first', { name: alias, first: hits[0]?.canonicalPlaceId });
    for (const mention of group.mentions) {
      const bound = manifest.sourceState.mentions.find(m => m.mentionId === mention.mentionId);
      check(bound?.status === 'resolved' && bound.entityId === actual.id && bound.revision === group.revision && bound.inputHash === mention.inputHash,
        'mention_source_mismatch', mention.mentionId);
    }
    const excluded = parkMode ? group.name === '中山公园'
      ? ['中山公园北门', '中山公园南门', '济南市图书馆(中山公园馆)', '利兴来快餐中山公园店']
      : group.name === '泉城公园' ? ['泉城广场', '泉城公园北门', '泉城公园-公交站', '泉城公园站']
      : ['济南黄河森林公园', '济南森林公园南门', '济南森林公园科普馆', '腊山河廊道']
      : towerMode ? ['大明湖', '尚泉尚水茶馆', '超然楼码头', '超然楼北门']
      : group.name === '解放阁' ? ['黑虎泉', '解放阁商务中心', '解放阁-公交站', '解放阁自行车租赁点']
      : group.name === '泉城广场' ? ['恒隆广场', '全季酒店济南泉城广场店', '泉城广场音乐喷泉', '泉标']
      : group.name === '济南府学文庙' ? ['济南府学文庙北门', '明伦堂', '济南府学居教育托管中心', '大明湖']
      : group.name === '山东博物馆' ? ['山东博物馆南门', '山东博物馆停车场', '山东博物馆(地铁站)', '山东省石刻艺术博物馆']
      : group.name === '山东美术馆' ? ['山东美术馆南门', '山东美术馆停车场', '山东美术出版社美术馆'] : ['洪家楼教堂广场', '圣山天主教堂'];
    for (const name of excluded) {
      const resolution = index.resolve('济南', name);
      check(resolution.status !== 'resolved' || resolution.canonicalPlaceId !== actual.id, 'facility_or_other_institution_claimed', name);
    }
    const matchingImages = library.sources.filter(s => [s.catalogName, ...s.aliases].some(name => {
      const result = index.resolve('济南', name); return result.status === 'resolved' && result.canonicalPlaceId === actual.id;
    }));
    const imageFields = rows.filter(r => legacyIds.has(r.id)).map(r => ({ id: r.id, coverImage: r.payload?.coverImage ?? null,
      amapPhoto: r.payload?.amapPhoto ?? null, imageGallery: r.payload?.imageGallery ?? null }));
    const imageCount = imageFields.reduce((n, row) => n + Number(Boolean(row.coverImage)) + Number(Boolean(row.amapPhoto))
      + (Array.isArray(row.imageGallery) ? row.imageGallery.length : 0), 0);
    const boundImages = bindings.filter(b => legacyIds.has(b.entity_id));
    if (towerMode) {
      check(boundImages.length === 4 && matchingImages.length === 10, 'tower_media_coverage', { bound: boundImages.length, sources: matchingImages.length });
      const old = rows.find(r => r.id === 'ef9937ce2185cc51d0870a6c8ce9feaa');
      check(old?.payload?.canonicalRedirectTo === actual.id, 'tower_old_id_redirect', old?.id);
    }
    if (landmarkMode || parkMode) check(boundImages.length === 0 && matchingImages.length === 0 && imageCount === 0 && group.upstreamManagedImageCount === 0,
      'landmark_media_coverage', { name: group.name, bound: boundImages.length, sources: matchingImages.length, imported: imageCount, upstream: group.upstreamManagedImageCount });
    const mediaReviewRequired = imageCount > 0 || matchingImages.length > 0 || boundImages.length > 0 || group.upstreamManagedImageCount > 0;
    report.entities.push({ entityId: actual.id, name: actual.name, revision: group.revision, category: actual.category,
      lat: actual.lat, lng: actual.lng, address: actual.payload?.address, aliases: names, legacyIds: [...legacyIds], sql,
      vector: { name: alias, firstId: hits[0]?.canonicalPlaceId, diagnostics }, mentionsVerified: group.mentions.length,
      negativeIdentityNames: excluded, imageFields, independentImages: matchingImages.length, independentBindings: boundImages.length, mediaReviewRequired,
      independentSources: matchingImages.map(s => ({ imageKey: s.imageKey, inputHash: s.inputHash, assetKey: s.assetKey,
        eligible: s.eligible, catalogName: s.catalogName, entry: s.entry })),
      sourceImages: group.upstreamManagedImageCount, locationConclusion: group.name.includes('教堂') ? 'pending_reference_point_review' : 'reviewed_map_reference_point' });
    console.log(JSON.stringify({ name: group.name, sqlNames: sql.length, mentions: group.mentions.length, vector: diagnostics?.vector }));
  }
  for (const group of upstream.groups) {
    for (const other of upstream.groups.filter(g => g.entityId !== group.entityId)) {
      const resolved = index.resolve('济南', other.name);
      check(resolved.status === 'resolved' && resolved.canonicalPlaceId !== group.entityId, 'independent_entities_merged', [group.name, other.name]);
    }
  }
  const trips = (await client.query(`SELECT count(*)::int count,md5(COALESCE(string_agg(h,'' ORDER BY h),'')) digest
    FROM (SELECT md5(to_jsonb(t)::text) h FROM trips t) x`)).rows[0];
  const expectedTrips = (await read(`all-cities/${batch}/sync-01/pre-import-check.json`)).trips;
  check(trips.count === expectedTrips.count && trips.digest === expectedTrips.digest, 'historical_trips_changed', trips);
  report.trips = trips;
} finally { await client.query('ROLLBACK').catch(() => {}); await client.end(); }
await writeFile(destination, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ file: `priority-cities/济南/${prefix}-downstream-check-${attempt}.json`, entities: report.entities.length,
  independentLibrary: report.independentLibrary, failures: report.failures }));
if (report.failures.length) process.exitCode = 1;
