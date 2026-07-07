import { useEffect, useMemo, useState } from 'react';
import L from 'leaflet';
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from 'react-leaflet';
import type { Activity, TripDay } from '@tripweaver/shared';
import { dayColor, hasValidCoord } from '../../lib/colors';
import { useEditorStore } from '../../store/editorStore';

interface MapPoint {
  day: TripDay;
  activity: Activity;
  order: number;
}

function collectPoints(days: TripDay[]): MapPoint[] {
  const points: MapPoint[] = [];
  for (const day of days) {
    let order = 0;
    for (const activity of day.activities) {
      order += 1;
      if (hasValidCoord(activity)) points.push({ day, activity, order });
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
  const key = points.map((p) => `${p.activity.id}:${p.activity.lat},${p.activity.lng}`).join('|');
  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => {
      map.invalidateSize();
      if (points.length > 0) {
        const bounds = L.latLngBounds(points.map((p) => [p.activity.lat, p.activity.lng] as [number, number]));
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
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        />
        {visibleDays.map((day) => {
          const path = day.activities.filter(hasValidCoord).map((a) => [a.lat, a.lng] as [number, number]);
          return path.length >= 2 ? (
            <Polyline key={day.id} positions={path} pathOptions={{ color: dayColor(day.dayIndex), weight: 3, opacity: 0.75 }} />
          ) : null;
        })}
        {points.map(({ day, activity, order }) => (
          <Marker
            key={activity.id}
            position={[activity.lat, activity.lng]}
            icon={numberIcon(dayColor(day.dayIndex), order, activity.coordSource === 'estimated')}
          >
            <Popup>
              <div className="map-popup">
                <strong>{activity.name}</strong>
                <p className="muted">
                  Day {day.dayIndex} · {activity.startTime || '--:--'}
                  {activity.endTime ? ` – ${activity.endTime}` : ''} · {activity.category}
                  {activity.cost > 0 ? ` · ¥${activity.cost}` : ''}
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
