// Pexels 封面（09-27）：挑选闸门（纯函数）+ 适配器的缓存、失败降级、请求上限（mock fetch）
// 适配器只依赖 lib/*，导入本文件不会连库 —— 保持这个性质，别把 placeFacts 之类的模块拉进来。
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPexelsCoverLookup as createLookup, pickCover, pickPhotos, type PexelsPhoto } from '../integrations/pexels/cover';

const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tripweaver-pexels-'));
const createPexelsCoverLookup = (key: string, cap = 8, interval = 0) => createLookup(key, cap, interval, { dataRoot });
after(async () => {
  assert.ok(path.resolve(dataRoot).startsWith(path.resolve(os.tmpdir()) + path.sep));
  await fs.rm(dataRoot, { recursive: true, force: true });
});
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=', 'base64');

const MEDIUM = 'https://images.pexels.com/photos/37467110/pexels-photo-37467110.jpeg?h=350';

function photo(alt: string, over: Partial<PexelsPhoto> = {}): PexelsPhoto {
  return {
    alt,
    photographer: 'Test Photographer', width: 1600, height: 900,
    url: 'https://www.pexels.com/photo/beijing-forbidden-city-37467110/',
    src: { medium: MEDIUM },
    ...over,
  };
}

test('挑选：alt 命中地点名时取其图片直链', () => {
  assert.equal(pickCover([photo('北京故宫')], '故宫'), MEDIUM);
});

test('挑选：归一键对齐 ——「故宫博物院」对得上 alt「北京故宫」', () => {
  // 与 placeFacts 同一套归一：剥掉「博物院」后按「故宫」比较
  assert.equal(pickCover([photo('北京故宫')], '故宫博物院'), MEDIUM);
});

test('挑选：alt 与地点名无关时判未命中，宁可不出图', () => {
  assert.equal(pickCover([photo('Green trees in a park')], '虎跑公园'), null);
  assert.equal(pickCover([photo('Sunset over a lake')], '西湖'), null);
  assert.equal(pickCover([], '西湖'), null);
});

test('挑选：尺寸回落 medium → large → original，非 https 一律丢弃', () => {
  assert.equal(pickCover([photo('西湖', { src: { large: `${MEDIUM}&large` } })], '西湖'), `${MEDIUM}&large`);
  assert.equal(pickCover([photo('西湖', { src: { original: `${MEDIUM}&orig` } })], '西湖'), `${MEDIUM}&orig`);
  assert.equal(pickCover([photo('西湖', { src: { medium: 'http://images.pexels.com/a.jpeg' } })], '西湖'), null);
  assert.equal(pickCover([photo('西湖', { src: {} })], '西湖'), null);
});

test('挑选：地点名过短（剥不出有效键）时不猜', () => {
  assert.equal(pickCover([photo('甲')], '甲'), null);
});

test('挑选：去掉通用尾缀的核心词也能命中（龙井村 → 龙井）', () => {
  // normalizePlaceKey 不剥「村」，靠核心词才能对上 alt「杭州龙井茶园」
  assert.equal(pickCover([photo('杭州龙井茶园')], '龙井村'), MEDIUM);
  assert.equal(pickCover([photo('秋日西湖边的小路')], '西湖'), MEDIUM, '完整地名仍优先');
});

test('挑选：核心词匹配不会因 alt 里的泛化词而误放', () => {
  // 「虎跑公园」归一后是「虎跑」（公园已被剥），alt 里的「公园」不构成命中
  assert.equal(pickCover([photo('一名男子在城市公园里跑步')], '虎跑公园'), null);
  assert.equal(pickCover([photo('秋日树木倒映在湿地池塘上')], '西溪湿地'), null);
  assert.equal(pickCover([photo('静谧的石径穿过茂密竹林')], '云栖竹径'), null);
});

test('适配器：未配置 key 时直接返回 null 且不发请求', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return Response.json({ photos: [] });
  }) as typeof fetch;
  try {
    const lookup = createPexelsCoverLookup('', 8, 0);
    assert.equal(await lookup.coverFor({ name: '西湖', city: '杭州' }), null);
    assert.equal(calls, 0, '无 key 不得发请求');
  } finally {
    globalThis.fetch = original;
  }
});

test('适配器：首次入选下载，重建适配器并移除API密钥后仍只读本地文件', async () => {
  const original = globalThis.fetch;
  const urls: string[] = [];
  let auth = '';
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    urls.push(String(input));
    if (String(input).startsWith('https://images.pexels.com/')) {
      assert.equal((init?.headers as Record<string, string>)?.Authorization, undefined, '不向图片域名转发 API 凭据');
      return new Response(PNG, { headers: { 'Content-Type': 'image/png' } });
    }
    auth = String((init?.headers as Record<string, string> | undefined)?.Authorization ?? '');
    return Response.json({ photos: [photo('西湖'), photo('无关风景')] });
  }) as typeof fetch;
  try {
    const lookup = createPexelsCoverLookup('test-key', 8, 0);
    const query = { name: '西湖', city: '杭州' };
    const cover = await lookup.coverFor(query);
    assert.match(cover!, /^\/media\/remote-photos\/[a-f0-9]{64}\.png$/);
    assert.equal(await lookup.coverFor(query), cover);
    assert.equal(await createPexelsCoverLookup('', 0, 0).coverFor(query), cover, '跨实例与无密钥时复用持久记录');
    assert.equal((await lookup.photosFor!(query))[0]?.attribution?.photographer, 'Test Photographer');
    assert.equal(urls.length, 2, '一回搜索加一次图片下载；其余调用零网络');
    assert.match(urls[0]!, /api\.pexels\.com\/v1\/search\?/);
    assert.match(urls[0]!, /locale=zh-CN/);
    assert.equal(auth, 'test-key');
  } finally {
    globalThis.fetch = original;
  }
});

test('候选优先横向氛围图，保留逐图作者并优先可放大尺寸', () => {
  const candidates = pickPhotos([
    photo('西湖白天', { src: { large2x: `${MEDIUM}&day` } }),
    photo('西湖晨雾', { width: 800, height: 1200, src: { large2x: `${MEDIUM}&portrait` } }),
    photo('西湖 sunset', { src: { large2x: `${MEDIUM}&sunset` } }),
  ], '西湖');
  assert.equal(candidates[0]?.url, `${MEDIUM}&sunset`);
  assert.equal(candidates[1]?.url, `${MEDIUM}&day`);
  assert.equal(candidates[2]?.url, `${MEDIUM}&portrait`);
});

test('适配器：确认无图的结果进负缓存，第二次不再发请求', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return Response.json({ photos: [photo('Sunset over a lake')] });
  }) as typeof fetch;
  try {
    const lookup = createPexelsCoverLookup('test-key', 8, 0);
    const query = { name: '虎跑公园', city: '杭州' };
    assert.equal(await lookup.coverFor(query), null);
    assert.equal(await lookup.coverFor(query), null);
    assert.equal(calls, 1, '两次调用只应发一次请求（负缓存命中）');
  } finally {
    globalThis.fetch = original;
  }
});

test('适配器：失败（非 2xx）返回 null 且不进缓存，下次重试', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response('rate limited', { status: 429 });
  }) as typeof fetch;
  try {
    const lookup = createPexelsCoverLookup('test-key', 8, 0);
    const query = { name: '云栖竹径', city: '杭州' };
    assert.equal(await lookup.coverFor(query), null);
    assert.equal(await lookup.coverFor(query), null);
    assert.equal(calls, 2, '失败不缓存，第二次应再次尝试');
  } finally {
    globalThis.fetch = original;
  }
});

test('适配器：超过单次生成上限后不再发请求', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response('nope', { status: 500 });
  }) as typeof fetch;
  try {
    const lookup = createPexelsCoverLookup('test-key', 1, 0);
    assert.equal(await lookup.coverFor({ name: '甲园', city: '北京' }), null);
    assert.equal(await lookup.coverFor({ name: '乙园', city: '北京' }), null);
    assert.equal(calls, 1, '上限为 1 时第二次不得发请求');
  } finally {
    globalThis.fetch = original;
  }
});
