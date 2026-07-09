import { and, eq, gte, sql } from 'drizzle-orm';
import { startOfToday, startOfTomorrow, type UsageView } from '@tripweaver/shared';
import { db } from '../db/client';
import { generations } from '../db/schema';
import { env } from '../env';

/** 今日已成功生成次数（失败/取消不计，PRD F8） */
export function usedToday(userId: string): number {
  const row = db
    .select({ n: sql<number>`count(*)` })
    .from(generations)
    .where(
      and(eq(generations.userId, userId), eq(generations.status, 'done'), gte(generations.createdAt, startOfToday())),
    )
    .get();
  return row?.n ?? 0;
}

export function usageView(userId: string): UsageView {
  const used = usedToday(userId);
  return {
    usedToday: used,
    dailyLimit: env.genDailyLimit,
    remaining: Math.max(0, env.genDailyLimit - used),
    resetAt: startOfTomorrow(),
  };
}

export function hasQuota(userId: string): boolean {
  return usedToday(userId) < env.genDailyLimit;
}

// ---------- 全站外部数据源日额度（架构 §6） ----------
// 以 generations 用量列聚合为准（含 error/cancelled——外呼已实际发生），60s 内存缓存。
// 运行中任务的调用未入库，并发下有界超额（≤ 并发任务数 × 单任务上限），KISS 取舍已记录于任务 PRD。

const dailyAgg: Record<'amap' | 'search', { at: number; total: number }> = {
  amap: { at: 0, total: 0 },
  search: { at: 0, total: 0 },
};

function callsToday(key: 'amap' | 'search'): number {
  const agg = dailyAgg[key];
  if (Date.now() - agg.at > 60_000) {
    const column = key === 'amap' ? generations.amapCalls : generations.searchCalls;
    const row = db
      .select({ n: sql<number>`coalesce(sum(${column}), 0)` })
      .from(generations)
      .where(gte(generations.createdAt, startOfToday()))
      .get();
    agg.total = row?.n ?? 0;
    agg.at = Date.now();
  }
  return agg.total;
}

export function amapBudgetRemaining(): number {
  return Math.max(0, env.amapDailyBudget - callsToday('amap'));
}

export function searchBudgetRemaining(): number {
  return Math.max(0, env.searchDailyBudget - callsToday('search'));
}
