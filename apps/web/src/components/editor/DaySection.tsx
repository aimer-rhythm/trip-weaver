import { useMemo, useState } from 'react';
import type { TripDay } from '@tripweaver/shared';
import { dayColor } from '../../lib/colors';
import { useEditorStore } from '../../store/editorStore';
import { ActivityCard } from './ActivityCard';

interface Props {
  day: TripDay;
  allDays: TripDay[];
  onEditActivity: (dayId: string, activityId: string | null) => void;
}

export function DaySection({ day, allDays, onEditActivity }: Props) {
  const updateDayTitle = useEditorStore((s) => s.updateDayTitle);
  const deleteDay = useEditorStore((s) => s.deleteDay);
  const [collapsed, setCollapsed] = useState(false);

  const dayTotal = useMemo(
    () => day.activities.reduce((n, a) => n + a.cost, 0),
    [day.activities],
  );

  return (
    <section className="day-section">
      <header className="day-head" style={{ borderLeftColor: dayColor(day.dayIndex) }}>
        <button type="button" className="btn btn-icon" onClick={() => setCollapsed(!collapsed)} title={collapsed ? '展开' : '折叠'}>
          {collapsed ? '▸' : '▾'}
        </button>
        <span className="day-label" style={{ color: dayColor(day.dayIndex) }}>
          Day {day.dayIndex}
        </span>
        <input
          className="day-title-input"
          value={day.title}
          placeholder="当日主题…"
          maxLength={30}
          onChange={(e) => updateDayTitle(day.id, e.target.value)}
        />
        <span className="day-total muted">¥{dayTotal}</span>
        <button
          type="button"
          className="btn btn-icon btn-danger"
          title="删除这一天"
          onClick={() => window.confirm(`删除 Day ${day.dayIndex}（含 ${day.activities.length} 个活动）？`) && deleteDay(day.id)}
        >
          ✕
        </button>
      </header>
      {!collapsed && (
        <div className="day-body">
          {day.activities.length === 0 && <p className="muted day-empty">这一天还没有安排</p>}
          {day.activities.map((a, i) => (
            <ActivityCard
              key={a.id}
              day={day}
              activity={a}
              index={i}
              allDays={allDays}
              onEdit={() => onEditActivity(day.id, a.id)}
            />
          ))}
          <button type="button" className="btn btn-ghost btn-add-activity" onClick={() => onEditActivity(day.id, null)}>
            ＋ 添加活动
          </button>
        </div>
      )}
    </section>
  );
}
