import assert from 'node:assert/strict';
import test from 'node:test';
import type { ResearchPoi } from '@tripweaver/shared';
import { activityPlaceName, createResearchPlaceLookup, rememberResearchLocation, type ResearchLocation } from '../generation/placeLookup';
import { buildResearchTools, type ResearchOutcome } from '../generation/tools/researchTools';
import type { AmapPoi, PoiSource } from '../integrations/amap/poiSource';

const point: ResearchLocation = { lat: 39.9, lng: 116.4, adcode: '110101' };
const candidate: ResearchPoi = { id: 'museum', name: '真实博物馆', category: 'attraction', intro: '', reservation: 'unknown', sourceLinks: [] };

test('定位名兼容旧餐次文案，并优先使用显式片区', () => {
  assert.equal(activityPlaceName({ name: '午餐｜春熙路 · 川菜' }), '春熙路');
  assert.equal(activityPlaceName({ name: ' 晚饭 | 南京东路 • 本帮菜 ' }), '南京东路');
  assert.equal(activityPlaceName({ name: '午餐｜景区周边 · 当地菜', placeName: ' 人民广场 ' }), '人民广场');
  assert.equal(activityPlaceName({ name: '国家博物馆（含午餐安排）' }), '国家博物馆（含午餐安排）');
  assert.equal(activityPlaceName({ name: 'Café · Museum' }), 'Café · Museum', '非餐次地点不得按标点截断');
});

test('候选 ID 和唯一地名复用同一个真实位置，未知引用保留正常查询路径', () => {
  const lookup = createResearchPlaceLookup([candidate], new Map([[candidate.name, point]]));
  assert.deepEqual(lookup({ name: '上午参观', poiId: candidate.id }), { name: candidate.name, point });
  assert.deepEqual(lookup({ name: ` ${candidate.name} ` }), { name: candidate.name, point });
  assert.deepEqual(lookup({ name: '新的公园', poiId: 'unknown' }), { name: '新的公园' });
  assert.deepEqual(lookup({ name: '午餐', poiId: candidate.id, placeName: '另一片区' }), { name: '另一片区' });
});

test('同名不同坐标不复用，后续重复结果不能覆盖已知歧义', () => {
  const locations = new Map<string, ResearchLocation>();
  const ambiguous = new Set<string>();
  rememberResearchLocation(locations, ambiguous, '同名公园', point);
  rememberResearchLocation(locations, ambiguous, '同名公园', { ...point, lng: 117 });
  rememberResearchLocation(locations, ambiguous, '同名公园', point);
  assert.equal(locations.has('同名公园'), false);
  assert.equal(ambiguous.has('同名公园'), true);
});

test('无效坐标不能进入复用索引，相同点可补充缺失的行政区划码', () => {
  const locations = new Map<string, ResearchLocation>();
  const ambiguous = new Set<string>();
  rememberResearchLocation(locations, ambiguous, '甲', { ...point, adcode: '' });
  rememberResearchLocation(locations, ambiguous, '甲', point);
  rememberResearchLocation(locations, ambiguous, '乙', { ...point, lat: Number.NaN });
  rememberResearchLocation(locations, ambiguous, '丙', { ...point, lng: 181 });
  assert.deepEqual(locations.get('甲'), point);
  assert.equal(locations.size, 1);
  const lookup = createResearchPlaceLookup([], new Map([['越界', { ...point, lat: 91 }]]));
  assert.deepEqual(lookup({ name: '越界' }), { name: '越界' });
});

test('调研工具旁路保留 adcode，公开候选不包含原始坐标', async () => {
  const poi: AmapPoi = { name: candidate.name, type: '博物馆', address: '', rating: '', cost: '', opentime: '', photoUrls: [], location: point, adcode: point.adcode };
  const source: PoiSource = {
    kind: 'amap',
    searchPois: async () => [poi],
    selfCheck: async () => ({ configured: true, checked: true, ok: true, message: '' }),
  };
  const outcome: ResearchOutcome = { summary: '', pool: [], locations: new Map() };
  const tools = buildResearchTools({
    poiSource: source,
    searchSource: { kind: 'null', search: async () => [], selfCheck: source.selfCheck },
    destination: '北京',
    searchWebMax: 2,
    outcome,
  });
  const search = tools.find((tool) => tool.name === 'search_pois')!;
  const add = tools.find((tool) => tool.name === 'add_candidate')!;
  await search.execute('search', { category: 'attraction', keyword: '博物馆' });
  await add.execute('add', { name: candidate.name, category: 'attraction', intro: '实地候选' });
  assert.deepEqual(outcome.locations.get(candidate.name), point);
  assert.equal(outcome.pool.length, 1);
  assert.equal('location' in outcome.pool[0]!, false);
  assert.equal('adcode' in outcome.pool[0]!, false);
});

test('add_candidate 自动回填高德营业时间（仅 attraction），模型无需转抄', async () => {
  const withHours: AmapPoi = {
    name: '周一闭馆馆', type: '博物馆', address: '', rating: '', cost: '',
    opentime: '09:00-17:00；周一闭馆', photoUrls: [], location: point, adcode: point.adcode,
  };
  const foodWithHours: AmapPoi = {
    name: '营业面馆', type: '餐饮', address: '', rating: '', cost: '',
    opentime: '10:00-22:00', photoUrls: [], location: point, adcode: point.adcode,
  };
  const source: PoiSource = {
    kind: 'amap',
    searchPois: async () => [withHours, foodWithHours],
    selfCheck: async () => ({ configured: true, checked: true, ok: true, message: '' }),
  };
  const outcome: ResearchOutcome = { summary: '', pool: [], locations: new Map() };
  const tools = buildResearchTools({
    poiSource: source,
    searchSource: { kind: 'null', search: async () => [], selfCheck: source.selfCheck },
    destination: '北京',
    searchWebMax: 2,
    outcome,
  });
  const search = tools.find((tool) => tool.name === 'search_pois')!;
  const add = tools.find((tool) => tool.name === 'add_candidate')!;
  await search.execute('search', { category: 'attraction', keyword: '博物馆' });

  // attraction 同名命中 → 回填
  await add.execute('add1', { name: '周一闭馆馆', category: 'attraction', intro: '实地候选' });
  assert.equal(outcome.pool[0]!.openTime, '09:00-17:00；周一闭馆');

  // food 同名命中 → 不回填（餐饮营业时段不参与闭馆日检测）
  await add.execute('add2', { name: '营业面馆', category: 'food', intro: '同名餐饮' });
  assert.equal(outcome.pool[1]!.openTime, undefined);

  // 未经过 search_pois 的点 → 无数据可回填
  await add.execute('add3', { name: '纯知识候选', category: 'attraction', intro: '模型知识' });
  assert.equal(outcome.pool[2]!.openTime, undefined);
});
