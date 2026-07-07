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

// ---------- 全站小红书日额度（架构 §6） ----------
// 以 generations.xhs_calls 聚合为准（含 error/cancelled——外呼已实际发生），60s 内存缓存。
// 运行中任务的调用未入库，并发下有界超额（≤ 并发任务数 × 14 次/任务），KISS 取舍已记录于任务 PRD。

const xhsAgg = { at: 0, total: 0 };

export function xhsCallsToday(): number {
  if (Date.now() - xhsAgg.at > 60_000) {
    const row = db
      .select({ n: sql<number>`coalesce(sum(${generations.xhsCalls}), 0)` })
      .from(generations)
      .where(gte(generations.createdAt, startOfToday()))
      .get();
    xhsAgg.total = row?.n ?? 0;
    xhsAgg.at = Date.now();
  }
  return xhsAgg.total;
}

export function xhsBudgetRemaining(): number {
  return Math.max(0, env.xhsDailyBudget - xhsCallsToday());
}
