// 坐标系交叉验证：canonical_places 的 lng/lat 与高德 POI 搜索结果是否同一套（GCJ-02）
// 目的：确定性排程想用 canonical_places 坐标做兜底（1494/1494 都有），但必须确认不是 WGS-84——
// 否则会有 ~500m 系统偏移。判定：同名地点两套坐标的球面距离（差 <150m = 同坐标系）。
// 用法（apps/server 目录）：npx tsx test-coord-system-check.mts
import 'dotenv/config';
import { pool } from './src/db/client';
import { AmapPoiSource } from './src/integrations/amap/poiSource';

const NAMES = ['故宫博物院', '天坛公园', '颐和园', '什刹海', '恭王府'];

function meters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = (a.lat - b.lat) * 111_320;
  const dLng = (a.lng - b.lng) * 111_320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

const { rows } = await pool.query<{ name: string; lng: number; lat: number; source: string }>(
  `SELECT name, lng, lat, source FROM canonical_places
   WHERE city = '北京' AND name = ANY($1) AND lng IS NOT NULL AND lat IS NOT NULL`,
  [NAMES],
);

const amap = new AmapPoiSource(process.env.AMAP_KEY ?? '');
console.log('名称'.padEnd(14) + 'source   库内坐标'.padEnd(28) + '高德坐标'.padEnd(28) + '偏差');
for (const name of NAMES) {
  const row = rows.find((r) => r.name === name);
  const hits = await amap.searchPois('attraction', name, '北京');
  const hit = hits.find((h) => h.name.includes(name)) ?? hits[0];
  if (!row || !hit?.location) {
    console.log(`${name.padEnd(14)}${row ? row.source.padEnd(8) : '（库内无）'.padEnd(8)} 缺一边，跳过`);
    continue;
  }
  const d = meters(row, hit.location);
  console.log(
    `${name.padEnd(14)}${row.source.padEnd(8)}` +
      `${`${row.lng.toFixed(5)}, ${row.lat.toFixed(5)}`.padEnd(28)}` +
      `${`${hit.location.lng.toFixed(5)}, ${hit.location.lat.toFixed(5)}`.padEnd(28)}` +
      `${d.toFixed(0)}m ${d < 150 ? '✅ 同坐标系' : d < 600 ? '⚠️ 偏移偏大' : '❌ 疑似 WGS-84'}`,
  );
}
await pool.end();
