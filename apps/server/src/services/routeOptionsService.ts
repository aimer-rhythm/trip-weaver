import { LEG_MODES, type RouteOptionsRequest, type RouteOptionsResponse } from '@tripweaver/shared';
import { resolveGeoProvider } from '../integrations/geoProvider';
import { TtlCache } from '../lib/ttlCache';
import { reserveEditorGeoBudget } from './quotaService';
import { queryRouteOptions } from './routeOptions';

const activeUsers = new Set<string>();
const cache = new TtlCache<RouteOptionsResponse['options'][number]>(5 * 60_000, 1200);

export async function getRouteOptions(userId: string, input: RouteOptionsRequest): Promise<RouteOptionsResponse> {
  const provider = await resolveGeoProvider(userId);
  const modes = input.mode ? [input.mode] : [...LEG_MODES];
  const point = (a: RouteOptionsRequest['from']) => [a.id, a.name, a.lat, a.lng, a.coordSystem ?? 'wgs84'];
  const key = JSON.stringify([userId, provider.kind, provider.cacheIdentity, input.destination, point(input.from), point(input.to)]);
  const cached = new Map(modes.flatMap((mode) => {
    const option = input.refresh ? undefined : cache.get(`${key}:${mode}`);
    return option ? [[mode, option] as const] : [];
  }));
  const missing = modes.filter((mode) => !cached.has(mode));
  if (!missing.length) return { options: modes.map((mode) => cached.get(mode)!) };
  if (activeUsers.has(userId)) throw Object.assign(new Error('正在查询路线，请稍后重试'), { statusCode: 429 });
  activeUsers.add(userId);
  try {
    const maxCalls = missing.length + (missing.includes('transit') && provider.kind === 'amap' ? 4 : 0);
    const finish = provider.kind === 'null' ? null : await reserveEditorGeoBudget(provider.kind, maxCalls);
    if (provider.kind !== 'null' && !finish) throw Object.assign(new Error('今日路线查询额度不足，请稍后再试'), { statusCode: 429 });
    let used = 0;
    try {
      const result = await queryRouteOptions(input, provider, () => {
        if (!finish || used >= maxCalls) return false;
        used += 1;
        return true;
      }, missing);
      for (const option of result.options) {
        const mode = option.status === 'available' ? option.leg.mode : option.mode;
        cache.set(`${key}:${mode}`, option, option.status === 'available' ? 5 * 60_000 : 30_000);
        cached.set(mode, option);
      }
      return { options: modes.map((mode) => cached.get(mode)!) };
    } finally {
      if (finish) await finish(used);
    }
  } finally {
    activeUsers.delete(userId);
  }
}
