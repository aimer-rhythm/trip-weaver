import { and, desc, eq, sql } from 'drizzle-orm';
import { MAX_TRIPS_PER_USER, uid, type Trip, type TripListItem } from '@tripweaver/shared';
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
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

export async function listTrips(userId: string): Promise<TripListItem[]> {
  const rows = await db.select().from(trips).where(eq(trips.userId, userId)).orderBy(desc(trips.updatedAt));
  return rows.map(toListItem);
}

export async function getTrip(userId: string, id: string): Promise<Trip | null> {
  const [row] = await db.select().from(trips).where(and(eq(trips.id, id), eq(trips.userId, userId)));
  return row ? (row.data as Trip) : null;
}

/** 新建（导入 / 生成落库共用）：分配新 id 与时间戳，归属当前用户 */
export async function createTrip(userId: string, source: Trip): Promise<Trip> {
  const [count] = await db.select({ n: sql<number>`count(*)` }).from(trips).where(eq(trips.userId, userId));
  if (Number(count?.n ?? 0) >= MAX_TRIPS_PER_USER) {
    throw Object.assign(new Error(`行程数量已达上限（${MAX_TRIPS_PER_USER} 条），请先清理历史行程`), { statusCode: 409 });
  }
  const nowMs = Date.now();
  const now = new Date(nowMs);
  const trip: Trip = { ...source, id: uid(), createdAt: nowMs, updatedAt: nowMs };
  await db.insert(trips).values({ id: trip.id, userId, ...summarize(trip), data: trip, createdAt: now, updatedAt: now });
  return trip;
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
