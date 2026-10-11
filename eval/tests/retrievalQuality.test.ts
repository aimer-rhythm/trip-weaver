import assert from 'node:assert/strict';
import test from 'node:test';
import { literalCoverage, realAliases, recallMetrics, renderRetrievalQuality, retrievalQualityReport,
  type PlaceCoverageRow, type RecallCase } from '../retrievalQuality';

const row = (over: Partial<PlaceCoverageRow> & Pick<PlaceCoverageRow, 'id' | 'name'>): PlaceCoverageRow => ({
  city: '北京', category: '文化', source: 'xhs', payload: {}, hasEvidence: false, ...over });

test('只填充主名本身的 aliases 数组不算真别名', () => {
  assert.deepEqual(realAliases(row({ id: 'a', name: '故宫博物院', payload: { aliases: ['故宫博物院'] } })), []);
  assert.deepEqual(realAliases(row({ id: 'b', name: '故宫博物院', payload: { aliases: ['故宫博物院', '紫禁城'] } })), ['紫禁城']);
  assert.deepEqual(realAliases(row({ id: 'c', name: '天坛', payload: { aliases: [' ', null, 1, ' 天坛 '] } })), []);
  assert.deepEqual(realAliases(row({ id: 'd', name: '天坛', payload: null })), []);
  assert.deepEqual(realAliases(row({ id: 'e', name: ' 天坛 ', payload: { aliases: ['天坛'] } })), []);
});

test('字面层覆盖区分真别名与字段填充，并按城市与同城同名分组', () => {
  const rows = [
    row({ id: '1', name: '故宫博物院', payload: { aliases: ['故宫博物院', '紫禁城'], themes: ['历史'] }, hasEvidence: true }),
    row({ id: '2', name: '天坛', payload: { aliases: ['天坛'] } }),
    row({ id: '3', name: '西湖', city: '杭州', payload: { themes: ['自然'] }, hasEvidence: true }),
    row({ id: '4', name: '同名', city: '杭州' }),
    row({ id: '5', name: '同名', city: '杭州' }),
  ];
  const coverage = literalCoverage(rows);
  assert.equal(coverage.total, 5);
  assert.equal(coverage.withRealAlias, 1, '只有故宫有除主名外的写法');
  assert.equal(coverage.withThemes, 2);
  assert.equal(coverage.withEvidence, 2);
  assert.equal(coverage.duplicateNameGroups, 1);
  assert.equal(coverage.duplicateNameRows, 2);
  assert.deepEqual(coverage.byCity.map((city) => city.city), ['杭州', '北京']);
  assert.deepEqual(coverage.byCity.find((city) => city.city === '北京'),
    { city: '北京', total: 2, withRealAlias: 1, withThemes: 1, withEvidence: 1 });
  assert.match(coverage.method, /真别名/);
});

test('召回分母是实际执行的 query 数，命中按返回实体的规范实体 ID 判定', () => {
  const cases: RecallCase[] = [
    { city: '北京', query: '紫禁城', expectId: 'p1', expectName: '故宫博物院', hitGroups: [['p1']], actualNames: ['故宫博物院'] },
    // 目标以成员行身份出现在合并实体里，排位不是第一
    { city: '北京', query: '天坛', expectId: 'member', expectName: '天坛', hitGroups: [['other'], ['root', 'member']], actualNames: ['其他', '天坛公园'] },
    // 排位恰好超出 depth
    { city: '杭州', query: '西湖', expectId: 'p3', expectName: '西湖',
      hitGroups: Array.from({ length: 9 }, (_, index) => [`x${index}`]), actualNames: [] },
    { city: '杭州', query: '灵隐寺', expectId: 'p4', expectName: '灵隐寺', hitGroups: [], actualNames: [] },
  ];
  const metrics = recallMetrics(cases, 8);
  assert.equal(metrics.total, 4, '分母是 query 数，不是被跳过的样本行数');
  assert.equal(metrics.depth, 8);
  assert.equal(metrics.at1, 1);
  assert.equal(metrics.atDepth, 2);
  assert.deepEqual(metrics.misses.map((miss) => miss.query), ['西湖', '灵隐寺']);
  assert.deepEqual(metrics.misses[1], { city: '杭州', query: '灵隐寺', expectName: '灵隐寺', actualNames: [] });
  assert.deepEqual(metrics.byCity.find((city) => city.city === '杭州'), { city: '杭州', total: 2, at1: 0, atDepth: 0 });
  assert.match(metrics.method, /分母是实际执行的 query 数/);
});

test('depth 变化同时限制命中范围与报告标注', () => {
  const cases: RecallCase[] = [
    { city: '北京', query: 'a', expectId: 'p1', expectName: 'n', hitGroups: [['p1']], actualNames: ['n'] },
    { city: '北京', query: 'b', expectId: 'p2', expectName: 'n', hitGroups: [['x'], ['p2']], actualNames: ['x', 'n'] },
  ];
  const metrics = recallMetrics(cases, 1);
  assert.equal(metrics.at1, 1);
  assert.equal(metrics.atDepth, 1, '排位 1 超出 depth=1，不计命中');
  assert.equal(metrics.misses.length, 1);
  assert.match(renderRetrievalQuality(retrievalQualityReport([], cases, 1)), /Recall@1/);
});

test('人读摘要给出覆盖率、召回率与未命中清单', () => {
  const rows = [row({ id: '1', name: '故宫博物院', payload: { aliases: ['紫禁城'] } }), row({ id: '2', name: '天坛' })];
  const cases: RecallCase[] = [{ city: '北京', query: '紫禁城', expectId: 'other', expectName: '故宫博物院', hitGroups: [], actualNames: [] }];
  const text = renderRetrievalQuality(retrievalQualityReport(rows, cases));
  assert.match(text, /真别名\s+1\s+50\.0%/);
  assert.match(text, /Recall@1\s+0\.0%/);
  assert.match(text, /Recall@8\s+0\.0%/);
  assert.match(text, /未命中 1 条/);
  assert.match(text, /「紫禁城」→ 期望「故宫博物院」，实得 \(空\)/);
});
