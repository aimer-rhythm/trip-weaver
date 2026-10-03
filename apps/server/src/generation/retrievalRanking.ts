import type { PoiCategory } from '@tripweaver/shared';
import { normalizePlaceKey } from '../lib/placeKey';
import { poiScore, scoreMaxima } from './scheduling/score';

export interface PlaceRow {
  id: string;
  city: string;
  name: string;
  category: string;
  verified: boolean;
  source: string;
  lat: number | null;
  lng: number | null;
  payload: Record<string, unknown> | null;
  distance?: number;
}

export function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && Boolean(v.trim())) : [];
}

export function placeCategory(category: string): PoiCategory {
  if (category === '美食' || category === 'food') return 'food';
  if (category === '住宿' || category === 'hotel') return 'hotel';
  return 'attraction';
}

export function categoryValues(category?: PoiCategory): string[] {
  if (category === 'food') return ['美食', 'food'];
  if (category === 'hotel') return ['住宿', 'hotel'];
  if (category === 'attraction') return ['文化', '自然', '娱乐', '购物', '其他', '景点', 'attraction'];
  return [];
}

const PREFERENCE_CATEGORIES: Record<string, string[]> = {
  历史文化: ['文化'], 历史人文: ['文化'], 历史古迹: ['文化'], 自然风光: ['自然'],
  自然: ['自然'], 文化: ['文化'], 人文: ['文化'], 美食: ['美食'], 购物: ['购物'], 亲子: ['自然', '娱乐'], 夜生活: ['娱乐'],
};

export function preferenceCategories(terms: readonly string[]): string[] {
  return [...new Set(terms.flatMap((term) => PREFERENCE_CATEGORIES[term] ?? []))];
}

function numeric(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function scoreFacts(row: PlaceRow) {
  return { source: row.source, recommendScore: numeric(row.payload?.recommendScore), mentionCount: numeric(row.payload?.mentionCount) };
}

export interface RankedPlace {
  row: PlaceRow;
  /** 同一实体的原始行 ID；只合并同一地点的证据。 */
  ids: string[];
  aliases: string[];
}

/** 有界 SQL 结果内归并实体与排序，不把任意包含关系当作同一地点。 */
export function rankPlaces(rows: readonly PlaceRow[], terms: readonly string[], preferences: readonly string[], limit: number): RankedPlace[] {
  const maxima = scoreMaxima(rows.map(scoreFacts));
  const exactKeys = new Set(terms.map(normalizePlaceKey));
  const categories = preferenceCategories([...terms, ...preferences]);
  const groups: RankedPlace[] = [];
  for (const row of rows) {
    const nameKey = normalizePlaceKey(row.name);
    const aliasKeys = stringList(row.payload?.aliases).map(normalizePlaceKey);
    // 两个不同主名仅共享一个泛称别名时不归并；歧义别名也不选第一个就合并。
    const matching = groups.filter((group) => group.row.city === row.city && (
      group.aliases.some((name) => normalizePlaceKey(name) === nameKey)
      || aliasKeys.includes(normalizePlaceKey(group.row.name))));
    const group = matching.length === 1 ? matching[0] : undefined;
    if (group) {
      group.ids.push(row.id);
      group.aliases.push(row.name, ...stringList(row.payload?.aliases));
      const preferred = (row.source === 'goldset' && group.row.source !== 'goldset')
        || (row.source === group.row.source && poiScore(scoreFacts(row), maxima) > poiScore(scoreFacts(group.row), maxima));
      const base = preferred ? row : group.row;
      const supplement = preferred ? group.row : row;
      const present = (value: Record<string, unknown> | null) => Object.fromEntries(Object.entries(value ?? {}).filter(([, v]) => v != null));
      const scores = [numeric(base.payload?.recommendScore), numeric(supplement.payload?.recommendScore)].filter((n): n is number => n !== undefined);
      const mentions = [numeric(base.payload?.mentionCount), numeric(supplement.payload?.mentionCount)].filter((n): n is number => n !== undefined);
      group.row = { ...base, payload: { ...present(supplement.payload), ...present(base.payload),
        themes: [...new Set([...stringList(base.payload?.themes), ...stringList(supplement.payload?.themes)])],
        ...(scores.length ? { recommendScore: Math.max(...scores) } : {}),
        ...(mentions.length ? { mentionCount: mentions.reduce((a, b) => a + b, 0) } : {}),
      },
        ...([base.distance, supplement.distance].some((d) => typeof d === 'number')
          ? { distance: Math.min(...[base.distance, supplement.distance].filter((d): d is number => typeof d === 'number')) } : {}),
        ...(base.lat == null || base.lng == null ? { lat: supplement.lat, lng: supplement.lng } : {}) };
    } else {
      const next = { row, ids: [row.id], aliases: [row.name, ...stringList(row.payload?.aliases)] };
      groups.push(next);
    }
  }
  const candidates = groups.map((group) => {
    const row = group.row;
    const identity = row.payload?.identity as { memberNames?: unknown } | undefined;
    const exact = [...group.aliases, ...stringList(identity?.memberNames)].some((name) => exactKeys.has(normalizePlaceKey(name)));
    const prefix = terms.some((term) => group.aliases.some((name) => name.startsWith(term)));
    const themes = stringList(row.payload?.themes);
    const theme = [...terms, ...preferences].some((term) => themes.includes(term));
    const detail = row.payload?.xhsPlaceType === 'photo_spot' || /(?:[东西南北]门|入口|出口|机位|倒影|转角|停车场)/.test(row.name);
    // 子景点只降权，不串用父景点事实；点名时仍优先返回。
    const parent = groups.find((other) => other !== group && normalizePlaceKey(other.row.name).length >= 2
      && normalizePlaceKey(row.name).startsWith(normalizePlaceKey(other.row.name)));
    const coord = typeof row.lat === 'number' && typeof row.lng === 'number'
      && Number.isFinite(row.lat) && Number.isFinite(row.lng) && (row.lat !== 0 || row.lng !== 0);
    return { group, score: poiScore(scoreFacts(row), maxima) + (exact ? 200 : prefix ? 65 : 0)
      + (typeof row.distance === 'number' ? (1 - Math.max(0, Math.min(1, row.distance))) * 120 : 0)
      + (theme ? 45 : 0) + (categories.includes(row.category) ? 25 : 0) + (coord ? 8 : 0)
      - (!exact && detail ? 100 : 0) - (!exact && parent ? 45 : 0),
    cell: coord ? `${row.city}|${Math.floor(row.lat! / 0.03)}|${Math.floor(row.lng! / 0.04)}` : '' };
  });
  const selected: RankedPlace[] = [];
  const cells = new Map<string, number>();
  while (candidates.length && selected.length < limit) {
    const value = (item: typeof candidates[number]) => item.score - Math.min(24, (cells.get(item.cell) ?? 0) * 8);
    candidates.sort((a, b) => value(b) - value(a) || a.group.row.name.localeCompare(b.group.row.name, 'zh-CN') || a.group.row.id.localeCompare(b.group.row.id));
    const next = candidates.shift()!;
    selected.push(next.group);
    if (next.cell) cells.set(next.cell, (cells.get(next.cell) ?? 0) + 1);
  }
  return selected;
}
