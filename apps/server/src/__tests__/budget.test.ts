// 单测：预算区间聚合（ST3 cost 可选化）+ 住宿哨兵 leg 匹配（node:test，经 tsx 运行）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LODGING_SENTINEL,
  computeBudgetSummary,
  lodgingLegsForDay,
  type Activity,
  type Trip,
  type TripDay,
} from '@tripweaver/shared';

function activity(id: string, cost?: number): Activity {
  return {
    id,
    name: `活动${id}`,
    startTime: '',
    endTime: '',
    description: '',
    lat: 0,
    lng: 0,
    coordSource: 'estimated',
    ...(typeof cost === 'number' ? { cost } : {}),
    category: '其他',
    sourceNotes: [],
  };
}

function trip(partySize: number, days: TripDay[]): Trip {
  return {
    id: 't1',
    title: '测试行程',
    destination: '杭州',
    startDate: '',
    budgetLevel: '舒适',
    totalBudget: 0,
    preferences: [],
    partySize,
    extraNotes: '',
    days,
    meta: { usedXhs: false, reviewNotes: [] },
    createdAt: 0,
    updatedAt: 0,
  };
}

function day(id: string, activities: Activity[]): TripDay {
  return { id, dayIndex: 1, title: '', activities };
}

test('computeBudgetSummary：日成本 ÷ partySize，区间 [0.8, 1.3] 十位取整', () => {
  // 一天费用合计 400，2 人 → 人均 200/天 → [160, 260]
  const b = computeBudgetSummary(trip(2, [day('d1', [activity('a1', 100), activity('a2', 300)])]));
  assert.deepEqual(b, { perPersonPerDayMin: 160, perPersonPerDayMax: 260, coveredDays: 1 });
});

test('computeBudgetSummary：cost 缺省跳过；无数据天不计入 coveredDays', () => {
  const b = computeBudgetSummary(
    trip(1, [
      day('d1', [activity('a1', 100), activity('a2')]),   // 有数据：100
      day('d2', [activity('a3')]),                        // 全缺省：不计
      day('d3', [activity('a4', 300)]),                   // 有数据：300
    ]),
  );
  // 均值 = (100+300)/1人/2天 = 200 → [160, 260]
  assert.deepEqual(b, { perPersonPerDayMin: 160, perPersonPerDayMax: 260, coveredDays: 2 });
});

test('computeBudgetSummary：全无费用数据 → 全零区间', () => {
  const b = computeBudgetSummary(trip(2, [day('d1', [activity('a1')])]));
  assert.deepEqual(b, { perPersonPerDayMin: 0, perPersonPerDayMax: 0, coveredDays: 0 });
});

test('computeBudgetSummary：cost=0（免费）算有数据', () => {
  const b = computeBudgetSummary(trip(1, [day('d1', [activity('a1', 0)])]));
  assert.deepEqual(b, { perPersonPerDayMin: 0, perPersonPerDayMax: 0, coveredDays: 1 });
});

const lodgingLeg = (from: string, to: string) => ({
  fromActivityId: from,
  toActivityId: to,
  mode: 'transit' as const,
  durationMin: 20,
  distanceM: 5000,
  source: 'heuristic' as const,
});

test('lodgingLegsForDay：首尾哨兵 leg 严格匹配当前首末活动', () => {
  const d: TripDay = {
    ...day('d1', [activity('a1'), activity('a2')]),
    legs: [lodgingLeg(LODGING_SENTINEL, 'a1'), lodgingLeg('a1', 'a2'), lodgingLeg('a2', LODGING_SENTINEL)],
  };
  const { departure, returning } = lodgingLegsForDay(d);
  assert.equal(departure?.toActivityId, 'a1');
  assert.equal(returning?.fromActivityId, 'a2');
});

test('lodgingLegsForDay：活动重排/删除后失配 → 不返回过期 leg', () => {
  const d: TripDay = {
    ...day('d1', [activity('a2')]),   // a1 已被删除
    legs: [lodgingLeg(LODGING_SENTINEL, 'a1'), lodgingLeg('a1', LODGING_SENTINEL)],
  };
  assert.deepEqual(lodgingLegsForDay(d), { departure: undefined, returning: undefined });
});

test('lodgingLegsForDay：无活动或无 legs → 空对象', () => {
  assert.deepEqual(lodgingLegsForDay(day('d1', [])), {});
  assert.deepEqual(lodgingLegsForDay(day('d1', [activity('a1')])), {});
});
