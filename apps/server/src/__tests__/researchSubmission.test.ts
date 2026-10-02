import assert from 'node:assert/strict';
import { after, mock, test } from 'node:test';
import { MAX_OVERVIEW_POIS, type ResearchPoi } from '@tripweaver/shared';
import { pool } from '../db/client';
import { buildResearchTools, type ResearchOutcome, type ResearchToolDeps } from '../generation/tools/researchTools';
import type { RetrievedPlace } from '../generation/placeRetrieval';
import { renderRetrievedPlaces } from '../generation/researchContext';
import { getNullPoiSource } from '../integrations/nullPoiSource';
import { getNullSearchSource } from '../integrations/websearch/searchSource';

after(() => pool.end());
const place = (id: string, overrides: Partial<RetrievedPlace> = {}): RetrievedPlace => ({
  id, name: `测试公园${id}`, city: '北京', category: '自然', verified: true, source: 'xhs',
  lat: 39.9, lng: 116.4, aliases: [], payload: {}, evidence: [], ...overrides,
});
function setup(places: RetrievedPlace[], extra: Partial<ResearchToolDeps> = {}) {
  const outcome: ResearchOutcome = { pool: [], summary: '', locations: new Map() };
  const published: ResearchPoi[] = [];
  const tools = buildResearchTools({ destination: '北京', verifiedPlaces: places, outcome,
    poiSource: getNullPoiSource(), searchSource: getNullSearchSource(), searchWebMax: 2,
    reviewedCover: async () => null, onCandidate: (poi) => published.push(poi), ...extra });
  return { outcome, published, submit: tools.find((t) => t.name === 'submit_research')!, add: tools.find((t) => t.name === 'add_candidate')! };
}

test('一批提交只需ID与简介，复用事实/照片/官方来源并逐条发布，无重复查库', async () => {
  const places = [place('palace', { name: '故宫博物院', payload: { reservation: 'none', reservationNote: '不能覆盖官方种子' } }),
    place('park', { payload: { openHours: { closedWeekdays: [1] } }, evidence: [
      { kind: 'xhs_reservation', content: '旺季可能需预约', strength: 'risk_only', sourceUrl: 'https://example.com/note' },
    ] }), place('free', { payload: { reservation: 'none', reservationNote: '现场入园' } }),
    place('booking', { payload: { reservation: 'required', reservationNote: '请先预约' } })];
  const { submit, outcome, published } = setup(places, { reviewedCover: async () => ({ coverUrl: '/media/test.webp' }) });
  const query = mock.method(pool, 'query', () => { throw new Error('已知候选不应查询数据库'); });
  try {
    const result = await submit.execute('batch', { candidates: places.map((p) => ({ placeId: p.id, intro: `${p.name}漫步参观。` })) });
    assert.equal(result.terminate, true);
    assert.equal(outcome.pool.length, 4);
    assert.deepEqual(published, outcome.pool);
    assert.equal(outcome.pool[0]?.reservation, 'required');
    assert.notEqual(outcome.pool[0]?.reservationNote, '不能覆盖官方种子');
    assert.match(outcome.pool[0]!.sourceLinks[0]!.url, /dpm.org.cn/);
    assert.equal(outcome.pool[1]?.reservation, 'unknown', '风险证据不能升级成确定预约政策');
    assert.equal(outcome.pool[1]?.sourceLinks[0]?.url, 'https://example.com/note');
    assert.equal(outcome.pool[1]?.coverUrl, '/media/test.webp');
    assert.match(outcome.pool[1]!.openTime!, /周一闭馆/);
    assert.equal(outcome.pool[2]?.reservation, 'none');
    assert.equal(outcome.pool[2]?.reservationNote, '现场入园');
    assert.equal(outcome.pool[3]?.reservation, 'required');
    assert.equal(outcome.pool[3]?.reservationNote, '请先预约');
    assert.equal(outcome.locations.size, 4);
    assert.equal(query.mock.callCount(), 0);
    const rendered = renderRetrievedPlaces(places);
    assert.match(rendered, /仅风险/);
    assert.ok(!rendered.includes('https://'), '来源仍在catalog中，提示无需重复URL');
  } finally { query.mock.restore(); }
});

test('整批验证：错误ID、跨城、未验证、酒店、禁用美食或空简介均不部分写入', async () => {
  const cases = [
    { bad: place('bad', { city: '杭州' }) },
    { bad: place('bad', { verified: false }) },
    { bad: place('bad', { category: '住宿' }) },
    { bad: place('bad', { category: '美食' }) },
    { bad: place('bad'), id: 'missing' },
    { bad: place('bad'), intro: '   ' },
  ];
  for (const sample of cases) {
    let coverCalls = 0;
    const { submit, outcome, published } = setup([place('good'), sample.bad], {
      foodSearch: false, reviewedCover: async () => { coverCalls++; return null; },
    });
    const result = await submit.execute('bad-batch', { candidates: [
      { placeId: 'good', intro: '公园漫步' }, { placeId: sample.id ?? 'bad', intro: sample.intro ?? '参观' },
    ] });
    assert.equal(result.details.ok, false);
    assert.notEqual(result.terminate, true);
    assert.equal(outcome.pool.length, 0);
    assert.equal(published.length, 0);
    assert.equal(coverCalls, 0);
    assert.equal(outcome.summary, '');
  }
});

test('批次入池与SSE优先复用上游完整介绍，冲突预约与官方种子各自处理', async () => {
  const places = [
    place('temple', { name: '天坛公园', payload: { reservation: 'required', reservationNote: '天坛公园无需预约' } }),
    place('lane', { name: '烟袋斜街', payload: { reservation: 'required', reservationNote: '烟袋斜街无需预约' } }),
    place('jingshan', { name: '景山公园', payload: { reservation: 'required', reservationNote: '景山公园' } }),
    place('palace', { name: '故宫博物院', payload: { reservation: 'required', reservationNote: '无需预约' } }),
  ];
  const { submit, outcome, published } = setup(places);
  for (const p of places) p.payload = { ...p.payload,
    content: { version: 1, intro: `${p.name}可漫步参观，留意建筑与园林景观。出发前以官方预约信息为准。`,
      highlights: [{ sourceUrl: 'https://example.com/place-introduction' }] } };
  await submit.execute('quality', { candidates: places.map((p) => ({ placeId: p.id,
    intro: `${p.name}可漫步参观，门票2元，法物流通处已关闭。` })) });
  assert.equal(outcome.pool.length, 4);
  assert.deepEqual(published, outcome.pool);
  assert.deepEqual(outcome.pool.slice(0, 3).map((p) => p.reservation), ['unknown', 'unknown', 'unknown']);
  assert.match(outcome.pool[0]!.reservationNote!, /冲突/);
  assert.equal(outcome.pool[3]!.reservation, 'required');
  assert.match(outcome.pool[3]!.sourceLinks[0]!.url, /dpm.org.cn/);
  for (const poi of published) {
    assert.equal(poi.intro, `${poi.name}可漫步参观，留意建筑与园林景观。出发前以官方预约信息为准。`);
    assert.ok(poi.sourceLinks.some((s) => s.url === 'https://example.com/place-introduction'));
  }
});

test('重复ID、同名与已入池候选幂等去重，空池不得提交', async () => {
  const original = place('original');
  const { submit, add, outcome, published } = setup([original, place('same-name', { name: original.name }), place('another')]);
  assert.equal((await submit.execute('empty', {})).details.ok, false);
  await add.execute('legacy', { placeId: original.id, name: original.name, category: 'attraction', intro: '已写入的简介' });
  const params = { candidates: ['original', 'same-name', 'another', 'another'].map((placeId) => ({ placeId, intro: '新简介' })) };
  assert.equal((await submit.execute('batch', params)).terminate, true);
  assert.equal((await submit.execute('retry', params)).terminate, true);
  assert.equal(outcome.pool.length, 2);
  assert.equal(published.length, 2);
  assert.equal(outcome.pool[0]?.intro, '已写入的简介');
  assert.equal((await submit.execute('legacy-submit', { summary: '兼容原有提交' })).terminate, true);
});

test('容量按整个池校验，超量不半批写入；允许美食偏好候选', async () => {
  const places = Array.from({ length: MAX_OVERVIEW_POIS + 1 }, (_, i) => place(String(i)));
  const { submit, outcome } = setup(places);
  outcome.pool.push({ id: 'existing', name: '已存在', category: 'attraction', intro: '说明', reservation: 'unknown', sourceLinks: [] });
  const result = await submit.execute('overflow', { candidates: places.slice(0, MAX_OVERVIEW_POIS).map((p) => ({ placeId: p.id, intro: '参观' })) });
  assert.equal(result.details.ok, false);
  assert.equal(outcome.pool.length, 1);
  const food = setup([place('food', { category: '美食' })], { foodSearch: true });
  assert.equal((await food.submit.execute('food', { candidates: [{ placeId: 'food', intro: '当地菜系' }] })).terminate, true);
  assert.equal(food.outcome.pool[0]?.category, 'food');
});

test('批次取消：等待照片期间不发布候选；条目之间取消不继续执行或提交摘要', async () => {
  const controller = new AbortController();
  const first = setup([place('one')], { signal: controller.signal, reviewedCover: async () => { controller.abort(); return null; } });
  await assert.rejects(first.submit.execute('abort-cover', { candidates: [{ placeId: 'one', intro: '参观' }] }), { name: 'AbortError' });
  assert.equal(first.outcome.pool.length, 0);
  const between = new AbortController();
  let calls = 0;
  const second = setup([place('one'), place('two')], { signal: between.signal,
    reviewedCover: async () => { calls++; return null; }, onCandidate: () => between.abort() });
  await assert.rejects(second.submit.execute('abort-between', { candidates: ['one', 'two'].map((placeId) => ({ placeId, intro: '参观' })) }), { name: 'AbortError' });
  assert.equal(calls, 1);
  assert.equal(second.outcome.pool.length, 1);
  assert.equal(second.outcome.summary, '');
});
