// POI 关联对加载（09-27）：上游 xhs-pipeline 规则挖掘的「常在同天」无向地点对。
//
// 语义边界（上游 47292c6 明确）：关联对**不表达先后** —— 「先去 A 再去 B」的顺序由消费端按坐标决定。
// 因此这里只服务「同天聚类」：排程成链时给命中的两点距离打折，让它们自然相邻，
// 切段时更可能落进同一段（＝同一天）。绝不产出先后硬约束（那是 routeOrderSeeds 的事）。
//
// 降级纪律（同 placeFacts）：查询失败返回空 Map —— 关联对是增强信息，缺了排程照常跑。
import { pool } from '../../db/client';
import { normalizePlaceKey } from './placeFacts';
import { relatedPairKey } from './schedule';

/** 归一键 → 该键关联的归一键列表。无向，两侧都登记，消费端不必关心存储方向。 */
export type PlaceRelations = ReadonlyMap<string, readonly string[]>;

/**
 * 全城关联对拉回并归一到归一键（09-23 同款实体归并思路）。
 * 库内存的可能是「故宫博物院」，候选池里是「故宫」—— 未归一的名字直接比对会漏掉全部关联。
 * city 必传：跨城关联对无意义（同 placeFacts 的 city 语义）。
 */
export async function loadPlaceRelations(city: string): Promise<PlaceRelations> {
  if (!city.trim()) return new Map();
  try {
    const { rows } = await pool.query<{ from_name: string; to_name: string }>(
      `SELECT from_name, to_name FROM place_relation WHERE city = $1`,
      [city],
    );
    const map = new Map<string, string[]>();
    const link = (from: string, to: string): void => {
      const list = map.get(from) ?? [];
      if (!list.includes(to)) list.push(to);
      map.set(from, list);
    };
    for (const row of rows) {
      const from = normalizePlaceKey(row.from_name);
      const to = normalizePlaceKey(row.to_name);
      if (!from || !to || from === to) continue;
      link(from, to);
      link(to, from);
    }
    return map;
  } catch (err) {
    console.warn(
      `[placeRelations] 关联对加载失败，排程按无关联降级：${err instanceof Error ? err.message : String(err)}`,
    );
    return new Map();
  }
}

/**
 * 关联对 → 候选池实际名 pair key（供排程直接查）。
 * 库里存的是上游 canonical name（如「故宫博物院」），候选池里可能是「故宫」—— 两边都过归一键
 * 后再交叉，且只有**两端都在候选池**的关联对才生效（缺一端无从打折）。
 * 一个归一键可能对应多个候选（剥后缀会合并：「天安门」与「天安门广场」同键），
 * 因此按键存**列表**并两两配对 —— 只留第一个会让同键的其余候选静默丢掉关联对。
 * 命中名一律用候选池的**原值**（不 trim）—— 排程里比对的也是 `poi.name`，两处必须逐字一致。
 * 候选池没命中任何一对时返回空集合，排程行为与接入前一致。
 */
export function resolveRelatedPairs(
  relations: PlaceRelations,
  candidateNames: readonly string[],
): Set<string> {
  const pairs = new Set<string>();
  if (!relations.size) return pairs;
  const namesByKey = new Map<string, string[]>();
  for (const name of candidateNames) {
    const key = normalizePlaceKey(name);
    if (!key) continue;
    const list = namesByKey.get(key) ?? [];
    if (!list.includes(name)) list.push(name);
    namesByKey.set(key, list);
  }
  for (const [key, neighbors] of relations) {
    const froms = namesByKey.get(key);
    if (!froms) continue;
    for (const neighbor of neighbors) {
      const tos = namesByKey.get(neighbor);
      if (!tos) continue;
      for (const from of froms) {
        for (const to of tos) {
          if (to !== from) pairs.add(relatedPairKey(from, to));
        }
      }
    }
  }
  return pairs;
}
