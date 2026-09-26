// 高德搜索POI 2.0 适配层（架构 §6）：调研候选的结构化底座
// 原则沿用 ContentSource 骨架：串行限速 + TTL 缓存 + 任务级上限 + Null 降级 + selfCheck，
// 任何故障不抛错到上层 —— searchPois 回空数组、selfCheck 变红。
// 协议红线（高德服务协议 3.5）：结果仅供展示，图片只取热链 URL 不转存；
// v0.5 反转 v0.4「不返回坐标」决策：Nominatim 中国 POI 覆盖不可用，行程坐标全面切换 GCJ-02，
// 适配器如实返回 pois[].location（GCJ-02）与 adcode，仅存活动坐标点值、不批量囤 POI（协议 3.5 缓解措施）。
import { createSerialQueue } from '../../lib/serialQueue';
import { TtlCache } from '../../lib/ttlCache';
import { resolveAmapCredential } from '../../services/settingsService';
import type { PoiSource, SourcedPoi } from '../geoContracts';
import { getNullPoiSource } from '../nullPoiSource';
import { parseAmapLocation } from './geocoder';
import type { PoiCategory } from '@tripweaver/shared';
import type { SourceStatus } from '../sourceStatus';

const AMAP_TEXT_URL = 'https://restapi.amap.com/v5/place/text';
const AMAP_MIN_INTERVAL_MS = 350;               // 个人认证约 3 QPS，串行保守姿态
const AMAP_CACHE_TTL_MS = 24 * 60 * 60 * 1000;  // 目的地高度重合 → 24h 缓存提高命中率
const MAX_RESULTS = 10;
const MAX_PHOTOS = 3;

/** 类目 → 高德 POI 分类码（搜索POI 2.0 types 参数） */
const CATEGORY_TYPECODE: Record<PoiCategory, string> = {
  attraction: '110000', // 风景名胜
  food: '050000',       // 餐饮服务
  hotel: '100000',      // 住宿服务
};

// ---------- 宽容解析 ----------

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function mapPoi(raw: Record<string, unknown>): SourcedPoi | null {
  const name = str(raw.name).trim();
  if (!name) return null;
  const business = (raw.business ?? {}) as Record<string, unknown>;
  const photos = Array.isArray(raw.photos) ? (raw.photos as Record<string, unknown>[]) : [];
  return {
    name: name.slice(0, 100),
    type: str(raw.type).split(';').filter(Boolean).at(-1) ?? '',
    address: str(raw.address).slice(0, 60),
    rating: str(business.rating),
    cost: str(business.cost),
    opentime: str(business.opentime_today || business.opentime_week).slice(0, 60),
    photoUrls: photos
      .map((p) => str(p.url))
      .filter((u) => /^https?:\/\//.test(u))
      .slice(0, MAX_PHOTOS),
    location: parseAmapLocation(raw.location),
    adcode: str(raw.adcode),
  };
}

// ---------- 高德实现 ----------

export class AmapPoiSource implements PoiSource {
  readonly kind = 'amap' as const;
  private queue = createSerialQueue(AMAP_MIN_INTERVAL_MS);
  private cache = new TtlCache<SourcedPoi[]>(AMAP_CACHE_TTL_MS, 300);

  constructor(private apiKey: string) {}

  /** 关键字搜索（region 提权召回 + city_limit 严格限定）；失败抛给调用方分支处理 */
  private async request(category: PoiCategory, keyword: string, region: string): Promise<SourcedPoi[]> {
    const params = new URLSearchParams({
      key: this.apiKey,
      keywords: keyword.slice(0, 80),          // 高德限制单关键字 ≤80 字符
      types: CATEGORY_TYPECODE[category],
      show_fields: 'business,photos',
      page_size: String(MAX_RESULTS),
    });
    if (region) {
      params.set('region', region.slice(0, 40));
      params.set('city_limit', 'true');
    }
    return this.queue(async () => {
      const res = await fetch(`${AMAP_TEXT_URL}?${params}`, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { status?: string; info?: string; pois?: unknown };
      if (body.status !== '1') throw new Error(body.info || '未知错误');
      const pois = Array.isArray(body.pois) ? (body.pois as Record<string, unknown>[]) : [];
      return pois.map(mapPoi).filter((p): p is SourcedPoi => p !== null);
    });
  }

  async searchPois(category: PoiCategory, keyword: string, region: string): Promise<SourcedPoi[]> {
    const key = `${category}:${region}:${keyword}`.trim().toLowerCase();
    const cached = this.cache.get(key);
    if (cached) return cached;
    try {
      const pois = await this.request(category, keyword, region);
      this.cache.set(key, pois);
      return pois;
    } catch {
      return [];                               // 不抛错：调研 Agent 自动降级为模型知识
    }
  }

  async selfCheck(): Promise<SourceStatus> {
    try {
      const pois = await this.request('attraction', '天安门', '北京市');
      return {
        configured: true,
        checked: true,
        ok: true,
        message: pois.length ? '高德地点数据源连接正常' : '高德已连通，但探测搜索无结果',
      };
    } catch (err) {
      return {
        configured: true,
        checked: true,
        ok: false,
        message: `高德连接失败：${err instanceof Error ? err.message : '未知错误'}（生成时自动降级）`,
      };
    }
  }
}

// ---------- 按用户动态构造 ----------

export interface ResolvedPoiSource {
  source: PoiSource;
  credentialRevision: string;
  credentialOrigin: 'personal' | 'site' | 'none';
}

/** 每次按有效凭据构造实例，避免把个人 Key 放进全局单例或跨用户结果缓存。 */
export function createPoiSource(apiKey: string | null | undefined): PoiSource {
  return apiKey ? new AmapPoiSource(apiKey) : getNullPoiSource();
}

/** 用户个人 Key 优先，未配置或密文不可用时回退站点 Key，再回退 Null 源。 */
export async function resolvePoiSourceForUser(userId: string): Promise<ResolvedPoiSource> {
  const credential = await resolveAmapCredential(userId);
  if (!credential) {
    return { source: getNullPoiSource(), credentialRevision: 'none', credentialOrigin: 'none' };
  }
  return {
    source: createPoiSource(credential.apiKey),
    credentialRevision: credential.revision,
    credentialOrigin: credential.origin,
  };
}
