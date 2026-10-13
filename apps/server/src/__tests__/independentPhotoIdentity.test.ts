import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { createLocalMediaStore } from '../lib/mediaStore';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import type { PoolClient } from 'pg';
import { pool } from '../db/client';
import { createPlaceIdentityIndex } from '../lib/placeIdentity';
import type { RetrievedPlace } from '../generation/placeRetrieval';
import { createGenerationPhotoLookup } from '../integrations/photoEnrichment';
import { createBoundPhotoLookup } from '../integrations/boundPhotoLookup';
import { type SelectedLibrary, type SelectedPhoto } from '../integrations/selectedPhotos';
import { PHOTO_REVIEW_VERSION, reviewDigest, type ReviewedPhoto, type ReviewedCatalog } from '../integrations/reviewedPhotos';
import { loadIndependentPhotoSources, photoIdentityDigest } from '../services/independentPhotoSources';
import { applyIndependentPhotoDecision, rollbackIndependentPhotoDecision, loadIndependentPhotoAssignments,
  type IndependentPhotoDecision } from '../services/independentPhotoIdentity';
import { captureIdentityImport, recordIdentityImport, rollbackIdentityImport } from '../services/placeIdentityAudit';
import { makeSampleTrip } from '@tripweaver/shared';
import { createTrip, getTrip } from '../services/tripService';
import { bindEditPlaceIdentities } from '../chat/placeIdentity';
import { normalizeEditOps, editActivityDrafts, applyItineraryEdits } from '../chat/editOps';

after(() => pool.end());

async function fixture() {
  assert.match(process.env.DATABASE_URL ?? '', /place_identity_test_\d+/);
  const client = await pool.connect(), root = await mkdtemp(path.join(tmpdir(), 'independent-photo-'));
  const store = createLocalMediaStore(root);
  const city = `独立图库-${randomUUID()}`, ids = [randomUUID(), randomUUID(), randomUUID()];
  const names = ['沐咖啡（南街店）', '沐咖啡（北街店）', '沐咖啡'];
  await client.query('BEGIN');
  for (const [i, id] of ids.entries()) {
    const identity = { version: 2, entityId: id, revision: 1, canonicalName: names[i], kind: 'same_entity', memberIds: [id], memberNames: [names[i]] };
    await client.query(`INSERT INTO canonical_places(id,city,name,category,source,verified,payload,created_at)
      VALUES($1,$2,$3,'美食','xhs',$4,$5,now())`, [id, city, names[i], i !== 2,
      { identity, imageIdentity: { version: 1, mode: 'reviewed', entityId: id, revision: 1, approved: [] },
        ...(i === 2 ? { identityWithdrawal: { version: 1, revision: 1, reason: 'split_source', candidateIds: ids.slice(0, 2) } } : {}) }]);
  }
  await mkdir(path.join(root, 'media/remote-photos'), { recursive: true });
  const asset = async (label: string): Promise<SelectedPhoto> => {
    const bytes = Buffer.concat([Buffer.from([255, 216, 255]), Buffer.from(label)]);
    const photo = { url: `/media/remote-photos/${label}.jpg`, attribution: {
      source: 'pexels' as const, photographer: '作者', sourceUrl: `https://www.pexels.com/photo/${label}/`,
      license: 'Pexels License', licenseUrl: 'https://www.pexels.com/license/', changes: '原目录记录',
    } };
    await writeFile(path.join(root, photo.url.slice(1)), bytes);
    return { photo, sha256: reviewDigest(bytes), selectionKey: reviewDigest(label), identity: 'verified', evidence: '原选图主体证据' };
  };
  const selected = await Promise.all(['south-first', 'south-second', 'north'].map(asset));
  const library: SelectedLibrary = { version: 1, city, snapshotId: randomUUID(), selectedAt: '2026-10-07',
    places: [{ name: names[2]!, aliases: [], photos: selected, excluded: [] }] };
  const reviewedEntries: ReviewedPhoto[] = await Promise.all(['review-south', 'review-north'].map(async label => ({ ...await asset(label),
    model: 'test', reviewedAt: '2026-10-07', evidence: '原审核来源', review: {
      identity: 'match' as const, singlePhoto: true, clear: true, representative: 'strong' as const,
      composition: 'strong' as const, light: 'adequate' as const, obstruction: false, unrelatedPortrait: false,
      view: label, reason: '明确建筑主体', evidence: '画面与分店证据匹配',
    } })));
  const reviewed: ReviewedCatalog[] = [{ version: PHOTO_REVIEW_VERSION, city, name: names[2]!, aliases: [], entries: reviewedEntries }];
  const load = () => loadIndependentPhotoSources(city, { store, library, reviewed });
  const index = async () => createPlaceIdentityIndex((await client.query<RetrievedPlace>(
    `SELECT id,city,name,category,source,verified,payload,lat,lng,'[]'::jsonb aliases,'[]'::jsonb evidence
      FROM canonical_places WHERE city=$1`, [city])).rows);
  const makeDecision = async (): Promise<IndependentPhotoDecision> => ({ key: randomUUID(), city,
    expectedEntityRevisions: { [ids[0]!]: 1, [ids[1]!]: 1 }, evidence: [{ kind: '原文与逐图核对', conclusion: '两个具体分店' }],
    images: (await load()).sources.map((s, i) => ({ imageKey: s.imageKey, inputHash: s.inputHash,
      entityId: ids[[0, 0, 1, 0, 1][i]!]!, expectedRevision: 0 })) });
  const enqueues: string[] = [];
  const lookup = () => createGenerationPhotoLookup(city, index, { loadSources: load,
    loadAssignments: () => loadIndependentPhotoAssignments(client, city), adoption: { store, mediaBase: '/media' },
    enqueue: async (_city, name) => { enqueues.push(name); } });
  const close = async () => { await client.query('ROLLBACK'); client.release(); await rm(root, { recursive: true, force: true }); };
  return { client, root, store, city, ids, names, selected, library, reviewed, load, index, makeDecision, lookup, close, asset, enqueues };
}
async function rejected(client: PoolClient, action: () => Promise<unknown>, pattern?: RegExp) {
  await client.query('SAVEPOINT rejected_case');
  try { if (pattern) await assert.rejects(action, pattern); else await assert.rejects(action); }
  finally { await client.query('ROLLBACK TO SAVEPOINT rejected_case'); await client.query('RELEASE SAVEPOINT rejected_case'); }
}

test('旧泛名同目录逐图分给两家分店，正式入口保持人工顺序且不混入模型图', async () => {
  const f = await fixture();
  try {
    const original = JSON.stringify(f.library), decision = await f.makeDecision();
    const after = await applyIndependentPhotoDecision(f.client, decision, f.load);
    assert.deepEqual(await applyIndependentPhotoDecision(f.client, decision, f.load), after);
    const lookup = f.lookup();
    assert.deepEqual((await lookup(f.names[0]!))?.photos?.map(p => p.url), f.selected.slice(0, 2).map(p => p.photo.url));
    assert.equal((await lookup(f.names[1]!))?.coverUrl, f.selected[2]!.photo.url);
    assert.equal(await lookup(f.names[2]!), null);
    assert.equal(await lookup(`${f.names[0]}（午后）`), null, '括注回退不能替代稳定分店身份');
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(f.enqueues, [], '嵌套展示括注也不能绕过受控主体的补图限制');
    const bound = createBoundPhotoLookup(f.city, await f.load(), await loadIndependentPhotoAssignments(f.client, f.city), await f.index());
    assert.equal(bound.allowUnbound(f.selected[0]!), false);
    assert.equal(JSON.stringify(f.library), original);
    await rollbackIndependentPhotoDecision(f.client, decision.key, f.load);
    assert.deepEqual(await loadIndependentPhotoAssignments(f.client, f.city), []);
    await rejected(f.client, () => applyIndependentPhotoDecision(f.client, decision, f.load), /key/);
  } finally { await f.close(); }
});

for (const error of ['hash', 'revision', 'foreign_entity', 'old_id', 'duplicate_image', 'missing_entity_revision', 'quality', 'file_changed', 'excluded']) {
  test(`独立图片非法分配原子拒绝：${error}`, async () => {
    const f = await fixture();
    try {
      const decision = await f.makeDecision();
      if (error === 'hash') decision.images[0]!.inputHash = 'a'.repeat(64);
      if (error === 'revision') decision.images[0]!.expectedRevision = 1;
      if (error === 'foreign_entity' || error === 'old_id') {
        decision.images[0]!.entityId = error === 'old_id' ? f.ids[2]! : randomUUID();
        decision.expectedEntityRevisions[decision.images[0]!.entityId!] = error === 'old_id' ? 1 : null;
      }
      if (error === 'duplicate_image') decision.images.push(decision.images[0]!);
      if (error === 'missing_entity_revision') delete decision.expectedEntityRevisions[f.ids[1]!];
      if (error === 'quality') f.reviewed[0]!.entries[0]!.review.identity = 'unknown';
      if (error === 'file_changed') await writeFile(path.join(f.root, f.selected[0]!.photo.url.slice(1)), 'changed');
      if (error === 'excluded') f.library.places[0]!.excluded.push({ url: f.selected[0]!.photo.url, sourceUrl: '', sha256: '' });
      await rejected(f.client, () => applyIndependentPhotoDecision(f.client, decision, f.load));
      assert.deepEqual(await loadIndependentPhotoAssignments(f.client, f.city), []);
    } finally { await f.close(); }
  });
}

test('错误来源城市和回滚期间来源变化均原子拒绝', async () => {
  const f = await fixture();
  try {
    const decision = await f.makeDecision();
    const wrongCity = async () => {
      const inputs = await f.load();
      return { ...inputs, sources: inputs.sources.map(source => ({ ...source, city: '另一城市' })) };
    };
    await rejected(f.client, () => applyIndependentPhotoDecision(f.client, decision, wrongCity), /城市/);
    assert.deepEqual(await loadIndependentPhotoAssignments(f.client, f.city), []);
    await applyIndependentPhotoDecision(f.client, decision, f.load);
    const before = await loadIndependentPhotoAssignments(f.client, f.city);
    const bound = createBoundPhotoLookup(f.city, await wrongCity(), before, await f.index());
    assert.equal(bound.allowUnbound(f.selected[0]!), false);
    assert.equal(await bound.forPlace((await f.index()).groups.flat().find(p => p.id === f.ids[0])!), null);
    let reads = 0;
    const changing = async () => {
      const inputs = await f.load();
      if (++reads === 2) inputs.sources[0]!.inputHash = 'a'.repeat(64);
      return inputs;
    };
    await rejected(f.client, () => rollbackIndependentPhotoDecision(f.client, decision.key, changing), /回滚期间变化/);
    assert.equal(reads, 2);
    assert.deepEqual(await loadIndependentPhotoAssignments(f.client, f.city), before);
    assert.equal((await f.client.query('SELECT rolled_back_at FROM independent_photo_changes WHERE change_key=$1', [decision.key])).rows[0].rolled_back_at, null);
    await rollbackIndependentPhotoDecision(f.client, decision.key, f.load);
  } finally { await f.close(); }
});

test('图片撤销阻止旧路径复活，倒序回滚；文件缺失只能采用仍合格的绑定图片', async () => {
  const f = await fixture();
  try {
    const first = await f.makeDecision();
    await applyIndependentPhotoDecision(f.client, first, f.load);
    const second = structuredClone(first); second.key = randomUUID();
    second.images.forEach(item => { item.expectedRevision = 1; item.entityId = null; });
    await applyIndependentPhotoDecision(f.client, second, f.load);
    assert.equal(await f.lookup()(f.names[0]!), null);
    await rejected(f.client, () => rollbackIndependentPhotoDecision(f.client, first.key, f.load), /后续/);
    await rollbackIndependentPhotoDecision(f.client, second.key, f.load);
    await rm(path.join(f.root, f.selected[0]!.photo.url.slice(1)));
    assert.equal((await f.lookup()(f.names[0]!))?.coverUrl, f.selected[1]!.photo.url);
    await rejected(f.client, () => rollbackIndependentPhotoDecision(f.client, first.key, f.load), /后续/);
  } finally { await f.close(); }
});

test('实体版本变化立即使旧图片分配失效，并阻止过期图片回滚', async () => {
  const f = await fixture();
  try {
    const decision = await f.makeDecision();
    await applyIndependentPhotoDecision(f.client, decision, f.load);
    await f.client.query(`UPDATE canonical_places SET payload=jsonb_set(jsonb_set(payload,'{identity,revision}','2'),'{imageIdentity,revision}','2') WHERE id=$1`, [f.ids[0]]);
    assert.equal(await f.lookup()(f.names[0]!), null);
    assert.equal((await f.lookup()(f.names[1]!))?.coverUrl, f.selected[2]!.photo.url);
    await rejected(f.client, () => rollbackIndependentPhotoDecision(f.client, decision.key, f.load), /后续/);
  } finally { await f.close(); }
});

test('模型补图仍遵守人工排除，不因绑定新分店而绕过旧目录反馈', async () => {
  const f = await fixture();
  try {
    f.library.places[0]!.excluded.push({ url: f.reviewed[0]!.entries[0]!.photo.url, sourceUrl: '', sha256: '' });
    const decision = await f.makeDecision();
    // 只绑定模型图，原人工图继续未分配，不能通过旧泛名补位。
    decision.images = decision.images.slice(3);
    await applyIndependentPhotoDecision(f.client, decision, f.load);
    assert.equal(await f.lookup()(f.names[0]!), null);
    assert.equal((await f.lookup()(f.names[1]!))?.coverUrl, f.reviewed[0]!.entries[1]!.photo.url);
  } finally { await f.close(); }
});

test('同图在不同目录不能分配给不同实体，来源在事务内变化整批回滚', async () => {
  const f = await fixture();
  try {
    f.reviewed[0]!.entries[0] = { ...f.reviewed[0]!.entries[0]!, sha256: f.selected[0]!.sha256, photo: f.selected[0]!.photo };
    const decision = await f.makeDecision(); decision.images[3]!.entityId = f.ids[1]!;
    await rejected(f.client, () => applyIndependentPhotoDecision(f.client, decision, f.load), /同一图片/);
    decision.images[3]!.entityId = f.ids[0]!;
    let loads = 0;
    await rejected(f.client, () => applyIndependentPhotoDecision(f.client, decision, async () => {
      if (++loads === 2) f.library.places[0]!.photos[0]!.evidence = '后来修改的审核';
      return f.load();
    }), /期间变化/);
    assert.deepEqual(await loadIndependentPhotoAssignments(f.client, f.city), []);
  } finally { await f.close(); }
});

test('新增图片绑定阻止地点导入倒序回滚，先回滚图片后恢复地点；旧审计保持兼容', async () => {
  const f = await fixture();
  try {
    const before = await captureIdentityImport(f.client, f.city);
    const audit = await recordIdentityImport(f.client, f.city, 'a'.repeat(64), before);
    const decision = await f.makeDecision();
    await applyIndependentPhotoDecision(f.client, decision, f.load);
    await rejected(f.client, () => rollbackIdentityImport(f.client, audit, true), /后续/);
    await rollbackIndependentPhotoDecision(f.client, decision.key, f.load);
    await rollbackIdentityImport(f.client, audit, true);
    assert.deepEqual(await captureIdentityImport(f.client, f.city), before);
    const legacy = await recordIdentityImport(f.client, f.city, 'b'.repeat(64), before);
    await f.client.query(`UPDATE place_identity_imports SET before_state=before_state-'independentPhotos',
      after_state=after_state-'independentPhotos' WHERE id=$1`, [legacy]);
    decision.key = randomUUID();
    await applyIndependentPhotoDecision(f.client, decision, f.load);
    const assigned = await loadIndependentPhotoAssignments(f.client, f.city);
    await rollbackIdentityImport(f.client, legacy, true);
    assert.deepEqual(await loadIndependentPhotoAssignments(f.client, f.city), assigned, '旧审计不能删除后来独立图库的绑定');
  } finally { await f.close(); }
});

test('普通目录保持既有选图，但被分配或撤销的图片不能沿旧名或副本回来', async () => {
  const f = await fixture();
  try {
    await f.client.query(`UPDATE canonical_places SET verified=true,payload=payload-'imageIdentity'-'identityWithdrawal' WHERE id=$1`, [f.ids[2]]);
    assert.equal((await f.lookup()(f.names[2]!))?.photos?.length, 3);
    const decision = await f.makeDecision(); decision.images = [decision.images[0]!];
    decision.expectedEntityRevisions = { [f.ids[0]!]: 1 };
    await applyIndependentPhotoDecision(f.client, decision, f.load);
    assert.deepEqual((await f.lookup()(f.names[2]!))?.photos?.map(p => p.url), f.selected.slice(1).map(p => p.photo.url));
    decision.key = randomUUID(); decision.images[0]!.entityId = null; decision.images[0]!.expectedRevision = 1;
    await applyIndependentPhotoDecision(f.client, decision, f.load);
    assert.deepEqual((await f.lookup()(f.names[2]!))?.photos?.map(p => p.url), f.selected.slice(1).map(p => p.photo.url));
    const inputs = await f.load(), duplicate = f.reviewed[0]!.entries[0]!;
    duplicate.photo = f.selected[0]!.photo; duplicate.sha256 = f.selected[0]!.sha256;
    const refreshed = await f.load();
    assert.notEqual(refreshed.sources[3]!.assetKey, inputs.sources[3]!.assetKey);
    const bound = createBoundPhotoLookup(f.city, refreshed, await loadIndependentPhotoAssignments(f.client, f.city), await f.index());
    assert.equal(bound.allowUnbound(duplicate), false);
  } finally { await f.close(); }
});

test('源条目删除后可以显式撤销，撤销回滚不会把缺失来源误当可用', async () => {
  const f = await fixture();
  try {
    const first = await f.makeDecision(); await applyIndependentPhotoDecision(f.client, first, f.load);
    const removed = first.images[0]!;
    f.library.places[0]!.photos.shift();
    const revoke: IndependentPhotoDecision = { key: randomUUID(), city: f.city,
      expectedEntityRevisions: { [f.ids[0]!]: 1 }, evidence: [{ reason: '来源移除' }],
      images: [{ imageKey: removed.imageKey, inputHash: photoIdentityDigest(['missing_photo', removed.imageKey]), entityId: null, expectedRevision: 1 }] };
    await applyIndependentPhotoDecision(f.client, revoke, f.load);
    await rollbackIndependentPhotoDecision(f.client, revoke.key, f.load);
    const rows = await loadIndependentPhotoAssignments(f.client, f.city);
    assert.equal(rows.find(r => r.image_key === removed.imageKey)?.entity_id, f.ids[0]);
    assert.ok(!(await f.lookup()(f.names[0]!))?.photos?.some(p => p.url === f.selected[0]!.photo.url));
    await rejected(f.client, () => rollbackIndependentPhotoDecision(f.client, first.key, f.load), /后续/);
  } finally { await f.close(); }
});

test('官方外链按URL指纹绑定，采用时仍上报；无绑定或实体过期均不发采用请求', async () => {
  const f = await fixture();
  try {
    const entry = f.reviewed[0]!.entries[0]!;
    entry.photo = { url: 'https://images.unsplash.com/branch?ixid=original', attribution: {
      source: 'unsplash', photographer: '作者', sourceUrl: 'https://unsplash.com/photos/branch?utm_source=tripweaver&utm_medium=referral',
      photographerUrl: 'https://unsplash.com/@author?utm_source=tripweaver&utm_medium=referral',
      license: 'Unsplash License', licenseUrl: 'https://unsplash.com/license?utm_source=tripweaver&utm_medium=referral', changes: '官方URL',
    } };
    entry.downloadLocation = 'https://api.unsplash.com/photos/branch/download?ixid=original';
    entry.sha256 = reviewDigest(entry.photo.url);
    let adoptions = 0;
    const lookup = () => createGenerationPhotoLookup(f.city, f.index, { loadSources: f.load,
      loadAssignments: () => loadIndependentPhotoAssignments(f.client, f.city), adoption: { store: f.store,
        adoptUnsplash: async () => { adoptions++; return true; } } });
    assert.equal(await lookup()(f.names[0]!), null); assert.equal(adoptions, 0);
    const decision = await f.makeDecision(); decision.images = [decision.images[3]!];
    decision.expectedEntityRevisions = { [f.ids[0]!]: 1 };
    await applyIndependentPhotoDecision(f.client, decision, f.load);
    const read = lookup();
    assert.equal((await read(f.names[0]!))?.coverUrl, entry.photo.url);
    await read(f.names[0]!); assert.equal(adoptions, 1);
    await f.client.query(`UPDATE canonical_places SET verified=false WHERE id=$1`, [f.ids[0]]);
    assert.equal(await lookup()(f.names[0]!), null); assert.equal(adoptions, 1);
  } finally { await f.close(); }
});

test('地点导入持城市锁时，等待中的图片分配必须按提交后的实体版本重新校验', async () => {
  const f = await fixture(), other = await pool.connect();
  try {
    const decision = await f.makeDecision();
    await f.client.query('COMMIT');
    await f.client.query('BEGIN');
    await captureIdentityImport(f.client, f.city);
    await f.client.query(`UPDATE canonical_places SET payload=jsonb_set(payload,'{identity,revision}','2') WHERE id=$1`, [f.ids[0]]);
    await other.query('BEGIN');
    const waiting = applyIndependentPhotoDecision(other, decision, f.load).then(() => null, error => error);
    await f.client.query('COMMIT');
    const error = await waiting;
    assert.match(error?.message ?? '', /版本过期/);
    await other.query('ROLLBACK');
    assert.deepEqual(await loadIndependentPhotoAssignments(f.client, f.city), []);
  } finally { await other.query('ROLLBACK'); other.release(); await f.close(); }
});

test('正式图片入口的分店相册随行程保存和编辑保持身份，旧版本不回写', async () => {
  const f = await fixture();
  try {
    await applyIndependentPhotoDecision(f.client, await f.makeDecision(), f.load);
    const lookup = f.lookup(), trip = makeSampleTrip(), user = randomUUID(); trip.destination = f.city;
    await pool.query("INSERT INTO users(id,email,password_hash,created_at) VALUES($1,$2,'',now())", [user, `${user}@example.test`]);
    trip.overview = await Promise.all(f.ids.slice(0, 2).map(async (id, i) => ({ id, canonicalPlaceId: id,
      name: f.names[i]!, category: 'food' as const, intro: '', reservation: 'unknown' as const, sourceLinks: [],
      ...await lookup(f.names[i]!) })));
    const saved = await createTrip(user, trip);
    assert.deepEqual((await getTrip(user, saved.id))?.overview, saved.overview);
    const ops = normalizeEditOps(f.names.slice(0, 2).map(name => ({ kind: 'add_activity', dayIndex: 1, activity: { name, category: '美食' } })));
    const bound = bindEditPlaceIdentities(saved, editActivityDrafts(ops), await f.index(), '添加两家明确分店');
    const edited = applyItineraryEdits(bound, ops);
    assert.equal(edited.changed, true);
    const next = await createTrip(user, edited.trip, saved.id), reread = await getTrip(user, next.id);
    for (const id of f.ids.slice(0, 2)) assert.equal(reread?.days.flatMap(day => day.activities).filter(a => a.canonicalPlaceId === id).length, 1);
    assert.deepEqual(reread?.overview, saved.overview);
    assert.deepEqual(await getTrip(user, saved.id), saved);
  } finally { await f.close(); }
});

test('正式CLI默认事务预演、应用幂等和回滚，源目录及字节保持不变', async () => {
  const f = await fixture();
  try {
    await f.client.query('COMMIT');
    const inputs = await f.load();
    const decision = await f.makeDecision(); decision.images = decision.images.slice(0, 3);
    const libraryFile = path.join(f.root, 'selected.json'), decisionsFile = path.join(f.root, 'decisions.json');
    await writeFile(libraryFile, JSON.stringify(f.library)); await writeFile(decisionsFile, JSON.stringify([decision]));
    const execute = async (label: string, args: string[]) => {
      const out = path.join(f.root, `${label}.json`);
      await promisify(execFile)(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('../../scripts/govern-independent-photos.mts', import.meta.url)),
        '--out', out, '--data-root', f.root, '--library', libraryFile, ...args], { env: process.env, windowsHide: true, timeout: 30000 });
      return JSON.parse(await readFile(out, 'utf8'));
    };
    assert.equal((await execute('preview', ['--decisions', decisionsFile])).apply, false);
    assert.deepEqual(await loadIndependentPhotoAssignments(f.client, f.city), []);
    await execute('apply', ['--decisions', decisionsFile, '--apply']);
    await execute('repeat', ['--decisions', decisionsFile, '--apply']);
    assert.equal((await loadIndependentPhotoAssignments(f.client, f.city)).length, 3);
    await execute('rollback', ['--rollback', decision.key, '--apply']);
    assert.deepEqual(await loadIndependentPhotoAssignments(f.client, f.city), []);
    assert.deepEqual((await f.load()).sources, inputs.sources);
  } finally { await f.close(); }
});
