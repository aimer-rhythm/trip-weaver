// 单测：对话按需编辑的归一与应用（纯函数，见 chat/editOps.ts）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeSampleTrip, type Trip } from '@tripweaver/shared';
import { applyItineraryEdits, normalizeEditOps } from '../chat/editOps';

function trip(): Trip {
  const t = makeSampleTrip();
  // 给第 1 天挂两条 leg，验证删除/替换后的清理
  const [a, b, c] = t.days[0]!.activities;
  if (a && b && c) {
    t.days[0]!.legs = [
      { fromActivityId: a.id, toActivityId: b.id, mode: 'walk', durationMin: 10, distanceM: 800, source: 'heuristic' },
      { fromActivityId: b.id, toActivityId: c.id, mode: 'walk', durationMin: 12, distanceM: 900, source: 'heuristic' },
    ];
  }
  return t;
}

test('normalizeEditOps：非数组/越界/缺字段的条目被丢弃，合法条目保留', () => {
  assert.deepEqual(normalizeEditOps(null), []);
  assert.deepEqual(normalizeEditOps([{ kind: 'delete_activity', dayIndex: 0, activityId: 'x' }]), []);   // dayIndex 从 1 起
  assert.deepEqual(normalizeEditOps([{ kind: 'replace_activity', dayIndex: 1, activityId: 'x' }]), []);     // 缺 activity
  const ops = normalizeEditOps([
    { kind: 'add_activity', dayIndex: 2, activity: { name: '夜市', category: '美食' } },
    { kind: 'add_activity', dayIndex: 2, activity: { name: '  ' } },                                       // 空名丢弃
    { kind: 'nonsense', dayIndex: 1 },
  ]);
  assert.equal(ops.length, 1);
  assert.equal(ops[0]!.kind, 'add_activity');
});

test('replace_activity：原位替换，旧活动的 leg 全部清除，其余不动', () => {
  const t = trip();
  const day1 = t.days[0]!;
  const victim = day1.activities[1]!;
  const result = applyItineraryEdits(t, [
    { kind: 'replace_activity', dayIndex: 1, activityId: victim.id, activity: { name: '上海博物馆', category: '文化', lat: 31.23, lng: 121.47 } },
  ]);
  assert.equal(result.changed, true);
  const nextDay = result.trip.days[0]!;
  assert.equal(nextDay.activities.length, day1.activities.length);           // 数量不变
  assert.equal(nextDay.activities[1]!.name, '上海博物馆');                   // 原位
  assert.equal(nextDay.activities[1]!.coordSource, 'geocoded');
  assert.equal(nextDay.activities[1]!.startTime, '');                        // 时刻轴恒空（D5）
  assert.deepEqual(nextDay.legs, []);                                        // 两条 leg 都触及被替换活动
  assert.notEqual(nextDay.activities[1]!.id, victim.id);                     // 新 id
});

test('delete_activity：移除目标，只清触及它的 leg', () => {
  const t = trip();
  const day1 = t.days[0]!;
  const [a, b, c] = day1.activities;
  void a; void c;
  const result = applyItineraryEdits(t, [{ kind: 'delete_activity', dayIndex: 1, activityId: b!.id }]);
  assert.equal(result.changed, true);
  const nextDay = result.trip.days[0]!;
  assert.deepEqual(nextDay.activities.map((x) => x.id), day1.activities.filter((x) => x.id !== b!.id).map((x) => x.id));
  assert.deepEqual(nextDay.legs, []);   // a→b 与 b→c 都触及 b
});

test('add_activity：默认追加到末尾，position 越界截断', () => {
  const t = trip();
  const count = t.days[1]!.activities.length;
  const append = applyItineraryEdits(t, [{ kind: 'add_activity', dayIndex: 2, activity: { name: '田子坊' } }]);
  assert.equal(append.trip.days[1]!.activities.length, count + 1);
  assert.equal(append.trip.days[1]!.activities.at(-1)!.name, '田子坊');

  const insert = applyItineraryEdits(t, [{ kind: 'add_activity', dayIndex: 2, position: 0, activity: { name: '外滩日出' } }]);
  assert.equal(insert.trip.days[1]!.activities[0]!.name, '外滩日出');
});

test('定位失败的操作被拒绝但不影响其他条；全拒绝时 changed=false', () => {
  const t = trip();
  const keep = t.days[0]!.activities[0]!;
  const result = applyItineraryEdits(t, [
    { kind: 'delete_activity', dayIndex: 99, activityId: 'ghost' },          // 天不存在
    { kind: 'delete_activity', dayIndex: 1, activityId: keep.id },
  ]);
  assert.equal(result.changed, true);
  assert.equal(result.outcomes[0]!.applied, false);
  assert.equal(result.outcomes[1]!.applied, true);

  const noop = applyItineraryEdits(t, [{ kind: 'delete_activity', dayIndex: 1, activityId: 'ghost' }]);
  assert.equal(noop.changed, false);
  assert.equal(noop.trip.days[0]!.activities.length, t.days[0]!.activities.length);
});

test('同一活动被两条操作命中时只执行第一条', () => {
  const t = trip();
  const victim = t.days[0]!.activities[0]!;
  const result = applyItineraryEdits(t, [
    { kind: 'replace_activity', dayIndex: 1, activityId: victim.id, activity: { name: '新活动' } },
    { kind: 'delete_activity', dayIndex: 1, activityId: victim.id },
  ]);
  assert.equal(result.outcomes[0]!.applied, true);
  assert.equal(result.outcomes[1]!.applied, false);
  assert.equal(result.trip.days[0]!.activities.length, t.days[0]!.activities.length);
});

test('不修改传入的原行程对象（immutable）', () => {
  const t = trip();
  const before = structuredClone(t);
  applyItineraryEdits(t, [{ kind: 'delete_activity', dayIndex: 1, activityId: t.days[0]!.activities[0]!.id }]);
  assert.deepEqual(t, before);
});
