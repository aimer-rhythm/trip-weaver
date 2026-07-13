// 地理后处理流水线（v0.5，架构铁律：机械工作移出 LLM 循环）
// orchestrator 在每轮编排后、审校前调用（M0-A 时序前移）：geocodeAll 补全全量坐标（GCJ-02），computeLegs 生成相邻活动通勤段。
// 高德失败/超额/无 Key 均静默降级（Nominatim 转换 / 启发式估算），生成流程永不因此失败。
import { LODGING_SENTINEL, WALK_THRESHOLD_M, haversineMeters, type LegMode, type TransitLeg } from '@tripweaver/shared';
import { resolveAmapCredential } from '../services/settingsService';
import { amapBudgetRemaining } from '../services/quotaService';
import { geocodeActivity, type GeocodedPlace } from '../integrations/amap/geocoder';
import { ROUTE_MAX_PER_TASK, routeEstimate } from '../integrations/amap/route';
import { estimateLeg } from './legEstimator';
import type { DraftTrip } from './draft';

export const GEOCODE_MAX_PER_TASK = 40;   // 单次生成 ≤40 次高德定位调用（POI text + v3 geocode 合计；含 lodging 解析）

export interface GeoSession {
  /** 高德调用尝试次数（geocode + route 合计）：计入 usage 事件与 generations.amap_calls */
  stats: { calls: number };
  /** 编排 Agent geocode_place 工具入口：走同一解析链与记账 */
  resolvePlace(name: string): Promise<GeocodedPlace | null>;
  /** 后处理 pass 1：为无坐标/estimated 活动补全 GCJ-02 坐标；signal 中止时尽快抛出（任务取消） */
  geocodeAll(draft: DraftTrip, onProgress: (text: string) => void, signal?: AbortSignal): Promise<void>;
  /** 后处理 pass 2：为每天相邻活动对生成通勤段（高德路径规划，降级启发式）；signal 中止时尽快抛出 */
  computeLegs(draft: DraftTrip, onProgress: (text: string) => void, signal?: AbortSignal): Promise<void>;
}

export function createGeoSession(userId: string, destination: string, baseMode: LegMode = 'transit'): GeoSession {
  // 日额度闸门：余额不足整任务预留量则本任务不用高德（Nominatim + 启发式降级，不断服）
  const credential = resolveAmapCredential(userId);
  const apiKey =
    credential && amapBudgetRemaining() >= GEOCODE_MAX_PER_TASK + ROUTE_MAX_PER_TASK ? credential.apiKey : null;

  const stats = { calls: 0 };
  let geocodeCalls = 0;
  let routeCalls = 0;
  // 任务级上限记账：调用尝试前占位（缓存命中同样计数，口径=接受的调用尝试，见 spec 集成规范）
  const tryGeocode = () => {
    if (geocodeCalls >= GEOCODE_MAX_PER_TASK) return false;
    geocodeCalls += 1;
    stats.calls += 1;
    return true;
  };
  const tryRoute = () => {
    if (routeCalls >= ROUTE_MAX_PER_TASK) return false;
    routeCalls += 1;
    stats.calls += 1;
    return true;
  };

  // 活动 id → adcode（transit 路径规划 city 入参）；目的地级 adcode 兜底
  const adcodes = new Map<string, string>();
  let cityAdcode: string | null | undefined;   // undefined=未解析，null=解析失败
  const resolveCityAdcode = async (): Promise<string> => {
    if (cityAdcode === undefined) {
      const place = await geocodeActivity(apiKey, destination, '', tryGeocode);
      cityAdcode = place?.adcode || null;
    }
    return cityAdcode ?? '';
  };

  // 通勤段跨轮记忆（时序前移 M0-A）：computeLegs 每轮编排后都跑，同一对端点+坐标的 leg 已算过就复用，
  // 不再第二次调用 tryRoute() —— 保证 ROUTE_MAX_PER_TASK 在修订轮不被未变动的段重复消耗（额度闸门仍成立）。
  const legMemo = new Map<string, TransitLeg>();
  const legMemoKey = (from: { id: string; lat: number; lng: number }, to: { id: string; lat: number; lng: number }) =>
    `${from.id}:${to.id}:${from.lat.toFixed(5)},${from.lng.toFixed(5)}:${to.lat.toFixed(5)},${to.lng.toFixed(5)}`;

  return {
    stats,

    resolvePlace(name) {
      return geocodeActivity(apiKey, name, destination, tryGeocode);
    },

    async geocodeAll(draft, onProgress, signal) {
      const all = draft.mutableDays().flatMap((d) => d.activities);
      const pending = all.filter((a) => (a.lat === 0 && a.lng === 0) || a.coordSource !== 'geocoded');
      // 编排 Agent 经 geocode_place 已解析的坐标即 GCJ-02，补上坐标系标注
      for (const a of all) {
        if (!pending.includes(a)) a.coordSystem = 'gcj02';
      }
      let done = 0;
      for (const activity of pending) {
        // 取消响应：每次串行网络调用（350ms 限速 / Nominatim 1.1s）前检查，避免取消后长时间挂起
        if (signal?.aborted) throw new Error('已取消');
        const place = await geocodeActivity(apiKey, activity.name, destination, tryGeocode);
        done += 1;
        if (place) {
          activity.lat = place.lat;
          activity.lng = place.lng;
          activity.coordSource = 'geocoded';
          activity.coordSystem = 'gcj02';
          if (place.adcode) adcodes.set(activity.id, place.adcode);
        }
        // 全链失败：保留模型给的估算坐标（或 0,0），coordSource 维持 estimated 如实标注
        if (done % 4 === 0 || done === pending.length) {
          onProgress(`正在解析活动坐标 (${done}/${pending.length})`);
        }
      }

      // 住宿锚点解析（ST3）：同一解析链与记账（计入 GEOCODE_MAX_PER_TASK）；失败静默 —— 无坐标即不生成住宿 leg
      const lodging = draft.lodging;
      if (lodging && !(typeof lodging.lat === 'number' && typeof lodging.lng === 'number')) {
        if (signal?.aborted) throw new Error('已取消');
        onProgress('正在解析住宿位置…');
        const place = await geocodeActivity(apiKey, lodging.name, destination, tryGeocode);
        if (place) {
          lodging.lat = place.lat;
          lodging.lng = place.lng;
          lodging.coordSystem = 'gcj02';
          if (place.adcode) adcodes.set(LODGING_SENTINEL, place.adcode);
        }
      }
    },

    async computeLegs(draft, onProgress, signal) {
      const days = draft.mutableDays();
      const pairs = days.reduce((n, d) => n + Math.max(0, d.activities.length - 1), 0);
      let done = 0;

      // 单段估算：先高德路径规划（transit 需 adcode），失败/超额降级启发式 —— 相邻活动对与住宿 leg 共用
      // 跨轮复用：同端点同坐标已算过直接返回 memo，不重复占 route 额度（时序前移后修订轮多次 computeLegs）
      const estimatePair = async (
        from: { id: string; lat: number; lng: number },
        to: { id: string; lat: number; lng: number },
      ): Promise<TransitLeg> => {
        const memoKey = legMemoKey(from, to);
        const memoized = legMemo.get(memoKey);
        if (memoized) return memoized;
        const leg = await computePair(from, to);
        legMemo.set(memoKey, leg);
        return leg;
      };

      const computePair = async (
        from: { id: string; lat: number; lng: number },
        to: { id: string; lat: number; lng: number },
      ): Promise<TransitLeg> => {
        const straightM = haversineMeters(from, to);
        const mode: LegMode = straightM < WALK_THRESHOLD_M ? 'walk' : baseMode;
        if (apiKey) {
          // transit 需要起终点 adcode；活动级缺失时用目的地级兜底，仍缺则直接启发式
          const city1 = mode === 'transit' ? adcodes.get(from.id) || (await resolveCityAdcode()) : '';
          const city2 = mode === 'transit' ? adcodes.get(to.id) || city1 : '';
          if ((mode !== 'transit' || (city1 && city2)) && tryRoute()) {
            const route = await routeEstimate(apiKey, from, to, mode, { city1, city2 });
            if (route) {
              return {
                fromActivityId: from.id,
                toActivityId: to.id,
                mode,
                durationMin: route.durationMin,
                distanceM: route.distanceM,
                source: 'amap',
                ...(route.polyline ? { polyline: route.polyline } : {}),
              };
            }
          }
        }
        return { fromActivityId: from.id, toActivityId: to.id, mode, ...estimateLeg(from, to, mode) };
      };

      const hasCoord = (p: { lat: number; lng: number }) => !(p.lat === 0 && p.lng === 0);
      // 住宿锚点（ST3）：坐标解析成功才生成住宿 leg（哨兵 id 'lodging'，挂在 day 上作用域限当天）
      const lodging = draft.lodging;
      const lodgingPoint =
        lodging && typeof lodging.lat === 'number' && typeof lodging.lng === 'number' && (lodging.lat !== 0 || lodging.lng !== 0)
          ? { id: LODGING_SENTINEL, lat: lodging.lat, lng: lodging.lng }
          : null;

      for (const day of days) {
        const legs: TransitLeg[] = [];
        for (let i = 0; i + 1 < day.activities.length; i++) {
          if (signal?.aborted) throw new Error('已取消');
          const from = day.activities[i]!;
          const to = day.activities[i + 1]!;
          done += 1;
          // 任一端无有效坐标：无法估算，跳过该段（消费方按缺失处理）
          if (!hasCoord(from) || !hasCoord(to)) continue;
          legs.push(await estimatePair(from, to));
          if (done % 4 === 0 || done === pairs) onProgress(`正在估算通勤时间 (${done}/${pairs})`);
        }
        // 住宿 leg：住宿 → 首活动 / 末活动 → 住宿（两端坐标齐备才生成，失败静默）
        const first = day.activities[0];
        const last = day.activities[day.activities.length - 1];
        if (lodgingPoint && first && last) {
          if (signal?.aborted) throw new Error('已取消');
          if (hasCoord(first)) legs.unshift(await estimatePair(lodgingPoint, first));
          if (hasCoord(last)) legs.push(await estimatePair(last, lodgingPoint));
        }
        day.legs = legs;
      }
    },
  };
}
