import { useEffect, useRef, useState } from 'react';
import { Value } from '@sinclair/typebox/value';
import { RouteOptionsResponseSchema, type RouteOptionsResponse, type TransitLeg } from '@tripweaver/shared';
import { api } from '../../api/client';
import { routePairKey } from '../../lib/routePair';
import { hasValidCoord } from '../../lib/colors';
import { formatLegDistance, formatLegDuration, LEG_MODE_LABEL } from '../../lib/tripDerive';
import { useEditorStore } from '../../store/editorStore';
import { EditorIcon } from './EditorIcon';

export function RouteOptions({ dayId, fromId, leg }: { dayId: string; fromId: string; leg?: TransitLeg }) {
  const trip = useEditorStore((s) => s.trip);
  const key = trip ? routePairKey(trip, dayId, fromId) : null;
  // Remount the request owner when endpoints change, so late promises cannot populate a new pair.
  if (!key) return null;
  return <RouteOptionsForPair key={key} pairKey={key} dayId={dayId} fromId={fromId} leg={leg} />;
}

function RouteOptionsForPair({ pairKey, dayId, fromId, leg }: { pairKey: string; dayId: string; fromId: string; leg?: TransitLeg }) {
  const [result, setResult] = useState<RouteOptionsResponse>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const active = useRef(true);
  const pending = useRef(false);
  const details = useRef<HTMLDetailsElement>(null);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);

  async function query() {
    if (pending.current) return;
    const trip = useEditorStore.getState().trip;
    if (!trip || routePairKey(trip, dayId, fromId) !== pairKey) return;
    const day = trip.days.find((d) => d.id === dayId)!;
    const i = day.activities.findIndex((a) => a.id === fromId);
    const from = day.activities[i]!;
    const to = day.activities[i + 1]!;
    if (!hasValidCoord(from) || !hasValidCoord(to)) { setError('地点缺少坐标，请先编辑地点'); return; }
    pending.current = true;
    setLoading(true);
    setError('');
    try {
      const response = await api.post<unknown>(`/api/trips/${encodeURIComponent(trip.id)}/route-options`, { from, to, destination: trip.destination });
      if (!Value.Check(RouteOptionsResponseSchema, response)) throw new Error('路线数据格式异常，请重试');
      if (active.current) setResult(response);
    } catch (e) {
      if (active.current) setError(e instanceof Error ? e.message : '路线查询失败，请重试');
    } finally {
      pending.current = false;
      if (active.current) setLoading(false);
    }
  }

  return <div className="activity-between py-2 text-[13px] text-muted">
    <details ref={details} className="rounded-lg" onToggle={(e) => { if (e.currentTarget.open && !result && !error) void query(); }}>
      <summary className="editor-transit flex min-h-10 cursor-pointer items-center gap-2 rounded-lg px-2 hover:bg-black/5" aria-label="切换交通方式">
        <EditorIcon name={leg?.mode === 'walk' ? 'walk' : 'route'} />
        <span>{leg ? `${LEG_MODE_LABEL[leg.mode]}约${formatLegDuration(leg.durationMin)} · ${leg.source === 'heuristic' ? '估算' : formatLegDistance(leg.distanceM)}` : '查询交通方式'}</span>
        <span aria-hidden="true">⌄</span>
      </summary>
      <div className="mt-1 rounded-lg border border-border bg-white/90 p-2" aria-label="交通方式选项">
        {loading && <p role="status" className="p-2">正在查询各方式耗时…</p>}
        {error && <p role="alert" className="p-2">{error}</p>}
        {result?.options.map((option) => {
          const mode = option.status === 'available' ? option.leg.mode : option.mode;
          return <button key={mode} type="button" disabled={loading || option.status !== 'available'}
            aria-pressed={leg?.mode === mode} className="flex min-h-11 w-full items-center justify-between gap-3 rounded-md px-2 py-2 text-left hover:bg-black/5 disabled:cursor-default disabled:opacity-60"
            onClick={() => {
              if (option.status !== 'available') return;
              if (!useEditorStore.getState().selectRoute(dayId, pairKey, option.leg)) { setError('路段已变化，请重新查询'); return; }
              if (details.current) details.current.open = false;
            }}>
            <span className="shrink-0">{LEG_MODE_LABEL[mode]}{leg?.mode === mode ? ' ✓' : ''}</span>
            <span>{option.status === 'available' ? `${formatLegDuration(option.leg.durationMin)} · ${formatLegDistance(option.leg.distanceM)} · ${option.leg.source === 'amap' ? '高德' : '天地图'}` : option.reason}</span>
          </button>;
        })}
        {leg && leg.source !== 'heuristic' && !leg.polyline && <p className="px-2 py-1">此路线暂无路径图，地图显示地点连线。</p>}
        <button type="button" className="min-h-10 px-2 underline" disabled={loading} onClick={() => void query()}>重新查询</button>
      </div>
    </details>
  </div>;
}
