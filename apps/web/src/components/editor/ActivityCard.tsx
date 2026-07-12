import { useState } from 'react';
import type { Activity, ResearchPoi, TripDay } from '@tripweaver/shared';
import { CATEGORY_COLORS, hasValidCoord } from '../../lib/colors';
import { useEditorStore } from '../../store/editorStore';
import { PoiCover, ReservationBadge } from '../PoiCard';

interface Props {
  day: TripDay;
  activity: Activity;
  index: number;
  allDays: TripDay[];
  /** 概览候选池中按名称命中的调研信息（旧行程无 overview → 恒为 undefined，不渲染） */
  matchedPoi?: ResearchPoi;
  onEdit: () => void;
}

export function ActivityCard({ day, activity, index, allDays, matchedPoi, onEdit }: Props) {
  const moveActivity = useEditorStore((s) => s.moveActivity);
  const moveActivityToDay = useEditorStore((s) => s.moveActivityToDay);
  const deleteActivity = useEditorStore((s) => s.deleteActivity);
  const updateActivity = useEditorStore((s) => s.updateActivity);
  const [editingCost, setEditingCost] = useState(false);
  const [costDraft, setCostDraft] = useState('');

  const commitCost = () => {
    setEditingCost(false);
    const n = Number(costDraft);
    if (!Number.isNaN(n) && n >= 0 && n !== (activity.cost ?? 0)) {
      updateActivity(day.id, activity.id, { cost: n });
    }
  };

  return (
    <div className="activity-card">
      <div className="activity-main">
        <div className="activity-line1">
          <span className="activity-time">
            {activity.startTime || '--:--'}
            {activity.endTime ? ` – ${activity.endTime}` : ''}
          </span>
          <span className="activity-name">{activity.name}</span>
          <span className="cat-badge">
            <i style={{ background: CATEGORY_COLORS[activity.category] }} />
            {activity.category}
          </span>
          {editingCost ? (
            <input
              className="cost-input"
              autoFocus
              inputMode="numeric"
              value={costDraft}
              onChange={(e) => setCostDraft(e.target.value)}
              onBlur={commitCost}
              onKeyDown={(e) => e.key === 'Enter' && commitCost()}
            />
          ) : (
            <button
              type="button"
              className="cost-chip"
              title="点击修改费用"
              onClick={() => {
                setCostDraft(String(activity.cost ?? 0));
                setEditingCost(true);
              }}
            >
              ¥{activity.cost ?? 0}
            </button>
          )}
        </div>
        {activity.description && <p className="activity-desc">{activity.description}</p>}
        {matchedPoi && (
          // 概览并入行程：内嵌命中的调研候选（封面热链 onerror 兜底 / 简介 / 预约徽章 / 来源链接）
          <div className="activity-poi">
            <PoiCover poi={matchedPoi} />
            <div className="activity-poi-body">
              <span className="poi-badges">
                <ReservationBadge poi={matchedPoi} />
                {matchedPoi.reservation === 'required' && matchedPoi.reservationNote && (
                  <span className="poi-rsv-note">📌 {matchedPoi.reservationNote}</span>
                )}
              </span>
              {matchedPoi.intro && <p className="poi-intro">{matchedPoi.intro}</p>}
              {matchedPoi.sourceLinks.length > 0 && (
                <p className="poi-links">
                  {matchedPoi.sourceLinks.slice(0, 3).map((s) => (
                    <a key={s.url} className="tag tag-source" href={s.url} target="_blank" rel="noopener noreferrer">
                      🔗 {s.title || '来源'}
                    </a>
                  ))}
                </p>
              )}
            </div>
          </div>
        )}
        <div className="activity-flags">
          {!hasValidCoord(activity) && <span className="tag tag-warn">无坐标</span>}
          {hasValidCoord(activity) && activity.coordSource === 'estimated' && <span className="tag tag-warn">坐标为估算</span>}
          {activity.sourceNotes.map((n) => (
            <a key={n.url} className="tag tag-source" href={n.url} target="_blank" rel="noopener noreferrer">
              🔗 {n.title || '来源笔记'}
            </a>
          ))}
        </div>
      </div>
      <div className="activity-actions">
        <button type="button" className="btn btn-icon" title="上移" disabled={index === 0} onClick={() => moveActivity(day.id, activity.id, 'up')}>
          ↑
        </button>
        <button
          type="button"
          className="btn btn-icon"
          title="下移"
          disabled={index === day.activities.length - 1}
          onClick={() => moveActivity(day.id, activity.id, 'down')}
        >
          ↓
        </button>
        {allDays.length > 1 && (
          <select
            className="day-move-select"
            value=""
            title="移动到其他天"
            onChange={(e) => {
              if (e.target.value) moveActivityToDay(day.id, activity.id, e.target.value);
            }}
          >
            <option value="">移至…</option>
            {allDays
              .filter((d) => d.id !== day.id)
              .map((d) => (
                <option key={d.id} value={d.id}>
                  Day {d.dayIndex}
                </option>
              ))}
          </select>
        )}
        <button type="button" className="btn btn-icon" title="编辑" onClick={onEdit}>
          ✎
        </button>
        <button
          type="button"
          className="btn btn-icon btn-danger"
          title="删除"
          onClick={() => window.confirm(`删除活动「${activity.name}」？`) && deleteActivity(day.id, activity.id)}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
