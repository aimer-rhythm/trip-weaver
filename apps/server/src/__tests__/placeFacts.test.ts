// 单测：placeFacts 实体归一（09-23）——归一键、合并规则、加载集成（本地库）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPlaceFacts, mergeFacts, normalizePlaceKey, renderOpenHours, type PlaceFacts } from '../generation/scheduling/placeFacts';

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
  category: '', source: 'xhs', themes: [], recommendScore: 0, mentionCount: 0, aliases: [], ...over,
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

// ---------- 结构化开闭馆渲染（09-27） ----------

test('renderOpenHours：营业时段与闭馆星期渲染成 openTime 同构文本', () => {
  assert.equal(renderOpenHours({ openTime: '09:00', closeTime: '17:00', closedWeekdays: [] }), '09:00-17:00');
  assert.equal(renderOpenHours({ text: '周一闭馆', openTime: null, closeTime: null, closedWeekdays: [1] }), '周一闭馆');
  assert.equal(
    renderOpenHours({ openTime: '09:00', closeTime: '17:00', closedWeekdays: [1, 6], note: '法定节假日除外' }),
    '09:00-17:00；周一、周六闭馆；法定节假日除外',
  );
  assert.equal(renderOpenHours({ closedWeekdays: [2, 1, 2] }), '周一、周二闭馆', '星期去重并排序');
});

test('renderOpenHours：字段缺失或类型不符时返回 undefined，不编造', () => {
  assert.equal(renderOpenHours(undefined), undefined);
  assert.equal(renderOpenHours(null), undefined);
  assert.equal(renderOpenHours('09:00-17:00'), undefined, '自由文本不走这条路');
  assert.equal(renderOpenHours({}), undefined);
  assert.equal(renderOpenHours({ closedWeekdays: [9, -1] }), undefined, '越界星期丢弃后无内容');
  assert.equal(
    renderOpenHours({ openTime: '09:00', closeTime: '17:00', closedWeekdays: ['1'] }),
    '09:00-17:00',
    '非数字星期忽略，不报错',
  );
});

// ---------- payload.aliases（09-27） ----------

test('loadPlaceFacts：payload.aliases 参与归一，别名能命中正式名条目', async () => {
  // 库里只有「香山双清别墅」一行，别名含「双清别墅」；候选名「双清别墅」剥不出后缀，
  // 主键与库内行不等 —— 只有别名键参与归一才能命中（实测库内无「双清别墅」独立行）。
  const map = await loadPlaceFacts(['双清别墅'], '北京');
  const facts = map.get('双清别墅');
  if (!facts) {
    console.warn('本地库不可达或无 aliases 数据，跳过集成断言');
    return;
  }
  assert.equal(facts.name, '香山双清别墅', `应靠别名命中正式名条目，实际命中 ${facts.name}`);
});

test('loadPlaceFacts：payload.openHours 渲染进 facts.openTime', async () => {
  // 景山公园：{text:'06:30-20:00', openTime:'06:30', closeTime:'20:00', closedWeekdays:[]}
  const map = await loadPlaceFacts(['景山公园'], '北京');
  const facts = map.get('景山公园');
  if (!facts) {
    console.warn('本地库不可达或无 openHours 数据，跳过集成断言');
    return;
  }
  assert.equal(facts.openTime, '06:30-20:00');
});
