import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SCHEDULE_LIMITS, buildSchedule, type SchedulablePoi } from '../generation/scheduling/schedule';
import { NEUTRAL_RATIO, poiScore, scoreMaxima } from '../generation/scheduling/score';
import { DEFAULT_VISIT_WEIGHT, isHeavy, visitWeight } from '../generation/scheduling/visitWeight';

let seq = 0;
function poi(overrides: Partial<SchedulablePoi> & { name: string }): SchedulablePoi {
  seq += 1;
  return { id: `p${seq}`, category: 'attraction', score: 10, weight: 2, ...overrides };
}

/** 一列在城里均匀排开的坐标，保证最近邻成链有确定结果 */
function ring(index: number, total: number): { lat: number; lng: number } {
  const angle = (index / Math.max(1, total)) * 2 * Math.PI;
  return { lat: 39.9 + Math.cos(angle) * 0.05, lng: 116.4 + Math.sin(angle) * 0.05 };
}

const sumScore = (stops: { poi: SchedulablePoi }[]) => stops.reduce((sum, stop) => sum + stop.poi.score, 0);

test('选点权重：缺失分走中性（不当 0），金集另有加分', () => {
  const maxima = { score: 50, mention: 20 };
  assert.equal(poiScore({ recommendScore: 50, mentionCount: 20, source: 'xhs' }, maxima), 100);
  // 分数全缺：质量/热度各取中性 0.5，金集再加 15
  assert.equal(poiScore({ source: 'goldset' }, maxima), NEUTRAL_RATIO * 60 + NEUTRAL_RATIO * 40 + 15);
  assert.equal(poiScore({ source: 'xhs' }, maxima), NEUTRAL_RATIO * 60 + NEUTRAL_RATIO * 40);
  assert.equal(poiScore(undefined, maxima), NEUTRAL_RATIO * 60 + NEUTRAL_RATIO * 40);
  // 金集地标（无分数）必须排在同为无数据的普通点前面 —— 修的就是这个反转
  assert.ok(poiScore({ source: 'goldset' }, maxima) > poiScore({ source: 'xhs' }, maxima));
  // 金集自带分数时，和同样有分的点比仍然是「金集优先」
  assert.ok(poiScore({ recommendScore: 40, source: 'goldset' }, maxima) > poiScore({ recommendScore: 40, source: 'xhs' }, maxima));
});

test('归一化基准只统计有值样本，缺失值不拉低整体', () => {
  assert.deepEqual(scoreMaxima([{ recommendScore: 10, mentionCount: 2 }, { source: 'goldset' }]), {
    score: 10,
    mention: 2,
  });
  assert.deepEqual(scoreMaxima([{ source: 'goldset' }, undefined]), { score: 0, mention: 0 });
});

test('停留分量：细粒度类型表 → 类目表 → 默认值', () => {
  assert.equal(visitWeight({ placeType: 'scenic_area', category: '文化' }), 3);
  assert.equal(visitWeight({ placeType: 'attraction', category: '文化' }), 2);
  assert.equal(visitWeight({ placeType: 'museum', category: '文化' }), 2);
  assert.equal(visitWeight({ placeType: 'street', category: '文化' }), 1);
  // 无 placeType 时退类目表（金集快照类候选只有这张表）
  assert.equal(visitWeight({ category: '自然' }), 2);
  assert.equal(visitWeight({ category: '购物' }), 1);
  assert.equal(visitWeight({}), DEFAULT_VISIT_WEIGHT);
  assert.equal(visitWeight(undefined), DEFAULT_VISIT_WEIGHT);
  assert.equal(isHeavy('scenic_area'), true);
  assert.equal(isHeavy('street'), false);
});

test('按停留分量切段：每天分量不超上限、个数不超单日上限', () => {
  // 6 个「大点」（分量 3）：上限 7 → 每段只能放 2 个（3+3=6，再加一个就 9 > 7）
  const candidates = Array.from({ length: 6 }, (_, i) =>
    poi({ name: `大点${i}`, score: 100 - i, weight: 3, ...ring(i, 6) }),
  );
  const result = buildSchedule(candidates, { days: 3, foodFocused: false });

  assert.equal(result.days.length, 3);
  for (const day of result.days) {
    const weight = day.stops.reduce((sum, stop) => sum + stop.poi.weight, 0);
    assert.ok(weight <= SCHEDULE_LIMITS.dayWeightLimit, `第${day.dayIndex}天分量 ${weight} 超上限`);
    assert.ok(day.stops.length <= SCHEDULE_LIMITS.maxStopsPerDay);
  }
  assert.equal(result.days.flatMap((day) => day.stops).length, 6);
  assert.equal(result.droppedCount, 0);
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

test('强独占级最多占一半天数：3 天行程只保留分数最高的那个远郊点', () => {
  const candidates = [
    poi({ name: '八达岭长城', score: 95, lat: 40.35, lng: 116.02 }),
    poi({ name: '慕田峪长城', score: 90, lat: 40.43, lng: 116.57 }),
    ...Array.from({ length: 5 }, (_, i) => poi({ name: `市区点${i}`, score: 60 - i, ...ring(i, 5) })),
  ];
  const result = buildSchedule(candidates, {
    days: 3,
    foodFocused: false,
    exclusiveNames: ['八达岭长城', '慕田峪长城'],
  });

  const names = result.days.flatMap((day) => day.stops.map((stop) => stop.poi.name));
  assert.ok(names.includes('八达岭长城'), '高分远郊点必须留下');
  assert.equal(names.includes('慕田峪长城'), false, '同类远郊点被上限挤掉');
  assert.equal(result.droppedCount, 1);
  // 剩下 2 天全部给市区点，且不超单日上限
  assert.equal(result.days.length, 3);
  assert.ok(result.days.every((day) => day.stops.length <= SCHEDULE_LIMITS.maxStopsPerDay));
  assert.equal(result.days.flatMap((day) => day.stops).length, 6);
});

test('独占点数超过上限时按分数如实丢弃，不把远端点塞进市区天', () => {
  const candidates = ['远郊甲', '远郊乙', '远郊丙'].map((name, i) =>
    poi({ name, score: 90 - i, lat: 40.4 + i * 0.01, lng: 116.0 }),
  );
  const result = buildSchedule(candidates, {
    days: 2,
    foodFocused: false,
    exclusiveNames: ['远郊甲', '远郊乙', '远郊丙'],
  });

  // 2 天 → 上限 1 天给远郊，另 1 天空出来走占位
  assert.deepEqual(result.days[0]!.stops.map((stop) => stop.poi.name), ['远郊甲']);
  assert.equal(result.droppedCount, 2);
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

// ---------- 闭馆日避让（09-22-opentime） ----------

test('段→天分配避让闭馆日：高分段不再铁定落 Day1', () => {
  // 两个大点各自成段（weight 5+5=10 > dayWeightLimit 8）；startDate 周一。
  // 甲馆「周一闭馆」分数最高 → 不避让时会落 Day1（周一），避让后应落 Day2（周二）。
  const result = buildSchedule(
    [
      poi({ name: '甲馆', score: 100, weight: 5, openTime: '09:00-17:00；周一闭馆', lat: 39.9, lng: 116.4 }),
      poi({ name: '乙园', score: 90, weight: 5, lat: 39.91, lng: 116.41 }),
    ],
    { days: 2, foodFocused: false, startDate: '2026-09-21' },
  );
  const day1Names = result.days[0]!.stops.map((s) => s.poi.name);
  const day2Names = result.days[1]!.stops.map((s) => s.poi.name);
  assert.ok(day2Names.includes('甲馆'), `甲馆周一闭馆，应避让到 Day2，实际 Day1=${day1Names} Day2=${day2Names}`);
  assert.ok(day1Names.includes('乙园'));
});

test('闭馆日避让：无 startDate 时不干预分天（拿不准不校验）', () => {
  const result = buildSchedule(
    [
      poi({ name: '甲馆', score: 100, weight: 5, openTime: '周一闭馆', lat: 39.9, lng: 116.4 }),
      poi({ name: '乙园', score: 90, weight: 5, lat: 39.91, lng: 116.41 }),
    ],
    { days: 2, foodFocused: false },
  );
  // 分数高 → Day1（与避让前行为一致）
  assert.equal(result.days[0]!.stops[0]!.poi.name, '甲馆');
});

test('闭馆日避让：所有天都闭馆时照常分配（交可行性引擎收口）', () => {
  const result = buildSchedule(
    [poi({ name: '甲馆', score: 100, weight: 5, openTime: '周一、周二闭馆', lat: 39.9, lng: 116.4 })],
    { days: 1, foodFocused: false, startDate: '2026-09-21' },
  );
  assert.equal(result.days[0]!.stops[0]!.poi.name, '甲馆');
});

// ---------- 顺序种子表（09-23） ----------

test('顺序约束：景山必须在故宫之后进链（出入口方向修正）', () => {
  // 景山离故宫质心极近，纯距离最近邻会把景山排前面（实测北京 3 日就是这么错的）
  const result = buildSchedule(
    [
      poi({ name: '故宫博物院', score: 90, weight: 3, lat: 39.9163, lng: 116.3972 }),
      poi({ name: '景山公园', score: 80, weight: 2, lat: 39.9251, lng: 116.3966 }),
      poi({ name: '天坛公园', score: 70, weight: 3, lat: 39.8822, lng: 116.4066 }),
    ],
    {
      days: 1,
      foodFocused: false,
      orderConstraints: [{ before: '故宫博物院', after: '景山公园' }],
    },
  );
  const names = result.days[0]!.stops.map((s) => s.poi.name);
  assert.ok(names.indexOf('故宫博物院') < names.indexOf('景山公园'), `期望故宫在景山前，实际：${names.join('→')}`);
});

test('顺序约束：约束一端缺席时不生效，两端在但无坐标时退让纯距离', () => {
  // 只有景山没有故宫 → 约束不生效，景山可以排第一
  const onlyAfter = buildSchedule(
    [poi({ name: '景山公园', score: 80, weight: 2, lat: 39.9251, lng: 116.3966 }), poi({ name: '天坛公园', score: 70, weight: 3, lat: 39.8822, lng: 116.4066 })],
    { days: 1, foodFocused: false, orderConstraints: [{ before: '故宫博物院', after: '景山公园' }] },
  );
  assert.equal(onlyAfter.days[0]!.stops[0]!.poi.name, '景山公园');
  // 故宫无坐标（stranded）→ 约束退让，景山照常按距离排
  const strandedPred = buildSchedule(
    [
      poi({ name: '故宫博物院', score: 90, weight: 3 }),  // 无坐标
      poi({ name: '景山公园', score: 80, weight: 2, lat: 39.9251, lng: 116.3966 }),
      poi({ name: '天坛公园', score: 70, weight: 3, lat: 39.8822, lng: 116.4066 }),
    ],
    { days: 1, foodFocused: false, orderConstraints: [{ before: '故宫博物院', after: '景山公园' }] },
  );
  assert.ok(strandedPred.days[0]!.stops.length > 0, '退让后仍应产出正常排程');
});

// ---------- 同类远郊点：独占上限挤掉低分者（09-23） ----------

test('双长城场景：两个强独占级候选 → 低分者不入选（droppedCount 计入）', () => {
  const result = buildSchedule(
    [
      poi({ name: '故宫博物院', score: 100, weight: 3, lat: 39.9163, lng: 116.3972 }),
      poi({ name: '景山公园', score: 60, weight: 2, lat: 39.9251, lng: 116.3966 }),
      poi({ name: '慕田峪长城', score: 50, weight: 3, lat: 40.4319, lng: 116.5703 }),
      poi({ name: '八达岭长城', score: 40, weight: 3, lat: 40.3598, lng: 116.0201 }),
    ],
    { days: 3, foodFocused: false, exclusiveNames: ['慕田峪长城', '八达岭长城'] },
  );
  const allNames = result.days.flatMap((d) => d.stops.map((s) => s.poi.name));
  assert.ok(allNames.includes('慕田峪长城'), '高分独占点应入选');
  assert.ok(!allNames.includes('八达岭长城'), '第二个长城应被独占上限挤掉');
  assert.equal(result.droppedCount, 1);
});
