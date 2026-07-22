import { useEffect, useMemo, useState } from 'react';
import L from 'leaflet';
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from 'react-leaflet';
import { wgs84ToGcj02, type Activity, type TripDay } from '@tripweaver/shared';
import { dayColor, hasValidCoord } from '../../lib/colors';
import { legForPair } from '../../lib/tripDerive';
import { useEditorStore } from '../../store/editorStore';

interface MapPoint {
  day: TripDay;
  activity: Activity;
  order: number;
  /** 高德底图展示坐标（GCJ-02，[lat, lng]） */
  pos: [number, number];
}

// 展示坐标统一到 GCJ-02：新数据（gcj02）直用，缺省/wgs84（旧行程）正向偏移 —— 高德底图上新旧行程都无偏移
function displayPos(activity: Activity): [number, number] {
  if (activity.coordSystem === 'gcj02') return [activity.lat, activity.lng];
  const c = wgs84ToGcj02(activity.lat, activity.lng);
  return [c.lat, c.lng];
}

// leg.polyline「lng,lat;lng,lat…」（GCJ-02）→ Leaflet [lat, lng]；坏点静默跳过
function parsePolyline(polyline: string): [number, number][] {
  const points: [number, number][] = [];
  for (const pair of polyline.split(';')) {
    const [lng, lat] = pair.split(',').map(Number);
    if (Number.isFinite(lat) && Number.isFinite(lng)) points.push([lat!, lng!]);
  }
  return points;
}

interface LegSegment {
  key: string;
  positions: [number, number][];
  /** 无 polyline（heuristic/transit 估算段）→ 两点虚线直连 */
  dashed: boolean;
}

// 一天内的路线段：仅画与当前相邻活动对匹配的 leg；无 leg / 失配的间隙不画线（旧行程整段无线）
function collectLegSegments(day: TripDay): LegSegment[] {
  const segments: LegSegment[] = [];
  for (let i = 1; i < day.activities.length; i += 1) {
    const from = day.activities[i - 1]!;
    const to = day.activities[i]!;
    if (!hasValidCoord(from) || !hasValidCoord(to)) continue;
    const leg = legForPair(day, from.id, to.id);
    if (!leg) continue;
    const path = leg.polyline ? parsePolyline(leg.polyline) : [];
    segments.push(
      path.length >= 2
        ? { key: `${from.id}:${to.id}`, positions: path, dashed: false }
        : { key: `${from.id}:${to.id}`, positions: [displayPos(from), displayPos(to)], dashed: true },
    );
  }
  return segments;
}

function collectPoints(days: TripDay[]): MapPoint[] {
  const points: MapPoint[] = [];
  for (const day of days) {
    let order = 0;
    for (const activity of day.activities) {
      order += 1;
      if (hasValidCoord(activity)) points.push({ day, activity, order, pos: displayPos(activity) });
    }
  }
  return points;
}

function numberIcon(color: string, order: number, estimated: boolean): L.DivIcon {
  return L.divIcon({
    className: 'marker-wrap',
    html: `<div class="marker-pin${estimated ? ' marker-estimated' : ''}" style="background:${color}">${order}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14],
  });
}

// 尺寸与视野控制：容器从隐藏变可见（移动端切页签）或点位变化时，
// 先 invalidateSize 再无动画 fitBounds —— 避免「隐藏容器初始化导致零尺寸定位」的经典坑
function MapController({ points, visible }: { points: MapPoint[]; visible: boolean }) {
  const map = useMap();
  const key = points.map((p) => `${p.activity.id}:${p.pos[0]},${p.pos[1]}`).join('|');
  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => {
      map.invalidateSize();
      if (points.length > 0) {
        const bounds = L.latLngBounds(points.map((p) => p.pos));
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15, animate: false });
      }
    }, 60);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, visible, map]);
  return null;
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

  const visibleDays = useMemo(() => {
    const days = trip?.days ?? [];
    return dayFilter === null ? days : days.filter((d) => d.dayIndex === dayFilter);
  }, [trip, dayFilter]);

  const points = useMemo(() => collectPoints(visibleDays), [visibleDays]);

  return (
    <div className="map-pane">
      <MapContainer center={[35.0, 105.0]} zoom={4} className="leaflet-host" scrollWheelZoom>
        <TileLayer
          url="https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}"
          subdomains={['1', '2', '3', '4']}
          attribution="&copy; 高德地图"
        />
        {visibleDays.map((day) =>
          collectLegSegments(day).map((seg) => (
            <Polyline
              key={`${day.id}:${seg.key}`}
              positions={seg.positions}
              pathOptions={{
                color: dayColor(day.dayIndex),
                weight: 3,
                opacity: 0.75,
                dashArray: seg.dashed ? '6 6' : undefined,
              }}
            />
          )),
        )}
        {points.map(({ day, activity, order, pos }) => (
          <Marker
            key={activity.id}
            position={pos}
            icon={numberIcon(dayColor(day.dayIndex), order, activity.coordSource === 'estimated')}
          >
            <Popup>
              <div className="map-popup">
                <strong>{activity.name}</strong>
                <p className="muted">
                  Day {day.dayIndex} · {activity.startTime || '--:--'}
                  {activity.endTime ? ` – ${activity.endTime}` : ''} · {activity.category}
                </p>
                {activity.description && <p>{activity.description}</p>}
                {activity.coordSource === 'estimated' && <p className="tag tag-warn">坐标为估算</p>}
                {activity.sourceNotes.length > 0 && (
                  <p>
                    {activity.sourceNotes.map((n) => (
                      <a key={n.url} href={n.url} target="_blank" rel="noopener noreferrer">
                        📕 {n.title || '来源笔记'}
                      </a>
                    ))}
                  </p>
                )}
                <button type="button" className="btn btn-ghost" onClick={() => onEditActivity(day.id, activity.id)}>
                  编辑
                </button>
              </div>
            </Popup>
          </Marker>
        ))}
        <MapController points={points} visible={visible || isDesktop} />
      </MapContainer>
      <DayFilterControl />
      {points.length === 0 && <div className="map-empty muted">暂无可标注的活动坐标</div>}
    </div>
  );
}
