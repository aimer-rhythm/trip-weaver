import { FEASIBILITY_THRESHOLDS, haversineMeters } from '@tripweaver/shared';

interface Point { name: string; lat?: number; lng?: number }
interface OrderOptions {
  constraints?: readonly { before: string; after: string }[];
  /** 餐次等位置固定；未知坐标也自动固定，不凭空推断其位置。 */
  fixedIndexes?: ReadonlySet<number>;
  origin?: { lat: number; lng: number };
}
function located(p: Point): p is Point & { lat: number; lng: number } {
  return typeof p.lat === 'number' && Number.isFinite(p.lat) && Math.abs(p.lat) <= 90
    && typeof p.lng === 'number' && Number.isFinite(p.lng) && Math.abs(p.lng) <= 180 && (p.lat !== 0 || p.lng !== 0);
}

/** 与 feasibility 的「>90度且回跳>2km」口径一致；分数与关联折扣不参与实际几何成本。 */
export function routeBacktracks(points: readonly Point[]): number {
  let count = 0;
  for (let i = 2; i < points.length; i++) {
    const a = points[i - 2]!, b = points[i - 1]!, c = points[i]!;
    if (!located(a) || !located(b) || !located(c)) continue;
    const x1 = (b.lng - a.lng) * Math.cos(a.lat * Math.PI / 180), y1 = b.lat - a.lat;
    const x2 = (c.lng - b.lng) * Math.cos(b.lat * Math.PI / 180), y2 = c.lat - b.lat;
    const magnitude = Math.hypot(x1, y1) * Math.hypot(x2, y2);
    if (magnitude && (x1 * x2 + y1 * y2) / magnitude < FEASIBILITY_THRESHOLDS.backtrackTurnCosMax
      && haversineMeters(b, c) > FEASIBILITY_THRESHOLDS.backtrackJumpMeters) count++;
  }
  return count;
}

export function routeDistanceMeters(points: readonly Point[], origin?: OrderOptions['origin']): number {
  let distance = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!;
    if (located(a) && located(b)) distance += haversineMeters(a, b);
  }
  if (origin && located({ name: '', ...origin })) {
    const first = points[0], last = points.at(-1);
    if (first && located(first)) distance += haversineMeters(origin, first);
    if (last && located(last)) distance += haversineMeters(last, origin);
  }
  return distance;
}

/** 最多8点=40320种顺序，纯代码且有界。只采纳不增加原路线长度的解，优先少折返、再短路程。
 * 循环/不可满足的约束保留输入，缺坐标点固定；不会丢点、移动日期或修改原对象。 */
export function optimizeRouteOrder<T extends Point>(points: readonly T[], options: OrderOptions = {}): T[] {
  if (points.length < 3 || points.length > 8) return [...points];
  const fixed = new Set(options.fixedIndexes);
  points.forEach((p, i) => { if (!located(p)) fixed.add(i); });
  const predecessors = points.map((p) => (options.constraints ?? []).filter((c) => c.after === p.name)
    .flatMap((c) => points.flatMap((q, i) => q.name === c.before && q.name !== p.name && located(q) && located(p) ? [i] : [])));
  let best = [...points];
  let bestTurns = routeBacktracks(best);
  let bestDistance = routeDistanceMeters(best, options.origin);
  const ceiling = bestDistance + 1; // 1米数值容差，不能为了少一处角度报警绕大圈。
  const originalValid = predecessors.every((before, i) => before.every((j) => j < i));
  if (!originalValid) { bestTurns = Infinity; bestDistance = Infinity; }
  const used = new Set<number>();
  const chain: T[] = [];
  const visit = () => {
    if (chain.length === points.length) {
      const distance = routeDistanceMeters(chain, options.origin);
      if (distance > ceiling && originalValid) return;
      const turns = routeBacktracks(chain);
      if (turns < bestTurns || (turns === bestTurns && distance < bestDistance - 1)) {
        best = [...chain]; bestTurns = turns; bestDistance = distance;
      }
      return;
    }
    const slot = chain.length;
    for (let i = 0; i < points.length; i++) {
      if (used.has(i) || (fixed.has(slot) ? i !== slot : fixed.has(i))) continue;
      if (predecessors[i]!.some((j) => !used.has(j))) continue;
      used.add(i); chain.push(points[i]!); visit(); chain.pop(); used.delete(i);
    }
  };
  visit();
  return best;
}
