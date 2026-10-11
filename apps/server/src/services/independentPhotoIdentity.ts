// 调用方持事务；与地点导入共用城市锁，原目录和历史行程均不写入。
import type { PoolClient } from 'pg';
import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { placeIdentity, type IdentityPlace } from '../lib/placeIdentity';
import { photoIdentityDigest, photoIdentityJson, type IndependentPhotoSources } from './independentPhotoSources';

const id = () => Type.String({ minLength: 1, maxLength: 128 });
const hash = () => Type.String({ pattern: '^[a-f0-9]{64}$' });
const revision = () => Type.Integer({ minimum: 1 });
export const IndependentPhotoDecisionSchema = Type.Object({
  key: id(), city: Type.String({ minLength: 1, maxLength: 128 }),
  expectedEntityRevisions: Type.Record(Type.String(), Type.Union([revision(), Type.Null()])),
  images: Type.Array(Type.Object({ imageKey: Type.String({ pattern: '^(selected|reviewed):[a-f0-9]{64}$' }),
    inputHash: hash(), entityId: Type.Union([id(), Type.Null()]), expectedRevision: Type.Integer({ minimum: 0 }),
  }, { additionalProperties: false }), { minItems: 1, maxItems: 1000 }),
  evidence: Type.Array(Type.Record(Type.String(), Type.Unknown()), { minItems: 1, maxItems: 100 }),
}, { additionalProperties: false });
export type IndependentPhotoDecision = Static<typeof IndependentPhotoDecisionSchema>;
export interface IndependentPhotoAssignment {
  city: string; image_key: string; input_hash: string; asset_key: string;
  entity_id: string | null; entity_revision: number | null; revision: number; change_key: string;
}
type SourceState = { imageKey: string; inputHash: string; assetKey: string; eligible: boolean };
type EntityState = { id: string; city: string; name: string | null; revision: number | null; eligible: boolean; identity: unknown; scope: unknown };
type PhotoState = { sources: SourceState[]; entities: EntityState[]; assignments: IndependentPhotoAssignment[] };
type PhotoChange = { city: string; request: IndependentPhotoDecision; before_state: PhotoState; after_state: PhotoState; rolled_back_at: unknown };
export type IndependentPhotoLoader = (city: string) => Promise<IndependentPhotoSources>;

export async function loadIndependentPhotoAssignments(client: Pick<PoolClient, 'query'>, city: string): Promise<IndependentPhotoAssignment[]> {
  return (await client.query<IndependentPhotoAssignment>('SELECT * FROM independent_photo_assignments WHERE city=$1 ORDER BY image_key', [city])).rows;
}
const lock = (client: PoolClient, city: string) => client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`place-identity:${city}`]);
const same = (a: unknown, b: unknown) => photoIdentityJson(a) === photoIdentityJson(b);

async function entityStates(client: PoolClient, city: string, ids: readonly string[]): Promise<EntityState[]> {
  const places = (await client.query<IdentityPlace & { verified: boolean }>(
    'SELECT id,city,name,verified,payload FROM canonical_places WHERE city=$1 AND id=ANY($2::text[])', [city, ids])).rows;
  return [...ids].sort().map(id => {
    const place = places.find(p => p.id === id);
    const identity = place ? placeIdentity(place) : {};
    const valid = identity.version === 2 && identity.entityId === id && Number.isInteger(identity.revision) && Number(identity.revision) > 0;
    return { id, city, name: place?.name ?? null, revision: valid ? Number(identity.revision) : null,
      eligible: !!place?.verified && valid && !place.payload?.canonicalRedirectTo && !place.payload?.identityWithdrawal,
      identity: place?.payload?.identity ?? null, scope: place?.payload?.imageIdentity ?? null };
  });
}

function sourceStates(city: string, inputs: IndependentPhotoSources, keys: string[], previous: readonly IndependentPhotoAssignment[]): SourceState[] {
  if (inputs.sources.some(source => source.city !== city)) throw new Error('图片来源城市与治理城市不一致');
  return [...keys].sort().map(imageKey => {
    const source = inputs.sources.find(s => s.imageKey === imageKey);
    if (source) return { imageKey, inputHash: source.inputHash, assetKey: source.assetKey, eligible: source.eligible };
    const old = previous.find(row => row.image_key === imageKey);
    if (!old) throw new Error('图片键不在当前独立图库中');
    return { imageKey, inputHash: photoIdentityDigest(['missing_photo', imageKey]), assetKey: old.asset_key, eligible: false };
  });
}
async function capture(client: PoolClient, city: string, sources: SourceState[], ids: string[], assetKeys: string[]): Promise<PhotoState> {
  return { sources, entities: await entityStates(client, city, ids), assignments: (await loadIndependentPhotoAssignments(client, city))
    .filter(row => sources.some(s => s.imageKey === row.image_key) || assetKeys.includes(row.asset_key)) };
}

export async function applyIndependentPhotoDecision(client: PoolClient, input: unknown, loadSources: IndependentPhotoLoader): Promise<PhotoState> {
  if (!Value.Check(IndependentPhotoDecisionSchema, input)) throw new Error('独立图片决策格式无效');
  const decision = input;
  if (new Set(decision.images.map(i => i.imageKey)).size !== decision.images.length) throw new Error('同一图片不能重复分配');
  await lock(client, decision.city);
  const oldChange = (await client.query<PhotoChange>('SELECT * FROM independent_photo_changes WHERE change_key=$1', [decision.key])).rows[0];
  if (oldChange) {
    if (oldChange.rolled_back_at || !same(oldChange.request, decision)) throw new Error('图片治理key已使用或已回滚');
    return oldChange.after_state;
  }
  const current = await loadIndependentPhotoAssignments(client, decision.city);
  const inputs = await loadSources(decision.city);
  const sources = sourceStates(decision.city, inputs, decision.images.map(i => i.imageKey), current);
  const ids = [...new Set(decision.images.flatMap(item => [item.entityId, current.find(r => r.image_key === item.imageKey)?.entity_id]
    .filter((value): value is string => !!value)))].sort();
  const assets = [...new Set([...sources.map(s => s.assetKey), ...current.filter(r => decision.images.some(i => i.imageKey === r.image_key)).map(r => r.asset_key)])];
  const before = await capture(client, decision.city, sources, ids, assets);
  if (!same(Object.keys(decision.expectedEntityRevisions).sort(), ids)
    || before.entities.some(e => decision.expectedEntityRevisions[e.id] !== e.revision)) throw new Error('图片分配实体版本过期或缺少新旧目标');
  const next: IndependentPhotoAssignment[] = decision.images.map(item => {
    const old = current.find(row => row.image_key === item.imageKey), source = sources.find(s => s.imageKey === item.imageKey)!;
    if (item.expectedRevision !== (old?.revision ?? 0) || item.inputHash !== source.inputHash) throw new Error('图片分配版本、文件或审核来源已变化');
    const target = before.entities.find(e => e.id === item.entityId);
    if (item.entityId && (!source.eligible || !target?.eligible)) throw new Error('图片或目标身份不可用，不能分配');
    return { city: decision.city, image_key: item.imageKey, input_hash: source.inputHash, asset_key: source.assetKey,
      entity_id: item.entityId, entity_revision: target?.revision ?? null, revision: (old?.revision ?? 0) + 1, change_key: decision.key };
  });
  const projected = [...current.filter(row => !next.some(n => n.image_key === row.image_key)), ...next];
  const owners = new Map<string, string>();
  for (const row of projected) {
    if (!row.entity_id) continue;
    if (owners.has(row.asset_key) && owners.get(row.asset_key) !== row.entity_id) throw new Error('同一图片不能分给两个不同实体');
    owners.set(row.asset_key, row.entity_id);
  }
  for (const row of next) {
    await client.query(`INSERT INTO independent_photo_assignments(city,image_key,input_hash,asset_key,entity_id,entity_revision,revision,change_key)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(city,image_key) DO UPDATE SET input_hash=excluded.input_hash,
      asset_key=excluded.asset_key,entity_id=excluded.entity_id,entity_revision=excluded.entity_revision,revision=excluded.revision,change_key=excluded.change_key`,
      [row.city, row.image_key, row.input_hash, row.asset_key, row.entity_id, row.entity_revision, row.revision, row.change_key]);
  }
  // 读取媒体在事务锁之外也可能被后台更新；写审计前重读，变化则让整个事务失败。
  const fresh = sourceStates(decision.city, await loadSources(decision.city), decision.images.map(i => i.imageKey), current);
  if (!same(fresh, sources)) throw new Error('图片来源在治理期间变化，请重新冻结');
  const after = await capture(client, decision.city, sources, ids, assets);
  await client.query(`INSERT INTO independent_photo_changes(change_key,city,request,before_state,after_state,created_at)
    VALUES($1,$2,$3,$4,$5,now())`, [decision.key, decision.city, JSON.stringify(decision), JSON.stringify(before), JSON.stringify(after)]);
  return after;
}

export async function rollbackIndependentPhotoDecision(client: PoolClient, key: string, loadSources: IndependentPhotoLoader): Promise<PhotoState> {
  const change = (await client.query<PhotoChange>('SELECT * FROM independent_photo_changes WHERE change_key=$1', [key])).rows[0];
  if (!change) throw new Error('图片治理审计不存在');
  await lock(client, change.city);
  const entry = (await client.query<PhotoChange>('SELECT * FROM independent_photo_changes WHERE change_key=$1 FOR UPDATE', [key])).rows[0]!;
  if (entry.rolled_back_at) return entry.before_state;
  const current = await loadIndependentPhotoAssignments(client, entry.city);
  const keys = entry.request.images.map(i => i.imageKey);
  const sources = sourceStates(entry.city, await loadSources(entry.city), keys, current);
  const assets = [...new Set([...entry.before_state.assignments.map(r => r.asset_key), ...entry.after_state.assignments.map(r => r.asset_key),
    ...entry.after_state.sources.map(s => s.assetKey)])];
  const state = await capture(client, entry.city, sources, entry.after_state.entities.map(e => e.id), assets);
  if (!same(state, entry.after_state)) throw new Error('图片、来源或实体已有后续变化，拒绝过期回滚');
  await client.query('DELETE FROM independent_photo_assignments WHERE city=$1 AND image_key=ANY($2::text[])', [entry.city, keys]);
  const restore = entry.before_state.assignments.filter(row => keys.includes(row.image_key));
  if (restore.length) await client.query('INSERT INTO independent_photo_assignments SELECT * FROM jsonb_populate_recordset(NULL::independent_photo_assignments,$1::jsonb)', [JSON.stringify(restore)]);
  const fresh = sourceStates(entry.city, await loadSources(entry.city), keys, current);
  if (!same(fresh, sources)) throw new Error('图片来源在回滚期间变化，请重新冻结');
  await client.query('UPDATE independent_photo_changes SET rolled_back_at=now() WHERE change_key=$1', [key]);
  return entry.before_state;
}
