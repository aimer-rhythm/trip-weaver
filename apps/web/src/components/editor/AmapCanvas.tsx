// 高德 JS API 渲染（09-26 新增，**主路径**）：与 LeafletCanvas 共用 lib/mapData 的点与线。
//
// ⚠️ 本 task 的全部目的在这里一行：`features` 只给 ['bg','road','building']，**不给 'point'**。
// `point` 才是兴趣点与文字标注层 —— 栅格瓦片把文字烘焙进 PNG（`style=` 关不掉，CSS 滤镜试过并回滚
// 于 commit 1d5a59b），JS API 能按图层精确控制，这是换渲染器唯一的收益来源。
//
// 交互：编辑按钮不用 React 组件（InfoWindow 的 content 是 HTML 字符串），改用 data 属性 +
// 容器上的事件委托 —— 高德把气泡 DOM 挂在传给它的容器内，也就是本组件的 div 里，
// 所以 React 合成事件能捕获到。
import { useEffect, useRef } from 'react';
import type { Activity, TripDay } from '@tripweaver/shared';
import type { AmapInfoWindow, AmapMap, AmapNamespace, AmapOverlay } from '../../lib/amapTypes';
import type { DayLines, MapPoint } from '../../lib/mapData';
import '../../styles/map-canvas.css';

interface Props {
  /** 已加载完成的高德命名空间（由 MapView 在加载成功后传入） */
  amap: AmapNamespace;
  points: MapPoint[];
  dayLines: DayLines[];
  /** 容器可见性：隐藏时 setFitView 会算出零尺寸视野，必须等可见再算 */
  visible: boolean;
  onEditActivity: (dayId: string, activityId: string) => void;
}

const FIT_PADDING = [40, 40, 40, 40]; // 上、下、左、右

/** marker pin 的 HTML：复用 Leaflet 路径的同一套 CSS 类，两套渲染视觉一致 */
function markerHtml(color: string, order: number, estimated: boolean): string {
  return `<div class="marker-pin${estimated ? ' marker-estimated' : ''}" style="background:${color}">${order}</div>`;
}

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** 活动名 / 简介来自模型输出，拼进 HTML 前必须转义（InfoWindow content 走 innerHTML） */
function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]!);
}

/** 气泡内容：与 Leaflet 侧的 <ActivityPopup> 同构，编辑按钮走 data 属性委托 */
function popupHtml(day: TripDay, activity: Activity): string {
  const time = activity.startTime ? `${activity.startTime}${activity.endTime ? ` – ${activity.endTime}` : ''}` : '--:--';
  const notes = activity.sourceNotes
    .map(
      (n) =>
        `<a href="${escapeHtml(n.url)}" target="_blank" rel="noopener noreferrer">📕 ${escapeHtml(n.title || '来源笔记')}</a>`,
    )
    .join('');
  return [
    '<div class="map-popup">',
    `<strong>${escapeHtml(activity.name)}</strong>`,
    `<p class="muted">Day ${day.dayIndex} · ${time} · ${escapeHtml(activity.category)}</p>`,
    activity.description ? `<p>${escapeHtml(activity.description)}</p>` : '',
    activity.coordSource === 'estimated' ? '<p class="tag tag-warn">坐标为估算</p>' : '',
    notes ? `<p>${notes}</p>` : '',
    `<button type="button" class="btn btn-ghost" data-edit-day="${escapeHtml(day.id)}" data-edit-activity="${escapeHtml(activity.id)}">编辑</button>`,
    '</div>',
  ]
    .filter(Boolean)
    .join('');
}

export function AmapCanvas({ amap, points, dayLines, visible, onEditActivity }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<AmapMap | null>(null);
  const overlaysRef = useRef<AmapOverlay[]>([]);
  // 回调进 ref：避免它变化时把建图 / 覆盖物 effect 整个重跑
  const onEditRef = useRef(onEditActivity);
  onEditRef.current = onEditActivity;

  // 覆盖物的输入汇总成一个 key，供下面两个 effect 共用（逐项列依赖只会制造噪声）
  const contentKey = [
    points.map((p) => `${p.activity.id}:${p.pos.lat},${p.pos.lng}`).join('|'),
    dayLines.map((l) => `${l.dayIndex}:${l.segments.map((s) => s.key).join(',')}`).join('|'),
  ].join('#');

  // 建图（只跑一次）
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const map = new amap.Map(host, {
      // ⚠️ 不要 'point' —— 那才是 POI 与文字标注层
      features: ['bg', 'road', 'building'],
      viewMode: '2D',
      zoom: 4,
      center: [105, 35],
    });
    mapRef.current = map;
    return () => {
      map.destroy();
      mapRef.current = null;
      overlaysRef.current = [];
    };
  }, [amap]);

  // 覆盖物随数据重建
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.remove(overlaysRef.current);
    const info = new amap.InfoWindow({ offset: new amap.Pixel(0, -18) });
    const overlays: AmapOverlay[] = [];

    for (const line of dayLines) {
      for (const seg of line.segments) {
        overlays.push(
          new amap.Polyline({
            path: seg.positions.map((p) => [p.lng, p.lat]),
            strokeColor: line.color,
            strokeWeight: 3,
            strokeOpacity: 0.75,
            ...(seg.dashed ? { strokeStyle: 'dashed', strokeDasharray: [6, 6] } : {}),
            zIndex: 50,
          }),
        );
      }
    }

    for (const point of points) {
      const marker = new amap.Marker({
        position: [point.pos.lng, point.pos.lat],
        content: markerHtml(point.color, point.order, point.activity.coordSource === 'estimated'),
        offset: new amap.Pixel(-14, -14),
        zIndex: 100,
      });
      marker.on('click', () => {
        const current = mapRef.current;
        if (!current) return;
        info.setContent(popupHtml(point.day, point.activity));
        info.open(current, [point.pos.lng, point.pos.lat]);
      });
      overlays.push(marker);
    }

    map.add(overlays);
    overlaysRef.current = overlays;
    return () => info.close();
    // contentKey 已覆盖 points / dayLines 的全部输入
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amap, contentKey]);

  // 尺寸与视野：容器从隐藏变可见（移动端切页签）或点位变化时，先 resize 再无动画自适应
  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => {
      const map = mapRef.current;
      if (!map) return;
      map.resize();
      if (overlaysRef.current.length > 0) map.setFitView(overlaysRef.current, false, FIT_PADDING);
    }, 60);
    return () => clearTimeout(timer);
  }, [contentKey, visible]);

  return <div className="amap-host" ref={hostRef} onClick={handleHostClick} />;

  function handleHostClick(event: React.MouseEvent<HTMLDivElement>) {
    const button = (event.target as HTMLElement).closest('[data-edit-activity]');
    if (!(button instanceof HTMLElement)) return;
    const dayId = button.dataset.editDay;
    const activityId = button.dataset.editActivity;
    if (dayId && activityId) onEditRef.current(dayId, activityId);
  }
}
