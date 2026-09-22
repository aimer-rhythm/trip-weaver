import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SCHEDULE_LIMITS, buildSchedule, type SchedulablePoi } from '../generation/scheduling/schedule';

let seq = 0;
function poi(overrides: Partial<SchedulablePoi> & { name: string }): SchedulablePoi {
  seq += 1;
  return { id: `p${seq}`, category: 'attraction', score: 10, ...overrides };
}

/** 一列在城里均匀排开的坐标，保证最近邻成链有确定结果 */
function ring(index: number, total: number): { lat: number; lng: number } {
  const angle = (index / Math.max(1, total)) * 2 * Math.PI;
  return { lat: 39.9 + Math.cos(angle) * 0.05, lng: 116.4 + Math.sin(angle) * 0.05 };
}

const sumScore = (stops: { poi: SchedulablePoi }[]) => stops.reduce((sum, stop) => sum + stop.poi.score, 0);

test('切段均衡：天数间活动数差 ≤1，且不超过单日上限', () => {
  const candidates = Array.from({ length: 9 }, (_, i) => poi({ name: `点${i}`, score: 100 - i, ...ring(i, 9) }));
  const result = buildSchedule(candidates, { days: 3, foodFocused: false });

  assert.equal(result.days.length, 3);
  assert.deepEqual(result.days.map((day) => day.stops.length), [3, 3, 3]);
  assert.equal(result.droppedCount, 0);
  assert.ok(result.days.every((day) => day.stops.length <= SCHEDULE_LIMITS.maxStopsPerDay));
});

test('容量不足时按分数丢弃：低分先出局，高分必留', () => {
  const candidates = Array.from({ length: 20 }, (_, i) => poi({ name: `点${i}`, score: 100 - i, ...ring(i, 20) }));
  const result = buildSchedule(candidates, { days: 2, foodFocused: false });

  assert.equal(result.days.length, 2);
  assert.ok(result.days.every((day) => day.stops.length <= SCHEDULE_LIMITS.maxStopsPerDay));
  assert.equal(result.droppedCount, 20 - result.days.reduce((sum, day) => sum + day.stops.length, 0));
  const kept = new Set(result.days.flatMap((day) => day.stops.map((stop) => stop.poi.name)));
  assert.ok(kept.has('点0'), '最高分必须留下');
  assert.equal(kept.has('点19'), false, '最低分必须被丢弃');
});

test('强独占级地点独占一天，不与市区点混排', () => {
  const candidates = [
    poi({ name: '远郊长城', score: 90, lat: 40.35, lng: 116.02 }),
    poi({ name: '甲馆', score: 50, ...ring(0, 3) }),
    poi({ name: '乙园', score: 40, ...ring(1, 3) }),
    poi({ name: '丙寺', score: 30, ...ring(2, 3) }),
  ];
  const result = buildSchedule(candidates, { days: 2, foodFocused: false, exclusiveNames: ['远郊长城'] });

  assert.deepEqual(result.days[0]!.stops.map((stop) => stop.poi.name), ['远郊长城']);
  assert.deepEqual(
    result.days[1]!.stops.map((stop) => stop.poi.name).sort(),
    ['丙寺', '乙园', '甲馆'].sort(),
  );
  assert.equal(result.droppedCount, 0);
});

test('独占点数超过天数时如实丢弃，不把远端点塞进市区天', () => {
  const candidates = ['远郊甲', '远郊乙', '远郊丙'].map((name) => poi({ name, score: 90, lat: 40.4, lng: 116.0 }));
  const result = buildSchedule(candidates, { days: 2, foodFocused: false, exclusiveNames: ['远郊甲', '远郊乙', '远郊丙'] });

  assert.equal(result.days.length, 2);
  assert.equal(result.days[0]!.stops.length, 1);
  assert.equal(result.days[1]!.stops.length, 1);
  assert.equal(result.droppedCount, 1);
});

test('无坐标候选不参与成链但照样排入（坐标由 geoPipeline 事后解析）', () => {
  const candidates = [
    poi({ name: '甲馆', score: 50, lat: 39.9, lng: 116.4 }),
    poi({ name: '乙园', score: 40, lat: 39.91, lng: 116.41 }),
    poi({ name: '无坐标馆', score: 30 }),
  ];
  const result = buildSchedule(candidates, { days: 1, foodFocused: false });

  assert.deepEqual(
    result.days[0]!.stops.map((stop) => stop.poi.name).sort(),
    ['甲馆', '乙园', '无坐标馆'].sort(),
  );
  assert.equal(result.droppedCount, 0);
});

test('美食导向每天必有午餐与晚餐；非美食导向一个餐次都没有', () => {
  const candidates = [
    poi({ name: '甲馆', score: 50, lat: 39.9, lng: 116.4 }),
    poi({ name: '乙园', score: 40, lat: 39.91, lng: 116.41 }),
    poi({ name: '南锣鼓巷小吃街', category: 'food', score: 5, lat: 39.937, lng: 116.403 }),
    poi({ name: '前门片食', category: 'food', score: 4, lat: 39.899, lng: 116.398 }),
  ];

  const free = buildSchedule(candidates, { days: 1, foodFocused: false });
  assert.ok(free.days[0]!.stops.every((stop) => stop.meal === undefined));

  const focused = buildSchedule(candidates, { days: 1, foodFocused: true, fallbackArea: '北京' });
  assert.deepEqual(
    focused.days[0]!.stops.filter((stop) => stop.meal).map((stop) => stop.meal),
    ['lunch', 'dinner'],
  );
  assert.ok(focused.days[0]!.stops.filter((stop) => stop.meal).every((stop) => stop.poi.category === 'food'));
});

test('美食导向没有美食候选时用目的地占位补齐餐次（餐次是硬门槛）', () => {
  const result = buildSchedule([poi({ name: '甲馆', score: 50, lat: 39.9, lng: 116.4 })], {
    days: 1,
    foodFocused: true,
    fallbackArea: '北京',
  });
  const meals = result.days[0]!.stops.filter((stop) => stop.meal);
  assert.deepEqual(meals.map((stop) => stop.meal), ['lunch', 'dinner']);
  assert.ok(meals.every((stop) => stop.poi.name === '北京'));
});

test('候选排不满天数：空天用占位活动兜底（保住每天至少一个活动）', () => {
  const result = buildSchedule([poi({ name: '甲馆', score: 50, lat: 39.9, lng: 116.4 })], {
    days: 3,
    foodFocused: false,
    fallbackArea: '北京',
  });

  assert.equal(result.days.length, 3);
  assert.deepEqual(result.days[0]!.stops.map((stop) => stop.poi.name), ['甲馆']);
  for (const day of result.days.slice(1)) {
    assert.equal(day.stops.length, 1);
    assert.ok(day.stops[0]!.poi.name.startsWith(SCHEDULE_LIMITS.emptyDayPrefix));
    assert.equal(day.title, SCHEDULE_LIMITS.emptyDayPrefix);
  }
  assert.equal(result.droppedCount, 0);
});

test('段按权重降序分天：总分最高的段拿 Day1（分数管分天 D1）', () => {
  const candidates = Array.from({ length: 6 }, (_, i) => poi({ name: `点${i}`, score: 100 - i * 10, ...ring(i, 6) }));
  const result = buildSchedule(candidates, { days: 3, foodFocused: false });

  const weights = result.days.map((day) => sumScore(day.stops));
  assert.deepEqual(weights, [...weights].sort((a, b) => b - a), `Day1..k 的段权重应递减，实际 ${weights.join(',')}`);
});

test('每天主题取成员 themes 众数；无 themes 时回退知识库 8 类目', () => {
  const themed = buildSchedule(
    [
      poi({ name: '甲馆', theme: '人文老城', score: 50, lat: 39.9, lng: 116.4 }),
      poi({ name: '乙园', theme: '人文老城', score: 40, lat: 39.91, lng: 116.41 }),
      poi({ name: '丙市', theme: '城市漫步', score: 30, lat: 39.92, lng: 116.42 }),
    ],
    { days: 1, foodFocused: false },
  );
  assert.equal(themed.days[0]!.title, '人文老城');

  const fallback = buildSchedule([poi({ name: '甲馆', kbCategory: '自然', score: 50, lat: 39.9, lng: 116.4 })], {
    days: 1,
    foodFocused: false,
  });
  assert.equal(fallback.days[0]!.title, '自然');

  const neither = buildSchedule([poi({ name: '甲馆', score: 50, lat: 39.9, lng: 116.4 })], {
    days: 1,
    foodFocused: false,
  });
  assert.equal(neither.days[0]!.title, '自由漫步');
});
