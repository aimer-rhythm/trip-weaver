import { ACTIVITY_CATEGORIES } from './constants';
import type { ActivityCategory, BudgetSummary, Trip } from './types';

// 预算聚合 —— 前端面板与审校 Agent 的 get_budget_status 工具共用同一份逻辑
export function computeBudgetSummary(trip: Trip): BudgetSummary {
  let total = 0;
  const perDay: BudgetSummary['perDay'] = [];
  const categoryMap = new Map<ActivityCategory, number>();

  for (const day of trip.days) {
    let dayAmount = 0;
    for (const activity of day.activities) {
      dayAmount += activity.cost;
      categoryMap.set(activity.category, (categoryMap.get(activity.category) ?? 0) + activity.cost);
    }
    total += dayAmount;
    perDay.push({ dayId: day.id, dayIndex: day.dayIndex, amount: dayAmount });
  }

  const perCategory = ACTIVITY_CATEGORIES
    .map((category) => ({ category, amount: categoryMap.get(category) ?? 0 }))
    .filter((entry) => entry.amount > 0);

  return {
    total,
    perDay,
    perCategory,
    overBudget: trip.totalBudget > 0 && total > trip.totalBudget,
  };
}
