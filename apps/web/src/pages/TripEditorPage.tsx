import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useSaveTrip, useTrip } from '../api/hooks';
import { useEditorStore } from '../store/editorStore';
import { ActivityEditDialog } from '../components/editor/ActivityEditDialog';
import { BudgetPanel } from '../components/editor/BudgetPanel';
import { DaySection } from '../components/editor/DaySection';
import { MapView } from '../components/editor/MapView';
import { OverviewPanel } from '../components/editor/OverviewPanel';
import { TripMetaDialog } from '../components/editor/TripMetaDialog';
import { ExportMenu } from '../components/ExportMenu';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';
type PanelTab = 'itinerary' | 'overview' | 'budget';
type MobileTab = 'list' | 'overview' | 'map' | 'budget';

export function TripEditorPage() {
  const { id = '' } = useParams();
  const tripQuery = useTrip(id);
  const saveTrip = useSaveTrip();

  const trip = useEditorStore((s) => s.trip);
  const revision = useEditorStore((s) => s.revision);
  const dayFilter = useEditorStore((s) => s.dayFilter);
  const load = useEditorStore((s) => s.load);
  const clear = useEditorStore((s) => s.clear);
  const addDay = useEditorStore((s) => s.addDay);

  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [panelTab, setPanelTab] = useState<PanelTab>('itinerary');
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

  if (tripQuery.isPending) return <div className="page-loading">加载中…</div>;
  if (tripQuery.isError) return <div className="page-loading">行程加载失败：{tripQuery.error.message}</div>;
  if (!trip) return <div className="page-loading">准备编辑器…</div>;

  const editingActivity = editing?.activityId
    ? trip.days.find((d) => d.id === editing.dayId)?.activities.find((a) => a.id === editing.activityId) ?? null
    : null;

  // 概览入口仅在候选池非空时出现（旧行程无 overview 字段 → 完全不渲染，向后兼容）
  const hasOverview = Boolean(trip.overview?.length);
  const effectivePanelTab: PanelTab = panelTab === 'overview' && !hasOverview ? 'itinerary' : panelTab;
  const effectiveMobileTab: MobileTab = mobileTab === 'overview' && !hasOverview ? 'list' : mobileTab;

  const panelTabs: [PanelTab, string][] = [
    ['itinerary', '行程'],
    ...(hasOverview ? ([['overview', '概览']] as [PanelTab, string][]) : []),
    ['budget', '预算'],
  ];
  const mobileTabs: [MobileTab, string][] = [
    ['list', '行程'],
    ...(hasOverview ? ([['overview', '概览']] as [MobileTab, string][]) : []),
    ['map', '地图'],
    ['budget', '预算'],
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
          onEditActivity={(dayId, activityId) => setEditing({ dayId, activityId })}
        />
      ))}
      {dayFilter === null && (
        <button type="button" className="btn btn-ghost btn-add-day" onClick={addDay}>
          ＋ 添加一天
        </button>
      )}
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
              {trip.destination} · {trip.days.length} 天 · {trip.partySize} 人 · 预算 {trip.budgetLevel}
              {trip.totalBudget > 0 ? `（¥${trip.totalBudget}）` : ''}
            </span>
          </div>
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
            className={`mobile-tab ${effectiveMobileTab === tab ? 'active' : ''}`}
            onClick={() => setMobileTab(tab)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className={`editor-body mobile-${effectiveMobileTab}`}>
        <aside className="editor-left">
          <div className="panel-tabs">
            {panelTabs.map(([tab, label]) => (
              <button
                key={tab}
                type="button"
                className={`panel-tab ${effectivePanelTab === tab ? 'active' : ''}`}
                onClick={() => setPanelTab(tab)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="editor-left-scroll">
            {effectivePanelTab === 'itinerary' ? itineraryPanel : effectivePanelTab === 'overview' ? <OverviewPanel /> : <BudgetPanel />}
          </div>
        </aside>
        <div className="editor-map">
          <MapView
            visible={effectiveMobileTab === 'map'}
            onEditActivity={(dayId, activityId) => setEditing({ dayId, activityId })}
          />
        </div>
        {hasOverview && (
          <div className="editor-mobile-overview">
            <OverviewPanel />
          </div>
        )}
        <div className="editor-mobile-budget">
          <BudgetPanel />
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
