import { dateForDayIndex, type ResearchPoi, type TripDay } from '@tripweaver/shared';
import { legForPair } from '../../lib/tripDerive';
import { useEditorStore } from '../../store/editorStore';
import { ActivityCard } from './ActivityCard';
import { EditorMenu } from './EditorMenu';

interface Props {
  day: TripDay;
  allDays: TripDay[];
  poiByActivityId: Map<string, ResearchPoi>;
  onEditActivity: (dayId: string, activityId: string | null) => void;
}

export function DaySection({ day, allDays, poiByActivityId, onEditActivity }: Props) {
  const updateDayTitle = useEditorStore((s) => s.updateDayTitle);
  const deleteDay = useEditorStore((s) => s.deleteDay);
  const startDate = useEditorStore((s) => s.trip?.startDate);
  const date = dateForDayIndex(startDate, day.dayIndex);
  return (
    <section className="day-section" aria-label={`第${day.dayIndex}天行程`}>
      <header className="day-head">
        <div><h2>{day.title || `第${day.dayIndex}天的旅程`}</h2><p>{date ? `${date.slice(5).replace('-', '月')}日 · ` : ''}第{day.dayIndex}天</p></div>
        <EditorMenu label="当天更多操作">
          <button type="button" onClick={() => { const title = window.prompt('修改当日主题', day.title); if (title !== null) updateDayTitle(day.id, title.slice(0, 30)); }}>修改当日主题</button>
          <button type="button" className="text-danger" onClick={() => window.confirm(`删除第${day.dayIndex}天（含${day.activities.length}个活动）？`) && deleteDay(day.id)}>删除这一天</button>
        </EditorMenu>
      </header>
      <div className="day-body">
        {day.activities.length === 0 && <p className="muted day-empty">这一天还没有安排，添加第一个活动吧。</p>}
        {day.activities.map((activity, index) => {
          const next = day.activities[index + 1];
          return <ActivityCard key={activity.id} day={day} activity={activity} index={index} allDays={allDays} matchedPoi={poiByActivityId.get(activity.id)} nextLeg={next ? legForPair(day, activity.id, next.id) : undefined} onEdit={() => onEditActivity(day.id, activity.id)} />;
        })}
        <button type="button" className="btn btn-ghost btn-add-activity" onClick={() => onEditActivity(day.id, null)}>＋ 添加活动</button>
      </div>
    </section>
  );
}
