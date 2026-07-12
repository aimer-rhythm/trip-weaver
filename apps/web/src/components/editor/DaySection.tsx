import { Fragment, useMemo, useState } from 'react';
import type { ResearchPoi, TransitLeg, TripDay } from '@tripweaver/shared';
import { dayColor } from '../../lib/colors';
import { LEG_MODE_ICON, LEG_MODE_LABEL, formatLegDistance, formatLegDuration, legForPair, lodgingLegsForDay } from '../../lib/tripDerive';
import { useEditorStore } from '../../store/editorStore';
import { ActivityCard } from './ActivityCard';

interface Props {
  day: TripDay;
  allDays: TripDay[];
  /** activityId → 概览命中候选（由 TripEditorPage 统一匹配，旧行程为空 Map） */
  poiByActivityId: Map<string, ResearchPoi>;
  onEditActivity: (dayId: string, activityId: string | null) => void;
}

// 相邻活动间通勤条：方式 + 时长 + 距离；heuristic 加「估算」徽章；住宿 leg（哨兵 id）带首尾提示语
function LegChip({ leg, lodgingLabel }: { leg: TransitLeg; lodgingLabel?: string }) {
  return (
    <div className="leg-chip">
      {lodgingLabel && <span>🏨 {lodgingLabel}</span>}
      <span aria-hidden="true">{LEG_MODE_ICON[leg.mode]}</span>
      <span>
        {LEG_MODE_LABEL[leg.mode]} {formatLegDuration(leg.durationMin)} · {formatLegDistance(leg.distanceM)}
      </span>
      {leg.source === 'heuristic' && <span className="tag tag-warn">估算</span>}
    </div>
  );
}

export function DaySection({ day, allDays, poiByActivityId, onEditActivity }: Props) {
  const updateDayTitle = useEditorStore((s) => s.updateDayTitle);
  const deleteDay = useEditorStore((s) => s.deleteDay);
  const tripLodging = useEditorStore((s) => s.trip?.lodging);
  const [collapsed, setCollapsed] = useState(false);

  const dayTotal = useMemo(
    () => day.activities.reduce((n, a) => n + (a.cost ?? 0), 0),
    [day.activities],
  );
  // 住宿锚点（ST3）：day 级覆盖优先；有锚点才尝试渲染住宿 leg（哨兵 id 严格匹配当天首尾活动）
  const lodging = day.lodging ?? tripLodging;
  const lodgingLegs = useMemo(() => (lodging ? lodgingLegsForDay(day) : {}), [lodging, day]);

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
        <span className="day-total muted">约 ¥{dayTotal}</span>
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
          {!lodging && day.activities.length > 0 && (
            <p className="muted day-lodging-hint">未设住宿，通勤自首个活动算起</p>
          )}
          {lodgingLegs.departure && <LegChip leg={lodgingLegs.departure} lodgingLabel="从住宿出发" />}
          {day.activities.map((a, i) => {
            // 仅当 leg 与当前相邻活动对精确匹配才显示；失配（重排/删改后）静默过滤，旧行程无 legs 不渲染
            const prev = i > 0 ? day.activities[i - 1] : undefined;
            const leg = prev ? legForPair(day, prev.id, a.id) : undefined;
            return (
              <Fragment key={a.id}>
                {leg && <LegChip leg={leg} />}
                <ActivityCard
                  day={day}
                  activity={a}
                  index={i}
                  allDays={allDays}
                  matchedPoi={poiByActivityId.get(a.id)}
                  onEdit={() => onEditActivity(day.id, a.id)}
                />
              </Fragment>
            );
          })}
          {lodgingLegs.returning && <LegChip leg={lodgingLegs.returning} lodgingLabel="返回住宿" />}
          <button type="button" className="btn btn-ghost btn-add-activity" onClick={() => onEditActivity(day.id, null)}>
            ＋ 添加活动
          </button>
        </div>
      )}
    </section>
  );
}
