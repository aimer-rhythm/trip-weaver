// 单测：高德路径规划适配层（mock fetch）——三模式解析 / 折线抽稀与超长丢弃 / 缓存命中 / transit 缺 adcode 降级
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { downsamplePolyline, routeEstimate } from '../integrations/amap/route';

const originalFetch = globalThis.fetch;

function mockFetchOnce(body: unknown): { calls: string[] } {
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    calls.push(String(input));
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  return { calls };
}

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('routeEstimate：walking 解析时长/距离/折线', async () => {
  const { calls } = mockFetchOnce({
    status: '1',
    route: {
      paths: [
        {
          distance: '1200',
          cost: { duration: '900' },
          steps: [{ polyline: '116.1,39.1;116.2,39.2' }, { polyline: '116.3,39.3' }],
        },
      ],
    },
  });
  const r = await routeEstimate('k', { lat: 39.1, lng: 116.1 }, { lat: 39.3, lng: 116.3 }, 'walk');
  assert.ok(r);
  assert.equal(r.durationMin, 15);
  assert.equal(r.distanceM, 1200);
  assert.equal(r.polyline, '116.1,39.1;116.2,39.2;116.3,39.3');
  assert.ok(calls[0]!.includes('/v5/direction/walking'));
});

test('routeEstimate：transit 解析（transits[0]），无折线', async () => {
  const { calls } = mockFetchOnce({
    status: '1',
    route: { transits: [{ distance: '5000', cost: { duration: '1800' } }] },
  });
  const r = await routeEstimate('k', { lat: 39.5, lng: 116.5 }, { lat: 39.6, lng: 116.6 }, 'transit', {
    city1: '110000',
    city2: '110000',
  });
  assert.ok(r);
  assert.equal(r.durationMin, 30);
  assert.equal(r.distanceM, 5000);
  assert.equal(r.polyline, undefined);
  assert.ok(calls[0]!.includes('transit%2Fintegrated') || calls[0]!.includes('transit/integrated'));
  assert.ok(calls[0]!.includes('city1=110000'));
});

test('routeEstimate：transit 缺 adcode 直接回 null，不发请求', async () => {
  const { calls } = mockFetchOnce({ status: '1' });
  const r = await routeEstimate('k', { lat: 31.1, lng: 121.1 }, { lat: 31.2, lng: 121.2 }, 'transit');
  assert.equal(r, null);
  assert.equal(calls.length, 0);
});

test('routeEstimate：driving 超长折线丢弃，仅留时长距离', async () => {
  // 构造 500 个长坐标点：抽稀后仍 >4000 字符 → polyline 丢弃
  const points = Array.from({ length: 500 }, (_, i) => `116.${String(i).padStart(9, '0')},39.${String(i).padStart(9, '0')}`);
  mockFetchOnce({
    status: '1',
    route: { paths: [{ distance: '30000', cost: { duration: '3600' }, steps: [{ polyline: points.join(';') }] }] },
  });
  const r = await routeEstimate('k', { lat: 39.9, lng: 116.9 }, { lat: 40.0, lng: 117.0 }, 'drive');
  assert.ok(r);
  assert.equal(r.durationMin, 60);
  assert.equal(r.distanceM, 30000);
  assert.equal(r.polyline, undefined);
});

test('routeEstimate：24h 缓存命中，第二次不发请求', async () => {
  const { calls } = mockFetchOnce({
    status: '1',
    route: { paths: [{ distance: '800', cost: { duration: '600' }, steps: [] }] },
  });
  const origin = { lat: 22.1, lng: 113.1 };
  const dest = { lat: 22.2, lng: 113.2 };
  const first = await routeEstimate('k', origin, dest, 'walk');
  const second = await routeEstimate('k', origin, dest, 'walk');
  assert.deepEqual(second, first);
  assert.equal(calls.length, 1);
});

test('routeEstimate：高德 status!=1 回 null（不抛错）', async () => {
  mockFetchOnce({ status: '0', info: 'INVALID_USER_KEY' });
  const r = await routeEstimate('k', { lat: 23.1, lng: 114.1 }, { lat: 23.2, lng: 114.2 }, 'walk');
  assert.equal(r, null);
});

test('downsamplePolyline：短折线原样保留，空输入回 undefined', () => {
  assert.equal(downsamplePolyline(['116.1,39.1', '116.2,39.2']), '116.1,39.1;116.2,39.2');
  assert.equal(downsamplePolyline([]), undefined);
  assert.equal(downsamplePolyline(['']), undefined);
});

test('downsamplePolyline：长折线抽稀后 ≤4000 字符且保留首尾点', () => {
  const points = Array.from({ length: 2000 }, (_, i) => `116.${i},39.${i}`);
  const out = downsamplePolyline(points);
  assert.ok(out);
  assert.ok(out.length <= 4000);
  assert.ok(out.startsWith('116.0,39.0'));
  assert.ok(out.endsWith('116.1999,39.1999'));
});
