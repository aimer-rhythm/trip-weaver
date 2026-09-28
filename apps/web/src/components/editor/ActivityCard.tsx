import { useState } from 'react';
import type { Activity, ResearchPoi, TransitLeg, TripDay } from '@tripweaver/shared';
import { hasValidCoord } from '../../lib/colors';
import { formatLegDistance, formatLegDuration, LEG_MODE_LABEL } from '../../lib/tripDerive';
import { useEditorStore } from '../../store/editorStore';
import { PoiCover, ReservationBadge } from '../PoiCard';
import { Modal } from '../Modal';
import { EditorIcon } from './EditorIcon';
import { EditorMenu } from './EditorMenu';

interface Props {
  day: TripDay;
  activity: Activity;
  index: number;
  allDays: TripDay[];
  matchedPoi?: ResearchPoi;
  nextLeg?: TransitLeg;
  onEdit: () => void;
}

export function ActivityCard({ day, activity, index, allDays, matchedPoi, nextLeg, onEdit }: Props) {
  const moveActivity = useEditorStore((s) => s.moveActivity);
  const moveActivityToDay = useEditorStore((s) => s.moveActivityToDay);
  const deleteActivity = useEditorStore((s) => s.deleteActivity);
  const [detailOpen, setDetailOpen] = useState(false);
  const [failedCover, setFailedCover] = useState<string>();
  const showCover = matchedPoi?.coverUrl && matchedPoi.coverUrl !== failedCover;

  return (
    <article className="activity-entry" aria-label={activity.name}>
      <div className={`activity-card ${showCover ? 'has-cover' : ''}`}>
        <div className="activity-heading">
          <span className="activity-order">{String(index + 1).padStart(2, '0')}</span>
          <h3 className="activity-name">{activity.name}</h3>
          <EditorMenu label={`${activity.name}更多操作`}>
            <button type="button" onClick={() => setDetailOpen(true)}>查看完整信息</button>
            <button type="button" onClick={onEdit}>编辑活动</button>
            <button type="button" disabled={index === 0} onClick={() => moveActivity(day.id, activity.id, 'up')}>上移</button>
            <button type="button" disabled={index === day.activities.length - 1} onClick={() => moveActivity(day.id, activity.id, 'down')}>下移</button>
            {allDays.length > 1 && <label>移至其他天<select aria-label="移至其他天" value="" onChange={(e) => { if (e.target.value) moveActivityToDay(day.id, activity.id, e.target.value); }}><option value="">选择天数</option>{allDays.filter((d) => d.id !== day.id).map((d) => <option key={d.id} value={d.id}>第{d.dayIndex}天</option>)}</select></label>}
            <button type="button" className="text-danger" onClick={() => window.confirm(`删除活动「${activity.name}」？`) && deleteActivity(day.id, activity.id)}>删除活动</button>
          </EditorMenu>
        </div>
        <div className="activity-main">
          <span className="cat-badge"><EditorIcon name="place" />{activity.category}</span>
          {(activity.description || matchedPoi?.intro) && <p className="activity-desc">{activity.description || matchedPoi?.intro}</p>}
          {matchedPoi?.reservation === 'required' && <div className="activity-reservation"><ReservationBadge poi={matchedPoi} />{matchedPoi.reservationNote && <p>{matchedPoi.reservationNote}</p>}</div>}
          {!hasValidCoord(activity) && <span className="tag tag-warn">无坐标</span>}
          {hasValidCoord(activity) && activity.coordSource === 'estimated' && <span className="tag tag-warn">坐标为估算</span>}
        </div>
        {showCover && matchedPoi && <PoiCover key={matchedPoi.coverUrl} poi={matchedPoi} onCoverError={setFailedCover} />}
      </div>
      {nextLeg && <div className="activity-between">
        <div className="editor-transit"><EditorIcon name={nextLeg.mode === 'walk' ? 'walk' : 'route'} /><span>{LEG_MODE_LABEL[nextLeg.mode]}约{formatLegDuration(nextLeg.durationMin)} · {nextLeg.source === 'heuristic' ? '估算' : formatLegDistance(nextLeg.distanceM)}</span></div>
      </div>}
      {detailOpen && <Modal title={activity.name} onClose={() => setDetailOpen(false)}>
        <div className="activity-detail">
          <p>{activity.category}</p>
          {activity.startTime && <p>原始时间：{activity.startTime}{activity.endTime ? ` — ${activity.endTime}` : ''}</p>}
          {activity.description && <p>{activity.description}</p>}
          {matchedPoi && <><ReservationBadge poi={matchedPoi} />{matchedPoi.reservationNote && <p>{matchedPoi.reservationNote}</p>}{matchedPoi.intro && <p>{matchedPoi.intro}</p>}</>}
          {[...activity.sourceNotes, ...(matchedPoi?.sourceLinks ?? [])].map((source, i) => <a key={`${source.url}:${i}`} href={source.url} target="_blank" rel="noopener noreferrer">{source.title || '来源笔记'}</a>)}
        </div>
      </Modal>}
    </article>
  );
}
