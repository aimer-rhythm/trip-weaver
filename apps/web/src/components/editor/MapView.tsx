import { Button } from '../ui/Button';
// 地图面板（09-26 重构）：渲染器选择 + 数据计算 + 按天筛选。
//   · 主路径 AmapCanvas（高德 JS API）—— 唯一目的是能用 `features` 关掉 POI 文字层
//   · 降级 LeafletCanvas（高德栅格瓦片）—— 未配 JS Key、或 SDK 加载失败 / 超时
// 选择逻辑只在本文件；两个 canvas 只负责把数据画出来（数据层见 lib/mapData）。
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client';
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

// 桌面端地图常驻可见；≤1100px 时由移动页签决定
function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia('(min-width: 1101px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1101px)');
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
  if (!trip) return null;
  return (
    <div className={"day-filter absolute [top:12px] [left:12px] [z-index:1000] flex [gap:6px] flex-wrap [max-width:calc(100%_-_24px)]"} role="group" aria-label="地图天数">
      <Button variant="plain"
        type="button"
        className={`day-filter-btn [border:1px_solid_var(--color-border)] [background:var(--color-btn-primary-color-3)] rounded-full [padding:4px_12px] [font-size:0.8rem] cursor-pointer [box-shadow:var(--shadow)] [&.active]:[background:var(--color-primary)] [&.active]:[border-color:var(--color-primary)] [&.active]:[color:var(--color-btn-primary-color-3)] ${dayFilter === null ? "active" : ""}`}
        aria-pressed={dayFilter === null}
        onClick={() => setDayFilter(null)}
      >
        全部
      </Button>
      {trip.days.map((d) => (
        <Button variant="plain"
          key={d.id}
          type="button"
          className={`day-filter-btn [border:1px_solid_var(--color-border)] [background:var(--color-btn-primary-color-3)] rounded-full [padding:4px_12px] [font-size:0.8rem] cursor-pointer [box-shadow:var(--shadow)] [&.active]:[background:var(--color-primary)] [&.active]:[border-color:var(--color-primary)] [&.active]:[color:var(--color-btn-primary-color-3)] ${dayFilter === d.dayIndex ? "active" : ""}`}
          aria-pressed={dayFilter === d.dayIndex}
          onClick={() => setDayFilter(d.dayIndex)}
        >
          D{d.dayIndex}
        </Button>
      ))}
    </div>
  );
}

export function MapView({ visible }: { visible: boolean }) {
  const trip = useEditorStore((s) => s.trip);
  const dayFilter = useEditorStore((s) => s.dayFilter);
  const isDesktop = useIsDesktop();
  const amap = useAmapNamespace();

  // 按天筛选不再把其他天从数据里删掉 —— 它们仍然画出来，只是被标成 dimmed 由画布淡化
  const allDays = useMemo(() => trip?.days ?? [], [trip]);
  const points = useMemo(() => collectPoints(allDays, dayFilter), [allDays, dayFilter]);
  const dayLines = useMemo(() => collectDayLines(allDays, dayFilter), [allDays, dayFilter]);
  const canvasProps = { points, dayLines, visible: visible || isDesktop };

  return (
    <div className={"map-pane absolute [inset:0]"}>
      <DayFilterControl />
      <div className={"editor-map-canvas relative flex-1 min-h-0 [border-radius:18px] overflow-hidden [isolation:isolate]"}>{amap ? <AmapCanvas amap={amap} {...canvasProps} /> : <LeafletCanvas {...canvasProps} />}</div>
      {points.length === 0 && <div className={"map-empty absolute [z-index:1000] [top:50%] [left:50%] [transform:translate(-50%,_-50%)] [background:rgba(255,_255,_255,_0.92)] [border-radius:10px] [padding:10px_16px] muted [color:var(--color-muted)] [font-size:0.88rem]"}>暂无可标注的活动坐标</div>}
    </div>
  );
}
