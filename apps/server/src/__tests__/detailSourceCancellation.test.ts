import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../db/client';
import { WebSearchSource } from '../integrations/websearch/searchSource';
import { TiandituPoiSource } from '../integrations/tianditu/poiSource';

after(() => pool.end());

test('网页查询取消传到 HTTP，不把取消结果写入跨轮缓存', async () => {
  const original = globalThis.fetch;
  const source = new WebSearchSource('https://example.com', 'test');
  const controller = new AbortController();
  let started!: () => void;
  const ready = new Promise<void>((resolve) => { started = resolve; });
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    if (calls > 1) return Response.json({ data: { webPages: { value: [{ name: '真实结果', url: 'https://example.com/source', summary: '资料' }] } } });
    started();
    return new Promise((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true }));
  };
  try {
    const request = source.search('取消后重试', controller.signal);
    await ready; controller.abort();
    await assert.rejects(request, { name: 'AbortError' });
    assert.equal((await source.search('取消后重试')).length, 1);
    assert.equal(calls, 2);
  } finally { globalThis.fetch = original; }
});

test('地点搜索的城市定位取消不污染缓存，重试可正常查询', async () => {
  const original = globalThis.fetch;
  const source = new TiandituPoiSource('test');
  const controller = new AbortController();
  let started!: () => void;
  const ready = new Promise<void>((resolve) => { started = resolve; });
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls++;
    if (calls === 1) {
      started();
      return new Promise((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true }));
    }
    if (String(url).includes('/geocoder')) return Response.json({ status: '0', location: { lon: 116.4, lat: 39.9 } });
    return Response.json({ status: { infocode: 1000 }, pois: [{ name: '测试公园', lonlat: '116.4,39.9', address: '测试地址', poiType: '公园' }] });
  };
  try {
    const request = source.searchPois('attraction', '公园', '取消测试城市', controller.signal);
    await ready; controller.abort();
    await assert.rejects(request, { name: 'AbortError' });
    assert.equal((await source.searchPois('attraction', '公园', '取消测试城市')).length, 1);
    assert.equal(calls, 3, '重新定位城市并查询地点');
  } finally { globalThis.fetch = original; }
});
