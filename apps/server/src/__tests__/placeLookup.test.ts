import assert from 'node:assert/strict';
import test from 'node:test';
import type { ResearchPoi } from '@tripweaver/shared';
import { activityPlaceName, createResearchPlaceLookup, rememberResearchLocation, type ResearchLocation } from '../generation/placeLookup';
import { buildResearchTools, type ResearchOutcome } from '../generation/tools/researchTools';
import type { PoiSource, SourcedPoi } from '../integrations/geoContracts';
import type { CoverLookup } from '../integrations/wikimedia/cover';
import type { StockPhotoLookup } from '../integrations/stockPhotoSupport';

const point: ResearchLocation = { lat: 39.9, lng: 116.4, adcode: '110101' };
const candidate: ResearchPoi = { id: 'museum', name: '真实博物馆', category: 'attraction', intro: '', reservation: 'unknown', sourceLinks: [] };

test('正式新版选图入口：命中传递三图，缺图与失败均不能调用旧来源', async () => {
  const source: PoiSource = { kind: 'null', searchPois: async () => [], selfCheck: async () => ({ configured: false, checked: false, ok: true, message: '' }) };
  let legacyCalls = 0;
  const legacy = async () => { legacyCalls++; return null; };
  for (const mode of ['hit', 'missing', 'failed'] as const) {
    const outcome: ResearchOutcome = { summary: '', pool: [], locations: new Map() };
    const photos = [{ url: '/media/reviewed-a.webp' }, { url: '/media/reviewed-b.webp' }];
    const tools = buildResearchTools({ poiSource: source, searchSource: { kind: 'null', search: async () => [], selfCheck: source.selfCheck }, destination: '北京', searchWebMax: 2, outcome,
      reviewedCover: async () => { if (mode === 'failed') throw new Error('unavailable'); return mode === 'hit' ? { coverUrl: photos[0]!.url, photos } : null; },
      curatedCover: legacy, storedCover: legacy, pexelsCover: { coverFor: legacy }, amapPhotos: { coverFor: legacy, calls: 0 },
    });
    await tools.find(t => t.name === 'add_candidate')!.execute(mode, { name: candidate.name, category: 'attraction', intro: '' });
    assert.equal(outcome.pool[0]?.coverUrl, mode === 'hit' ? photos[0]!.url : undefined);
    assert.deepEqual(outcome.pool[0]?.photos, mode === 'hit' ? photos : undefined);
  }
  assert.equal(legacyCalls, 0);
});

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

const WIKI_THUMB = '/media/wikimedia/abc123.jpg';

test('精选封面优先并保留署名，精选服务故障继续已有封面路径', async () => {
  const outcome: ResearchOutcome = { summary: '', pool: [], locations: new Map() };
  let storedCalls = 0;
  const attribution: NonNullable<ResearchPoi['coverAttribution']> = {
    source: 'commons', photographer: '摄影师', sourceUrl: 'https://commons.wikimedia.org/wiki/File:Bridge.jpg',
    license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', changes: '已调整尺寸与裁切',
  };
  const tools = buildResearchTools({
    poiSource: { kind: 'null', searchPois: async () => [], selfCheck: async () => ({ configured: false, checked: false, ok: false, message: '' }) },
    searchSource: { kind: 'null', search: async () => [], selfCheck: async () => ({ configured: false, checked: false, ok: false, message: '' }) },
    destination: '杭州', searchWebMax: 0, outcome,
    curatedCover: async name => { if (name === '苏堤') throw new Error('optional failure'); return { coverUrl: '/media/photography/commons-1.webp', coverAttribution: attribution, photos: [{ url: '/media/photography/commons-1.webp', attribution }, { url: '/media/photography/commons-2.webp', attribution }] }; },
    storedCover: async () => { storedCalls++; return '/media/xhs/fallback.webp'; },
  });
  const add = tools.find(tool => tool.name === 'add_candidate')!;
  await add.execute('one', { name: '断桥残雪', category: 'attraction', intro: '' });
  assert.equal(storedCalls, 0);
  assert.deepEqual(outcome.pool[0]?.coverAttribution, attribution);
  assert.equal(outcome.pool[0]?.photos?.length, 2, '照片组随候选快照输出，封面包含在内');
  await add.execute('two', { name: '苏堤', category: 'attraction', intro: '' });
  assert.equal(storedCalls, 1);
  assert.equal(outcome.pool[1]?.coverUrl, '/media/xhs/fallback.webp');
  assert.equal(outcome.pool[1]?.coverAttribution, undefined);
});

test('已保存的外链照片优先于所有新搜索，文件缺失也不自动重选', async () => {
  for (const provider of ['pexels', 'wikimedia'] as const) {
    for (const missing of [false, true]) {
      const photos = missing ? [] : [{ url: `/media/${provider === 'pexels' ? 'remote-photos' : 'wikimedia'}/saved.jpg` }];
      const outcome: ResearchOutcome = { summary: '', pool: [], locations: new Map([[candidate.name, point]]) };
      const noSearch = async (): Promise<never> => { assert.fail('已保存的地点不得重新检索图源'); };
      let reads = 0;
      const tools = buildResearchTools({
        poiSource: { kind: 'null', searchPois: async () => [], selfCheck: noSearch },
        searchSource: { kind: 'null', search: async () => [], selfCheck: noSearch },
        destination: '北京', searchWebMax: 0, outcome,
        pexelsCover: {
          cachedPhotosFor: async () => provider === 'pexels' ? (reads++, photos) : null,
          photosFor: noSearch, coverFor: noSearch,
        },
        coverLookup: {
          cachedPhotosFor: async query => {
            assert.deepEqual(query, { name: candidate.name, city: '北京', lat: point.lat, lng: point.lng });
            reads++;
            return photos;
          },
          coverFor: noSearch,
        },
        amapPhotos: { coverFor: noSearch, calls: 0 },
        storedAmapPhoto: noSearch,
      });
      await tools.find(tool => tool.name === 'add_candidate')!.execute('saved', { name: candidate.name, category: 'attraction', intro: '' });
      assert.equal(reads, 1);
      assert.equal(outcome.pool[0]?.coverUrl, photos[0]?.url);
      assert.deepEqual(outcome.pool[0]?.photos, missing ? undefined : photos);
    }
  }
});

function recordingCover(url: string | null = WIKI_THUMB): { lookup: CoverLookup; queries: string[] } {
  const queries: string[] = [];
  return {
    queries,
    lookup: {
      coverFor: async (query) => {
        queries.push(query.name);
        return url;
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

test('景点封面：外部图源未命中时接受库内相对路径（/media/...）', async () => {
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
  const cover = recordingCover(null);
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
  assert.deepEqual(cover.queries, ['故宫'], '先检索 Commons，未命中时回退小红书图库');
});

// ---------- 封面来源顺序：Pexels → Pixabay → Unsplash → Commons → 小红书图库 → 高德 ----------

const testPoi: SourcedPoi = {
  name: '故宫博物院', type: '博物馆', address: '', rating: '', cost: '',
  opentime: '', photoUrls: [], location: point, adcode: point.adcode,
};

function coverTools(deps: {
  stored?: string | null;
  pexels?: string | null;
  wiki?: string | null;
  amap?: string | null;
  /** 库内已回写的高德图 */
  cachedAmap?: string | null;
  onStored?: () => void;
  onPexels?: () => void;
  onAmap?: () => void;
  /** 回写记录（`name|url`） */
  saved?: string[];
}) {
  const source: PoiSource = {
    kind: 'amap',
    searchPois: async () => [testPoi],
    selfCheck: async () => ({ configured: true, checked: true, ok: true, message: '' }),
  };
  const outcome: ResearchOutcome = { summary: '', pool: [], locations: new Map() };
  const cover = recordingCover(deps.wiki ?? null);
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
    storedAmapPhoto: async () => deps.cachedAmap ?? null,
    saveAmapPhoto: (name, url) => {
      deps.saved?.push(`${name}|${url}`);
    },
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

test('封面顺序：外部摄影均无图后才用小红书补充，不查高德', async () => {
  const calls: string[] = [];
  const { tools, outcome, cover } = coverTools({
    stored: '/media/xhs/北京/8f3a/00.webp',
    onStored: () => calls.push('stored'),
    onPexels: () => calls.push('pexels'),
    onAmap: () => calls.push('amap'),
  });
  assert.equal(await addFirst(tools, outcome), '/media/xhs/北京/8f3a/00.webp');
  assert.deepEqual(calls, ['pexels', 'stored'], '已有小红书图不能挡住外部主候选源');
  assert.deepEqual(cover.queries, ['故宫']);
});

test('封面顺序：Pexels 命中即不读小红书也不查高德', async () => {
  const pexelsUrl = 'https://images.pexels.com/photos/1/a.jpeg?h=350';
  const calls: string[] = [];
  const { tools, outcome, cover } = coverTools({
    stored: '/media/xhs/existing.webp',
    pexels: pexelsUrl,
    onStored: () => calls.push('stored'),
    onPexels: () => calls.push('pexels'),
    onAmap: () => calls.push('amap'),
  });
  assert.equal(await addFirst(tools, outcome), pexelsUrl);
  assert.deepEqual(calls, ['pexels'], 'Pexels 命中后不读小红书，也不打高德');
  assert.deepEqual(cover.queries, []);
});

test('封面顺序：摄影与小红书都无图时才用高德', async () => {
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
  assert.deepEqual(calls, ['pexels', 'stored', 'amap']);
  assert.deepEqual(cover.queries, ['故宫'], 'Commons 先于小红书和高德');
});

test('封面顺序：库内已回写的高德图直接复用，不再打高德也不重写', async () => {
  const cached = 'https://store.is.autonavi.com/showpic/cached';
  const calls: string[] = [];
  const saved: string[] = [];
  const { tools, outcome } = coverTools({
    stored: null,
    pexels: null,
    cachedAmap: cached,
    onAmap: () => calls.push('amap'),
    saved,
  });
  assert.equal(await addFirst(tools, outcome), cached);
  assert.deepEqual(calls, [], '库内已有高德图时不该再发请求（省的是稀缺搜索配额）');
  assert.deepEqual(saved, [], '复用已有值不需要回写');
});

test('封面顺序：高德实时命中后回写库内（fire-and-forget）', async () => {
  const amapUrl = 'https://store.is.autonavi.com/showpic/fresh';
  const saved: string[] = [];
  const { tools, outcome } = coverTools({ stored: null, pexels: null, amap: amapUrl, saved });
  assert.equal(await addFirst(tools, outcome), amapUrl);
  assert.deepEqual(saved, [`故宫|${amapUrl}`], '命中后必须回写 payload.amapPhoto');
});

test('新图库已保存选择先于所有新搜索；Unsplash只在胜出时执行采用', async () => {
  for (const winner of ['pexels', 'unsplash', 'pixabay', 'new-unsplash', 'new-pixabay']) {
    const calls: string[] = [];
    const photo = { url: winner.includes('unsplash') ? 'https://images.unsplash.com/photo-one?ixid=keep' : '/media/remote-photos/fixture.png' };
    const stock = (source: string): StockPhotoLookup => ({
      cachedPhotosFor: async () => { calls.push(`peek-${source}`); return winner === source ? [photo] : null; },
      photosFor: async () => { calls.push(`use-${source}`); return winner === source || winner === `new-${source}` ? [photo] : []; },
    });
    const outcome: ResearchOutcome = { summary: '', pool: [], locations: new Map() };
    const tools = buildResearchTools({
      poiSource: { kind: 'amap', searchPois: async () => [], selfCheck: async () => ({ configured: true, checked: true, ok: true, message: '' }) },
      searchSource: { kind: 'null', search: async () => [], selfCheck: async () => ({ configured: false, checked: false, ok: false, message: '' }) },
      destination: '北京', searchWebMax: 0, outcome,
      pexelsCover: {
        cachedPhotosFor: async () => winner === 'pexels' ? [photo] : null,
        coverFor: async () => null,
        photosFor: async () => { calls.push('new-pexels'); return []; },
      },
      unsplashCover: stock('unsplash'), pixabayCover: stock('pixabay'),
      amapPhotos: { calls: 0, coverFor: async () => { assert.fail('已命中图库不应再查询高德'); } },
    });
    await tools.find(tool => tool.name === 'add_candidate')!.execute('add', { name: '故宫', category: 'attraction', intro: '' });
    assert.equal(outcome.pool[0]?.coverUrl, photo.url);
    if (winner === 'pexels') assert.deepEqual(calls, [], '已有Pexels无需窥探或上报Unsplash');
    if (winner === 'unsplash') assert.deepEqual(calls, ['peek-pixabay', 'peek-unsplash', 'use-unsplash']);
    if (winner === 'pixabay') assert.deepEqual(calls, ['peek-pixabay'], '已存Pixabay不触发Unsplash采用或新搜索');
    if (winner === 'new-unsplash') assert.deepEqual(calls, ['peek-pixabay', 'peek-unsplash', 'new-pexels', 'use-pixabay', 'use-unsplash']);
    if (winner === 'new-pixabay') assert.deepEqual(calls, ['peek-pixabay', 'peek-unsplash', 'new-pexels', 'use-pixabay']);
  }
});

test('Commons 优先于已有小红书；外部都缺图时小红书三图与署名仍完整', async () => {
  const attribution: NonNullable<ResearchPoi['coverAttribution']> = {
    source: 'xhs', photographer: '摄影师', sourceUrl: 'https://www.xiaohongshu.com/explore/sample',
    license: '未确认授权', licenseUrl: 'https://www.xiaohongshu.com', changes: '缩放',
  };
  const photos = [1,2,3].map(i=>({url:`/media/xhs/photography/${i}.webp`,attribution}));
  for(const wiki of [WIKI_THUMB,null]) {
    const outcome: ResearchOutcome = {summary:'',pool:[],locations:new Map([['故宫',point]])};
    const calls: string[]=[];
    const tools=buildResearchTools({
      destination:'北京',searchWebMax:0,outcome,
      poiSource:{kind:'null',searchPois:async()=>[],selfCheck:async()=>({configured:false,checked:false,ok:false,message:''})},
      searchSource:{kind:'null',search:async()=>[],selfCheck:async()=>({configured:false,checked:false,ok:false,message:''})},
      coverLookup:{coverFor:async()=>{calls.push('commons');return wiki;}},
      storedPhotos:async()=>{calls.push('xhs');return photos;},
      storedCover:async()=>assert.fail('三图命中不得再读旧封面'),
      amapPhotos:{calls:0,coverFor:async()=>assert.fail('摄影命中不打高德')},
    });
    await tools.find(t=>t.name==='add_candidate')!.execute('add',{name:'故宫',category:'attraction',intro:''});
    assert.deepEqual(calls,wiki?['commons']:['commons','xhs']);
    assert.equal(outcome.pool[0]?.coverUrl,wiki??photos[0]!.url);
    if(!wiki) assert.deepEqual(outcome.pool[0]?.photos,photos);
  }
});
