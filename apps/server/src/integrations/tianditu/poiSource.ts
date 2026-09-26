// 天地图地名搜索 V2 适配层（09-25）：POI 搜索**固定**走这里（高德 v5/place/text 与地理编码主路径
// 共用同一份个人配额，实测会被打满 —— 这是配额分工，不是可用性降级）
// 与高德 POI 源同形（形状见 integrations/geoContracts.ts），但**字段能力更弱**：
// 只有名称 / 地址 / 坐标 / 电话 / 类型，没有评分、人均、营业时间、图片 —— 这四个字段一律留空
// （上游对空值已有容忍，见 prd R5）。另有两处结构性差异：
// ① 该接口需在天地图控制台**单独申请权限**；未开通时按请求失败处理 → 空数组 → 调研自动降级为模型知识
//    （**不回落高德**：那会把刚腾给地理编码的 v5/place/text 配额重新挤掉）；
// ② 没有高德那样的 POI 分类码（types）参数，类目不参与请求 —— 召回完全靠关键词。
//
// 待真实 tk 实测确认项（见 research/tianditu-api.md 第 6 节）：queryType/mapBound 的必需组合。
// 已实测（09-25）：queryType=1 的**普通搜索必需 mapBound**，缺则 `infocode 2003「缺少参数：mapBound」`。
// 调用方只给城市名，故本适配器先用同一个 tk 的 geocoder 解析城市中心，再取 ±0.5° 作为视野范围。
import { createSerialQueue } from '../../lib/serialQueue';
import { TtlCache } from '../../lib/ttlCache';
import { wgs84ToGcj02 } from '@tripweaver/shared';
import type { PoiCategory } from '@tripweaver/shared';
import type { PoiSource, SourcedPoi } from '../geoContracts';
import { getNullPoiSource } from '../nullPoiSource';
import { parseTiandituLonLat, tiandituGeocode } from './geo';
import { gcj02ToWgs84 } from '@tripweaver/shared';
import { describeHttpFailure } from './http';
import type { SourceStatus } from '../sourceStatus';

const SEARCH_URL = 'https://api.tianditu.gov.cn/v2/search';
const MIN_INTERVAL_MS = 350;               // 与 geocoder / route 同姿态（各自独立队列，天地图无公开 QPS 约定）
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;  // 目的地高度重合 → 24h 缓存提高命中率
const MAX_RESULTS = 10;
/** 天地图地名搜索成功状态：status.infocode === 1000 */
const SUCCESS_INFOCODE = 1000;
/** 搜索等级（0~18 量级）：12 约等于城市级视野 */
const SEARCH_LEVEL = '12';
/**
 * 城市级视野半径（度）：±0.5° ≈ 经向 111km / 纬向 96km（视纬度）。
 * 取值权衡：再小会漏掉合法近郊锚点（八达岭 ~60km、崂山 ~35km），再大有碰天地图未公开的
 * mapBound 跨度上限的风险。城市名同时也拼进了 keyWord，两者叠加做消歧。
 */
const CITY_BOUND_DEGREES = 0.5;

/** region → 城市级 mapBound 的 24h 缓存（null = 该城市解析失败，与 geocode 同样负缓存） */
const boundCache = new TtlCache<string | null>(CACHE_TTL_MS, 100);

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** 天地图 poi → 中立形状；WGS-84「lon,lat」入站转 GCJ-02，缺失字段留空 */
function mapPoi(raw: Record<string, unknown>): SourcedPoi | null {
  const name = str(raw.name).trim();
  if (!name) return null;
  const wgs = parseTiandituLonLat(raw.lonlat);
  return {
    name: name.slice(0, 100),
    type: str(raw.poiType).slice(0, 40),
    address: str(raw.address).slice(0, 60),
    rating: '',
    cost: '',
    opentime: '',
    photoUrls: [],
    location: wgs ? wgs84ToGcj02(wgs.lat, wgs.lng) : null,
    adcode: '',
  };
}

export class TiandituPoiSource implements PoiSource {
  readonly kind = 'tianditu' as const;
  private queue = createSerialQueue(MIN_INTERVAL_MS);
  private cache = new TtlCache<SourcedPoi[]>(CACHE_TTL_MS, 300);

  constructor(private tk: string) {}

  /**
   * region（城市名）→ 城市级 mapBound「西南经,西南纬,东北经,东北纬」。
   * 天地图普通搜索强制要 mapBound（09-25 实测 infocode 2003），而调用方只给我们城市名：
   * 先用同一 tk 的 geocoder 解析城市中心，再取 ±CITY_BOUND_DEGREES 作为视野范围。
   * 结果按 region 缓存（与 geocode 同为 24h）：同一目的地的一次生成里最多多出一次 geocoder 调用，
   * 且该调用是地域级的、跨生成可复用。
   */
  private async cityBound(region: string): Promise<string | null> {
    const key = region.trim().toLowerCase();
    if (!key) return null;
    const cached = boundCache.get(key);
    if (cached !== undefined) return cached;
    const center = await tiandituGeocode(this.tk, region, '');
    // mapBound 也是「出站参数」，与其他出站坐标一样回 WGS-84（geocoder 入站时已转成 GCJ-02）。
    // 500m 的偏差对 ±0.5° 的视野本来无实际影响，但保持一致才不会有「哪个参数忘了转」的下一次。
    const wgs = center ? gcj02ToWgs84(center.lat, center.lng) : null;
    const bound = wgs
      ? [
          wgs.lng - CITY_BOUND_DEGREES,
          wgs.lat - CITY_BOUND_DEGREES,
          wgs.lng + CITY_BOUND_DEGREES,
          wgs.lat + CITY_BOUND_DEGREES,
        ]
          .map((n) => n.toFixed(6))
          .join(',')
      : null;
    boundCache.set(key, bound);
    return bound;
  }

  /**
   * 关键字搜索；失败抛给调用方分支处理。
   * 类目不参与请求（天地图无分类码参数）；`region` 既拼进 keyWord 消歧、也用于算 mapBound ——
   * 天地图的普通搜索没有「搜索区划」入参，这是最接近高德 region + city_limit 语义的等价做法。
   */
  private async request(keyword: string, region: string): Promise<SourcedPoi[]> {
    const mapBound = await this.cityBound(region);
    if (!mapBound) return [];          // 拿不到城市视野：普通搜索无法进行，按空结果降级
    const postStr = JSON.stringify({
      keyWord: `${region}${keyword}`.slice(0, 80),
      level: SEARCH_LEVEL,
      mapBound,                        // queryType=1 必填，缺则 infocode 2003
      queryType: '1',
      start: 0,
      count: MAX_RESULTS,
    });
    const params = new URLSearchParams({ postStr, type: 'query', tk: this.tk });
    return this.queue(async () => {
      const res = await fetch(`${SEARCH_URL}?${params}`, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw await describeHttpFailure(res);
      const body = (await res.json()) as Record<string, unknown>;
      // 成功判定：status.infocode === 1000（未开通权限时这里会给出非 1000 的状态）
      const status = (body.status ?? {}) as Record<string, unknown>;
      if (typeof status.infocode === 'number' && status.infocode !== SUCCESS_INFOCODE) {
        throw new Error(str(status.cndesc) || `infocode ${status.infocode}`);
      }
      // 无结果时天地图可能干脆不带 pois 字段：按空结果处理，不当作错误
      const pois = Array.isArray(body.pois) ? (body.pois as Record<string, unknown>[]) : [];
      return pois.map(mapPoi).filter((poi): poi is SourcedPoi => poi !== null);
    });
  }

  async searchPois(category: PoiCategory, keyword: string, region: string): Promise<SourcedPoi[]> {
    void category;                                          // 天地图无分类码参数，类别由 keyword 承载
    const cacheKey = `${region}:${keyword}`.trim().toLowerCase();
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;
    try {
      const pois = await this.request(keyword, region);
      this.cache.set(cacheKey, pois);
      return pois;
    } catch {
      return [];                               // 不抛错：调研 Agent 自动降级为模型知识
    }
  }

  async selfCheck(): Promise<SourceStatus> {
    try {
      const pois = await this.request('天安门', '北京市');
      return {
        configured: true,
        checked: true,
        ok: true,
        message: pois.length ? '天地图地点数据源连接正常' : '天地图已连通，但探测搜索无结果（可能未开通地名搜索权限，或城市视野解析失败）',
      };
    } catch (err) {
      return {
        configured: true,
        checked: true,
        ok: false,
        message: `天地图连接失败：${err instanceof Error ? err.message : '未知错误'}（生成时自动降级）`,
      };
    }
  }
}

/** 天地图只做站点级单轨凭据：未配置 tk 时回 Null 源，**不回落高德**（配额分工，见 geoProvider 注释） */
export function resolveTiandituPoiSource(tk: string | null | undefined): PoiSource {
  return tk ? new TiandituPoiSource(tk) : getNullPoiSource();
}
