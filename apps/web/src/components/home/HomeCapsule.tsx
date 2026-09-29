import { Button } from '../ui/Button';
// 首页渐进式玻璃胶囊指挥台（09-26）：4 段摘要（目的地/日期/节奏与同行/偏好与出行）+ 圆形提交。
// 每段点击后在「自己上方」弹出玻璃面板，面板带指向该段的小尾巴；四段共用同一套外壳样式。
// 只做收集与展示，跳转 /trips/new 预填由 HomePage 负责。
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  MAX_TRIP_DAYS,
  PACE_LABELS,
  PACE_OPTIONS,
  PREFERENCE_OPTIONS,
  TRANSPORT_MODES,
  type TransportMode,
  type TripPace,
} from '@tripweaver/shared';
import { RangeCalendar } from '../RangeCalendar';
import { TRANSPORT_LABELS } from '../../lib/chatDerive';
import { daysBetween, isoDateAfter, shortDate } from '../../lib/dates';
import {
  CalendarIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ClockIcon,
  CloseIcon,
  CompassIcon,
  GaugeIcon,
  PinIcon,
  ScissorsIcon,
} from './HomeIcons';

type Preference = (typeof PREFERENCE_OPTIONS)[number];
type PanelKey = 'city' | 'date' | 'pace' | 'more';

export interface HomeTripDraft {
  startDate: string;
  endDate: string;
  days: number;
  pace: TripPace | null;
  partySize: number;
  preferences: Preference[];
  transportMode: TransportMode | null;
}

interface HomeCapsuleProps {
  city: string | null;
  cities: string[];
  onSelectCity: (name: string) => void;
  onStart: (draft: HomeTripDraft) => void;
}

const PACE_DESCS: Record<TripPace, string> = {
  relaxed: '少走路、慢节奏探索',
  moderate: '经典地标全景体验',
  tight: '高密度、极致高效',
};

/** 面板外壳：玻璃卡片 + 指向所在段的尾巴（宽度与内边距由各面板自己给，避免原子类互相覆盖） */
const panelShellCls =
  'absolute bottom-[calc(100%_+_31*var(--ui))] left-0 z-30 flex max-w-[calc(100vw_-_2rem)] flex-col rounded-[calc(20*var(--ui))] border border-white/70 bg-white/88 shadow-[0_18px_50px_rgba(31,64,124,0.14)] backdrop-blur-2xl backdrop-saturate-150';
const spacedPanelCls = 'gap-[calc(14*var(--ui))] p-[calc(18*var(--ui))]';
const cityPanelCls = `${panelShellCls} ${spacedPanelCls} w-[max(300px,21vw)]`;
const pacePanelCls = `${panelShellCls} ${spacedPanelCls} w-[max(320px,22vw)]`;
const datePanelCls = `${panelShellCls} w-[max(340px,25vw)]`;

const panelLabelCls = 'm-0 text-[length:calc(13*var(--ui))] text-ink-muted';
const chipCls = (active: boolean) =>
  `rounded-full border px-[calc(14*var(--ui))] py-[calc(6*var(--ui))] text-[length:calc(14*var(--ui))] transition-colors ${
    active
      ? 'border-brand bg-brand font-semibold text-white'
      : 'border-black/10 bg-white/70 text-ink-strong hover:border-brand hover:text-brand'
  }`;
const cityCardCls = (active: boolean) =>
  `rounded-[calc(12*var(--ui))] border px-[calc(10*var(--ui))] py-[calc(13*var(--ui))] text-center text-[length:calc(15*var(--ui))] font-semibold transition-colors ${
    active
      ? 'border-brand bg-brand/10 text-brand'
      : 'border-hairline-strong bg-white/60 text-ink-strong hover:border-brand hover:text-brand'
  }`;

const divider = (
  <span aria-hidden="true" className="my-[calc(13*var(--ui))] hidden w-px shrink-0 bg-hairline-divider lg:block" />
);

interface SegmentProps {
  icon: ReactNode;
  iconCls: string;
  label: string;
  value: string;
  pending?: boolean;
  open: boolean;
  onClick: () => void;
}

function Segment({ icon, iconCls, label, value, pending = false, open, onClick }: SegmentProps) {
  return (
    <Button variant="plain"
      type="button"
      aria-expanded={open}
      onClick={onClick}
      className={`flex h-full w-full min-w-0 items-center gap-[calc(8*var(--ui))] rounded-[calc(20*var(--ui))] px-[calc(8*var(--ui))] py-[calc(9*var(--ui))] text-left transition-colors ${open ? "bg-white/80" : "hover:bg-white/55"}`}
    >
      <span className={`grid h-[calc(26*var(--ui))] w-[calc(26*var(--ui))] shrink-0 place-items-center ${iconCls}`}>
        {icon}
      </span>
      <span className="flex min-w-0 flex-col gap-[calc(4*var(--ui))]">
        <span className="text-[length:calc(13*var(--ui))] leading-none text-ink-faint">{label}</span>
        <span className="flex min-w-0 items-center gap-[calc(5*var(--ui))]">
          <span
            className={`text-[length:calc(16*var(--ui))] leading-tight font-semibold ${pending ? "text-ink-pending" : "text-ink-strong"}`}
          >
            {value}
          </span>
          <ChevronDownIcon className="h-[calc(15*var(--ui))] w-[calc(15*var(--ui))] shrink-0 text-ink-faint" />
        </span>
      </span>
    </Button>
  );
}

function PanelHead({ icon, title, onClose }: { icon: ReactNode; title: string; onClose?: () => void }) {
  return (
    <div className="flex items-center gap-[calc(10*var(--ui))]">
      <span className="grid h-[calc(20*var(--ui))] w-[calc(20*var(--ui))] shrink-0 place-items-center">{icon}</span>
      <h2 className="m-0 font-semibold text-ink-strong">{title}</h2>
      {onClose && (
        <Button variant="plain"
          type="button"
          aria-label={`关闭${title}`}
          onClick={onClose}
          className="ml-auto grid h-[calc(28*var(--ui))] w-[calc(28*var(--ui))] place-items-center rounded-full text-ink-soft transition-colors hover:bg-canvas"
        >
          <CloseIcon className="h-[calc(14*var(--ui))] w-[calc(14*var(--ui))]" />
        </Button>
      )}
    </div>
  );
}

/** 指向所在胶囊段的尾巴：只有右下两条边需要描边 */
function PanelTail() {
  return (
    <span
      aria-hidden="true"
      className="absolute -bottom-[calc(8*var(--ui))] left-[calc(30*var(--ui))] h-[calc(16*var(--ui))] w-[calc(16*var(--ui))] rotate-45 border-r border-b border-white/70 bg-white/88"
    />
  );
}

export function HomeCapsule({ city, cities, onSelectCity, onStart }: HomeCapsuleProps) {
  const [startDate, setStartDate] = useState(() => isoDateAfter(1));
  const [endDate, setEndDate] = useState(() => isoDateAfter(3));
  const [pace, setPace] = useState<TripPace | null>(null);
  const [partySize, setPartySize] = useState(2);
  const [preferences, setPreferences] = useState<Preference[]>([]);
  const [transportMode, setTransportMode] = useState<TransportMode | null>(null);
  const [activePanel, setActivePanel] = useState<PanelKey | null>(null);
  const deckRef = useRef<HTMLDivElement>(null);

  const days = daysBetween(startDate, endDate);
  const ready = Boolean(city) && pace !== null;

  // 点胶囊条外部收起面板
  useEffect(() => {
    const onPointerDown = (e: MouseEvent) => {
      if (deckRef.current && !deckRef.current.contains(e.target as Node)) setActivePanel(null);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, []);

  const togglePanel = (key: PanelKey) => setActivePanel((cur) => (cur === key ? null : key));
  const togglePreference = (option: Preference) =>
    setPreferences((prev) => (prev.includes(option) ? prev.filter((p) => p !== option) : [...prev, option]));

  const paceSummary = `${partySize} 人 · ${pace ? PACE_LABELS[pace] : '选择节奏'}`;
  const moreSummary = [
    preferences.length > 0 ? preferences.join(' · ') : '偏好不限',
    transportMode ? TRANSPORT_LABELS[transportMode] : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const dateSummary = `${shortDate(startDate)} ~ ${shortDate(endDate)} · ${days}天`;

  return (
    <div ref={deckRef} className="relative">
      <div className="flex w-full flex-col gap-[calc(2*var(--ui))] rounded-[calc(28*var(--ui))] border border-white/70 bg-white/72 p-[calc(11*var(--ui))] shadow-[0_18px_46px_rgba(31,64,124,0.12)] backdrop-blur-2xl backdrop-saturate-150 lg:flex-row lg:items-stretch">
        <div className="relative min-w-0 flex-1">
          <Segment
            icon={<PinIcon className="h-[calc(26*var(--ui))] w-[calc(26*var(--ui))]" />}
            iconCls="text-brand"
            label="目的地"
            value={city ?? '点击地图选城市'}
            pending={!city}
            open={activePanel === 'city'}
            onClick={() => togglePanel('city')}
          />
          {activePanel === 'city' && (
            <div className={cityPanelCls}>
              <PanelHead
                icon={<PinIcon className="h-[calc(20*var(--ui))] w-[calc(20*var(--ui))] text-brand" />}
                title="目的地"
              />
              <p className={panelLabelCls}>可规划城市（也可直接点地图圆点）</p>
              <div className="grid grid-cols-3 gap-[calc(10*var(--ui))]">
                {cities.map((c) => (
                  <Button variant="plain"
                    key={c}
                    type="button"
                    aria-pressed={c === city}
                    className={cityCardCls(c === city)}
                    onClick={() => {
                      onSelectCity(c);
                    }}
                  >
                    {c}
                  </Button>
                ))}
              </div>
              <PanelTail />
            </div>
          )}
        </div>

        {divider}

        <div className="relative min-w-0 flex-1">
          <Segment
            icon={<CalendarIcon className="h-[calc(26*var(--ui))] w-[calc(26*var(--ui))]" />}
            iconCls="text-accent-indigo"
            label="出行日期"
            value={dateSummary}
            open={activePanel === 'date'}
            onClick={() => togglePanel('date')}
          />
          {activePanel === 'date' && (
            <div className={datePanelCls}>
              <div className="flex items-center gap-[calc(12*var(--ui))] px-[calc(20*var(--ui))] pt-[calc(16*var(--ui))]">
                <span className="grid h-[calc(20*var(--ui))] w-[calc(20*var(--ui))] shrink-0 place-items-center">
                  <CalendarIcon className="h-[calc(20*var(--ui))] w-[calc(20*var(--ui))] text-accent-indigo" />
                </span>
                <h2 className="m-0 font-semibold text-ink-strong">选择出行日期</h2>
                <Button variant="plain"
                  type="button"
                  aria-label="关闭选择出行日期"
                  onClick={() => setActivePanel(null)}
                  className="ml-auto grid h-[calc(28*var(--ui))] w-[calc(28*var(--ui))] place-items-center rounded-full text-ink-soft transition-colors hover:bg-canvas"
                >
                  <CloseIcon className="h-[calc(14*var(--ui))] w-[calc(14*var(--ui))]" />
                </Button>
              </div>
              <div className="px-[calc(16*var(--ui))]">
                <RangeCalendar
                  startDate={startDate}
                  endDate={endDate}
                  maxDays={MAX_TRIP_DAYS}
                  months={2}
                  onRangeChange={(s, e) => {
                    setStartDate(s);
                    setEndDate(e);
                  }}
                  footSlot={
                    <div className="-mx-[calc(16*var(--ui))] mt-[calc(16*var(--ui))] flex items-center gap-[calc(12*var(--ui))] border-t border-hairline px-[calc(20*var(--ui))] py-[calc(14*var(--ui))]">
                      <ClockIcon className="h-[calc(16*var(--ui))] w-[calc(16*var(--ui))] shrink-0 text-ink-muted" />
                      <span className="text-[length:calc(16*var(--ui))] font-semibold text-ink-soft">
                        {dateSummary}
                      </span>
                      <Button variant="plain"
                        type="button"
                        aria-label="收起日期选择"
                        onClick={() => setActivePanel(null)}
                        className="ml-auto grid h-[calc(28*var(--ui))] w-[calc(28*var(--ui))] place-items-center rounded-full text-ink-muted transition-colors hover:bg-canvas"
                      >
                        <ChevronUpIcon className="h-[calc(18*var(--ui))] w-[calc(18*var(--ui))]" />
                      </Button>
                    </div>
                  }
                />
              </div>
              <PanelTail />
            </div>
          )}
        </div>

        {divider}

        <div className="relative min-w-0 flex-1">
          <Segment
            icon={<GaugeIcon className="h-[calc(26*var(--ui))] w-[calc(26*var(--ui))]" />}
            iconCls="text-accent-teal"
            label="节奏与同行"
            value={paceSummary}
            pending={!pace}
            open={activePanel === 'pace'}
            onClick={() => togglePanel('pace')}
          />
          {activePanel === 'pace' && (
            <div className={pacePanelCls}>
              <PanelHead
                icon={<GaugeIcon className="h-[calc(20*var(--ui))] w-[calc(20*var(--ui))] text-accent-teal" />}
                title="节奏与同行"
                onClose={() => setActivePanel(null)}
              />
              <p className={panelLabelCls}>旅行节奏</p>
              <div className="grid grid-cols-3 gap-[calc(10*var(--ui))]">
                {PACE_OPTIONS.map((option) => (
                  <Button variant="plain"
                    key={option}
                    type="button"
                    aria-pressed={pace === option}
                    onClick={() => setPace(option)}
                    className={`flex flex-col gap-[calc(4*var(--ui))] rounded-[calc(12*var(--ui))] border px-[calc(12*var(--ui))] py-[calc(12*var(--ui))] text-left transition-colors ${pace === option ? "border-brand bg-brand/10 ring-1 ring-brand" : "border-hairline-strong bg-white/60 hover:border-brand"}`}
                  >
                    <span className="text-[length:calc(15*var(--ui))] font-semibold text-ink-strong">
                      {PACE_LABELS[option]}
                    </span>
                    <span className="text-[length:calc(12*var(--ui))] text-ink-muted">{PACE_DESCS[option]}</span>
                  </Button>
                ))}
              </div>
              <p className={panelLabelCls}>同行人数</p>
              <div className="inline-flex items-center gap-[calc(12*var(--ui))]">
                <Button variant="plain"
                  type="button"
                  aria-label="减少人数"
                  disabled={partySize <= 1}
                  onClick={() => setPartySize((n) => Math.max(1, n - 1))}
                  className="grid h-[calc(32*var(--ui))] w-[calc(32*var(--ui))] place-items-center rounded-[calc(10*var(--ui))] border border-hairline-strong bg-white/70 text-ink-strong disabled:opacity-30"
                >
                  −
                </Button>
                <span className="min-w-[6em] text-center text-[length:calc(15*var(--ui))] font-semibold text-ink-strong">
                  {partySize} 人同行
                </span>
                <Button variant="plain"
                  type="button"
                  aria-label="增加人数"
                  disabled={partySize >= 20}
                  onClick={() => setPartySize((n) => Math.min(20, n + 1))}
                  className="grid h-[calc(32*var(--ui))] w-[calc(32*var(--ui))] place-items-center rounded-[calc(10*var(--ui))] border border-hairline-strong bg-white/70 text-ink-strong disabled:opacity-30"
                >
                  ＋
                </Button>
              </div>
              <PanelTail />
            </div>
          )}
        </div>

        {divider}

        <div className="relative min-w-0 flex-1">
          <Segment
            icon={<ScissorsIcon className="h-[calc(26*var(--ui))] w-[calc(26*var(--ui))]" />}
            iconCls="text-accent-pink"
            label="偏好与出行"
            value={moreSummary}
            open={activePanel === 'more'}
            onClick={() => togglePanel('more')}
          />
          {activePanel === 'more' && (
            <div className={pacePanelCls}>
              <PanelHead
                icon={<ScissorsIcon className="h-[calc(20*var(--ui))] w-[calc(20*var(--ui))] text-accent-pink" />}
                title="偏好与出行"
                onClose={() => setActivePanel(null)}
              />
              <p className={panelLabelCls}>偏好（多选）</p>
              <div className="flex flex-wrap gap-[calc(8*var(--ui))]">
                {PREFERENCE_OPTIONS.map((option) => (
                  <Button variant="plain"
                    key={option}
                    type="button"
                    aria-pressed={preferences.includes(option)}
                    className={chipCls(preferences.includes(option))}
                    onClick={() => togglePreference(option)}
                  >
                    {option}
                  </Button>
                ))}
              </div>
              <p className={panelLabelCls}>出行方式（缺省公共交通）</p>
              <div className="flex flex-wrap gap-[calc(8*var(--ui))]">
                {TRANSPORT_MODES.map((mode) => (
                  <Button variant="plain"
                    key={mode}
                    type="button"
                    aria-pressed={transportMode === mode}
                    className={chipCls(transportMode === mode)}
                    onClick={() => setTransportMode((prev) => (prev === mode ? null : mode))}
                  >
                    {TRANSPORT_LABELS[mode]}
                  </Button>
                ))}
              </div>
              <PanelTail />
            </div>
          )}
        </div>

        {divider}

        <div className="flex shrink-0 items-center justify-center rounded-full bg-white/55 px-[calc(12*var(--ui))] py-[calc(6*var(--ui))]">
          <Button variant="plain"
            type="button"
            aria-label="开始规划"
            title={ready ? '开始规划' : '先选目的地与节奏'}
            disabled={!ready}
            onClick={() => onStart({ startDate, endDate, days, pace, partySize, preferences, transportMode })}
            className="grid h-[calc(76*var(--ui))] w-[calc(76*var(--ui))] place-items-center rounded-full bg-gradient-to-br from-brand-light to-brand text-white shadow-[0_12px_26px_rgba(47,107,243,0.35)] transition-transform enabled:hover:scale-[1.04] enabled:active:scale-95 disabled:cursor-not-allowed disabled:from-brand-disabled disabled:to-brand-disabled-deep disabled:shadow-none"
          >
            <CompassIcon className="h-[calc(30*var(--ui))] w-[calc(30*var(--ui))]" />
          </Button>
        </div>
      </div>

      {/* 提示语脱离文档流，不占胶囊外层高度 */}
      {!ready && (
        <p className="absolute inset-x-0 -bottom-[calc(26*var(--ui))] m-0 text-center text-[length:calc(13*var(--ui))] text-ink-hint">
          先选好目的地与节奏，再开始规划
        </p>
      )}
    </div>
  );
}






