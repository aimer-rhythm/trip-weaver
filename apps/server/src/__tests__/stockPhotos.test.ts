import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Value } from '@sinclair/typebox/value';
import { PoiPhotoSchema } from '@tripweaver/shared';
import { createUnsplashCoverLookup, pickUnsplashPhotos } from '../integrations/unsplash/cover';
import { createPixabayCoverLookup, pickPixabayPhotos } from '../integrations/pixabay/cover';
import { DAY, matchesStockPlace, photoKey, readStockCache, stockPhotoBudget, stockPhotoSearch, writeStockCache } from '../integrations/stockPhotoSupport';
import { saveRemotePhoto } from '../integrations/photoStore';

const query = { name: '故宫博物院', city: '北京' };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=', 'base64');
const unsplash = (id = 'one') => ({ id, width: 1600, height: 900, description: 'Forbidden City Beijing sunset',
  urls: { regular: `https://images.unsplash.com/photo-${id}?ixid=originalTracking&ixlib=rb-4.1.0&w=1080&fit=max` },
  links: { html: `https://unsplash.com/photos/${id}`, download_location: `https://api.unsplash.com/photos/${id}/download?ixid=downloadTracking` },
  user: { name: 'Alice', links: { html: 'https://unsplash.com/@alice' } } });
const pixabay = (id = 1) => ({ id, type: 'photo', tags: 'Forbidden City, Beijing, sunset', user: 'Bob', imageWidth: 1600, imageHeight: 900,
  pageURL: `https://pixabay.com/photos/forbidden-city-beijing-${id}/`, largeImageURL: `https://pixabay.com/get/${id}.jpg` });
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
async function fixture(run: (root: string) => Promise<void>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tripweaver-stock-'));
  const previous = globalThis.fetch;
  try { await run(root); }
  finally {
    globalThis.fetch = previous;
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    await fs.rm(root, { recursive: true, force: true });
  }
}

test('地名闸门要求城市和具体景点；不把圆明园、通用长城或同城风景冒充目标', () => {
  assert.ok(matchesStockPlace('Forbidden City Beijing', query));
  assert.ok(matchesStockPlace('National Museum of China Beijing', { name: '国家博物馆', city: '北京' }));
  assert.match(stockPhotoSearch(query), /Forbidden City Beijing/);
  assert.equal(matchesStockPlace('Beijing sunset', query), false);
  assert.equal(matchesStockPlace('Forbidden City Shenyang', query), false);
  assert.equal(matchesStockPlace('Old Summer Palace Beijing', { name: '颐和园', city: '北京' }), false);
  assert.equal(matchesStockPlace('https://pixabay.com/photos/old-summer-palace-beijing-123/', { name: '颐和园', city: '北京' }), false);
  assert.equal(matchesStockPlace('Great Wall Beijing sunset', { name: '八达岭长城', city: '北京' }), false);
  assert.ok(matchesStockPlace('Badaling Great Wall Beijing', { name: '八达岭长城', city: '北京' }));
});

test('Unsplash保留原始hotlink与ixid，只在采用时上报；跨实例复用元数据但重新计采用', async () => fixture(async root => {
  const calls: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input)); calls.push(url.pathname);
    assert.equal(init?.redirect, 'error');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Client-ID test-key');
    assert.equal(url.hostname, 'api.unsplash.com', '不得请求或保存Unsplash图片字节');
    return url.pathname === '/search/photos' ? json({ results: [unsplash()] }) : json({ url: 'https://images.unsplash.com/unused' });
  };
  const lookup = createUnsplashCoverLookup('test-key', 8, { dataRoot: root });
  assert.equal(await lookup.cachedPhotosFor(query), null);
  assert.deepEqual(calls, []);
  const [first, same] = await Promise.all([lookup.photosFor(query), lookup.photosFor(query)]);
  assert.deepEqual(first, same); assert.equal(first.length, 1);
  assert.ok(Value.Check(PoiPhotoSchema, first[0]));
  assert.equal(first[0]!.url, unsplash().urls.regular);
  assert.match(first[0]!.attribution!.photographerUrl!, /@alice\?utm_source=tripweaver&utm_medium=referral/);
  assert.match(first[0]!.attribution!.sourceUrl, /utm_source=tripweaver&utm_medium=referral/);
  assert.match(first[0]!.attribution!.licenseUrl, /utm_source=tripweaver&utm_medium=referral/);
  assert.deepEqual(calls, ['/search/photos', '/photos/one/download']);
  const reused = createUnsplashCoverLookup('test-key', 4, { dataRoot: root });
  assert.deepEqual(await reused.cachedPhotosFor(query), first);
  assert.equal(calls.length, 2, '只读缓存不增加采用事件');
  assert.deepEqual(await reused.photosFor(query), first);
  assert.deepEqual(calls, ['/search/photos', '/photos/one/download', '/photos/one/download']);
  assert.equal(await fs.stat(path.join(root, 'media')).catch(() => null), null);
  const disabled = createUnsplashCoverLookup('', 0, { dataRoot: root });
  assert.equal(await disabled.cachedPhotosFor(query), null);
  assert.deepEqual(await disabled.photosFor(query), []);
  assert.equal(calls.length, 3);
}));

test('Unsplash采用失败不输出该图片；后续任务从查询缓存重试，不重新搜索', async () => fixture(async root => {
  let searches = 0, reports = 0, fail = true;
  globalThis.fetch = async input => {
    if (String(input).includes('/search/photos')) { searches++; return json({ results: [unsplash()] }); }
    reports++;
    return fail ? new Response('', { status: 503 }) : json({ url: 'unused' });
  };
  assert.deepEqual(await createUnsplashCoverLookup('key', 4, { dataRoot: root }).photosFor(query), []);
  fail = false;
  assert.equal((await createUnsplashCoverLookup('key', 4, { dataRoot: root }).photosFor(query)).length, 1);
  assert.equal(searches, 1); assert.equal(reports, 2);
}));

test('Unsplash过滤恶意下载地址/错误身份/超长hotlink，优先横版且最多三张', async () => fixture(async root => {
  const malicious = unsplash('evil'); malicious.links.download_location = 'https://127.0.0.1/photos/evil/download';
  const wrong = unsplash('wrong'); wrong.links.download_location = 'https://api.unsplash.com/photos/another/download';
  const huge = unsplash('huge'); huge.urls.regular += 'x'.repeat(300);
  const portrait = { ...unsplash('portrait'), width: 900, height: 1600 };
  const picked = pickUnsplashPhotos([malicious, wrong, huge, portrait, unsplash('landscape'), unsplash('two'), unsplash('three')], query);
  assert.deepEqual(picked.map(row => row.id), ['landscape', 'two', 'three']);
  let calls = 0; globalThis.fetch = async () => { calls++; return json({}); };
  assert.equal(await saveRemotePhoto({ url: unsplash().urls.regular }, root), null);
  assert.equal(calls, 0, '通用图片存储器也拒绝Unsplash下载');
}));

test('Pixabay入选下载本地，跨实例/缺密钥/零预算复用；下载失败补位且最终最多三张', async () => fixture(async root => {
  let searches = 0, downloads = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(init?.redirect, 'error');
    if (url.pathname === '/api/') {
      searches++;
      assert.equal(url.searchParams.get('orientation'), 'horizontal');
      assert.equal(url.searchParams.get('image_type'), 'photo');
      return json({ hits: [1, 2, 3, 4, 5].map(pixabay) });
    }
    downloads++;
    if (url.pathname === '/get/1.jpg') return new Response('', { status: 503 });
    return new Response(Buffer.concat([png, Buffer.from(url.pathname)]), { headers: { 'content-type': 'image/png' } });
  };
  const first = await createPixabayCoverLookup('secret', 3, { dataRoot: root }).photosFor(query);
  assert.equal(first.length, 3); assert.equal(searches, 1); assert.equal(downloads, 4);
  assert.ok(first.every(photo => photo.url.startsWith('/media/remote-photos/') && Value.Check(PoiPhotoSchema, photo)));
  const reused = createPixabayCoverLookup('', 0, { dataRoot: root });
  assert.deepEqual(await reused.cachedPhotosFor(query), first);
  assert.deepEqual(await reused.photosFor(query), first);
  assert.equal(searches, 1); assert.equal(downloads, 4);
  const files = await fs.readdir(path.join(root, 'photo-store/pixabay-search'));
  const cached = await fs.readFile(path.join(root, 'photo-store/pixabay-search', files[0]!), 'utf8');
  assert.ok(!cached.includes('secret') && !cached.includes('key='));
}));

test('Pixabay空结果也缓存24h；到期后允许一次新搜索', async () => fixture(async root => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return json({ hits: [] }); };
  for (let i = 0; i < 2; i++) assert.deepEqual(await createPixabayCoverLookup('key', 1, { dataRoot: root }).photosFor(query), []);
  assert.equal(calls, 1);
  const dir = path.join(root, 'photo-store/pixabay-search'), file = path.join(dir, (await fs.readdir(dir))[0]!);
  const cached = JSON.parse(await fs.readFile(file, 'utf8'));
  cached.savedAt = Date.now() - DAY - 1; await fs.writeFile(file, JSON.stringify(cached));
  await createPixabayCoverLookup('key', 1, { dataRoot: root }).photosFor(query);
  assert.equal(calls, 2);
}));

test('Pixabay图片失败重试复用24h结果；拒绝错误图源和插画', async () => fixture(async root => {
  let searches = 0, fail = true;
  globalThis.fetch = async input => {
    if (String(input).includes('/api/')) { searches++; return json({ hits: [pixabay()] }); }
    return fail ? new Response('', { status: 503 }) : new Response(png, { headers: { 'content-type': 'image/png' } });
  };
  assert.deepEqual(await createPixabayCoverLookup('key', 1, { dataRoot: root }).photosFor(query), []);
  fail = false;
  assert.equal((await createPixabayCoverLookup('key', 0, { dataRoot: root }).photosFor(query)).length, 1);
  assert.equal(searches, 1);
  assert.deepEqual(pickPixabayPhotos([{ ...pixabay(), type: 'illustration' }, { ...pixabay(), largeImageURL: 'https://evil.test/a.jpg' }], query), []);
}));

test('请求预算、响应字节上限及错误脱敏；缓存不含请求密钥', async () => fixture(async root => {
  let calls = 0;
  globalThis.fetch = async input => { calls++; throw new Error(`failure ${String(input)}`); };
  const budget = stockPhotoBudget('pixabay', 1);
  await assert.rejects(budget.json('https://pixabay.com/api/?key=do-not-log'), error => error instanceof Error && !error.message.includes('do-not-log'));
  await assert.rejects(budget.json('https://pixabay.com/api/?key=do-not-log'), /budget/);
  assert.equal(calls, 1);
  globalThis.fetch = async () => new Response('x'.repeat(1024 * 1024 + 1), { headers: { 'content-type': 'application/json' } });
  await assert.rejects(stockPhotoBudget('pixabay', 1).json('https://pixabay.com/api/'), /unavailable/);
  await writeStockCache('pixabay-search', photoKey(query), [], root);
  assert.deepEqual(await readStockCache('pixabay-search', photoKey(query), root), []);
  assert.equal(await readStockCache('pixabay-search', photoKey({ ...query, city: '杭州' }), root), undefined);
}));

test('Pixabay并发查询合并；畸形响应不进入24h成功缓存', async () => fixture(async root => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return json({ error: 'invalid result' }); };
  const a = createPixabayCoverLookup('key', 2, { dataRoot: root });
  const b = createPixabayCoverLookup('key', 2, { dataRoot: root });
  assert.deepEqual(await Promise.all([a.photosFor(query), b.photosFor(query)]), [[], []]);
  assert.equal(calls, 1);
  assert.equal(await readStockCache('pixabay-search', photoKey(query), root), undefined);
  globalThis.fetch = async () => { calls++; return json({ hits: [] }); };
  await b.photosFor(query);
  assert.equal(calls, 2);
}));

test('429触发进程限流，后续适配器不继续请求同一提供方', async () => fixture(async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response('', { status: 429 }); };
  await assert.rejects(stockPhotoBudget('pixabay', 2).json('https://pixabay.com/api/'));
  await assert.rejects(stockPhotoBudget('pixabay', 2).json('https://pixabay.com/api/'), /budget/);
  assert.equal(calls, 1);
}));
