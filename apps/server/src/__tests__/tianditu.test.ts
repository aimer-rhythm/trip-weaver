// 单测：天地图适配层（mock fetch）——地理编码坐标系转换与降级顺序 / 驾车·步行·公交 XML 解析 /
// 单位与隐含速度闸门 / 24h 缓存 / 任务级熔断前置拦截（骑行不计失败）/ POI 字段缺口与权限失败降级
//
// 无真实 tk：全部靠 mock 断言「请求长什么样、返回值怎么被解释」。
// 真实 tk 的实测清单（XML 标签名、bus 城市字段名）见任务 research/tianditu-api.md 第 6 节。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tiandituGeocodeActivity } from '../integrations/tianditu/geo';
import { createTiandituRouteBreaker, tiandituRouteEstimate } from '../integrations/tianditu/route';
import { resolveTiandituPoiSource, TiandituPoiSource } from '../integrations/tianditu/poiSource';
import { ROUTE_BREAKER_THRESHOLD } from '../integrations/routeBreaker';

const originalFetch = globalThis.fetch;

interface MockResult {
  hits: string[];
  urls: string[];
}

/** 按 URL 分发的 mock fetch；记录命中端点顺序与完整 URL（用于断言出站参数） */
function mockFetch(handlers: { match: string; body: unknown; status?: number }[]): MockResult {
  const hits: string[] = [];
  const urls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    const handler = handlers.find((candidate) => url.includes(candidate.match));
    if (!handler) throw new Error(`未预期的请求：${url}`);
    hits.push(handler.match);
    const body = typeof handler.body === 'string' ? handler.body : JSON.stringify(handler.body);
    return new Response(body, { status: handler.status ?? 200 });
  }) as typeof fetch;
  return { hits, urls };
}

/** 取某次出站请求的 postStr（天地图路径规划的入参载体），解析回对象 */
function postStrOf(url: string): Record<string, unknown> {
  const raw = new URL(url).searchParams.get('postStr');
  assert.ok(raw, '请求缺少 postStr');
  return JSON.parse(raw) as Record<string, unknown>;
}

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

// 已知坐标向量（eviltransform 上海）：天地图用 WGS-84/CGCS2000，库内一律 GCJ-02
const WGS = { lat: 31.1774276, lng: 121.5272106 };
const GCJ = { lat: 31.17530398364597, lng: 121.53154299111314 };

const NOMINATIM_OK = [{ lat: '31.1774276', lon: '121.5272106' }];

/** 天地图 geocoder 成功响应（坐标是 WGS-84，入站会转 GCJ-02） */
const TIANDITU_GEOCODER_OK = { status: '0', location: { lon: `${WGS.lng}`, lat: `${WGS.lat}` } };

// ---------- 地理编码 ----------

test('天地图地理编码：命中 geocoder，坐标 WGS-84 → GCJ-02，adcode 回空串', async () => {
  const { hits } = mockFetch([{ match: 'api.tianditu.gov.cn/geocoder', body: { status: '0', location: { lon: `${WGS.lng}`, lat: `${WGS.lat}` } } }]);
  const place = await tiandituGeocodeActivity('tk', '外滩A', '上海');
  assert.ok(place);
  assert.equal(place.origin, 'tianditu');
  assert.equal(place.adcode, '');
  // 出站回的是 WGS-84，入站必须已转成 GCJ-02（与已知向量对齐）
  assert.ok(Math.abs(place.lat - GCJ.lat) < 1e-4, `lat 未转 GCJ-02：${place.lat}`);
  assert.ok(Math.abs(place.lng - GCJ.lng) < 1e-4, `lng 未转 GCJ-02：${place.lng}`);
  assert.deepEqual(hits, ['api.tianditu.gov.cn/geocoder']);
});

test('天地图地理编码：ds 是 JSON 字符串且带上城市名消歧', async () => {
  const { urls } = mockFetch([{ match: 'api.tianditu.gov.cn/geocoder', body: { status: '0', location: { lon: `${WGS.lng}`, lat: `${WGS.lat}` } } }]);
  await tiandituGeocodeActivity('tk', '西湖B', '杭州');
  const ds = new URL(urls[0]!).searchParams.get('ds');
  assert.ok(ds, '请求缺少 ds');
  assert.deepEqual(JSON.parse(ds), { keyWord: '杭州西湖B' });
});

test('天地图地理编码：status 非 "0" 时降级 Nominatim 并标注 nominatim', async () => {
  const { hits } = mockFetch([
    { match: 'api.tianditu.gov.cn/geocoder', body: { status: '1', msg: '鉴权失败' } },
    { match: 'nominatim', body: NOMINATIM_OK },
  ]);
  const place = await tiandituGeocodeActivity('tk', '豫园C', '上海');
  assert.ok(place);
  assert.equal(place.origin, 'nominatim');
  assert.equal(place.adcode, '');
  assert.equal(hits[0], 'api.tianditu.gov.cn/geocoder');
  assert.ok(hits.slice(1).every((hit) => hit === 'nominatim'));
});

test('天地图地理编码：无 tk 或 tryAcquire 拒绝时直接走 Nominatim，不发天地图请求', async () => {
  for (const call of [
    () => tiandituGeocodeActivity(null, '南京路D', '上海'),
    () => tiandituGeocodeActivity('tk', '南京路E', '上海', () => false),
  ]) {
    const { hits } = mockFetch([{ match: 'nominatim', body: NOMINATIM_OK }]);
    const place = await call();
    assert.ok(place);
    assert.equal(place.origin, 'nominatim');
    assert.ok(hits.every((hit) => hit === 'nominatim'), `不应发起天地图请求：${hits.join(',')}`);
  }
});

test('天地图地理编码：全链失败回 null（不抛错）', async () => {
  mockFetch([
    { match: 'api.tianditu.gov.cn/geocoder', body: { status: '1', msg: '无权限' } },
    { match: 'nominatim', body: [] },
  ]);
  assert.equal(await tiandituGeocodeActivity('tk', '不存在的地方F', '乌有市'), null);
});

// ---------- 路径规划：驾车 / 步行 ----------

/** 天地图 drive/walk 的 XML 形状（distance 单位 km、duration 单位秒、routelatlon 整条折线） */
function driveXml(distanceKm: number, durationSec: number, polyline = `${WGS.lng},${WGS.lat};${WGS.lng},${WGS.lat}`): string {
  return `<result><distance>${distanceKm}</distance><duration>${durationSec}</duration><routelatlon>${polyline};</routelatlon><ret_code>0</ret_code></result>`;
}

test('天地图驾车：km/秒 → 米/分钟，折线逐点转 GCJ-02 后抽稀', async () => {
  const { hits, urls } = mockFetch([{ match: 'api.tianditu.gov.cn/drive', body: driveXml(7.5, 542) }]);
  const route = await tiandituRouteEstimate('tk', GCJ, { lat: 31.2, lng: 121.6 }, 'drive');
  assert.ok(route);
  assert.equal(route.distanceM, 7500);
  assert.equal(route.durationMin, 9);          // 542s → 9min
  assert.ok(route.polyline?.startsWith('121.53154,31.17530'), `折线未转 GCJ-02：${route.polyline}`);
  assert.deepEqual(hits, ['api.tianditu.gov.cn/drive']);
  // 天地图入参要 WGS-84：出站坐标必须已反解回 WGS（取整 5 位）
  const postStr = postStrOf(urls[0]!);
  assert.equal(postStr.orig, `${WGS.lng.toFixed(5)},${WGS.lat.toFixed(5)}`);
  assert.equal(postStr.style, '0');
});

test('天地图步行：天地图没有步行路径规划，直接回 null 且不发请求（style=3 实测是「驾车最短路线」）', async () => {
  // 实测：style=3 对 0.9km 只给 97 秒（33km/h）—— 那是驾车速度，拿来当步行会让步行段少算 10 倍
  const { hits } = mockFetch([]);
  assert.equal(await tiandituRouteEstimate('tk', { lat: 31.21, lng: 121.52 }, { lat: 31.22, lng: 121.53 }, 'walk'), null);
  assert.deepEqual(hits, [], '不该发出任何请求（省额度，也避免把驾车数据当步行）');
});

test('天地图路径规划：骑行无端点，直接回 null 且不发请求', async () => {
  const { hits } = mockFetch([]);
  assert.equal(await tiandituRouteEstimate('tk', { lat: 31.31, lng: 121.51 }, { lat: 31.32, lng: 121.52 }, 'cycle'), null);
  assert.deepEqual(hits, []);
});

test('天地图路径规划：隐含速度不合理（单位错位）时回 null，不把错值写进时间轴', async () => {
  // 7.5km 只给 1 秒 → 隐含 450km/h，必为字段异常（如 duration 被当成分钟）
  const { hits } = mockFetch([{ match: 'api.tianditu.gov.cn/drive', body: driveXml(7.5, 1) }]);
  assert.equal(await tiandituRouteEstimate('tk', { lat: 31.41, lng: 121.61 }, { lat: 31.42, lng: 121.62 }, 'drive'), null);
  assert.deepEqual(hits, ['api.tianditu.gov.cn/drive']);
});

test('天地图路径规划：XML 缺 distance/duration 时回 null', async () => {
  mockFetch([{ match: 'api.tianditu.gov.cn/drive', body: '<result><ret_code>1</ret_code></result>' }]);
  assert.equal(await tiandituRouteEstimate('tk', { lat: 31.51, lng: 121.71 }, { lat: 31.52, lng: 121.72 }, 'drive'), null);
});

test('天地图路径规划：24h 缓存命中，第二次不发请求', async () => {
  const origin = { lat: 31.61, lng: 121.81 };
  const dest = { lat: 31.62, lng: 121.82 };
  const first = mockFetch([{ match: 'api.tianditu.gov.cn/drive', body: driveXml(2, 600) }]);
  assert.ok(await tiandituRouteEstimate('tk', origin, dest, 'drive'));
  assert.equal(first.hits.length, 1);
  const second = mockFetch([{ match: 'api.tianditu.gov.cn/drive', body: driveXml(2, 600) }]);
  assert.ok(await tiandituRouteEstimate('tk', origin, dest, 'drive'));
  assert.deepEqual(second.hits, []);
});

// ---------- 路径规划：公交 ----------

/**
 * /transit 的真实响应结构（09-25 用真 tk 实测）：results[].lines[] 是**互斥的候选方案**，
 * lines[].segments[] 串联，segments[].segmentLine[] 是同一段的**平行备选**线路。
 * time 单位分钟、distance 单位米；负值表示该段不可用。
 */
interface TransitPlan {
  segments: { alts: { time: number; distance: number }[] }[];
}

function transitJson(plans: TransitPlan[]): unknown {
  return {
    resultCode: 0,
    hasSubway: true,
    results: [
      {
        lineType: 1,
        lines: plans.map((plan) => ({
          lineName: '地铁2号线',
          segments: plan.segments.map((segment) => ({
            segmentType: 1,
            stationStart: { name: '东直门站', uuid: '121218', lonlat: '116.427561,39.939676' },
            stationEnd: { name: '西直门站', uuid: '121230', lonlat: '116.349338,39.939135' },
            segmentLine: segment.alts.map((alt) => ({
              linePoint: '116.427562,39.93967;116.349338,39.939135',
              segmentTime: alt.time,
              segmentDistance: alt.distance,
            })),
          })),
        })),
      },
    ],
  };
}

/** 09-25 实测样本（东直门 → 西直门）：方案1「地铁2号线」全为负值不可用，方案2 可用 */
const TRANSIT_LIVE_PLANS: TransitPlan[] = [
  { segments: [{ alts: [{ time: -2, distance: -15314.00495526843 }] }] },
  {
    segments: [
      { alts: [{ time: 7, distance: 310 }] },
      { alts: [{ time: 26, distance: 8198.94033273053 }, { time: 26, distance: 8209.169652316144 }] },
      { alts: [{ time: 12, distance: 520 }] },
    ],
  },
];

test('天地图公交：走 /transit 且 type=busline，postStr 用 startposition/endposition/linetype（无城市参数）', async () => {
  const { hits, urls } = mockFetch([
    { match: 'api.tianditu.gov.cn/transit', body: transitJson(TRANSIT_LIVE_PLANS) },
  ]);
  const route = await tiandituRouteEstimate('tk', { lat: 31.71, lng: 121.91 }, { lat: 31.72, lng: 121.92 }, 'transit');
  // 实测样本：跳过不可用的地铁方案，取公交方案 7+26+12=45 分钟、310+8199+520=9029 米
  assert.ok(route);
  assert.equal(route.durationMin, 45);
  assert.equal(route.distanceM, 9029);
  assert.equal(route.polyline, undefined);      // 换乘方案不拼折线（避免换乘点之间的假直线）
  assert.deepEqual(hits, ['api.tianditu.gov.cn/transit']);
  const url = new URL(urls[0]!);
  assert.equal(url.searchParams.get('type'), 'busline', '公交的 type 是 busline，不是 search');
  const postStr = postStrOf(urls[0]!);
  // 官方文档的可用示例用小写键：startposition / endposition / linetype
  assert.ok(postStr.startposition, `缺 startposition：${JSON.stringify(postStr)}`);
  assert.ok(postStr.endposition, `缺 endposition：${JSON.stringify(postStr)}`);
  assert.equal(postStr.linetype, '1');
  assert.equal(postStr.city, undefined, '天地图公交不需要城市参数');
});

test('天地图公交：segmentTime 单位是分钟（按秒解读会算出 804 km/h，被速度闸门拦下 → 整段静默降级成估算）', async () => {
  mockFetch([{ match: 'api.tianditu.gov.cn/transit', body: transitJson(TRANSIT_LIVE_PLANS) }]);
  const route = await tiandituRouteEstimate('tk', { lat: 31.73, lng: 121.97 }, { lat: 31.74, lng: 121.98 }, 'transit');
  assert.ok(route, '公交必须能解析出结果（单位判错时这里会因速度闸门回 null）');
  assert.equal(route.durationMin, 45, '45 是分钟；若当秒处理会得到 1 分钟且距离 9029 米 → 804 km/h 被拦');
});

test('天地图公交：lines[] 是互斥候选方案，只取第一条可用（全累加会得到 53km/4 分钟并被闸门拦下）', async () => {
  mockFetch([
    {
      match: 'api.tianditu.gov.cn/transit',
      body: transitJson([
        { segments: [{ alts: [{ time: 10, distance: 5000 }] }] },
        { segments: [{ alts: [{ time: 30, distance: 9000 }] }] },
      ]),
    },
  ]);
  const route = await tiandituRouteEstimate('tk', { lat: 31.77, lng: 122.03 }, { lat: 31.78, lng: 122.04 }, 'transit');
  assert.ok(route);
  assert.equal(route.durationMin, 10, '取第一条方案，不与第二条叠加');
  assert.equal(route.distanceM, 5000);
});

test('天地图公交：segmentLine[] 是平行备选，只取第一个（全取会让该段时长翻倍）', async () => {
  mockFetch([
    {
      match: 'api.tianditu.gov.cn/transit',
      body: transitJson([{ segments: [{ alts: [{ time: 26, distance: 8198 }, { time: 26, distance: 8209 }] }] }]),
    },
  ]);
  const route = await tiandituRouteEstimate('tk', { lat: 31.79, lng: 122.05 }, { lat: 31.8, lng: 122.06 }, 'transit');
  assert.ok(route);
  assert.equal(route.durationMin, 26, '两条备选不能相加成 52');
  assert.equal(route.distanceM, 8198);
});

test('天地图公交：唯一方案全为负值时回 null，其余走启发式', async () => {
  mockFetch([
    { match: 'api.tianditu.gov.cn/transit', body: transitJson([{ segments: [{ alts: [{ time: -2, distance: -15314 }] }] }]) },
  ]);
  assert.equal(
    await tiandituRouteEstimate('tk', { lat: 31.81, lng: 122.01 }, { lat: 31.82, lng: 122.02 }, 'transit'),
    null,
  );
});

// ---------- 任务级熔断前置拦截 ----------

test('天地图熔断器：骑行不计失败、不扣额度（一队骑行段打不穿熔断）', async () => {
  const { hits } = mockFetch([]);
  const breaker = createTiandituRouteBreaker('tk');
  let acquired = 0;
  const tryAcquire = () => {
    acquired += 1;
    return true;
  };
  for (let i = 0; i < ROUTE_BREAKER_THRESHOLD + 3; i++) {
    const route = await breaker.estimate({ lat: 32.0 + i * 0.01, lng: 122.2 }, { lat: 32.1 + i * 0.01, lng: 122.3 }, 'cycle', {}, tryAcquire);
    assert.equal(route, null);
  }
  assert.equal(breaker.isOpen(), false, '骑行不是服务商故障，不应熔断');
  assert.equal(breaker.failStreak(), 0);
  assert.equal(acquired, 0, '骑行在扣额度之前被拦截');
  assert.deepEqual(hits, []);
});

test('天地图熔断器：连续真实失败达阈值熔断，warn 前缀为 [tianditu-route]', async () => {
  mockFetch([{ match: 'api.tianditu.gov.cn/drive', body: '<result><ret_code>1</ret_code></result>' }]);
  const warns: string[] = [];
  const originalWarn = console.warn;
  console.warn = (message?: unknown) => {
    warns.push(String(message));
  };
  try {
    const breaker = createTiandituRouteBreaker('tk');
    for (let i = 0; i < ROUTE_BREAKER_THRESHOLD; i++) {
      await breaker.estimate({ lat: 33.1 + i * 0.01, lng: 123.1 }, { lat: 33.2 + i * 0.01, lng: 123.2 }, 'drive', {}, () => true);
    }
    assert.equal(breaker.isOpen(), true);
    assert.equal(warns.filter((warn) => warn.startsWith('[tianditu-route]') && warn.includes('熔断')).length, 1);
  } finally {
    console.warn = originalWarn;
  }
});

test('天地图熔断器：公交直接可用（无需城市参数），并继承 /transit + busline', async () => {
  const { urls } = mockFetch([{ match: 'api.tianditu.gov.cn/transit', body: transitJson(TRANSIT_LIVE_PLANS) }]);
  const breaker = createTiandituRouteBreaker('tk');
  const route = await breaker.estimate({ lat: 30.61, lng: 104.01 }, { lat: 30.62, lng: 104.02 }, 'transit', {}, () => true);
  assert.ok(route);
  assert.equal(new URL(urls[0]!).searchParams.get('type'), 'busline');
});

// ---------- POI 源 ----------

const POI_OK = {
  status: { infocode: 1000, cndesc: '服务正常' },
  count: '1',
  pois: [{ name: '北京大学', address: '颐和园路5号', lonlat: `${WGS.lng},${WGS.lat}`, poiType: '101' }],
};

test('天地图 POI：解析名称/地址/坐标，缺失字段留空（无评分、人均、营业时间、图片）', async () => {
  mockFetch([
    { match: 'api.tianditu.gov.cn/geocoder', body: TIANDITU_GEOCODER_OK },
    { match: 'api.tianditu.gov.cn/v2/search', body: POI_OK },
  ]);
  const source = new TiandituPoiSource('tk');
  const pois = await source.searchPois('attraction', '北京大学', '北京市');
  assert.equal(pois.length, 1);
  assert.equal(pois[0]!.name, '北京大学');
  assert.equal(pois[0]!.address, '颐和园路5号');
  assert.equal(pois[0]!.rating, '');
  assert.equal(pois[0]!.cost, '');
  assert.equal(pois[0]!.opentime, '');
  assert.deepEqual(pois[0]!.photoUrls, []);
  assert.equal(pois[0]!.adcode, '');
  assert.ok(Math.abs(pois[0]!.location!.lat - GCJ.lat) < 1e-4, '坐标未转 GCJ-02');
  assert.ok(Math.abs(pois[0]!.location!.lng - GCJ.lng) < 1e-4, '坐标未转 GCJ-02');
});

test('天地图 POI：queryType=1 必带 mapBound（城市中心 ±0.5°），keyWord 带 region 消歧', async () => {
  const { urls } = mockFetch([
    { match: 'api.tianditu.gov.cn/geocoder', body: TIANDITU_GEOCODER_OK },
    { match: 'api.tianditu.gov.cn/v2/search', body: POI_OK },
  ]);
  const source = new TiandituPoiSource('tk');
  await source.searchPois('food', '火锅', '成都市');
  const searchUrl = urls.find((url) => url.includes('/v2/search'));
  assert.ok(searchUrl, '应发起 /v2/search 请求');
  assert.equal(new URL(searchUrl).searchParams.get('type'), 'query');
  const postStr = postStrOf(searchUrl);
  assert.equal(postStr.keyWord, '成都市火锅');
  // 缺 mapBound 会被天地图回 infocode 2003「缺少参数：mapBound」（09-25 实测）；
  // 城市中心来自 geocoder（入站转 GCJ-02、出站再转回 WGS-84），故最终回到 mock 给的原始 WGS 值；
  // 这里只断言「以该中心取 ±0.5°」这个意图
  const bounds = String(postStr.mapBound).split(',').map(Number);
  assert.equal(bounds.length, 4, `mapBound 应为四段：${postStr.mapBound}`);
  assert.ok(Math.abs(bounds[0]! - (WGS.lng - 0.5)) < 1e-5, `西经异常：${bounds[0]}`);
  assert.ok(Math.abs(bounds[1]! - (WGS.lat - 0.5)) < 1e-5, `南纬异常：${bounds[1]}`);
  assert.ok(Math.abs(bounds[2]! - (WGS.lng + 0.5)) < 1e-5, `东经异常：${bounds[2]}`);
  assert.ok(Math.abs(bounds[3]! - (WGS.lat + 0.5)) < 1e-5, `北纬异常：${bounds[3]}`);
});

test('天地图 POI：城市视野解析失败时回空数组，且不发搜索请求', async () => {
  const { hits } = mockFetch([{ match: 'api.tianditu.gov.cn/geocoder', body: { status: '1', msg: '无权限' } }]);
  const source = new TiandituPoiSource('tk');
  assert.deepEqual(await source.searchPois('attraction', '故宫', '视野解析失败市'), []);
  assert.ok(
    hits.every((hit) => hit === 'api.tianditu.gov.cn/geocoder'),
    `拿不到 mapBound 就不应发起搜索：${hits.join(',')}`,
  );
});

test('天地图 POI：未开通权限（infocode 非 1000）时 searchPois 回空数组、selfCheck 报失败', async () => {
  mockFetch([
    { match: 'api.tianditu.gov.cn/geocoder', body: TIANDITU_GEOCODER_OK },
    { match: 'api.tianditu.gov.cn/v2/search', body: { status: { infocode: 400, cndesc: '无权限' } } },
  ]);
  const source = new TiandituPoiSource('tk');
  assert.deepEqual(await source.searchPois('attraction', '故宫G', '北京市'), []);
  const status = await source.selfCheck();
  assert.equal(status.ok, false);
  assert.ok(status.message.includes('无权限'), status.message);
});

test('天地图 POI：HTTP 失败时把响应体带进 message（400/403 语义不同，不能只回状态码）', async () => {
  mockFetch([
    { match: 'api.tianditu.gov.cn/geocoder', body: TIANDITU_GEOCODER_OK },
    {
      match: 'api.tianditu.gov.cn/v2/search',
      body: { count: 0, resultType: 1, status: { cndesc: '缺少参数：mapBound', infocode: 2003 } },
      status: 400,
    },
  ]);
  const source = new TiandituPoiSource('tk');
  const status = await source.selfCheck();
  assert.equal(status.ok, false);
  // 实测：400+308011 = 参数/tk 长度不合规；400+2003 = 缺 mapBound；403+301001 = 非法 key；418 = CloudWAF。
  // 设置页卡片直接显示这条 message，丢掉 body 就等于把这几类错误混成一类。
  assert.ok(status.message.includes('400'), status.message);
  assert.ok(status.message.includes('2003'), status.message);
  assert.ok(status.message.includes('缺少参数：mapBound'), status.message);
});

test('天地图 POI：响应缺 pois 字段按空结果处理，不当错误', async () => {
  mockFetch([
    { match: 'api.tianditu.gov.cn/geocoder', body: TIANDITU_GEOCODER_OK },
    { match: 'api.tianditu.gov.cn/v2/search', body: { status: { infocode: 1000, cndesc: '服务正常' } } },
  ]);
  const source = new TiandituPoiSource('tk');
  assert.deepEqual(await source.searchPois('attraction', '没有结果的地方H', '乌有市'), []);
  assert.equal((await source.selfCheck()).ok, true);
});

test('天地图 POI：未配置 tk 时回 Null 源（不回退高德）', () => {
  assert.equal(resolveTiandituPoiSource(null).kind, 'null');
  assert.equal(resolveTiandituPoiSource('').kind, 'null');
  assert.equal(resolveTiandituPoiSource('tk').kind, 'tianditu');
});
