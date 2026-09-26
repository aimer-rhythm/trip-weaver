// 维基封面降级：挑选规则（纯函数）+ 适配器的缓存、失败降级、请求上限（mock fetch）
import assert from 'node:assert/strict';
import test from 'node:test';
import { createWikiCoverLookup, pickCover, type CoverQuery } from '../integrations/wikimedia/cover';

const here = { lat: 39.9, lng: 116.4 };
const thumb = 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a7/example.jpg/500px-example.jpg';

function page(partial: Partial<{ title: string; lat: number | null; lng: number | null; thumb: string | null }>) {
  return { title: '词条', lat: here.lat, lng: here.lng, thumb, ...partial };
}

test('挑选：取 2km 内最近且有主图的词条，无坐标或超距的丢弃', () => {
  const picked = pickCover(
    [
      page({ title: '同名电影', lat: null, lng: null, thumb: null }),
      page({ title: '远处同名', lat: here.lat + 0.05, lng: here.lng }),
      page({ title: '近处', lat: here.lat + 0.002, lng: here.lng, thumb: `${thumb}?near` }),
      page({ title: '更近', lat: here.lat, lng: here.lng, thumb: `${thumb}?closest` }),
    ],
    here,
  );
  assert.equal(picked, `${thumb}?closest`);
});

test('挑选：全部不合格时返回 null，非 https 的缩略图不用', () => {
  assert.equal(pickCover([page({ thumb: null }), page({ lat: here.lat + 1 })], here), null);
  assert.equal(pickCover([page({ thumb: 'http://example.com/a.jpg' })], here), null);
  assert.equal(pickCover([], here), null);
});

const query: CoverQuery = { name: '故宫博物院', city: '北京', lat: 39.9163, lng: 116.3972 };

function wikiBody(pages: Record<string, unknown>) {
  return { query: { pages } };
}

test('适配器：搜索后按坐标核对，命中返回缩略图且第二次走缓存', async () => {
  const original = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    if (url.includes('list=search')) {
      return Response.json({ query: { search: [{ title: '颐和园 (电影)' }, { title: '故宫博物院' }] } });
    }
    return Response.json(wikiBody({
      '1': { title: '颐和园 (电影)', thumbnail: { source: `${thumb}?movie` } },
      '2': {
        title: '故宫博物院',
        thumbnail: { source: `${thumb}?palace` },
        coordinates: [{ lat: 39.916, lon: 116.397 }],
      },
    }));
  }) as typeof fetch;

  try {
    const lookup = createWikiCoverLookup(8, 0);
    assert.equal(await lookup.coverFor(query), `${thumb}?palace`);
    assert.equal(await lookup.coverFor(query), `${thumb}?palace`);
    assert.equal(urls.length, 2, '第二次应命中缓存，不再发请求');
    assert.match(urls[0]!, /srsearch=/);
  } finally {
    globalThis.fetch = original;
  }
});

test('适配器：超时或非 2xx 返回 null，不抛异常', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response('nope', { status: 503 })) as typeof fetch;
  try {
    const lookup = createWikiCoverLookup(8, 0);
    assert.equal(await lookup.coverFor({ ...query, name: '不存在的园' }), null);
  } finally {
    globalThis.fetch = original;
  }
});

test('适配器：确认无图的结果进负缓存，第二次不再发请求', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async (input: string | URL | Request) => {
    calls += 1;
    const url = String(input);
    if (url.includes('list=search')) return Response.json({ query: { search: [{ title: '某电影' }] } });
    return Response.json(wikiBody({ '1': { title: '某电影' } }));
  }) as typeof fetch;
  try {
    const lookup = createWikiCoverLookup(8, 0);
    const q = { ...query, name: '只有电影同名' };
    assert.equal(await lookup.coverFor(q), null);
    assert.equal(await lookup.coverFor(q), null);
    assert.equal(calls, 2, '两次请求（搜索 + 详情）后应命中负缓存');
  } finally {
    globalThis.fetch = original;
  }
});

test('适配器：无坐标命中时返回 null', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes('list=search')) return Response.json({ query: { search: [{ title: '某电影' }] } });
    return Response.json(wikiBody({ '1': { title: '某电影' } }));
  }) as typeof fetch;
  try {
    const lookup = createWikiCoverLookup(8, 0);
    assert.equal(await lookup.coverFor({ ...query, name: '只有电影的名字' }), null);
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
    const lookup = createWikiCoverLookup(1, 0);
    assert.equal(await lookup.coverFor({ ...query, name: '甲园' }), null);
    assert.equal(await lookup.coverFor({ ...query, name: '乙园' }), null);
    assert.equal(calls, 1, '上限为 1 时第二次不得发请求');
  } finally {
    globalThis.fetch = original;
  }
});
