import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useSaveTrip, useTrip, useTripConversation, useTripVersions } from '../api/hooks';
import { useEditorStore } from '../store/editorStore';
import { ChatPanel } from '../components/chat/ChatPanel';
import { ActivityEditDialog } from '../components/editor/ActivityEditDialog';
import { CandidateDrawer } from '../components/editor/CandidateDrawer';
import { DaySection } from '../components/editor/DaySection';
import { MapView } from '../components/editor/MapView';
import { TripMetaDialog } from '../components/editor/TripMetaDialog';
import { ExportMenu } from '../components/ExportMenu';
import { matchOverview } from '../lib/tripDerive';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';
type MobileTab = 'chat' | 'list' | 'map';

export function TripEditorPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const tripQuery = useTrip(id);
  const versions = useTripVersions(id);
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
  const [metaOpen, setMetaOpen] = useState(false);
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

  const saveLabel: Record<SaveState, string> = {
    idle: '',
    saving: '保存中…',
    saved: '已保存',
    error: '保存失败，稍后自动重试',
  };

  const itineraryPanel = (
    <div className="itinerary-panel">
      {visibleDays.length === 0 && <p className="muted day-empty">没有可显示的天数</p>}
      {visibleDays.map((day) => (
        <DaySection
          key={day.id}
          day={day}
          allDays={trip.days}
          poiByActivityId={overviewMatch.poiByActivityId}
          onEditActivity={(dayId, activityId) => setEditing({ dayId, activityId })}
        />
      ))}
      {dayFilter === null && (
        <button type="button" className="btn btn-ghost btn-add-day" onClick={addDay}>
          ＋ 添加一天
        </button>
      )}
      <CandidateDrawer pois={overviewMatch.unmatched} />
    </div>
  );

  return (
    <div className="editor-page">
      <div className="editor-toolbar">
        <div className="editor-toolbar-left">
          <Link to="/trips" className="btn btn-ghost btn-back" title="返回列表">
            ←
          </Link>
          <div className="editor-title">
            <h1>{trip.title}</h1>
            <span className="muted">
              {trip.destination} · {trip.days.length} 天 · {trip.partySize} 人
            </span>
          </div>
          {/* 版本链（09-23）：对话内修订产出的新版本可在同一链上切换对比 */}
          {versions.data && versions.data.versions.length > 1 && (
            <div className="trip-versions" role="group" aria-label="版本切换">
              {versions.data.versions.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  className={`btn btn-chip ${v.id === id ? 'is-active' : ''}`}
                  aria-current={v.id === id}
                  title={`${v.title} · ${new Date(v.createdAt).toLocaleDateString()}`}
                  onClick={() => v.id !== id && navigate(`/trips/${v.id}`)}
                >
                  v{v.version}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="editor-toolbar-right">
          <span className={`save-state ${saveState === 'error' ? 'text-danger' : ''}`}>{saveLabel[saveState]}</span>
          <ExportMenu trip={trip} />
          <button type="button" className="btn btn-ghost" onClick={() => setMetaOpen(true)}>
            行程信息
          </button>
        </div>
      </div>

      <div className="editor-mobile-tabs">
        {mobileTabs.map(([tab, label]) => (
          <button
            key={tab}
            type="button"
            className={`mobile-tab ${mobileTab === tab ? 'active' : ''}`}
            onClick={() => setMobileTab(tab)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className={`editor-body mobile-${mobileTab}`}>
        {/* R2（09-24）：有来源会话的行程，对话常驻最左侧；导入/旧行程无会话则不占位 */}
        {conversationId && (
          <aside className="editor-chat">
            <ChatPanel conversationId={conversationId} currentTripId={id} />
          </aside>
        )}
        <aside className="editor-left">
          <div className="editor-left-scroll">{itineraryPanel}</div>
        </aside>
        <div className="editor-map">
          <MapView
            visible={mobileTab === 'map'}
            onEditActivity={(dayId, activityId) => setEditing({ dayId, activityId })}
          />
        </div>
      </div>

      {metaOpen && <TripMetaDialog onClose={() => setMetaOpen(false)} />}
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
