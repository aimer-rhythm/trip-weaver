// 天地图路径规划适配层（09-25）：驾车 / 公交两模式时长距离估算
// 与高德适配层同形（形状见 integrations/geoContracts.ts）；坐标系转换（GCJ-02 ↔ WGS-84）收敛在本文件内 ——
// 天地图入参要 WGS-84 经纬度、返回也是 WGS-84，而库内一律 GCJ-02。
// 纪律沿用四道闸：与 geocoder 共用串行队列（350ms）+ 24h TTL 缓存（键=坐标取整5位+mode，仅缓存成功结果）；
// 任务级上限与日额度由 generation/geoPipeline 把关并计入 tianditu_calls。
//
// ⚠️ 端点与入参以**官方文档 + 实测**双重确认，二手资料（博客/教程）在这个 API 上错得极多：
//
//   官方文档：http://lbs.tianditu.gov.cn/server/drive.html（驾车）、/server/bus.html（公交）
//   端点存在性实测（用「长度合法但无效的 tk」探测：真实端点回 403 301001，不存在回 404）：
//     存在：/geocoder、/drive、/transit、/v2/search
//     不存在：/walk、/bus、/search、以及全部 /v2/{drive,walk,bus,transit}
//   于是：
//     驾车 → /drive?type=search，postStr={orig,dest,style}
//     公交 → /transit?type=busline，postStr={startposition,endposition,linetype}，**没有城市参数**
//     步行 / 骑行 → **无可用端点**，只能回落启发式
//
// ⚠️ 路径规划不支持 `style=3` 作步行 —— 实测证明它是「驾车最短路线」（文档写的 0 最快/1 最短/2 避开高速/3 步行与实现不符）：
//     · 0/1/2 对同一对坐标返回**完全相同**的结果
//     · 天安门→颐和园：style=0 → 18.84km/20min；style=3 → 17.3km/27min（27 分钟走 17.3km = 38 km/h）
//     · 天安门→故宫：  style=0 → 1.85km/160s； style=3 → 0.9km/97s（97 秒走 0.9km = 33 km/h）
//   两条都不是步行速度 —— **天地图没有步行路径规划**。曾把 walk 接到 `style=3`，那会让步行段拿到
//   驾车时长（颐和园段少算 10 倍）且刚好落在速度闸门内、坏值直写时间轴，比启发式兜底糟得多，已移除。
//
// ✅ 返回格式已用真实 tk 实测（09-25）：**驾车是 XML**（`<distance>` km / `<duration>` 秒 /
// `<routelatlon>` 整条折线），**公交是 JSON**（content-type application/json）。两者格式不同，解析路径分开。
//
// ⚠️ 单位在端点之间不一致，且文档都漏写了：drive 的 distance 是 **km**、duration 是 **秒**；
// transit 的 segmentDistance 是 **米**、segmentTime 是 **分钟**（文档只写「此段线路需要的时间 Int」）。
// 单位判错一次时长就错 60 倍，故所有估算都要过 hasPlausibleSpeed 闸门 —— 宁可回 null 走启发式，也不写错值。
import type { LegMode } from '@tripweaver/shared';
import { gcj02ToWgs84, wgs84ToGcj02 } from '@tripweaver/shared';
import { TtlCache } from '../../lib/ttlCache';
import { downsamplePolyline } from '../../lib/polyline';
import { createRouteBreaker } from '../routeBreaker';
import type { GeoPoint, RouteBreaker, RouteEstimate, RouteOpts } from '../geoContracts';
import { parseTiandituLonLat, tiandituQueue } from './geo';
import { describeHttpFailure } from './http';

const DRIVE_URL = 'https://api.tianditu.gov.cn/drive';
const TRANSIT_URL = 'https://api.tianditu.gov.cn/transit';

/** 公交线路规划类型（按位）：第0位=1 较快捷 */
const TRANSIT_LINE_TYPE = '1';

/**
 * 端点 / type / style 按出行方式查表；缺项即「天地图无此能力」：
 * walk（无步行端点，style=3 是驾车最短路线）与 cycle（端点全 404）都不在表内，
 * 两者因此被熔断器的 skip 挡在扣额度之前 —— 不发请求、不计失败、不扣额度，直接走启发式。
 */
const ROUTE_ENDPOINTS: Partial<Record<LegMode, { url: string; type: string; style?: string }>> = {
  drive: { url: DRIVE_URL, type: 'search', style: '0' },
  transit: { url: TRANSIT_URL, type: 'busline' },
};

const cache = new TtlCache<RouteEstimate>(24 * 60 * 60 * 1000, 300);

const MIN_PLAUSIBLE_KMH = 1;
const MAX_PLAUSIBLE_KMH = 150;

/** 隐含速度闸门：单位判断错（如把 km 当 m、把分钟当秒）必然算出荒谬速度，此处拦下 */
function hasPlausibleSpeed(distanceM: number, durationMin: number): boolean {
  if (distanceM <= 0 || durationMin <= 0) return false;
  const kmh = distanceM / 1000 / (durationMin / 60);
  return kmh >= MIN_PLAUSIBLE_KMH && kmh <= MAX_PLAUSIBLE_KMH;
}

/** 天地图通用请求：postStr 为 JSON 字符串 + type（驾车 search / 公交 busline）；返回原始文本 */
async function tiandituGet(
  url: string,
  tk: string,
  type: string,
  postStr: Record<string, unknown>,
): Promise<string> {
  const params = new URLSearchParams({ postStr: JSON.stringify(postStr), type, tk });
  const res = await fetch(`${url}?${params}`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw await describeHttpFailure(res);
  return res.text();
}

/** 该出行方式在天地图是否有端点（熔断器的前置拦截与 estimate 共用同一张表，避免两处各写一份判断） */
function hasEndpoint(mode: LegMode): boolean {
  return ROUTE_ENDPOINTS[mode] !== undefined;
}

/** JSON.parse 成功且是对象才回值；HTML/XML 响应一律回 null 交给标签解析 */
function tryParseJson(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** 取 XML 里第一个同名标签的数值；缺失或非数值回 NaN */
function firstTagNumber(raw: string, tag: string): number {
  const matched = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(raw);
  const value = matched ? Number.parseFloat(matched[1]!) : NaN;
  return Number.isFinite(value) ? value : NaN;
}

/** 取 XML 里第一个同名标签的文本（如 routelatlon 整条折线） */
function firstTagText(raw: string, tag: string): string {
  const matched = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(raw);
  return matched ? (matched[1] ?? '').trim() : '';
}

/** JSON 里单元素可能写成对象、也可能写成数组；两种都按数组处理 */
function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return value === undefined || value === null ? [] : [value];
}

/** 取数值字段的正值；缺失/非数值/负值一律回 0（实测天地图用负值标记「该段不可用」） */
function positiveNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * 天地图折线串（WGS-84「lon,lat;lon,lat;…」）→ 库内契约串（GCJ-02）后抽稀。
 * 逐点转换：折线要跟前端 GCJ-02 底图逐点对齐，整条平移一个偏移量是错的。
 */
function convertPolyline(rawPolyline: string): string | undefined {
  const points = rawPolyline
    .split(';')
    .map((point) => parseTiandituLonLat(point))
    .filter((point): point is GeoPoint => point !== null)
    .map((point) => {
      const gcj = wgs84ToGcj02(point.lat, point.lng);
      return `${gcj.lng.toFixed(5)},${gcj.lat.toFixed(5)}`;
    });
  return downsamplePolyline(points);
}

/** 解析驾车/步行响应：distance 单位 **km**、duration 单位 **秒**、routelatlon 为整条折线 */
function parseDriveLike(raw: string): RouteEstimate | null {
  const distanceKm = firstTagNumber(raw, 'distance');
  const durationSec = firstTagNumber(raw, 'duration');
  if (!Number.isFinite(distanceKm) || !Number.isFinite(durationSec)) return null;
  const distanceM = Math.round(distanceKm * 1000);
  const durationMin = Math.max(1, Math.round(durationSec / 60));
  if (!hasPlausibleSpeed(distanceM, durationMin)) return null;
  const polyline = convertPolyline(firstTagText(raw, 'routelatlon'));
  return { durationMin, distanceM, ...(polyline ? { polyline } : {}) };
}

/**
 * 解析公交响应（实测为 JSON）。层级语义是这里最容易写错的地方，官方文档 + 09-25 实测逐层核对：
 *
 *   results[]                —— 请求了几种 lineType 就有几个（本项目只请求 1 种）
 *   results[].lines[]        —— **最多 5 条互斥的完整候选方案**（文档：「数组中每个对象为一条由起点到
 *                               终点的公交规划线路」）→ 只能取一条。全累加会得到 53km/4 分钟这种
 *                               荒谬值，再被速度闸门拦下 → 静默降级成启发式
 *   lines[].segments[]       —— 一条方案内**串联**的各段（步行到站 → 乘车 → 步行到终点）
 *   segments[].segmentLine[] —— 同一段的**平行备选**线路（实测「特12外」与「44外」并列）→ 只取第一个
 *                               可用的，全取会让该段时长翻倍
 *
 * 单位：segmentTime 是**分钟**、segmentDistance 是**米**（两者都经实测反推，文档未写单位）。
 * 负值表示该段不可用（实测地铁段 -2 / -15314）→ 跳过；一条方案若全无可用量则试下一条。
 * 不产出折线 —— 换乘方案由多段子路线组成，直接拼接会在换乘点画出穿越城市的假直线；高德 transit 同样只留时长与距离。
 */
function parseTransit(raw: string): RouteEstimate | null {
  const json = tryParseJson(raw);
  if (!json) return null;   // 实测返回 JSON；非 JSON 视为异常响应，降级启发式
  for (const result of asArray(json.results)) {
    for (const line of asArray((result as Record<string, unknown>).lines)) {
      let durationMin = 0;
      let distanceM = 0;
      for (const segment of asArray((line as Record<string, unknown>).segments)) {
        // 每段取第一个「时间与距离都可用」的备选线路
        const best = asArray((segment as Record<string, unknown>).segmentLine)
          .map((leg) => (leg ?? {}) as Record<string, unknown>)
          .map((leg) => ({ time: positiveNumber(leg.segmentTime), dist: positiveNumber(leg.segmentDistance) }))
          .find((leg) => leg.time > 0 && leg.dist > 0);
        if (best) {
          durationMin += best.time;
          distanceM += best.dist;
        }
      }
      const roundedM = Math.round(distanceM);
      if (durationMin <= 0 || roundedM <= 0) continue;           // 该方案不可用（实测地铁方案全为负值）
      if (!hasPlausibleSpeed(roundedM, durationMin)) continue;   // 单位/层级判断错时隐含速度会荒谬
      return { durationMin, distanceM: roundedM };
    }
  }
  return null;
}

/**
 * 两点间路径规划（天地图）；步行/骑行无端点、请求失败、单位校验不过均回 null（上层走启发式）。
 * @param mode 步行（walk）与骑行（cycle）恒回 null —— 天地图没有这两种端点，用 drive 结果冒充会系统性低估时长
 * @param _opts 形参对齐 RouteBreaker 契约：天地图不需要城市参数（/transit 从坐标自行推断）
 */
export async function tiandituRouteEstimate(
  tk: string,
  origin: GeoPoint,
  dest: GeoPoint,
  mode: LegMode,
  _opts: RouteOpts = {},
): Promise<RouteEstimate | null> {
  // 步行/骑行：天地图无对应端点（步行实测 style=3 返的是驾车路线；骑行 /bicycle、/bike、/cycling、/ride 均 404）
  const endpoint = ROUTE_ENDPOINTS[mode];
  if (!endpoint) return null;
  // 天地图入参要 WGS-84 经纬度：出站先转；坐标取整 5 位兼作缓存键
  const fmt = (point: GeoPoint) => {
    const wgs = gcj02ToWgs84(point.lat, point.lng);
    return `${wgs.lng.toFixed(5)},${wgs.lat.toFixed(5)}`;
  };
  const cacheKey = `${mode}:${fmt(origin)}:${fmt(dest)}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;

  const estimate = await tiandituQueue(async () => {
    try {
      const postStr =
        mode === 'transit'
          ? { startposition: fmt(origin), endposition: fmt(dest), linetype: TRANSIT_LINE_TYPE }
          : { orig: fmt(origin), dest: fmt(dest), style: endpoint.style! };
      const raw = await tiandituGet(endpoint.url, tk, endpoint.type, postStr);
      return mode === 'transit' ? parseTransit(raw) : parseDriveLike(raw);
    } catch {
      return null;
    }
  });
  // 只缓存成功结果：失败（网络/超时/字段异常/无方案）不做 24h 负缓存，
  // 避免一次瞬时故障把该点对钉死在启发式（重试成本已由任务级上限与日额度闸门约束）
  if (estimate) cache.set(cacheKey, estimate);
  return estimate;
}

// ---------- 任务级连续失败熔断 ----------
// 阈值、语义与 warn 契约见 integrations/routeBreaker.ts；这里只绑定天地图适配器与它特有的前置拦截。

/**
 * 每个生成任务（geoSession）各建一个实例：熔断状态与该任务同生命周期；tk 绑定在适配器内。
 *
 * 前置拦截把「天地图无此端点（步行/骑行）」挡在扣额度之前（未发请求 → 不计失败、不扣额度）。
 * 这必须在拦截层处理 —— 若让它作为一次「失败」计数，一队步行/骑行段会把熔断器打穿，
 * 后续本可成功的驾车/公交段也会被误判为服务不可用。
 */
export function createTiandituRouteBreaker(tk: string): RouteBreaker {
  return createRouteBreaker({
    estimate: (origin, dest, mode, opts) => tiandituRouteEstimate(tk, origin, dest, mode, opts),
    skip: (_origin, _dest, mode) => !hasEndpoint(mode),
    label: '[tianditu-route]',
  });
}
