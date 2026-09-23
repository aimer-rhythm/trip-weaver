// 单测：placeFacts 实体归一（09-23）——归一键、合并规则、加载集成（本地库）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPlaceFacts, mergeFacts, normalizePlaceKey, type PlaceFacts } from '../generation/scheduling/placeFacts';

// ---------- 归一键 ----------

test('归一键：机构后缀剥离后同键，无后缀原名保持', () => {
  assert.equal(normalizePlaceKey('故宫博物院'), '故宫');
  assert.equal(normalizePlaceKey('故宫'), '故宫');
  assert.equal(normalizePlaceKey('景山公园'), '景山');
  assert.equal(normalizePlaceKey('景山'), '景山');
  assert.equal(normalizePlaceKey('恭王府博物馆'), '恭王府');
  assert.equal(normalizePlaceKey(' 故宫博物院 '), '故宫', '空白先 trim');
});

test('归一键：不剥非后缀差异（沈阳故宫 ≠ 故宫），不剥到少于 2 字', () => {
  assert.notEqual(normalizePlaceKey('沈阳故宫'), normalizePlaceKey('故宫博物院'));
  assert.equal(normalizePlaceKey('公园'), '公园', '整名就是后缀时不剥');
});

// ---------- 合并规则 ----------

const fx = (over: Partial<PlaceFacts> & { name: string }): PlaceFacts => ({
  category: '', source: 'xhs', themes: [], recommendScore: 0, mentionCount: 0, ...over,
});

test('合并：质量取 max、热度求和、themes 并集、source 优先金集', () => {
  const merged = mergeFacts([
    fx({ name: '故宫博物院', source: 'goldset', recommendScore: 17.33, mentionCount: 6, themes: ['历史古迹'] }),
    fx({ name: '故宫', source: 'xhs', recommendScore: 40, mentionCount: 12, themes: ['历史古迹', '赏雪'] }),
  ]);
  assert.equal(merged.recommendScore, 40, '质量取 max');
  assert.equal(merged.mentionCount, 18, '热度求和');
  assert.deepEqual(merged.themes, ['历史古迹', '赏雪'], 'themes 并集去重');
  assert.equal(merged.source, 'goldset', 'source 取高优先');
});

test('合并：坐标与停留时长取有值/最大', () => {
  const merged = mergeFacts([
    fx({ name: '甲', visitMinutes: 120 }),
    fx({ name: '甲公园', lat: 39.9, lng: 116.4, visitMinutes: 90 }),
  ]);
  assert.equal(merged.visitMinutes, 120);
  assert.equal(merged.lat, 39.9);
});

// ---------- 加载集成（本地库；库不可达时 placeFacts 降级为空 Map，跳过断言） ----------

test('loadPlaceFacts：候选「故宫博物院」合并到「故宫」分裂条目的分数与提及', async () => {
  const map = await loadPlaceFacts(['故宫博物院'], '北京');
  const facts = map.get('故宫博物院');
  if (!facts) {
    console.warn('本地库不可达或未命中，跳过集成断言');
    return;
  }
  // 分裂前实测：recommendScore 17.33 / mentionCount 6；合并后提及应 > 6（故宫条目的提及加进来）
  assert.ok(facts.mentionCount > 6, `合并后提及应大于单条目 6，实际 ${facts.mentionCount}`);
});
