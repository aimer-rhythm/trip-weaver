import { and, asc, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import {
  MAX_TRIPS_PER_USER,
  uid,
  type Trip,
  type TripListItem,
  type TripVersionChain,
} from '@tripweaver/shared';
import { db } from '../db/client';
  type TripListPage,
  type TripListSort,
import { trips } from '../db/schema';

type TripWriter = Pick<typeof db, 'select' | 'insert'>;

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
 * 行程列表分页（10-03）：每条版本链只返回最新版，筛选/排序/计数全在 SQL 里做。
 * 内层 `distinct on (root_id)` 只按 user_id 过滤，筛选放到外层 ——
 * WHERE 在 DISTINCT ON 之前求值，混在一层会让旧版本命中筛选词后把旧内容当最新版返回。
 */
export async function listTripsPage(userId: string, query: TripListQuery): Promise<TripListPage> {
  const latest = db
    .selectDistinctOn([trips.rootId])
    .from(trips)
    .where(eq(trips.userId, userId))
    .orderBy(trips.rootId, desc(trips.version))
    .as('latest');

  const filters: SQL[] = [];
  const city = query.city?.trim();
  if (city) filters.push(eq(latest.destination, city));
  const keyword = query.q?.trim();
  if (keyword) {
    const pattern = `%${escapeLike(keyword)}%`;
    filters.push(or(ilike(latest.title, pattern), ilike(latest.destination, pattern))!);
  }
  const where = filters.length ? and(...filters) : undefined;

  // 三种排序都以 title/id 收尾，等值时 offset 分页不会跨页重复或漏项
  const order = query.sort === 'name'
    ? [asc(latest.title), asc(latest.id)]
    : query.sort === 'created'
      ? [desc(latest.createdAt), asc(latest.title), asc(latest.id)]
      : [desc(latest.updatedAt), asc(latest.title), asc(latest.id)];

  const [rows, counted, destinations] = await Promise.all([
    db.select().from(latest).where(where).orderBy(...order).limit(query.limit).offset(query.offset),
    db.select({ n: sql<number>`count(*)::int` }).from(latest).where(where),
    db.selectDistinct({ destination: trips.destination }).from(trips).where(eq(trips.userId, userId)).orderBy(asc(trips.destination)),
  ]);

  return {
    items: rows.map(toListItem),
    total: Number(counted[0]?.n ?? 0),
    destinations: destinations.map((row) => row.destination),
  };
}

/** 版本链（含历史版本）；非本人或不存在返回 null，路由统一 404 */
export async function listTripVersions(userId: string, id: string): Promise<TripVersionChain | null> {
  const [anchor] = await db
/** LIKE 元字符转义：用户输入不能被当成通配符（口径同 generation/placeRetrieval） */
function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, '\\$&');
}

export interface TripListQuery {
  offset: number;
  limit: number;
  q?: string | undefined;
  city?: string | undefined;
  sort?: TripListSort | undefined;
}

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
export async function createTrip(userId: string, source: Trip, revisionOf?: string, writer: TripWriter = db): Promise<Trip> {
  const [count] = await writer.select({ n: sql<number>`count(*)` }).from(trips).where(eq(trips.userId, userId));
  if (Number(count?.n ?? 0) >= MAX_TRIPS_PER_USER) {
    throw Object.assign(new Error(`行程数量已达上限（${MAX_TRIPS_PER_USER} 条），请先清理历史行程`), { statusCode: 409 });
  }
  const nowMs = Date.now();
  const now = new Date(nowMs);
  const trip: Trip = { ...source, id: uid(), createdAt: nowMs, updatedAt: nowMs };
  // 修订（PR5）：新行程挂到被修订行程所在版本链的下一版，旧版原样保留
  const lineage = revisionOf
    ? await revisionLineage(userId, revisionOf, writer)
    : { rootId: trip.id, version: 1, parentId: null as string | null };
  await writer.insert(trips).values({
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
  writer: TripWriter,
): Promise<{ rootId: string; version: number; parentId: string }> {
  const [target] = await writer
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
