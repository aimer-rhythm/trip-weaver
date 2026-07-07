import { useMemo } from 'react';
import { computeBudgetSummary } from '@tripweaver/shared';
import { CATEGORY_COLORS, dayColor } from '../../lib/colors';
import { useEditorStore } from '../../store/editorStore';

export function BudgetPanel() {
  const trip = useEditorStore((s) => s.trip);
  const summary = useMemo(() => (trip ? computeBudgetSummary(trip) : null), [trip]);
  if (!trip || !summary) return null;

  const budget = trip.totalBudget;
  const maxDay = Math.max(1, ...summary.perDay.map((d) => d.amount));
  const maxCat = Math.max(1, ...summary.perCategory.map((c) => c.amount));
  const ratio = budget > 0 ? Math.min(1, summary.total / budget) : 0;

  return (
    <div className="budget-panel">
      <section className="budget-block">
        <h3>总费用</h3>
        <p className="budget-total">
          <strong className={summary.overBudget ? 'text-danger' : ''}>¥{summary.total}</strong>
          {budget > 0 && <span className="muted"> / 预算 ¥{budget}</span>}
        </p>
        {budget > 0 && (
          <>
            <div className="bar-track">
              <div className={`bar-fill ${summary.overBudget ? 'bar-over' : ''}`} style={{ width: `${ratio * 100}%` }} />
            </div>
            {summary.overBudget && <p className="form-error">超出预算 ¥{summary.total - budget}</p>}
          </>
        )}
        {budget === 0 && <p className="muted">未设置总预算（可在行程信息中填写以启用超支预警）</p>}
      </section>

      <section className="budget-block">
        <h3>按天</h3>
        {summary.perDay.map((d) => (
          <div key={d.dayId} className="bar-row">
            <span className="bar-label" style={{ color: dayColor(d.dayIndex) }}>
              D{d.dayIndex}
            </span>
            <div className="bar-track">
              <div className="bar-fill" style={{ width: `${(d.amount / maxDay) * 100}%`, background: dayColor(d.dayIndex) }} />
            </div>
            <span className="bar-value">¥{d.amount}</span>
          </div>
        ))}
      </section>

      <section className="budget-block">
        <h3>按类别</h3>
        {summary.perCategory.length === 0 && <p className="muted">暂无费用记录</p>}
        {summary.perCategory.map((c) => (
          <div key={c.category} className="bar-row">
            <span className="bar-label">
              <i className="cat-dot" style={{ background: CATEGORY_COLORS[c.category] }} />
              {c.category}
            </span>
            <div className="bar-track">
              <div className="bar-fill" style={{ width: `${(c.amount / maxCat) * 100}%`, background: CATEGORY_COLORS[c.category] }} />
            </div>
            <span className="bar-value">¥{c.amount}</span>
          </div>
        ))}
      </section>
    </div>
  );
}
