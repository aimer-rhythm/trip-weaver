// 单测：库内景点封面 key → 展示 URL（09-27）
// env 在模块加载时校验 MASTER_KEY，必须先备好环境再动态 import（同 geoPipeline.test.ts 的做法）。
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import type { PlaceFacts } from '../generation/scheduling/placeFacts';

// 无条件赋值（不用 ??=/||=）：本套件不用真 key，只要能在 env.ts 校验时解析通过
process.env.MASTER_KEY = 'a'.repeat(64);

const { createStoredCoverLookup, createStoredPlaceLookups, mediaUrl } = await import('../generation/storedCover');
const { loadCityPlaceFacts, loadPlaceFacts } = await import('../generation/scheduling/placeFacts');
const { pool } = await import('../db/client');
after(() => pool.end());

test('mediaUrl：相对 key 拼上 base 前缀', () => {
  assert.equal(mediaUrl('xhs/杭州/8f3a/00.webp', '/media'), '/media/xhs/杭州/8f3a/00.webp');
  assert.equal(mediaUrl('xhs/a.webp', 'https://cdn.example.com'), 'https://cdn.example.com/xhs/a.webp');
  assert.equal(
    mediaUrl('xhs/a.webp', 'https://cdn.example.com/'),
    'https://cdn.example.com/xhs/a.webp',
    'base 尾斜杠不产生双斜杠',
  );
  assert.equal(mediaUrl('/xhs/a.webp', ''), '/xhs/a.webp', 'key 前导斜杠剥掉，空 base 退化为同源路径');
  assert.equal(mediaUrl('  xhs/a.webp  ', '/media'), '/media/xhs/a.webp', '空白先 trim');
});

test('mediaUrl：空 key 返回 null，不生成指向目录的 URL', () => {
  assert.equal(mediaUrl('', '/media'), null);
  assert.equal(mediaUrl('   ', '/media'), null);
  assert.equal(mediaUrl('/', '/media'), null);
});

test('库内多图按已选顺序读取并复用同一城市索引', async () => {
  let loads = 0;
  const facts: PlaceFacts = { name: '故宫', category: '历史', source: 'xhs', themes: [], aliases: [],
    coverImage: 'xhs/first.webp', imageGallery: [{ key: 'xhs/first.webp' }, { key: 'xhs/second.webp' }] };
  const lookups = createStoredPlaceLookups('北京', async () => { loads++; return new Map([['故宫', facts]]); });
  assert.deepEqual((await lookups.photosFor('故宫')).map(photo => photo.url), [mediaUrl('xhs/first.webp'), mediaUrl('xhs/second.webp')]);
  assert.equal(await lookups.coverFor('故宫'), mediaUrl('xhs/first.webp'));
  assert.equal(loads, 1);
});

test('createStoredCoverLookup：城市为空直接返回 null，不查库', async () => {
  assert.equal(await createStoredCoverLookup('')('故宫'), null);
  assert.equal(await createStoredCoverLookup('   ')('故宫'), null);
});

test('同城多候选共享完整索引：首项未命中也不吞掉后续图片和坐标', async () => {
  let loads = 0;
  const facts: PlaceFacts = {
    name: '虎跑公园', category: '自然', source: 'xhs', themes: [], aliases: ['虎跑泉'],
    coverImage: 'xhs/杭州/hupao/00.webp', amapPhoto: 'https://example.com/hupao.jpg', lat: 30.21, lng: 120.13,
  };
  const lookups = createStoredPlaceLookups('杭州', async (city) => {
    assert.equal(city, '杭州');
    loads++;
    return new Map([['虎跑', facts], ['虎跑泉', facts]]);
  });
  assert.equal(await lookups.coverFor('断桥残雪'), null);
  const [cover, point, amap] = await Promise.all([
    lookups.coverFor(' 虎跑公园 '), lookups.pointFor('虎跑泉'), lookups.amapPhotoFor('虎跑公园'),
  ]);
  assert.equal(cover, mediaUrl(facts.coverImage!));
  assert.deepEqual(point, { lat: 30.21, lng: 120.13 });
  assert.equal(amap, facts.amapPhoto);
  assert.equal(loads, 1, '三类并发读取应共用一次城市加载');
});

test('空城市/空名字不加载；空索引与不同城市互不污染', async () => {
  let loads = 0;
  const empty = async () => { loads++; return new Map<string, PlaceFacts>(); };
  assert.equal(await createStoredPlaceLookups(' ', empty).pointFor('西湖'), null);
  assert.equal(await createStoredPlaceLookups('杭州', empty).coverFor(' '), null);
  assert.equal(loads, 0);
  const hangzhou = createStoredPlaceLookups('杭州', empty);
  assert.equal(await hangzhou.coverFor('西湖'), null);
  assert.equal(await hangzhou.pointFor('灵隐寺'), null);
  assert.equal(await createStoredPlaceLookups('北京', empty).amapPhotoFor('西湖'), null);
  assert.equal(loads, 2);
});

test('展示括注不丢失主体图片，完整名优先，不把括号内父景区当主体', async () => {
  const base: PlaceFacts = { name: '九溪烟树', category: '自然', source: 'xhs', themes: [], aliases: [], coverImage: 'xhs/jiuxi.webp' };
  const lookup = createStoredPlaceLookups('杭州', async () => new Map([
    ['九溪烟树', base], ['西湖', { ...base, name: '西湖', coverImage: 'xhs/lake.webp' }],
    ['九溪烟树（特定入口）', { ...base, coverImage: 'xhs/entrance.webp' }],
  ]));
  assert.equal(await lookup.coverFor('九溪烟树（九溪十八涧）'), mediaUrl('xhs/jiuxi.webp'));
  assert.equal(await lookup.coverFor('九溪烟树 (九溪十八涧)'), mediaUrl('xhs/jiuxi.webp'));
  assert.equal(await lookup.coverFor('九溪烟树（特定入口）'), mediaUrl('xhs/entrance.webp'));
  assert.equal(await lookup.coverFor('断桥（西湖）'), null);
  assert.equal(await lookup.coverFor('九溪烟树与西湖'), null);
});

test('真实城市加载保留多地点与别名；批量 API 仍只返回所请求名称', async () => {
  const city = '封面回归测试城';
  const ids = ['cover-regression-a', 'cover-regression-b', 'cover-regression-other'];
  try {
    await pool.query(
      `INSERT INTO canonical_places (id, city, name, category, source, payload, created_at)
       VALUES ($1, $4, '断桥残雪', '自然', 'xhs', '{}', now()),
              ($2, $4, '虎跑公园', '自然', 'xhs', $5, now()),
              ($3, '另一座测试城', '虎跑公园', '自然', 'xhs', $6, now())`,
      [...ids, city, { aliases: ['虎跑泉'], coverImage: 'xhs/test/hupao.webp' }, { coverImage: 'wrong-city.webp' }],
    );
    const index = await loadCityPlaceFacts(city);
    assert.ok(index.has('断桥残雪'));
    assert.equal(index.get('虎跑')?.coverImage, 'xhs/test/hupao.webp');
    assert.equal(index.get('虎跑泉')?.coverImage, 'xhs/test/hupao.webp');
    const subset = await loadPlaceFacts(['虎跑公园'], city);
    assert.deepEqual([...subset.keys()], ['虎跑公园']);
    const lookups = createStoredPlaceLookups(city);
    assert.equal(await lookups.coverFor('断桥残雪'), null);
    assert.equal(await lookups.coverFor('虎跑泉'), mediaUrl('xhs/test/hupao.webp'));
  } finally {
    await pool.query('DELETE FROM canonical_places WHERE id = ANY($1::text[])', [ids]);
  }
});
