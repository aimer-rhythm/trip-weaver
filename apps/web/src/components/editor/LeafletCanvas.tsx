// Leaflet 渲染（09-26 从 MapView 抽出）：**降级路径** —— 未配高德 JS API Key、
// 或 SDK 加载失败/超时（见 MapView 的选择逻辑）时使用。
// 与 AmapCanvas 共用 lib/mapData 的点与线，这里只负责把 GeoPos 翻成 Leaflet 的 [lat, lng]。
import { useEffect } from 'react';
import L from 'leaflet';
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from 'react-leaflet';
import type { Activity, TripDay } from '@tripweaver/shared';
import { collectDayLines, type DayLines, type GeoPos, type MapPoint } from '../../lib/mapData';

interface Props {
  points: MapPoint[];
  dayLines: DayLines[];
  /** 容器可见性（桌面端常驻可见；≤768px 由移动页签决定） */
  visible: boolean;
  onEditActivity: (dayId: string, activityId: string) => void;
}

const toLatLng = (pos: GeoPos): [number, number] => [pos.lat, pos.lng];

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
  const key = points.map((p) => `${p.activity.id}:${p.pos.lat},${p.pos.lng}`).join('|');
  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => {
      map.invalidateSize();
      if (points.length > 0) {
        const bounds = L.latLngBounds(points.map((p) => toLatLng(p.pos)));
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15, animate: false });
      }
    }, 60);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, visible, map]);
  return null;
}

function ActivityPopup({
  day,
  activity,
  onEditActivity,
}: {
  day: TripDay;
  activity: Activity;
  onEditActivity: (dayId: string, activityId: string) => void;
}) {
  return (
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
  );
}

export function LeafletCanvas({ points, dayLines, visible, onEditActivity }: Props) {
  return (
    <MapContainer center={[35.0, 105.0]} zoom={4} className="leaflet-host" scrollWheelZoom>
      <TileLayer
        url="https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}"
        subdomains={['1', '2', '3', '4']}
        attribution="&copy; 高德地图"
      />
      {dayLines.map((line) =>
        line.segments.map((seg) => (
          <Polyline
            key={`${line.dayIndex}:${seg.key}`}
            positions={seg.positions.map(toLatLng)}
            pathOptions={{
              color: line.color,
              weight: 3,
              opacity: 0.75,
              dashArray: seg.dashed ? '6 6' : undefined,
            }}
          />
        )),
      )}
      {points.map(({ day, activity, order, pos, color }) => (
        <Marker
          key={activity.id}
          position={toLatLng(pos)}
          icon={numberIcon(color, order, activity.coordSource === 'estimated')}
        >
          <Popup>
            <ActivityPopup day={day} activity={activity} onEditActivity={onEditActivity} />
          </Popup>
        </Marker>
      ))}
      <MapController points={points} visible={visible} />
    </MapContainer>
  );
}
