import { and, eq, gte, sql } from 'drizzle-orm';
import { startOfToday, startOfTomorrow, type UsageView } from '@tripweaver/shared';
import { db } from '../db/client';
import { generations } from '../db/schema';
import { env } from '../env';

/** 今日已成功生成次数（失败/取消不计，PRD F8） */
export async function usedToday(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(generations)
    .where(
      and(
        eq(generations.userId, userId),
        eq(generations.status, 'done'),
        gte(generations.createdAt, new Date(startOfToday())),
      ),
    );
  return Number(row?.n ?? 0);
}

export async function usageView(userId: string): Promise<UsageView> {
  const used = await usedToday(userId);
  return {
    usedToday: used,
    dailyLimit: env.genDailyLimit,
    remaining: Math.max(0, env.genDailyLimit - used),
    resetAt: startOfTomorrow(),
  };
}

export async function hasQuota(userId: string): Promise<boolean> {
  return (await usedToday(userId)) < env.genDailyLimit;
}

// ---------- 全站外部数据源日额度（架构 §6） ----------
// 以 generations 用量列聚合为准（含 error/cancelled——外呼已实际发生），60s 内存缓存。
// 运行中任务的调用未入库，并发下有界超额（≤ 并发任务数 × 单任务上限），KISS 取舍已记录于任务 PRD。

const dailyAgg: Record<'amap' | 'search', { at: number; total: number }> = {
  amap: { at: 0, total: 0 },
  search: { at: 0, total: 0 },
};

async function callsToday(key: 'amap' | 'search'): Promise<number> {
  const agg = dailyAgg[key];
  if (Date.now() - agg.at > 60_000) {
    const column = key === 'amap' ? generations.amapCalls : generations.searchCalls;
    const [row] = await db
      .select({ n: sql<number>`coalesce(sum(${column}), 0)` })
      .from(generations)
      .where(gte(generations.createdAt, new Date(startOfToday())));
    agg.total = Number(row?.n ?? 0);
    agg.at = Date.now();
  }
  return agg.total;
}

export async function amapBudgetRemaining(): Promise<number> {
  return Math.max(0, env.amapDailyBudget - (await callsToday('amap')));
}

export async function searchBudgetRemaining(): Promise<number> {
  return Math.max(0, env.searchDailyBudget - (await callsToday('search')));
}
