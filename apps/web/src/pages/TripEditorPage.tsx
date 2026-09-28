import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useSaveTrip, useTrip, useTripConversation } from '../api/hooks';
import { useEditorStore } from '../store/editorStore';
import { ChatPanel } from '../components/chat/ChatPanel';
import { ActivityEditDialog } from '../components/editor/ActivityEditDialog';
import { CandidateDrawer } from '../components/editor/CandidateDrawer';
import { PexelsCredit } from '../components/PoiCard';
import { DaySection } from '../components/editor/DaySection';
import { MapView } from '../components/editor/MapView';
import { dateForDayIndex } from '@tripweaver/shared';
import { EditorIcon } from '../components/editor/EditorIcon';
import { Modal } from '../components/Modal';
import { ExportMenu } from '../components/ExportMenu';
import { matchOverview } from '../lib/tripDerive';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';
type MobileTab = 'chat' | 'list' | 'map';

export function TripEditorPage() {
  const { id = '' } = useParams();
  const tripQuery = useTrip(id);
  const conversationQuery = useTripConversation(id);
  const conversationId = conversationQuery.data?.conversationId ?? null;
  const saveTrip = useSaveTrip();

  const trip = useEditorStore((s) => s.trip);
  const revision = useEditorStore((s) => s.revision);
  const dayFilter = useEditorStore((s) => s.dayFilter);
  const load = useEditorStore((s) => s.load);
  const clear = useEditorStore((s) => s.clear);
  const addDay = useEditorStore((s) => s.addDay);

  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [mobileTab, setMobileTab] = useState<MobileTab>('list');
  const [candidatesOpen, setCandidatesOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const setDayFilter = useEditorStore((s) => s.setDayFilter);
  const [editing, setEditing] = useState<{ dayId: string; activityId: string | null } | null>(null);

  // 载入：仅在行程 id 变化时执行，避免自动保存回写触发重载覆盖本地编辑
  const loadedId = tripQuery.data?.id;
  useEffect(() => {
    if (tripQuery.data) load(tripQuery.data);
    return () => clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedId]);

  // 防抖自动保存（800ms）
  useEffect(() => {
    if (revision === 0) return;
    setSaveState('saving');
    const timer = setTimeout(() => {
      const current = useEditorStore.getState().trip;
      if (!current) return;
      saveTrip.mutate(current, {
        onSuccess: () => setSaveState('saved'),
        onError: () => setSaveState('error'),
      });
    }, 800);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision]);

  const visibleDays = useMemo(() => {
    const days = trip?.days ?? [];
    return dayFilter === null ? days : days.filter((d) => d.dayIndex === dayFilter);
  }, [trip, dayFilter]);

  useEffect(() => { scrollRef.current?.scrollTo({ top: 0 }); }, [dayFilter]);

  // 概览并入行程：候选按名称匹配到活动（内嵌卡片），未命中的进「备选」抽屉；旧行程无 overview → 两者皆空
  const overviewMatch = useMemo(() => matchOverview(trip?.days ?? [], trip?.overview), [trip]);

  if (tripQuery.isPending) return <div className="page-loading">加载中…</div>;
  if (tripQuery.isError) return <div className="page-loading">行程加载失败：{tripQuery.error.message}</div>;
  if (!trip) return <div className="page-loading">准备编辑器…</div>;

  const editingActivity = editing?.activityId
    ? trip.days.find((d) => d.id === editing.dayId)?.activities.find((a) => a.id === editing.activityId) ?? null
    : null;

  const mobileTabs: [MobileTab, string][] = [
    ...(conversationId ? [['chat', '对话'] as [MobileTab, string]] : []),
    ['list', '行程'],
    ['map', '地图'],
  ];

  const endDate = dateForDayIndex(trip.startDate, Math.max(1, trip.days.length));
  const dateLabel = trip.startDate && endDate
    ? `${trip.startDate.slice(5).replace('-', '月')}日—${endDate.slice(5).replace('-', '月')}日`
    : '';

  const itineraryPanel = (
    <div className="itinerary-panel">
      {dayFilter !== null && visibleDays.length === 0 && <p className="muted day-empty">没有可显示的天数</p>}
      {dayFilter !== null && visibleDays.map((day) => (
        <DaySection
          key={day.id}
          day={day}
          allDays={trip.days}
          poiByActivityId={overviewMatch.poiByActivityId}
          onEditActivity={(dayId, activityId) => setEditing({ dayId, activityId })}
        />
      ))}
      {dayFilter === null && (
        <section className="editor-overview" aria-label="全程概览">
          <h2>一路的风景</h2>
          <p className="muted">{trip.days.length}天 · {trip.destination}</p>
          {trip.days.length === 0 && <p className="day-empty">还没有行程，添加一天开始安排吧。</p>}
          {trip.days.map((day) => (
            <button key={day.id} type="button" className="editor-overview-day" onClick={() => setDayFilter(day.dayIndex)}>
              <span>第{day.dayIndex}天 · {dateForDayIndex(trip.startDate, day.dayIndex) || '日期待定'}</span>
              <strong>{day.title || '待安排的旅程'}</strong>
              <p>{day.activities.map((activity) => activity.name).join(' · ') || '这一天还没有安排'}</p>
              <span>查看当天 →</span>
            </button>
          ))}
          <button type="button" className="btn btn-ghost btn-add-day" onClick={addDay}>＋ 添加一天</button>
        </section>
      )}
      <PexelsCredit
        pois={[...overviewMatch.poiByActivityId.values(), ...overviewMatch.unmatched]}
      />
    </div>
  );

  return (
    <div className="editor-page">
      <div className="editor-toolbar">
        <div className="editor-toolbar-left">
          <Link to="/trips" className="btn btn-ghost btn-back" aria-label="返回行程列表"><EditorIcon name="back" /><span>返回</span></Link>
          <div className="editor-title">
            <h1><EditorIcon name="pin" />{trip.title}</h1>
            <span className="editor-trip-meta"><EditorIcon name="calendar" />{dateLabel ? `${dateLabel} · ` : ''}{trip.days.length}天 · {trip.partySize}人</span>
            {saveState === 'error' && <span className="text-danger" role="alert">保存失败，请检查网络后<button type="button" className="btn" onClick={() => { setSaveState('saving'); saveTrip.mutate(trip, { onSuccess: () => setSaveState('saved'), onError: () => setSaveState('error') }); }}>重试保存</button></span>}
          </div>
        </div>
        <div className="editor-toolbar-right"><ExportMenu trip={trip} /></div>
      </div>

      <div className="editor-mobile-tabs">
        {mobileTabs.map(([tab, label]) => (
          <button
            key={tab}
            type="button"
            className={`mobile-tab ${mobileTab === tab ? 'active' : ''}`}
            aria-pressed={mobileTab === tab}
            onClick={() => setMobileTab(tab)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className={`editor-body mobile-${mobileTab} ${conversationId ? "has-chat" : "without-chat"}`}>
        {/* R2（09-24）：有来源会话的行程，对话常驻最左侧；导入/旧行程无会话则不占位 */}
        {conversationId && (
          <aside className="editor-chat" aria-label="旅行助手">
            <ChatPanel conversationId={conversationId} currentTripId={id} />
          </aside>
        )}
        <aside className="editor-left">
          <div className="editor-day-nav">
            <div className="editor-day-tabs" role="group" aria-label="行程天数">
              <button type="button" aria-pressed={dayFilter === null} onClick={() => setDayFilter(null)}>总览</button>
              {trip.days.map((day) => <button key={day.id} type="button" aria-pressed={dayFilter === day.dayIndex} onClick={() => setDayFilter(day.dayIndex)}>第{day.dayIndex}天</button>)}
            </div>
            <button type="button" className="editor-candidates-button" onClick={() => setCandidatesOpen(true)}>备选清单</button>
          </div>
          <div className="editor-left-scroll" ref={scrollRef}>{itineraryPanel}</div>
        </aside>
        <div className="editor-map">
          <MapView
            visible={mobileTab === 'map'}
            onEditActivity={(dayId, activityId) => setEditing({ dayId, activityId })}
          />
        </div>
      </div>

      {candidatesOpen && <Modal title="备选清单" onClose={() => setCandidatesOpen(false)}>{overviewMatch.unmatched.length ? <CandidateDrawer pois={overviewMatch.unmatched} expanded /> : <p className="muted">暂无未编入行程的备选地点。</p>}</Modal>}
      {editing && (
        <ActivityEditDialog
          key={`${editing.dayId}:${editing.activityId ?? 'new'}`}
          dayId={editing.dayId}
          activity={editingActivity}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
