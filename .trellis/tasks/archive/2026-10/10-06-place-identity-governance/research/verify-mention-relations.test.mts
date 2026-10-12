import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { type GenerateForm, type ResearchPoi } from '@tripweaver/shared';
import { pool } from '../../../../apps/server/src/db/client';
import { createPlaceRetriever } from '../../../../apps/server/src/generation/placeRetrieval';
import { loadPlaceRelations, resolveRelatedPairs } from '../../../../apps/server/src/generation/scheduling/placeRelations';
import { loadCityPlaceFacts } from '../../../../apps/server/src/generation/scheduling/placeFacts';
import { applyDeterministicSchedule } from '../../../../apps/server/src/generation/scheduling/buildDraft';
import { DraftTrip } from '../../../../apps/server/src/generation/draft';
import { buildResearchTools } from '../../../../apps/server/src/generation/tools/researchTools';
import { getNullPoiSource } from '../../../../apps/server/src/integrations/nullPoiSource';
import { getNullSearchSource } from '../../../../apps/server/src/integrations/websearch/searchSource';
import { type ResearchLocation } from '../../../../apps/server/src/generation/placeLookup';
import { loadPlaceIdentityIndex } from '../../../../apps/server/src/services/placeIdentityService';
import { captureIdentityImport, rollbackIdentityImport } from '../../../../apps/server/src/services/placeIdentityAudit';
import { validateRelationManifest, validateBoundRelations } from '../../../../apps/server/src/services/placeRelationIdentity';
import { createTrip, getTrip } from '../../../../apps/server/src/services/tripService';
import { bindEditPlaceIdentities } from '../../../../apps/server/src/chat/placeIdentity';
import { normalizeEditOps, editActivityDrafts, applyItineraryEdits } from '../../../../apps/server/src/chat/editOps';

after(() => pool.end());

test('真实逐提及SQL双导出贯通ID关系、候选、排程、保存编辑、来源失效与恢复', async () => {
  assert.match(process.env.DATABASE_URL ?? '', /127\.0\.0\.1:18798\/place_identity_test_\d+$/);
  const folder = new URL(process.env.RELATION_FLOW_FIXTURE ?? './mention-relations-preview-1791359223388/', import.meta.url);
  const report = JSON.parse(await readFile(new URL('report.json', folder), 'utf8'));
  assert.equal(report.synthetic, true);
  assert.equal(report.entityRevisionsUnchanged, true);
  assert.equal(report.restoredSameSourceHash, true);
  const city: string = report.city;
  const execute = (label: string, kind: 'places' | 'relations') => promisify(execFile)(process.execPath, ['--import', 'tsx',
    fileURLToPath(new URL(`../../../../apps/server/scripts/seed-xhs-${kind}.ts`, import.meta.url)),
    fileURLToPath(new URL(report.files[label][kind].file, folder))], { env: process.env, windowsHide: true, timeout: 30000 });
  for (const label of ['initial', 'withdrawn', 'restored']) {
    for (const kind of ['places', 'relations']) {
      const descriptor = report.files[label][kind];
      const bytes = await readFile(new URL(descriptor.file, folder));
      assert.equal(createHash('sha256').update(bytes).digest('hex'), descriptor.sha256);
      const data = JSON.parse(bytes.toString('utf8'));
      const manifest = validateRelationManifest(data.relationIdentity, city);
      if (kind === 'relations') validateBoundRelations(data.relations, manifest);
    }
  }
  const client = await pool.connect();
  try {
    const before = await captureIdentityImport(client, city);
    await execute('initial', 'places');
    assert.equal((await loadPlaceRelations(city)).size, 0);
    await execute('initial', 'relations');
    const relations = await loadPlaceRelations(city);
    assert.equal(relations.size, 4);
    for (const id of report.targetIds) assert.equal(relations.get(`id:${id}`)?.length, 1);
    assert.ok(!relations.get(`id:${report.targetIds[0]}`)!.includes(`id:${report.targetIds[1]}`));
    const index = await loadPlaceIdentityIndex(city);
    assert.equal(index.resolve(city, '双门咖啡').status, 'ambiguous');
    const retrieve = createPlaceRetriever({ query: (sql, values) => client.query(sql, values), embed: async () => null });
    const candidates = await retrieve([], { city, browse: true, vector: 'off' });
    assert.equal(candidates.length, 4);
    const outcome: { pool: ResearchPoi[]; summary: string; locations: Map<string, ResearchLocation> } = {
      pool: [], summary: '', locations: new Map(),
    };
    const tools = buildResearchTools({ destination: city, verifiedPlaces: candidates, outcome,
      poiSource: getNullPoiSource(), searchSource: getNullSearchSource(), searchWebMax: 1, reviewedCover: async () => null });
    for (const candidate of candidates) assert.equal((await tools.find(t => t.name === 'add_candidate')!.execute('relation-candidate', {
      name: candidate.name, placeId: candidate.canonicalPlaceId, category: 'attraction', intro: '合成地点用于身份关系集成验证。',
    })).details.ok, true);
    assert.equal(resolveRelatedPairs(relations, outcome.pool).size, 2);
    const form: GenerateForm = { destination: city, days: 2, preferences: [], partySize: 2, budgetLevel: '舒适', totalBudget: 0, extraNotes: '', startDate: '' };
    const draft = new DraftTrip(form);
    applyDeterministicSchedule({ draft, form, pool: outcome.pool, locations: outcome.locations, longHaul: [],
      foodFocused: false, facts: await loadCityPlaceFacts(city), relations });
    const trip = draft.toTrip();
    for (const candidate of candidates) assert.equal(trip.days.flatMap(d => d.activities).filter(a => a.canonicalPlaceId === candidate.canonicalPlaceId).length, 1);
    const user = randomUUID();
    await client.query("INSERT INTO users(id,email,password_hash,created_at) VALUES($1,$2,'',now())", [user, `${user}@example.test`]);
    const saved = await createTrip(user, trip);
    assert.deepEqual(await getTrip(user, saved.id), saved);
    const branch = candidates.find(p => p.canonicalPlaceId === report.targetIds[0])!;
    const ops = normalizeEditOps([{ kind: 'add_activity', dayIndex: 2, activity: { name: branch.name, category: '文化' } }]);
    const bound = bindEditPlaceIdentities(saved, editActivityDrafts(ops), index, `第二天再去${branch.name}`);
    const edited = applyItineraryEdits(bound, ops);
    assert.equal(edited.changed, true, JSON.stringify(edited.outcomes));
    const next = await createTrip(user, edited.trip, saved.id);
    assert.equal(next.days.flatMap(d => d.activities).filter(a => a.canonicalPlaceId === branch.canonicalPlaceId).length, 2);
    await execute('withdrawn', 'places');
    assert.equal((await loadPlaceRelations(city)).size, 0);
    await assert.rejects(execute('initial', 'relations'), /当前来源快照/);
    await execute('withdrawn', 'relations');
    assert.equal((await loadPlaceRelations(city)).size, 0);
    await execute('restored', 'places');
    await execute('restored', 'relations');
    assert.deepEqual(await loadPlaceRelations(city), relations);
    await assert.rejects(execute('initial', 'places'), /版本回退/);
    await execute('restored', 'relations');
    assert.deepEqual(await getTrip(user, saved.id), saved);
    assert.deepEqual(await getTrip(user, next.id), next);
    const audits = (await client.query('SELECT id FROM place_identity_imports WHERE city=$1 ORDER BY created_at DESC', [city])).rows;
    await client.query('BEGIN');
    for (const audit of audits) await rollbackIdentityImport(client, audit.id, true);
    assert.deepEqual(await captureIdentityImport(client, city), before);
    await client.query('COMMIT');
    assert.deepEqual(await getTrip(user, saved.id), saved);
    await writeFile(new URL(`verification-${Date.now()}.json`, folder), JSON.stringify({ synthetic: true, city,
      sourceRevisions: [1, 2, 3], relations: 2, candidates: 4, scheduled: 4, trips: 2, audits: audits.length,
      sourceInvalidation: true, staleFilesRejected: true, reverseRollback: true, failures: [] }, null, 2), { flag: 'wx' });
  } finally { await client.query('ROLLBACK'); client.release(); }
});
