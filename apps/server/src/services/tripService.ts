import { and, asc, desc, eq, sql } from 'drizzle-orm';
import {
  MAX_TRIPS_PER_USER,
  uid,
  type Trip,
  type TripListItem,
  type TripVersionChain,
} from '@tripweaver/shared';
import { db } from '../db/client';
import { trips } from '../db/schema';

function summarize(trip: Trip) {
  // 冗余列 total_cost：粗估合计（cost 可选化后缺省按 0 计，仅供列表页「约 ¥」展示）
  const totalCost = trip.days.reduce((n, d) => n + d.activities.reduce((m, a) => m + (a.cost ?? 0), 0), 0);
  return {
    title: trip.title,
    destination: trip.destination,
    daysCount: trip.days.length,
    activityCount: trip.days.reduce((n, d) => n + d.activities.length, 0),
    totalCost: Math.round(totalCost),
    usedXhs: trip.meta.usedXhs,
  };
}

function toListItem(row: typeof trips.$inferSelect): TripListItem {
  return {
    id: row.id,
    title: row.title,
    destination: row.destination,
    daysCount: row.daysCount,
    activityCount: row.activityCount,
    totalCost: row.totalCost,
    usedXhs: row.usedXhs,
    version: row.version,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

/**
 * 行程列表：每条版本链只返回最新版（09-23）。
 * 在 JS 里做归并而不是 SQL 自连接：单用户上限 MAX_TRIPS_PER_USER 条，
 * 一次全取 + Map 归并既便宜又不会写错，比子查询/自连接好读。
 */
export async function listTrips(userId: string): Promise<TripListItem[]> {
  const rows = await db.select().from(trips).where(eq(trips.userId, userId)).orderBy(desc(trips.updatedAt));
  const latestByRoot = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const kept = latestByRoot.get(row.rootId);
    if (!kept || row.version > kept.version) latestByRoot.set(row.rootId, row);
  }
  return [...latestByRoot.values()]
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .map(toListItem);
}

/** 版本链（含历史版本）；非本人或不存在返回 null，路由统一 404 */
export async function listTripVersions(userId: string, id: string): Promise<TripVersionChain | null> {
  const [anchor] = await db
    .select({ rootId: trips.rootId })
    .from(trips)
    .where(and(eq(trips.id, id), eq(trips.userId, userId)));
  if (!anchor) return null;
  const rows = await db
    .select({ id: trips.id, version: trips.version, title: trips.title, createdAt: trips.createdAt })
    .from(trips)
    .where(and(eq(trips.rootId, anchor.rootId), eq(trips.userId, userId)))
    .orderBy(asc(trips.version));
  return {
    rootId: anchor.rootId,
    versions: rows.map((row) => ({ ...row, createdAt: row.createdAt.getTime() })),
  };
}

export async function getTrip(userId: string, id: string): Promise<Trip | null> {
  const [row] = await db.select().from(trips).where(and(eq(trips.id, id), eq(trips.userId, userId)));
  return row ? (row.data as Trip) : null;
}

/** 新建（导入 / 生成落库共用）：分配新 id 与时间戳，归属当前用户；全新行程自为版本链根 */
export async function createTrip(userId: string, source: Trip, revisionOf?: string): Promise<Trip> {
  const [count] = await db.select({ n: sql<number>`count(*)` }).from(trips).where(eq(trips.userId, userId));
  if (Number(count?.n ?? 0) >= MAX_TRIPS_PER_USER) {
    throw Object.assign(new Error(`行程数量已达上限（${MAX_TRIPS_PER_USER} 条），请先清理历史行程`), { statusCode: 409 });
  }
  const nowMs = Date.now();
  const now = new Date(nowMs);
  const trip: Trip = { ...source, id: uid(), createdAt: nowMs, updatedAt: nowMs };
  // 修订（PR5）：新行程挂到被修订行程所在版本链的下一版，旧版原样保留
  const lineage = revisionOf
    ? await revisionLineage(userId, revisionOf)
    : { rootId: trip.id, version: 1, parentId: null as string | null };
  await db.insert(trips).values({
    id: trip.id,
    userId,
    ...summarize(trip),
    rootId: lineage.rootId,
    version: lineage.version,
    parentId: lineage.parentId,
    data: trip,
    createdAt: now,
    updatedAt: now,
  });
  return trip;
}

/** 版本链血缘：目标行程必须属于当前用户（越权与非存在返回同一个 404 语义） */
async function revisionLineage(
  userId: string,
  targetTripId: string,
): Promise<{ rootId: string; version: number; parentId: string }> {
  const [target] = await db
    .select({ rootId: trips.rootId, version: trips.version })
    .from(trips)
    .where(and(eq(trips.id, targetTripId), eq(trips.userId, userId)));
  if (!target) throw Object.assign(new Error('被修订的行程不存在'), { statusCode: 404 });
  return { rootId: target.rootId, version: target.version + 1, parentId: targetTripId };
}

export async function updateTrip(userId: string, id: string, incoming: Trip): Promise<Trip | null> {
  const [existing] = await db.select().from(trips).where(and(eq(trips.id, id), eq(trips.userId, userId)));
  if (!existing) return null;
  const nowMs = Date.now();
  // id 与 createdAt 以服务端为准，防止客户端篡改
  const trip: Trip = { ...incoming, id, createdAt: existing.createdAt.getTime(), updatedAt: nowMs };
  await db
    .update(trips)
    .set({ ...summarize(trip), data: trip, updatedAt: new Date(nowMs) })
    .where(and(eq(trips.id, id), eq(trips.userId, userId)));
  return trip;
}

export async function renameTrip(userId: string, id: string, title: string): Promise<boolean> {
  const trip = await getTrip(userId, id);
  if (!trip) return false;
  return (await updateTrip(userId, id, { ...trip, title })) !== null;
}

export async function deleteTrip(userId: string, id: string): Promise<boolean> {
  const rows = await db.delete(trips).where(and(eq(trips.id, id), eq(trips.userId, userId))).returning({ id: trips.id });
  return rows.length > 0;
}
