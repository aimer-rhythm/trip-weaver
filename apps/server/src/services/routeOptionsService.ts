import type { RouteOptionsRequest } from '@tripweaver/shared';
import { resolveGeoProvider } from '../integrations/geoProvider';
import { reserveEditorGeoBudget } from './quotaService';
import { queryRouteOptions, ROUTE_OPTIONS_MAX_CALLS } from './routeOptions';

const activeUsers = new Set<string>();

export async function getRouteOptions(userId: string, input: RouteOptionsRequest) {
  if (activeUsers.has(userId)) throw Object.assign(new Error('正在查询路线，请稍后重试'), { statusCode: 429 });
  activeUsers.add(userId);
  try {
    const provider = await resolveGeoProvider(userId);
    if (provider.kind === 'null') return queryRouteOptions(input, provider, () => false);
    const finish = await reserveEditorGeoBudget(provider.kind, ROUTE_OPTIONS_MAX_CALLS);
    if (!finish) throw Object.assign(new Error('今日路线查询额度不足，请稍后再试'), { statusCode: 429 });
    let used = 0;
    try {
      return await queryRouteOptions(input, provider, () => {
        if (used >= ROUTE_OPTIONS_MAX_CALLS) return false;
        used += 1;
        return true;
      });
    } finally {
      await finish(used);
    }
  } finally {
    activeUsers.delete(userId);
  }
}
