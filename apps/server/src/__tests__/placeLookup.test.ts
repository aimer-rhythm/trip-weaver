import assert from 'node:assert/strict';
import test from 'node:test';
import type { ResearchPoi } from '@tripweaver/shared';
import { activityPlaceName, createResearchPlaceLookup, rememberResearchLocation, type ResearchLocation } from '../generation/placeLookup';
import { buildResearchTools, type ResearchOutcome } from '../generation/tools/researchTools';
import type { PoiSource, SourcedPoi } from '../integrations/geoContracts';
import type { CoverLookup } from '../integrations/wikimedia/cover';

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
  const poi: SourcedPoi = { name: candidate.name, type: '博物馆', address: '', rating: '', cost: '', opentime: '', photoUrls: [], location: point, adcode: point.adcode };
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
  const withHours: SourcedPoi = {
    name: '周一闭馆馆', type: '博物馆', address: '', rating: '', cost: '',
    opentime: '09:00-17:00；周一闭馆', photoUrls: [], location: point, adcode: point.adcode,
  };
  const foodWithHours: SourcedPoi = {
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

const WIKI_THUMB = 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a7/example.jpg/500px-example.jpg';

function recordingCover(): { lookup: CoverLookup; queries: string[] } {
  const queries: string[] = [];
  return {
    queries,
    lookup: {
      coverFor: async (query) => {
        queries.push(query.name);
        return WIKI_THUMB;
      },
    },
  };
}

test('景点封面：库内无图且有坐标时查维基，美食不查，库内有图不再查', async () => {
  const poi: SourcedPoi = {
    name: '故宫博物院', type: '博物馆', address: '', rating: '', cost: '',
    opentime: '', photoUrls: [], location: point, adcode: point.adcode,
  };
  const source: PoiSource = {
    kind: 'amap',
    searchPois: async () => [poi],
    selfCheck: async () => ({ configured: true, checked: true, ok: true, message: '' }),
  };
  const outcome: ResearchOutcome = { summary: '', pool: [], locations: new Map() };
  const cover = recordingCover();
  const tools = buildResearchTools({
    poiSource: source,
    searchSource: { kind: 'null', search: async () => [], selfCheck: source.selfCheck },
    destination: '北京',
    searchWebMax: 2,
    outcome,
    coverLookup: cover.lookup,
    storedCover: async (name) => (name === '天坛' ? 'https://example.com/stored.jpg' : null),
  });
  const search = tools.find((tool) => tool.name === 'search_pois')!;
  const add = tools.find((tool) => tool.name === 'add_candidate')!;
  await search.execute('search', { category: 'attraction', keyword: '故宫' });

  await add.execute('a', { name: '故宫', category: 'attraction', intro: '中轴线' });
  assert.equal(outcome.pool[0]!.coverUrl, WIKI_THUMB, '归一后「故宫」对上「故宫博物院」的坐标');

  await add.execute('b', { name: '美食街', category: 'food', intro: '吃饭' });
  assert.equal(outcome.pool[1]!.coverUrl, undefined, '非景点不查');

  await add.execute('c', { name: '天坛', category: 'attraction', intro: '祈年殿' });
  assert.equal(outcome.pool[2]!.coverUrl, 'https://example.com/stored.jpg', '库内有图直接用');

  assert.deepEqual(cover.queries, ['故宫'], '只有缺图的景点触发了一次检索');
});

test('景点封面：库内相对路径（/media/...）也是合法封面，不再查维基', async () => {
  const poi: SourcedPoi = {
    name: '故宫博物院', type: '博物馆', address: '', rating: '', cost: '',
    opentime: '', photoUrls: [], location: point, adcode: point.adcode,
  };
  const source: PoiSource = {
    kind: 'amap',
    searchPois: async () => [poi],
    selfCheck: async () => ({ configured: true, checked: true, ok: true, message: '' }),
  };
  const outcome: ResearchOutcome = { summary: '', pool: [], locations: new Map() };
  const cover = recordingCover();
  const media = '/media/xhs/北京/8f3a1b/00.webp';
  const tools = buildResearchTools({
    poiSource: source,
    searchSource: { kind: 'null', search: async () => [], selfCheck: source.selfCheck },
    destination: '北京',
    searchWebMax: 2,
    outcome,
    coverLookup: cover.lookup,
    storedCover: async (name) => (name === '故宫' ? media : null),
  });
  const search = tools.find((tool) => tool.name === 'search_pois')!;
  const add = tools.find((tool) => tool.name === 'add_candidate')!;
  await search.execute('search', { category: 'attraction', keyword: '故宫' });
  await add.execute('a', { name: '故宫', category: 'attraction', intro: '中轴线' });

  assert.equal(outcome.pool[0]!.coverUrl, media, '站内相对 URL 必须被接受（库内封面默认就是同源路径）');
  assert.deepEqual(cover.queries, [], '库内命中不该触发维基请求');
});

// ---------- 封面来源顺序（09-27）：上游图库 → Pexels → 高德 → 维基 ----------

const testPoi: SourcedPoi = {
  name: '故宫博物院', type: '博物馆', address: '', rating: '', cost: '',
  opentime: '', photoUrls: [], location: point, adcode: point.adcode,
};

function coverTools(deps: {
  stored?: string | null;
  pexels?: string | null;
  amap?: string | null;
  onStored?: () => void;
  onPexels?: () => void;
  onAmap?: () => void;
}) {
  const source: PoiSource = {
    kind: 'amap',
    searchPois: async () => [testPoi],
    selfCheck: async () => ({ configured: true, checked: true, ok: true, message: '' }),
  };
  const outcome: ResearchOutcome = { summary: '', pool: [], locations: new Map() };
  const cover = recordingCover();
  const tools = buildResearchTools({
    poiSource: source,
    searchSource: { kind: 'null', search: async () => [], selfCheck: source.selfCheck },
    destination: '北京',
    searchWebMax: 2,
    outcome,
    coverLookup: cover.lookup,
    pexelsCover: { coverFor: async () => { deps.onPexels?.(); return deps.pexels ?? null; } },
    storedCover: async () => { deps.onStored?.(); return deps.stored ?? null; },
    amapPhotos: { coverFor: async () => { deps.onAmap?.(); return deps.amap ?? null; }, calls: 0 },
  });
  return { tools, outcome, cover };
}

async function addFirst(tools: ReturnType<typeof coverTools>['tools'], outcome: ResearchOutcome) {
  const search = tools.find((tool) => tool.name === 'search_pois')!;
  const add = tools.find((tool) => tool.name === 'add_candidate')!;
  await search.execute('search', { category: 'attraction', keyword: '故宫' });
  await add.execute('a', { name: '故宫', category: 'attraction', intro: '中轴线' });
  return outcome.pool[0]!.coverUrl;
}

test('封面顺序：上游图库命中即短路，不查 Pexels 与高德', async () => {
  const calls: string[] = [];
  const { tools, outcome, cover } = coverTools({
    stored: '/media/xhs/北京/8f3a/00.webp',
    onStored: () => calls.push('stored'),
    onPexels: () => calls.push('pexels'),
    onAmap: () => calls.push('amap'),
  });
  assert.equal(await addFirst(tools, outcome), '/media/xhs/北京/8f3a/00.webp');
  assert.deepEqual(calls, ['stored'], '上游图库是最前一级');
  assert.deepEqual(cover.queries, []);
});

test('封面顺序：上游无图时查 Pexels，命中即不再查高德', async () => {
  const pexelsUrl = 'https://images.pexels.com/photos/1/a.jpeg?h=350';
  const calls: string[] = [];
  const { tools, outcome, cover } = coverTools({
    stored: null,
    pexels: pexelsUrl,
    onStored: () => calls.push('stored'),
    onPexels: () => calls.push('pexels'),
    onAmap: () => calls.push('amap'),
  });
  assert.equal(await addFirst(tools, outcome), pexelsUrl);
  assert.deepEqual(calls, ['stored', 'pexels'], 'Pexels 命中后不再打高德');
  assert.deepEqual(cover.queries, []);
});

test('封面顺序：前两级都无图时用高德，且不再查维基', async () => {
  const amapUrl = 'https://store.is.autonavi.com/showpic/78e3e7b4';
  const calls: string[] = [];
  const { tools, outcome, cover } = coverTools({
    stored: null,
    pexels: null,
    amap: amapUrl,
    onStored: () => calls.push('stored'),
    onPexels: () => calls.push('pexels'),
    onAmap: () => calls.push('amap'),
  });
  assert.equal(await addFirst(tools, outcome), amapUrl);
  assert.deepEqual(calls, ['stored', 'pexels', 'amap']);
  assert.deepEqual(cover.queries, [], '高德命中后不再查维基');
});
