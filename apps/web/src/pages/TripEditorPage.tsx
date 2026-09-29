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

  if (tripQuery.isPending) return <div className={"page-loading [padding:20vh_16px] text-center [color:var(--color-muted)]"}>加载中…</div>;
  if (tripQuery.isError) return <div className={"page-loading [padding:20vh_16px] text-center [color:var(--color-muted)]"}>行程加载失败：{tripQuery.error.message}</div>;
  if (!trip) return <div className={"page-loading [padding:20vh_16px] text-center [color:var(--color-muted)]"}>准备编辑器…</div>;

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
      {dayFilter !== null && visibleDays.length === 0 && <p className={"muted [color:var(--color-muted)] [font-size:0.88rem] day-empty text-center [padding:8px_0]"}>没有可显示的天数</p>}
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
        <section className={"editor-overview [&_h2]:[font:400_clamp(25px,_1.8vw,_32px)/1.5_'QianTuBiFeng_Handwriting',_'Noto_Serif_SC_Variable',_serif] [&_h2]:[letter-spacing:1px] [&_h2]:[margin:0_0_8px] [&_h2]:[overflow-wrap:anywhere]"} aria-label="全程概览">
          <h2>一路的风景</h2>
          <p className={"muted [color:var(--color-muted)] [font-size:0.88rem]"}>{trip.days.length}天 · {trip.destination}</p>
          {trip.days.length === 0 && <p className={"day-empty text-center [padding:8px_0]"}>还没有行程，添加一天开始安排吧。</p>}
          {trip.days.map((day) => (
            <button key={day.id} type="button" className={"editor-overview-day flex flex-col [gap:10px] w-full [margin:14px_0] [padding:20px] [border:1px_solid_white] [border-radius:18px] [background:var(--color-editor-overview-day-background-93)] [color:inherit] text-left [box-shadow:0_8px_20px_var(--color-editor-overview-day-box-shadow-94)] cursor-pointer [&_strong]:[font:400_26px/1.5_'QianTuBiFeng_Handwriting',_serif] [&_span]:[color:var(--editor-muted)] [&_span]:[font-size:13px] [&_p]:m-0 [&_p]:[line-height:1.7]"} onClick={() => setDayFilter(day.dayIndex)}>
              <span>第{day.dayIndex}天 · {dateForDayIndex(trip.startDate, day.dayIndex) || '日期待定'}</span>
              <strong>{day.title || '待安排的旅程'}</strong>
              <p>{day.activities.map((activity) => activity.name).join(' · ') || '这一天还没有安排'}</p>
              <span>查看当天 →</span>
            </button>
          ))}
          <button type="button" className={"btn [border:1px_solid_transparent] [border-radius:var(--radius)] [padding:8px_14px] [font-size:0.9rem] cursor-pointer [color:var(--color-text)] inline-flex items-center [gap:4px] [&:disabled]:[opacity:0.55] [&:disabled]:[cursor:not-allowed] btn-ghost [border-color:var(--color-border)] [background:var(--color-card)] [&:not(:disabled):hover]:[border-color:var(--color-primary)] [&:not(:disabled):hover]:[color:var(--color-primary)] btn-add-day justify-center [border-style:dashed] w-full"} onClick={addDay}>＋ 添加一天</button>
        </section>
      )}
      <PexelsCredit
        pois={[...overviewMatch.poiByActivityId.values(), ...overviewMatch.unmatched]}
      />
    </div>
  );

  return (
    <div className={"editor-page flex-none flex flex-col min-h-0 [max-height:calc(100dvh_-_76px)] [--editor-ink:var(--color-editor-page-editor-ink-55)] [--editor-muted:var(--color-editor-page-editor-muted-56)] [--editor-gradient:linear-gradient(135deg,_var(--color-brand-light),_var(--color-brand))] [color:var(--editor-ink)] [height:calc(100dvh_-_76px)] [padding:12px_0_36px] [gap:8px] [&_.muted]:[color:var(--editor-muted)] [&_.editor-toolbar]:relative [&_.editor-toolbar]:[z-index:2] [&_.editor-toolbar]:[min-height:66px] [&_.editor-toolbar]:flex-none [&_.editor-toolbar]:[padding:12px_20px] [&_.editor-toolbar]:[border:1px_solid_var(--color-editor-page-border-57)] [&_.editor-toolbar]:[border-radius:24px] [&_.editor-toolbar]:[background:var(--color-editor-page-background-58)] [&_.editor-toolbar]:[box-shadow:0_6px_24px_var(--color-editor-page-box-shadow-59)] [&_.editor-toolbar]:[backdrop-filter:blur(18px)] [&_.editor-toolbar-left]:[gap:22px] [&_.editor-toolbar-left]:flex-1 [&_.btn-back]:flex [&_.btn-back]:items-center [&_.btn-back]:[gap:10px] [&_.btn-back]:border-0 [&_.btn-back]:bg-transparent [&_.btn-back]:[border-right:1px_solid_var(--color-editor-page-border-right-60)] [&_.btn-back]:[border-radius:0] [&_.btn-back]:[padding:0_22px_0_0] [&_.btn-back]:[color:var(--editor-ink)] [&_.btn-back_.editor-icon]:[box-sizing:content-box] [&_.btn-back_.editor-icon]:[padding:8px] [&_.btn-back_.editor-icon]:[border-radius:50%] [&_.btn-back_.editor-icon]:[background:var(--color-editor-page-background-61)] [&_.editor-title]:flex [&_.editor-title]:items-center [&_.editor-title]:[gap:22px] [&_.editor-title]:min-w-0 [&_.editor-title]:flex-wrap [&_.editor-title_h1]:flex [&_.editor-title_h1]:items-center [&_.editor-title_h1]:[gap:10px] [&_.editor-title_h1]:[font:600_22px_'Noto_Serif_SC_Variable',_SimSun,_serif] [&_.editor-title_h1]:[white-space:normal] [&_.editor-title_h1]:[overflow-wrap:anywhere] [&_.editor-title_h1_.editor-icon]:[color:var(--color-editor-page-color-62)] [&_.editor-title_>_.text-danger]:[flex-basis:100%] [&_.editor-title_>_.text-danger]:[font-size:13px] [&_.export-menu_>_summary]:flex [&_.export-menu_>_summary]:items-center [&_.export-menu_>_summary]:[gap:8px] [&_.export-menu_>_summary]:bg-transparent [&_.export-menu_>_summary]:[border-radius:8px] [&_.export-menu_>_summary]:[color:var(--color-brand)] [&_.export-menu_>_summary]:[min-height:44px] [&_.export-menu_>_summary]:shadow-none [&_.export-menu]:[z-index:15] [&_.btn-primary]:[background:var(--editor-gradient)] [&_.btn-primary]:[color:white] [&_.editor-body]:relative [&_.editor-body]:[z-index:1] [&_.editor-body]:grid [&_.editor-body]:[grid-template-columns:minmax(0,_26fr)_minmax(0,_41fr)_minmax(0,_33fr)] [&_.editor-body]:[gap:16px] [&_.editor-body.without-chat]:[grid-template-columns:minmax(0,_56fr)_minmax(0,_44fr)] [&_:is(.editor-chat,_.editor-left,_.editor-map)]:[width:auto] [&_:is(.editor-chat,_.editor-left,_.editor-map)]:min-w-0 [&_:is(.editor-chat,_.editor-left,_.editor-map)]:[border:1px_solid_var(--color-editor-page-border-57)] [&_:is(.editor-chat,_.editor-left,_.editor-map)]:[border-radius:24px] [&_:is(.editor-chat,_.editor-left,_.editor-map)]:[background:var(--color-editor-page-background-63)] [&_:is(.editor-chat,_.editor-left,_.editor-map)]:[box-shadow:0_10px_30px_var(--color-editor-page-box-shadow-64)] [&_:is(.editor-chat,_.editor-left,_.editor-map)]:min-h-0 [&_.editor-chat]:overflow-hidden [&_.editor-left]:overflow-hidden [&_.editor-map]:[padding:16px] [&_.editor-left-scroll]:[padding:6px_18px_24px] [&_.editor-left-scroll]:[scrollbar-width:thin] [&_.editor-left-scroll]:[scrollbar-color:var(--color-editor-page-scrollbar-color-65)_transparent] [&_.day-filter-btn]:border-0 [&_.day-filter-btn]:rounded-full [&_.day-filter-btn]:[min-height:38px] [&_.day-filter-btn]:[padding:8px_17px] [&_.day-filter-btn]:flex-none [&_.day-filter-btn]:cursor-pointer [&_.day-filter-btn]:[background:var(--color-editor-day-tabs-background-66)] [&_.day-filter-btn]:[color:var(--editor-muted)] [&_.day-filter-btn]:[font:inherit] [&_.day-filter-btn]:[font-size:14px] [&_.day-filter-btn]:shadow-none [&_.day-filter-btn]:whitespace-nowrap [&_.day-filter-btn:first-child]:[background:var(--color-editor-day-tabs-background-67)] [&_.day-filter-btn.active]:[background:var(--editor-gradient)] [&_.day-filter-btn.active]:[color:white] [&_.day-filter-btn.active]:[box-shadow:0_4px_12px_var(--color-editor-day-tabs-box-shadow-68)] [&_.day-section]:[background:none] [&_.day-section]:border-0 [&_.day-section]:[border-radius:0] [&_.day-section]:[overflow:visible] [&_.day-section]:m-0 [&_.day-head]:flex [&_.day-head]:justify-between [&_.day-head]:items-start [&_.day-head]:border-0 [&_.day-head]:[padding:6px_0_16px] [&_.day-head]:[gap:6px] [&_.day-head_>_div]:min-w-0 [&_.day-head_h2]:[font:400_clamp(25px,_1.8vw,_32px)/1.5_'QianTuBiFeng_Handwriting',_'Noto_Serif_SC_Variable',_serif] [&_.day-head_h2]:[letter-spacing:1px] [&_.day-head_h2]:[margin:0_0_8px] [&_.day-head_h2]:[overflow-wrap:anywhere] [&_.day-head_p]:m-0 [&_.day-head_p]:[color:var(--editor-muted)] [&_.day-head_p]:[font-size:14px] [&_.day-body]:p-0 [&_.day-body]:[gap:0] [&_.activity-card]:grid [&_.activity-card]:[grid-template-columns:40px_minmax(0,_1fr)] [&_.activity-card]:[align-items:start] [&_.activity-card]:[gap:12px] [&_.activity-card]:[padding:18px_16px] [&_.activity-card]:[background:var(--color-editor-page-background-69)] [&_.activity-card]:[border:1px_solid_var(--color-editor-page-border-70)] [&_.activity-card]:[border-radius:18px] [&_.activity-card]:[box-shadow:0_3px_8px_var(--color-editor-page-box-shadow-71),_0_12px_28px_var(--color-editor-page-box-shadow-72)] [&_.activity-card.has-cover]:[grid-template-columns:40px_minmax(0,_1fr)_minmax(120px,_39%)] [&_.activity-name]:[font-size:20px] [&_.activity-name]:[line-height:1.45] [&_.activity-name]:[margin:2px_0_8px] [&_.activity-name]:[color:var(--editor-ink)] [&_.activity-name]:font-semibold [&_.activity-name]:[overflow-wrap:anywhere] [&_.cat-badge]:[color:var(--editor-muted)] [&_.cat-badge]:[font-size:14px] [&_.cat-badge]:[gap:6px] [&_.cat-badge_.editor-icon]:[color:var(--color-editor-page-color-76)] [&_.cat-badge_.editor-icon]:[width:18px] [&_.cat-badge_.editor-icon]:[height:18px] [&_.activity-desc]:[color:var(--color-editor-page-color-77)] [&_.activity-desc]:[font-size:14px] [&_.activity-desc]:[line-height:1.8] [&_.activity-desc]:[margin:10px_0_0] [&_.activity-desc]:[display:-webkit-box] [&_.activity-desc]:[-webkit-line-clamp:2] [&_.activity-desc]:[-webkit-box-orient:vertical] [&_.activity-desc]:overflow-hidden [&_.activity-card_>_.poi-cover]:w-full [&_.activity-card_>_.poi-cover]:[height:auto] [&_.activity-card_>_.poi-cover]:[aspect-ratio:4/3] [&_.activity-card_>_.poi-cover]:[object-fit:cover] [&_.activity-card_>_.poi-cover]:[align-self:stretch] [&_.activity-card_>_.poi-cover]:[min-height:150px] [&_.activity-card_>_.poi-cover]:[max-height:210px] [&_.activity-card_>_.poi-cover]:[border:2px_solid_white] [&_.activity-card_>_.poi-cover]:[border-radius:14px] [&_.activity-card_>_.poi-cover]:[box-shadow:0_3px_10px_var(--color-editor-page-box-shadow-78)] [&_.rsv-required]:[background:var(--color-editor-page-background-80)] [&_.rsv-required]:[color:var(--color-editor-page-color-81)] [&_.rsv-required]:font-medium [&_.rsv-badge]:[padding:5px_9px] [&_.rsv-badge]:rounded-full [&_.activity-heading_.activity-name]:m-0 [&_.activity-main]:[grid-column:2] [&_.activity-card_>_.poi-cover]:[grid-column:3] [&_:is(.btn-add-activity,_.btn-add-day)]:[border:1px_dashed_var(--color-editor-page-border-90)] [&_:is(.btn-add-activity,_.btn-add-day)]:[color:var(--color-editor-page-color-91)] [&_:is(.btn-add-activity,_.btn-add-day)]:[border-radius:14px] [&_:is(.btn-add-activity,_.btn-add-day)]:[padding:12px] [&_:is(.btn-add-activity,_.btn-add-day)]:[background:var(--color-editor-page-background-92)] [&_.chat-panel]:[padding:26px_18px] [&_.chat-panel]:[gap:12px] [&_.chat-stream]:[padding:36px_10px_16px] [&_.chat-stream]:[gap:24px] [&_.chat-stream]:[scrollbar-width:thin] [&_.chat-msg]:[max-width:90%] [&_.chat-bubble]:[padding:14px_16px] [&_.chat-bubble]:[line-height:1.8] [&_.chat-bubble]:[font-size:14px] [&_.chat-bubble]:[background:var(--color-editor-page-background-95)] [&_.chat-bubble]:border-0 [&_.chat-bubble]:[border-radius:18px] [&_.chat-bubble]:[color:var(--color-editor-page-color-96)] [&_.chat-msg-user_.chat-bubble]:[background:var(--color-editor-page-background-97)] [&_.chat-msg-user_.chat-bubble]:[color:var(--color-editor-page-color-98)] [&_.chat-input]:[background:var(--color-editor-page-background-99)] [&_.chat-input]:[border:1px_solid_white] [&_.chat-input]:[border-radius:28px] [&_.chat-input]:[padding:8px] [&_.chat-input]:m-0 [&_.chat-input]:items-center [&_.chat-input]:[box-shadow:0_6px_18px_var(--color-editor-page-box-shadow-100)] [&_.chat-input_textarea]:[width:0] [&_.chat-input_textarea]:min-w-0 [&_.chat-input_textarea]:[max-height:120px] [&_.chat-input_textarea]:border-0 [&_.chat-input_textarea]:[resize:none] [&_.chat-input_textarea]:bg-transparent [&_.chat-input_textarea]:[font-size:13px] [&_.chat-input_textarea]:[padding:10px] [&_.chat-input_textarea]:[color:var(--editor-ink)] [&_.chat-input_textarea::placeholder]:[color:var(--color-editor-page-color-101)] [&_.chat-input_.btn]:[width:42px] [&_.chat-input_.btn]:[height:42px] [&_.chat-input_.btn]:flex-none [&_.chat-input_.btn]:[padding:10px] [&_.chat-input_.btn]:[border-radius:50%] [&_.chat-input_.btn]:[background:var(--editor-gradient)] [&_.chat-input_.btn]:[color:var(--color-btn-primary-color-3)] [&_.chat-input_.btn]:[box-shadow:0_3px_10px_var(--color-editor-page-box-shadow-102)] [&_.chat-input_.btn:disabled]:[opacity:1] [&_.chat-input_.btn:disabled]:[background:linear-gradient(135deg,_var(--color-brand-disabled),_var(--color-brand-disabled-deep))] [&_.chat-input_.btn:disabled]:shadow-none [&_.map-pane]:relative [&_.map-pane]:[inset:auto] [&_.map-pane]:flex [&_.map-pane]:flex-col [&_.map-pane]:h-full [&_.map-pane]:[gap:14px] [&_.day-filter]:[position:static] [&_.day-filter]:flex [&_.day-filter]:[flex-wrap:nowrap] [&_.day-filter]:flex-none [&_.day-filter]:[max-width:100%] [&_.day-filter]:overflow-x-auto [&_.day-filter]:[gap:8px] [&_.day-filter]:[z-index:auto] [&_.day-filter]:[scrollbar-width:thin] [&_.day-filter]:[padding-bottom:2px] [&_:is(button,_summary,_a,_textarea,_select):focus-visible]:[outline:2px_solid_var(--color-editor-page-outline-106)] [&_:is(button,_summary,_a,_textarea,_select):focus-visible]:[outline-offset:3px] [@media_(min-width:_1101px)_and_(max-width:_1400px)]:[&_.activity-card]:[gap:8px] [@media_(min-width:_1101px)_and_(max-width:_1400px)]:[&_.activity-card]:[padding:14px_12px] [@media_(min-width:_1101px)_and_(max-width:_1400px)]:[&_.activity-card]:[grid-template-columns:32px_minmax(0,_1fr)] [@media_(min-width:_1101px)_and_(max-width:_1400px)]:[&_.activity-card.has-cover]:[grid-template-columns:32px_minmax(0,_1fr)_34%] [@media_(min-width:_1101px)_and_(max-width:_1400px)]:[&_.activity-name]:[font-size:18px] [@media_(min-width:_1101px)_and_(max-width:_1400px)]:[&_.activity-card_>_.poi-cover]:[min-height:130px] [@media_(min-width:_1101px)_and_(max-width:_1400px)]:[&_.editor-title]:[gap:10px] [@media_(min-width:_1101px)_and_(max-width:_1400px)]:[&_.editor-trip-meta]:[font-size:12px] [@media_(max-width:_1100px)]:[padding-bottom:16px] [@media_(max-width:_1100px)]:[&_.editor-mobile-tabs]:flex [@media_(max-width:_1100px)]:[&_.editor-mobile-tabs]:[gap:8px] [@media_(max-width:_1100px)]:[&_.editor-mobile-tabs]:[padding:4px] [@media_(max-width:_1100px)]:[&_.editor-mobile-tabs]:border-0 [@media_(max-width:_1100px)]:[&_.editor-mobile-tabs]:[background:var(--color-editor-page-background-107)] [@media_(max-width:_1100px)]:[&_.editor-mobile-tabs]:rounded-full [@media_(max-width:_1100px)]:[&_.editor-mobile-tabs]:flex-none [@media_(max-width:_1100px)]:[&_.mobile-tab]:flex-1 [@media_(max-width:_1100px)]:[&_.mobile-tab]:[min-height:40px] [@media_(max-width:_1100px)]:[&_.mobile-tab]:border-0 [@media_(max-width:_1100px)]:[&_.mobile-tab]:rounded-full [@media_(max-width:_1100px)]:[&_.mobile-tab]:[background:none] [@media_(max-width:_1100px)]:[&_.mobile-tab]:[color:var(--editor-muted)] [@media_(max-width:_1100px)]:[&_.mobile-tab]:cursor-pointer [@media_(max-width:_1100px)]:[&_.mobile-tab.active]:[background:var(--editor-gradient)] [@media_(max-width:_1100px)]:[&_.mobile-tab.active]:[color:white] [@media_(max-width:_1100px)]:[&_.editor-body]:flex [@media_(max-width:_1100px)]:[&_.editor-body.without-chat]:flex [@media_(max-width:_1100px)]:[&_:is(.editor-chat,_.editor-left,_.editor-map)]:hidden [@media_(max-width:_1100px)]:[&_:is(.editor-chat,_.editor-left,_.editor-map)]:w-full [@media_(max-width:_1100px)]:[&_:is(.editor-chat,_.editor-left,_.editor-map)]:flex-1 [@media_(max-width:_1100px)]:[&_.mobile-chat_.editor-chat]:flex [@media_(max-width:_1100px)]:[&_.mobile-list_.editor-left]:flex [@media_(max-width:_1100px)]:[&_.mobile-map_.editor-map]:block [@media_(max-width:_1100px)]:[&_.editor-title]:block [@media_(max-width:_1100px)]:[&_.editor-title_h1]:[font-size:19px] [@media_(max-width:_1100px)]:[&_.editor-trip-meta]:[margin-top:6px] [@media_(max-width:_1100px)]:[&_.editor-trip-meta]:[font-size:12px] [@media_(max-width:_1100px)]:[&_.activity-card_>_.poi-cover]:[max-height:230px] [@media_(max-width:_600px)]:[height:calc(100dvh_-_68px)] [@media_(max-width:_600px)]:[max-height:calc(100dvh_-_68px)] [@media_(max-width:_600px)]:[padding-top:8px] [@media_(max-width:_600px)]:[&_.editor-toolbar]:[padding:10px] [@media_(max-width:_600px)]:[&_.editor-toolbar]:[gap:8px] [@media_(max-width:_600px)]:[&_.editor-toolbar]:[border-radius:18px] [@media_(max-width:_600px)]:[&_.editor-toolbar-left]:[gap:8px] [@media_(max-width:_600px)]:[&_.btn-back]:border-0 [@media_(max-width:_600px)]:[&_.btn-back]:p-0 [@media_(max-width:_600px)]:[&_.btn-back_span]:hidden [@media_(max-width:_600px)]:[&_.editor-title_h1_.editor-icon]:hidden [@media_(max-width:_600px)]:[&_.editor-title_h1]:[font-size:16px] [@media_(max-width:_600px)]:[&_.editor-trip-meta]:[font-size:11px] [@media_(max-width:_600px)]:[&_.editor-trip-meta]:block [@media_(max-width:_600px)]:[&_.export-menu_>_summary]:[font-size:12px] [@media_(max-width:_600px)]:[&_.export-menu_>_summary]:[padding:8px] [@media_(max-width:_600px)]:[&_.export-menu_>_summary]:[gap:4px] [@media_(max-width:_600px)]:[&_.export-menu_.editor-icon]:[width:16px] [@media_(max-width:_600px)]:[&_.export-menu_.editor-icon]:[height:16px] [@media_(max-width:_600px)]:[&_.editor-left-scroll]:[padding:4px_12px_24px] [@media_(max-width:_600px)]:[&_.day-head_h2]:[font-size:26px] [@media_(max-width:_600px)]:[&_.activity-card]:[padding:14px_10px] [@media_(max-width:_600px)]:[&_.activity-card]:[gap:8px] [@media_(max-width:_600px)]:[&_.activity-card]:[grid-template-columns:28px_minmax(0,_1fr)] [@media_(max-width:_600px)]:[&_.activity-card.has-cover]:[grid-template-columns:28px_minmax(0,_1fr)_32%] [@media_(max-width:_600px)]:[&_.activity-name]:[font-size:17px] [@media_(max-width:_600px)]:[&_.activity-card_>_.poi-cover]:[min-height:120px] [@media_(max-width:_600px)]:[&_.activity-card_>_.poi-cover]:[max-height:160px] [@media_(max-width:_600px)]:[&_.activity-card_>_.poi-cover]:[border-radius:10px] [@media_(max-width:_600px)]:[&_.cat-badge]:[font-size:12px] [@media_(max-width:_600px)]:[&_.activity-desc]:[font-size:14px] [@media_(max-width:_600px)]:[&_.editor-map]:[padding:12px] [@media_(max-width:_600px)]:[&_.chat-stream]:[padding-top:12px]"}>
      <div className={"editor-toolbar flex items-center justify-between [gap:10px] [padding:10px_16px] [background:var(--color-card)] [border-bottom:1px_solid_var(--color-border)]"}>
        <div className={"editor-toolbar-left flex items-center [gap:10px] min-w-0"}>
          <Link to="/trips" className={"btn [border:1px_solid_transparent] [border-radius:var(--radius)] [font-size:0.9rem] cursor-pointer [color:var(--color-text)] inline-flex items-center [gap:4px] [&:disabled]:[opacity:0.55] [&:disabled]:[cursor:not-allowed] btn-ghost [border-color:var(--color-border)] [background:var(--color-card)] [&:not(:disabled):hover]:[border-color:var(--color-primary)] [&:not(:disabled):hover]:[color:var(--color-primary)] btn-back [padding:6px_10px]"} aria-label="返回行程列表"><EditorIcon name="back" /><span>返回</span></Link>
          <div className={"editor-title [&_h1]:[font-size:1.05rem] [&_h1]:whitespace-nowrap [&_h1]:overflow-hidden [&_h1]:[text-overflow:ellipsis] [&_.muted]:[font-size:0.78rem] [@media_(max-width:_768px)]:[&_.muted]:hidden"}>
            <h1><EditorIcon name="pin" />{trip.title}</h1>
            <span className={"editor-trip-meta [&_.editor-icon]:[color:var(--color-editor-page-color-62)] flex items-center [gap:8px] [font-size:14px] [@media_(max-width:_600px)]:[&_.editor-icon]:hidden"}><EditorIcon name="calendar" />{dateLabel ? `${dateLabel} · ` : ''}{trip.days.length}天 · {trip.partySize}人</span>
            {saveState === 'error' && <span className={"text-danger [color:var(--color-danger)]"} role="alert">保存失败，请检查网络后<button type="button" className={"btn [border:1px_solid_transparent] [border-radius:var(--radius)] [padding:8px_14px] [font-size:0.9rem] cursor-pointer [background:none] [color:var(--color-text)] inline-flex items-center [gap:4px] [&:disabled]:[opacity:0.55] [&:disabled]:[cursor:not-allowed]"} onClick={() => { setSaveState('saving'); saveTrip.mutate(trip, { onSuccess: () => setSaveState('saved'), onError: () => setSaveState('error') }); }}>重试保存</button></span>}
          </div>
        </div>
        <div className={"editor-toolbar-right flex items-center [gap:8px] shrink-0"}><ExportMenu trip={trip} /></div>
      </div>

      <div className={"editor-mobile-tabs hidden [@media_(max-width:_768px)]:flex [@media_(max-width:_768px)]:[background:var(--color-card)] [@media_(max-width:_768px)]:[border-bottom:1px_solid_var(--color-border)]"}>
        {mobileTabs.map(([tab, label]) => (
          <button
            key={tab}
            type="button"
            className={`mobile-tab [@media_(max-width:_768px)]:flex-1 [@media_(max-width:_768px)]:[border:none] [@media_(max-width:_768px)]:[background:none] [@media_(max-width:_768px)]:[padding:10px_0] [@media_(max-width:_768px)]:[font-size:0.9rem] [@media_(max-width:_768px)]:[color:var(--color-muted)] [@media_(max-width:_768px)]:[border-bottom:2px_solid_transparent] [@media_(max-width:_768px)]:[&.active]:[color:var(--color-primary)] [@media_(max-width:_768px)]:[&.active]:[border-bottom-color:var(--color-primary)] [@media_(max-width:_768px)]:[&.active]:font-semibold ${mobileTab === tab ? "active" : ""}`}
            aria-pressed={mobileTab === tab}
            onClick={() => setMobileTab(tab)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className={`editor-body flex-1 flex min-h-0 [@media_(max-width:_768px)]:relative [@media_(max-width:_768px)]:[&.mobile-chat_.editor-chat]:flex [@media_(max-width:_768px)]:[&.mobile-list_.editor-left]:flex [@media_(max-width:_768px)]:[&.mobile-map_.editor-map]:block mobile-${mobileTab} ${conversationId ? "has-chat" : "without-chat"}`}>
        {/* R2（09-24）：有来源会话的行程，对话常驻最左侧；导入/旧行程无会话则不占位 */}
        {conversationId && (
          <aside className={"editor-chat [width:300px] shrink-0 flex flex-col [border-right:1px_solid_var(--color-border)] [background:var(--color-card)] min-h-0 [@media_(max-width:_768px)]:w-full [@media_(max-width:_768px)]:[border-right:none] [@media_(max-width:_768px)]:hidden"} aria-label="旅行助手">
            <ChatPanel conversationId={conversationId} currentTripId={id} />
          </aside>
        )}
        <aside className={"editor-left [width:430px] shrink-0 flex flex-col [border-right:1px_solid_var(--color-border)] [background:var(--color-bg)] min-h-0 [@media_(max-width:_768px)]:w-full [@media_(max-width:_768px)]:[border-right:none] [@media_(max-width:_768px)]:hidden"}>
          <div className={"editor-day-nav flex items-center [gap:10px] [padding:16px_18px_12px] flex-none [@media_(min-width:_1101px)_and_(max-width:_1400px)]:[gap:4px] [@media_(min-width:_1101px)_and_(max-width:_1400px)]:[padding-inline:12px] [@media_(max-width:_600px)]:[padding:12px_12px_8px] [@media_(max-width:_600px)]:[gap:4px]"}>
            <div className={"editor-day-tabs flex [gap:5px] overflow-x-auto [scrollbar-width:thin] min-w-0 flex-1 [padding:2px_0_6px] [&_button]:border-0 [&_button]:rounded-full [&_button]:[min-height:38px] [&_button]:[padding:8px_17px] [&_button]:flex-none [&_button]:cursor-pointer [&_button]:[background:var(--color-editor-day-tabs-background-66)] [&_button]:[color:var(--editor-muted)] [&_button]:[font:inherit] [&_button]:[font-size:14px] [&_button]:shadow-none [&_button]:whitespace-nowrap [&_button:first-child]:[background:var(--color-editor-day-tabs-background-67)] [&_button[aria-pressed=true]]:[background:var(--editor-gradient)] [&_button[aria-pressed=true]]:[color:white] [&_button[aria-pressed=true]]:[box-shadow:0_4px_12px_var(--color-editor-day-tabs-box-shadow-68)] [@media_(min-width:_1101px)_and_(max-width:_1400px)]:[&_button]:[padding-inline:12px] [@media_(max-width:_600px)]:[&_button]:[padding-inline:13px]"} role="group" aria-label="行程天数">
              <button type="button" aria-pressed={dayFilter === null} onClick={() => setDayFilter(null)}>总览</button>
              {trip.days.map((day) => <button key={day.id} type="button" aria-pressed={dayFilter === day.dayIndex} onClick={() => setDayFilter(day.dayIndex)}>第{day.dayIndex}天</button>)}
            </div>
            <button type="button" className={"editor-candidates-button border-0 rounded-full [min-height:38px] [padding:8px_14px] flex-none cursor-pointer [background:var(--color-editor-day-tabs-background-67)] [color:var(--editor-muted)] [font:inherit] [font-size:13px] shadow-none whitespace-nowrap [@media_(max-width:_600px)]:[padding-inline:10px] [@media_(max-width:_600px)]:[font-size:12px]"} onClick={() => setCandidatesOpen(true)}>备选清单</button>
          </div>
          <div className={"editor-left-scroll flex-1 overflow-y-auto [padding:12px_14px_40px] min-h-0"} ref={scrollRef}>{itineraryPanel}</div>
        </aside>
        <div className={"editor-map flex-1 min-w-0 relative [@media_(max-width:_768px)]:hidden"}>
          <MapView
            visible={mobileTab === 'map'}
            onEditActivity={(dayId, activityId) => setEditing({ dayId, activityId })}
          />
        </div>
      </div>

      {candidatesOpen && <Modal title="备选清单" onClose={() => setCandidatesOpen(false)}>{overviewMatch.unmatched.length ? <CandidateDrawer pois={overviewMatch.unmatched} expanded /> : <p className={"muted [color:var(--color-muted)] [font-size:0.88rem]"}>暂无未编入行程的备选地点。</p>}</Modal>}
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
