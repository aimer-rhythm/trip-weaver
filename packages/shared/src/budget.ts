import type { BudgetSummary, Trip } from './types';

/** 十位取整（预算区间展示口径） */
function roundToTens(n: number): number {
  return Math.round(n / 10) * 10;
}

// 预算区间聚合（ST3 预算区间化）—— 前端面板与审校 Agent 的 get_budget_status 工具共用同一份逻辑
// 口径：日成本 = 当天各活动 cost（缺省跳过）求和 ÷ partySize；区间 = 有数据天均值 × [0.8, 1.3]，十位取整
export function computeBudgetSummary(trip: Trip): BudgetSummary {
  const partySize = Math.max(1, trip.partySize);
  let total = 0;
  let coveredDays = 0;

  for (const day of trip.days) {
    let hasData = false;
    for (const activity of day.activities) {
      if (typeof activity.cost === 'number') {
        total += activity.cost;
        hasData = true;
      }
    }
    if (hasData) coveredDays += 1;
  }

  if (coveredDays === 0) return { perPersonPerDayMin: 0, perPersonPerDayMax: 0, coveredDays: 0 };
  const perPersonPerDay = total / partySize / coveredDays;
  return {
    perPersonPerDayMin: roundToTens(perPersonPerDay * 0.8),
    perPersonPerDayMax: roundToTens(perPersonPerDay * 1.3),
    coveredDays,
  };
}
