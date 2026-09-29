import { Button } from '../ui/Button';
import { Select } from '../ui/Field';
import { useState } from 'react';
import type { Activity, ResearchPoi, TransitLeg, TripDay } from '@tripweaver/shared';
import { hasValidCoord } from '../../lib/colors';
import { RouteOptions } from './RouteOptions';
import { useEditorStore } from '../../store/editorStore';
import { PoiCover, ReservationBadge } from '../PoiCard';
import { ConfirmDialog } from '../ui/ActionDialog';
import { EditorIcon } from './EditorIcon';
import { EditorMenu } from './EditorMenu';

interface Props {
  day: TripDay;
  activity: Activity;
  index: number;
  allDays: TripDay[];
  matchedPoi?: ResearchPoi;
  nextLeg?: TransitLeg;
}

export function ActivityCard({ day, activity, index, allDays, matchedPoi, nextLeg }: Props) {
  const moveActivity = useEditorStore((s) => s.moveActivity);
  const moveActivityToDay = useEditorStore((s) => s.moveActivityToDay);
  const deleteActivity = useEditorStore((s) => s.deleteActivity);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [failedCover, setFailedCover] = useState<string>();
  const showCover = matchedPoi?.coverUrl && matchedPoi.coverUrl !== failedCover;

  return (
    <article className={"activity-entry [margin-bottom:16px]"} aria-label={activity.name}>
      <div className={`activity-card flex flex-col [gap:6px] [border:1px_solid_var(--color-border)] [border-radius:10px] [padding:8px_10px] [background:var(--color-activity-card-background-6)] ${showCover ? "has-cover" : ""}`}>
        <div className={"activity-heading [grid-column:1_/_-1] grid [grid-template-columns:40px_minmax(0,_1fr)_44px] items-center [gap:12px] [&_.editor-menu-list]:[top:100%] [&_.editor-menu-list]:[bottom:auto] [@media_(min-width:_1101px)_and_(max-width:_1400px)]:[grid-template-columns:32px_minmax(0,_1fr)_44px] [@media_(min-width:_1101px)_and_(max-width:_1400px)]:[gap:8px] [@media_(max-width:_600px)]:[grid-template-columns:28px_minmax(0,_1fr)_44px] [@media_(max-width:_600px)]:[gap:8px]"}>
          <span className={"activity-order [width:40px] [height:40px] grid [place-items:center] [border-radius:50%] [color:var(--color-activity-order-color-73)] [background:linear-gradient(135deg,_var(--color-activity-order-background-74),_var(--color-activity-order-background-75))] [font-size:17px] [@media_(min-width:_1101px)_and_(max-width:_1400px)]:[width:32px] [@media_(min-width:_1101px)_and_(max-width:_1400px)]:[height:32px] [@media_(min-width:_1101px)_and_(max-width:_1400px)]:[font-size:14px] [@media_(max-width:_600px)]:[width:28px] [@media_(max-width:_600px)]:[height:28px] [@media_(max-width:_600px)]:[font-size:13px]"}>{String(index + 1).padStart(2, '0')}</span>
          <h3 className={"activity-name font-semibold [font-size:0.94rem]"}>{activity.name}</h3>
          <EditorMenu label={`${activity.name}更多操作`}>
            <Button variant="ghost" type="button" disabled={index === 0} onClick={() => moveActivity(day.id, activity.id, 'up')}>上移</Button>
            <Button variant="ghost" type="button" disabled={index === day.activities.length - 1} onClick={() => moveActivity(day.id, activity.id, 'down')}>下移</Button>
            {allDays.length > 1 && <label>移至其他天<Select aria-label="移至其他天" value="" onChange={(e) => { if (e.target.value) moveActivityToDay(day.id, activity.id, e.target.value); }}><option value="">选择天数</option>{allDays.filter((d) => d.id !== day.id).map((d) => <option key={d.id} value={d.id}>第{d.dayIndex}天</option>)}</Select></label>}
            <Button variant="danger" type="button" onClick={() => setDeleteOpen(true)}>删除活动</Button>
          </EditorMenu>
        </div>
        <div className={"activity-main min-w-0"}>
          <span className={"cat-badge inline-flex items-center [gap:4px] [font-size:0.76rem] [color:var(--color-muted)] [&_i]:[width:8px] [&_i]:[height:8px] [&_i]:[border-radius:50%] [&_i]:inline-block"}><EditorIcon name="place" />{activity.category}</span>
          {(activity.description || matchedPoi?.intro) && <p className={"activity-desc [margin:4px_0_0] [font-size:0.83rem] [color:var(--color-muted)]"}>{activity.description || matchedPoi?.intro}</p>}
          {matchedPoi?.reservation === 'required' && <div className={"activity-reservation [margin-top:12px] [font-size:12px] [&_p]:[margin:6px_0_0] [&_p]:[color:var(--color-activity-reservation-color-79)] [&_p]:[line-height:1.5]"}><ReservationBadge poi={matchedPoi} />{matchedPoi.reservationNote && <p>{matchedPoi.reservationNote}</p>}</div>}
          {!hasValidCoord(activity) && <span className={"tag [border-radius:4px] [padding:1px_6px] [font-size:0.72rem] tag-warn [background:var(--color-tag-warn-background-7)] [color:var(--color-tag-warn-color-8)]"}>无坐标</span>}
          {hasValidCoord(activity) && activity.coordSource === 'estimated' && <span className={"tag [border-radius:4px] [padding:1px_6px] [font-size:0.72rem] tag-warn [background:var(--color-tag-warn-background-7)] [color:var(--color-tag-warn-color-8)]"}>坐标为估算</span>}
        </div>
        {showCover && matchedPoi && <PoiCover key={matchedPoi.coverUrl} poi={matchedPoi} onCoverError={setFailedCover} />}
      </div>
      {index < day.activities.length - 1 && <RouteOptions dayId={day.id} fromId={activity.id} leg={nextLeg} />}
      {deleteOpen && <ConfirmDialog title="删除活动" description={`确定删除「${activity.name}」？`} onClose={() => setDeleteOpen(false)} onConfirm={() => deleteActivity(day.id, activity.id)} />}
    </article>
  );
}
