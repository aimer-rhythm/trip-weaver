// 复用上海真实快照的餐厅与景点坐标，只重放选餐函数；不连接数据库或外部服务。
// node --import tsx .trellis/tasks/archive/2026-10/10-04-eval-operationalization/research/replay-meal-locality.mts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseSnapshot } from '../../../../../../eval/contracts';
import { distanceKm, selectMealStop, SCHEDULE_LIMITS, type SchedulablePoi } from '../../../../../../apps/server/src/generation/scheduling/schedule';

const output = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(output, '../../../../../..');
const source = 'eval/runs/2026-10-04T13-10-06-296Z-1d307915/snapshots/shanghai-3d-transit.json';
const bytes = fs.readFileSync(path.join(root, source));
const digest = (value: Buffer) => crypto.createHash('sha256').update(value).digest('hex');
const snapshot = parseSnapshot(JSON.parse(bytes.toString('utf8')));
const original = snapshot.trip.days.flatMap((d) => d.activities);
const isMeal = (name: string) => /^(午餐|晚餐)｜/.test(name);
const located = (p: { lat?: number; lng?: number }) => Number.isFinite(p.lat) && Number.isFinite(p.lng);
const toPoi = (p: { id: string; name: string; lat?: number; lng?: number }, food = false): SchedulablePoi =>
  ({ ...p, category: food ? 'food' : 'attraction', score: 0, weight: 1 });
const foods = new Set((snapshot.research?.candidates ?? []).filter((c) => c.category === 'food').map((candidate) => {
  const activity = original.find((a) => isMeal(a.name) && a.name.split('｜')[1] === candidate.name);
  assert.ok(activity && located(activity), `原快照缺餐厅坐标：${candidate.name}`);
  return toPoi({ id: candidate.id, name: candidate.name, lat: activity.lat, lng: activity.lng }, true);
}));
assert.equal(foods.size, 6, '对照必须使用本次调研全部六个美食候选');
const km = (a: SchedulablePoi, b: SchedulablePoi) => {
  assert.ok(located(a) && located(b));
  return distanceKm({ lat: a.lat!, lng: a.lng! }, { lat: b.lat!, lng: b.lng! });
};
const added = (meal: SchedulablePoi, before: SchedulablePoi, after?: SchedulablePoi) =>
  after ? Math.max(0, km(before, meal) + km(meal, after) - km(before, after)) : km(before, meal);
const rows = snapshot.trip.days.flatMap((day) => day.activities.flatMap((meal, index) => {
  if (!isMeal(meal.name)) return [];
  const previous = day.activities.slice(0, index).reverse().find((a) => !isMeal(a.name));
  const following = day.activities.slice(index + 1).find((a) => !isMeal(a.name));
  assert.ok(previous && located(previous));
  const before = toPoi(previous), after = following ? toPoi(following) : undefined;
  const kind = meal.name.startsWith('午餐') ? 'lunch' : 'dinner';
  const stop = selectMealStop(foods, kind, before, after, snapshot.form.destination);
  const nextAddedKm = added(stop.poi, before, after);
  assert.ok(nextAddedKm <= SCHEDULE_LIMITS.mealDetourKm);
  return [{ day: day.dayIndex, kind, before: before.name, after: after?.name ?? null,
    original: meal.name, selected: `${kind === 'lunch' ? '午餐' : '晚餐'}｜${stop.poi.name}`,
    areaAnchor: stop.areaAnchorName ?? null, previousAddedKm: added(toPoi(meal, true), before, after), nextAddedKm }];
}));
const evidence = { source, snapshotSha256: digest(bytes),
  scheduleSha256: digest(fs.readFileSync(path.join(root, 'apps/server/src/generation/scheduling/schedule.ts'))),
  method: '固定原快照日期、景点顺序与餐次位置，按原调研候选顺序重放 selectMealStop；坐标来自原最终行程，距离为直线近似。',
  limits: { nearbyKm: SCHEDULE_LIMITS.mealNearbyKm, detourKm: SCHEDULE_LIMITS.mealDetourKm }, rows,
  unusedRestaurants: [...foods].map((p) => p.name) };
const esc = (s: string) => s.replaceAll('|', '\\|');
const report = ['# 上海餐饮顺路规则：固定景点顺序的几何对照', '',
  `来源：[原 live 报告](../../../../../../eval/runs/2026-10-04T13-10-06-296Z-1d307915/report.md)。`, '',
  evidence.method, '',
  '这不是新的端到端生成结果，不重算分天、路线后处理或实际地图通勤。午餐增量为前站→餐厅→后站减去前站→后站；晚餐为末站→餐厅的距离。', '',
  '| 餐次 | 原餐厅 | 新选择 | 原直线增量 km | 新直线增量 km |',
  '| --- | --- | --- | --- | --- |',
  ...rows.map((r) => `| D${r.day} ${r.kind === 'lunch' ? '午餐' : '晚餐'} | ${esc(r.original)} | ${esc(r.selected)} | ${r.previousAddedKm.toFixed(2)} | ${r.nextAddedKm.toFixed(2)} |`), '',
  '“周边”是参考区域，0 仅表示采用相邻景点坐标，具体餐厅、步行路程和费用仍未知。没有重新核实原坐标是否属于正确分店，也没有声称实际交通节省多少分钟。', '',
  `仍未使用的餐厅：${evidence.unusedRestaurants.join('、')}。`, '',
  `原快照 SHA-256：\`${evidence.snapshotSha256}\`。`, '',
  '复现：`node --import tsx .trellis/tasks/archive/2026-10/10-04-eval-operationalization/research/replay-meal-locality.mts`。', ''].join('\n');
fs.writeFileSync(path.join(output, 'meal-locality-replay.json'), `${JSON.stringify(evidence, null, 2)}\n`);
fs.writeFileSync(path.join(output, 'meal-locality-replay.md'), report);
assert.equal(digest(fs.readFileSync(path.join(root, source))), evidence.snapshotSha256);
console.log(report);
