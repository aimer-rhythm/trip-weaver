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
    usedXhs: trip.meta.usedXhs ? 1 : 0,
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
    usedXhs: Boolean(row.usedXhs),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function listTrips(userId: string): TripListItem[] {
  return db.select().from(trips).where(eq(trips.userId, userId)).orderBy(desc(trips.updatedAt)).all().map(toListItem);
}

export function getTrip(userId: string, id: string): Trip | null {
  const row = db.select().from(trips).where(and(eq(trips.id, id), eq(trips.userId, userId))).get();
  return row ? (JSON.parse(row.data) as Trip) : null;
}

/** 新建（导入 / 生成落库共用）：分配新 id 与时间戳，归属当前用户 */
export function createTrip(userId: string, source: Trip): Trip {
  const count = db.select({ n: sql<number>`count(*)` }).from(trips).where(eq(trips.userId, userId)).get();
  if ((count?.n ?? 0) >= MAX_TRIPS_PER_USER) {
    throw Object.assign(new Error(`行程数量已达上限（${MAX_TRIPS_PER_USER} 条），请先清理历史行程`), { statusCode: 409 });
  }
  const now = Date.now();
  const trip: Trip = { ...source, id: uid(), createdAt: now, updatedAt: now };
  db.insert(trips)
    .values({ id: trip.id, userId, ...summarize(trip), data: JSON.stringify(trip), createdAt: now, updatedAt: now })
    .run();
  return trip;
}

export function updateTrip(userId: string, id: string, incoming: Trip): Trip | null {
  const existing = db.select().from(trips).where(and(eq(trips.id, id), eq(trips.userId, userId))).get();
  if (!existing) return null;
  const now = Date.now();
  // id 与 createdAt 以服务端为准，防止客户端篡改
  const trip: Trip = { ...incoming, id, createdAt: existing.createdAt, updatedAt: now };
  db.update(trips)
    .set({ ...summarize(trip), data: JSON.stringify(trip), updatedAt: now })
    .where(and(eq(trips.id, id), eq(trips.userId, userId)))
    .run();
  return trip;
}

export function renameTrip(userId: string, id: string, title: string): boolean {
  const trip = getTrip(userId, id);
  if (!trip) return false;
  return updateTrip(userId, id, { ...trip, title }) !== null;
}

export function deleteTrip(userId: string, id: string): boolean {
  const res = db.delete(trips).where(and(eq(trips.id, id), eq(trips.userId, userId))).run();
  return res.changes > 0;
}
