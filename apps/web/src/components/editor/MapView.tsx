// 地图面板（09-26 重构）：渲染器选择 + 数据计算 + 按天筛选。
//   · 主路径 AmapCanvas（高德 JS API）—— 唯一目的是能用 `features` 关掉 POI 文字层
//   · 降级 LeafletCanvas（高德栅格瓦片）—— 未配 JS Key、或 SDK 加载失败 / 超时
// 选择逻辑只在本文件；两个 canvas 只负责把数据画出来（数据层见 lib/mapData）。
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client';
import { dayColor } from '../../lib/colors';
import { loadAmapSdk } from '../../lib/amapLoader';
import { collectDayLines, collectPoints } from '../../lib/mapData';
import type { AmapNamespace } from '../../lib/amapTypes';
import { useEditorStore } from '../../store/editorStore';
import { AmapCanvas } from './AmapCanvas';
import { LeafletCanvas } from './LeafletCanvas';

interface AmapJsConfig {
  amapJsKey: string;
  amapJsSecurityCode: string;
}

// 桌面端地图常驻可见；≤768px 时由移动页签决定
function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia('(min-width: 769px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 769px)');
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return isDesktop;
}

/**
 * 高德 JS API 的可用性探测：**默认走 Leaflet，只有确认可用才切过去**。
 * 地图是编辑器主视图，不能为了等增强而空着 —— 所以探测/加载期间渲染的就是降级路径。
 * 未配置 Key、接口失败（含未登录 401）、SDK 加载失败与 8 秒超时，全部静默保持 Leaflet，
 * 只留一行 console.warn 供排查（底图变化肉眼可见，不需要额外的界面提示）。
 */
function useAmapNamespace(): AmapNamespace | null {
  const [amap, setAmap] = useState<AmapNamespace | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const cfg = await api.get<AmapJsConfig>('/api/settings/config');
        if (!cfg.amapJsKey || !cfg.amapJsSecurityCode) return; // 未配置：保持 Leaflet
        await loadAmapSdk({ key: cfg.amapJsKey, securityJsCode: cfg.amapJsSecurityCode });
        const namespace = window.AMap;
        if (!namespace) throw new Error('SDK 已加载但未挂到 window.AMap');
        if (!cancelled) setAmap(namespace);
      } catch (err) {
        console.warn('[map] 高德 JS API 不可用，回落 Leaflet：', err instanceof Error ? err.message : err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return amap;
}

function DayFilterControl() {
  const trip = useEditorStore((s) => s.trip);
  const dayFilter = useEditorStore((s) => s.dayFilter);
  const setDayFilter = useEditorStore((s) => s.setDayFilter);
  if (!trip || trip.days.length <= 1) return null;
  return (
    <div className="day-filter">
      <button
        type="button"
        className={`day-filter-btn ${dayFilter === null ? 'active' : ''}`}
        onClick={() => setDayFilter(null)}
      >
        全部
      </button>
      {trip.days.map((d) => (
        <button
          key={d.id}
          type="button"
          className={`day-filter-btn ${dayFilter === d.dayIndex ? 'active' : ''}`}
          style={dayFilter === d.dayIndex ? { background: dayColor(d.dayIndex), borderColor: dayColor(d.dayIndex) } : undefined}
          onClick={() => setDayFilter(dayFilter === d.dayIndex ? null : d.dayIndex)}
        >
          D{d.dayIndex}
        </button>
      ))}
    </div>
  );
}

export function MapView({ visible, onEditActivity }: { visible: boolean; onEditActivity: (dayId: string, activityId: string) => void }) {
  const trip = useEditorStore((s) => s.trip);
  const dayFilter = useEditorStore((s) => s.dayFilter);
  const isDesktop = useIsDesktop();
  const amap = useAmapNamespace();

  const visibleDays = useMemo(() => {
    const days = trip?.days ?? [];
    return dayFilter === null ? days : days.filter((d) => d.dayIndex === dayFilter);
  }, [trip, dayFilter]);

  const points = useMemo(() => collectPoints(visibleDays), [visibleDays]);
  const dayLines = useMemo(() => collectDayLines(visibleDays), [visibleDays]);
  const canvasProps = { points, dayLines, visible: visible || isDesktop, onEditActivity };

  return (
    <div className="map-pane">
      {amap ? <AmapCanvas amap={amap} {...canvasProps} /> : <LeafletCanvas {...canvasProps} />}
      <DayFilterControl />
      {points.length === 0 && <div className="map-empty muted">暂无可标注的活动坐标</div>}
    </div>
  );
}
