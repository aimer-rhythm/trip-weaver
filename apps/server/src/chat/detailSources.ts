import type { PoiSource } from '../integrations/geoContracts';
import type { SearchSource, WebSearchHit } from '../integrations/websearch/searchSource';

interface SourceDeps {
  poi: PoiSource;
  search: SearchSource;
  reserve: (source: 'tianditu' | 'search', count: number) => Promise<null | ((used: number) => Promise<void>)>;
}

/** 一轮问答、美食和追加调研共享上限与缓存；预算错误必须冒泡，不能吞成无资料。 */
export function createDetailSources(deps: SourceDeps, signal: AbortSignal, allowWeb = true) {
  const notes = new Set<string>();
  const calls = { poi: 0, search: 0 };
  const web: WebSearchHit[] = [];
  let ledgerFailure: unknown;
  const assertHealthy = () => { if (ledgerFailure) throw ledgerFailure; };
  const cache = new Map<string, Promise<unknown[]>>();
  async function call<T>(kind: 'poi' | 'search', key: string, configured: boolean, action: () => Promise<T[]>): Promise<T[]> {
    signal.throwIfAborted();
    const cacheKey = `${kind}:${key.trim().toLowerCase()}`;
    const known = cache.get(cacheKey);
    if (known) return known as Promise<T[]>;
    const pending = (async () => {
      const label = kind === 'poi' ? '地点搜索' : '联网搜索';
      if (kind === 'search' && !allowWeb) { notes.add('按要求未使用联网搜索。'); return []; }
      if (!configured) { notes.add(`${label}尚未配置，使用已有资料回答。`); return []; }
      if (calls[kind] >= (kind === 'poi' ? 4 : 2)) { notes.add(`本轮${label}次数已达上限。`); return []; }
      calls[kind]++;
      // 天地图分类适配器一次操作最多发两个请求，沿用编辑器计费单位。
      const cost = kind === 'poi' ? 2 : 1;
      const finish = await deps.reserve(kind === 'poi' ? 'tianditu' : 'search', cost).catch((error: unknown) => { ledgerFailure = error; throw error; });
      if (!finish) { notes.add(`今日${label}额度不足。`); return []; }
      let attempted = false;
      try {
        signal.throwIfAborted();
        attempted = true;
        let hits: T[];
        try { hits = await action(); }
        catch { signal.throwIfAborted(); notes.add(`${label}暂不可用，相关信息仍需核实。`); return []; }
        signal.throwIfAborted();
        if (!hits.length) notes.add(`${label}未返回资料，可能暂无结果或服务暂不可用。`);
        return hits;
      } finally { await finish(attempted ? cost : 0).catch((error: unknown) => { ledgerFailure = error; throw error; }); }
    })();
    cache.set(cacheKey, pending);
    return pending;
  }
  const poi: PoiSource = {
    kind: deps.poi.kind,
    searchPois: (category, keyword, city) => call('poi', `${category}|${city}|${keyword}`, deps.poi.kind !== 'null', () => deps.poi.searchPois(category, keyword, city, signal)),
    selfCheck: () => deps.poi.selfCheck(),
  };
  const search: SearchSource = {
    kind: allowWeb ? deps.search.kind : 'null',
    search: async (query) => {
      const hits = await call('search', query, deps.search.kind !== 'null', () => deps.search.search(query, signal));
      for (const hit of hits) if (!web.some((item) => item.url === hit.url)) web.push(hit);
      return hits;
    },
    selfCheck: () => deps.search.selfCheck(),
  };
  return { poi, search, notes, calls, web, assertHealthy };
}
export type DetailSources = ReturnType<typeof createDetailSources>;

export async function resolveDetailSources(userId: string, signal: AbortSignal, allowWeb = true) {
  const { resolvePoiSourceForUser } = await import('../integrations/geoProvider');
  const { resolveSearchSourceForUser } = await import('../integrations/websearch/searchSource');
  const { reserveEditorGeoBudget } = await import('../services/quotaService');
  const { source: search } = await resolveSearchSourceForUser(userId);
  return createDetailSources({ poi: resolvePoiSourceForUser().source, search, reserve: reserveEditorGeoBudget }, signal, allowWeb);
}
