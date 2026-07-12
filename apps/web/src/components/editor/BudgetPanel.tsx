import { useMemo } from 'react';
import { computeBudgetSummary } from '@tripweaver/shared';
import { useEditorStore } from '../../store/editorStore';

// 预算区间化（ST3）：只展示人均每日粗估区间 + 免责声明，不再有精确总额与超支判定
export function BudgetPanel() {
  const trip = useEditorStore((s) => s.trip);
  const summary = useMemo(() => (trip ? computeBudgetSummary(trip) : null), [trip]);
  if (!trip || !summary) return null;

  return (
    <div className="budget-panel">
      <section className="budget-block">
        <h3>费用估算</h3>
        {summary.coveredDays > 0 ? (
          <>
            <p className="budget-total">
              人均约 <strong>¥{summary.perPersonPerDayMin}–{summary.perPersonPerDayMax}</strong>/天
              <span className="muted">（门票餐饮等，不含大交通与住宿）</span>
            </p>
            {summary.coveredDays < trip.days.length && (
              <p className="muted">仅 {summary.coveredDays}/{trip.days.length} 天有费用数据，区间按有数据的天计算。</p>
            )}
          </>
        ) : (
          <p className="muted">暂无费用数据（各活动均未填费用）</p>
        )}
        <p className="muted budget-disclaimer">AI 估算，出行前请核实。</p>
      </section>
    </div>
  );
}
