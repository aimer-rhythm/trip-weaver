import assert from 'node:assert/strict';
import test from 'node:test';
import { createCuratedCoverLookup, findCuratedPhotos, type CuratedLibrary } from '../integrations/curatedPhotos';
import hangzhou from '../data/photography/hangzhou-curated.json';
import beijing from '../data/photography/beijing-curated.json';
import { Value } from '@sinclair/typebox/value';
import { ResearchPoiSchema } from '@tripweaver/shared';

function fixture(): CuratedLibrary {
  return { version: 1, city: '杭州', places: [{
    name: '西湖断桥', aliases: ['断桥残雪'], photos: [1, 2].map(id => ({
      id: `commons-${id}`, key: `photography/commons-${id}.webp`, sha256: 'a'.repeat(64),
      attribution: { source: 'commons', photographer: '摄影师', sourceUrl: `https://commons.wikimedia.org/wiki/File:Bridge${id}.jpg`,
        license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', changes: '已调整尺寸与裁切' },
      review: { status: 'approved', identity: 'verified', reviewer: 'agent-reviewed:codex', reviewedAt: '2026-09-30',
        evidence: '作品名、分类及桥体形状均与杭州断桥相符', quality: '桥体与湖面层次清晰' },
    })),
  }] };
}

test('精选图仅匹配同城精确名称、显式别名和展示括注，拒绝组合及近邻挪用', () => {
  const library = fixture();
  for (const name of ['西湖断桥', '断桥残雪', '断桥残雪（清晨）']) assert.equal(findCuratedPhotos(library, '杭州', name).length, 2);
  for (const [city, name] of [['北京', '断桥残雪'], ['杭州', '西湖'], ['杭州', '断桥残雪·白堤'], ['杭州', '西湖断桥景区']]) {
    assert.deepEqual(findCuratedPhotos(library, city!, name!), []);
  }
  library.places.push({ ...library.places[0]!, name: '另一断桥' });
  assert.deepEqual(findCuratedPhotos(library, '杭州', '断桥残雪'), [], '别名冲突不选首项');
});

test('拒绝未审核、身份未核实、伪造路径、图源错位和许可链接不一致', () => {
  const cases: ((p: CuratedLibrary['places'][number]['photos'][number]) => void)[] = [
    p => { p.review.status = 'pending'; }, p => { p.review.status = 'rejected'; }, p => { p.review.identity = 'uncertain'; },
    p => { p.key = '../outside.webp'; }, p => { p.attribution.source = 'pexels'; },
    p => { p.attribution.source = 'unsplash'; }, p => { p.attribution.source = 'pixabay'; },
    p => { p.attribution.sourceUrl = 'https://commons.wikimedia.org.evil.test/wiki/File:X'; },
    p => { p.attribution.licenseUrl = 'https://creativecommons.org/licenses/by/4.0/'; },
    p => { p.attribution.licenseUrl = 'https://creativecommons.org/unknown'; },
    p => { p.attribution.license = 'CC BY-NC 4.0'; },
  ];
  for (const mutate of cases) {
    const library = fixture(); library.places[0]!.photos = [library.places[0]!.photos[0]!];
    mutate(library.places[0]!.photos[0]!);
    assert.deepEqual(findCuratedPhotos(library, '杭州', '断桥残雪'), []);
  }
  assert.deepEqual(findCuratedPhotos({ version: 2 }, '杭州', '断桥残雪'), []);
});

test('缺文件或校验异常跳过首张，缓存并发查询，全部失效时返回空', async () => {
  let calls = 0;
  const lookup = createCuratedCoverLookup('杭州', { library: fixture(), mediaBase: 'https://cdn.example/media/',
    verify: async photo => { calls++; if (photo.id === 'commons-1') throw new Error('unreadable'); return true; } });
  const [one, two] = await Promise.all([lookup('断桥残雪'), lookup('断桥残雪')]);
  assert.deepEqual(one, two);
  assert.equal(one?.coverUrl, 'https://cdn.example/media/photography/commons-2.webp');
  assert.equal(one?.coverAttribution.photographer, '摄影师');
  assert.equal(calls, 2);
  const empty = createCuratedCoverLookup('杭州', { library: fixture(), verify: async () => false });
  assert.equal(await empty('断桥残雪'), null);
});

test('随仓库精选清单只返回仍获批准的照片，撤回图和缺口不冒用近邻图片', () => {
  for (const place of hangzhou.places) {
    assert.equal(findCuratedPhotos(hangzhou, '杭州', place.name).length, place.photos.filter(p => p.review.status === 'approved').length, place.name);
  }
  assert.deepEqual(findCuratedPhotos(hangzhou, '杭州', '断桥残雪'), [], '撤回的断桥记录照不得再次成为精选封面');
  assert.deepEqual(findCuratedPhotos(hangzhou, '杭州', '九溪十八涧'), []);
  assert.deepEqual(findCuratedPhotos(hangzhou, '杭州', '灵隐飞来峰'), []);
});

test('封面为首选，最多三张去重可用照片，坏图不占配额', async () => {
  const library = fixture(), prototype = library.places[0]!.photos[0]!;
  library.places[0]!.photos = [1, 1, 2, 3, 4].map(id => ({ ...prototype, id: `commons-${id}`, key: `photography/commons-${id}.webp` }));
  const lookup = createCuratedCoverLookup('杭州', { library, verify: async p => p.id !== 'commons-2' });
  const cover = await lookup('断桥残雪');
  assert.deepEqual(cover?.photos.map(p => p.url), [1, 3, 4].map(id => `/media/photography/commons-${id}.webp`));
  assert.equal(cover?.photos[0]?.url, cover?.coverUrl);
  assert.deepEqual(cover?.photos[0]?.attribution, cover?.coverAttribution);
});

test('旧单图快照仍有效，照片组仅接收一至三张', () => {
  const poi = { id: '1', name: '雷峰塔', category: 'attraction', intro: '', reservation: 'none', sourceLinks: [], coverUrl: '/media/old.webp' };
  const photo = { url: '/media/photography/commons-1.webp' };
  assert.equal(Value.Check(ResearchPoiSchema, poi), true);
  for (const count of [1, 3]) assert.equal(Value.Check(ResearchPoiSchema, { ...poi, photos: Array.from({ length: count }, () => photo) }), true);
  for (const count of [0, 4]) assert.equal(Value.Check(ResearchPoiSchema, { ...poi, photos: Array.from({ length: count }, () => photo) }), false);
  assert.equal(Value.Check(ResearchPoiSchema, { ...poi, photos: [{ url: 'javascript:alert(1)' }] }), false);
});

test('默认图库按城市选择，北京试片不会泄漏到杭州或借用不同长城段落', async () => {
  const lookup = createCuratedCoverLookup(' 北京 ', { verify: async () => true });
  assert.equal((await lookup('故宫'))?.photos.length, 3);
  assert.equal((await lookup('天坛'))?.photos.length, 2);
  assert.equal(await lookup('中国国家博物馆'), null, '保留缺口');
  assert.equal(await lookup('慕田峪长城'), null, '不复用八达岭照片');
  assert.equal(await createCuratedCoverLookup('杭州', { verify: async () => true })('故宫'), null);
  for (const place of beijing.places) assert.equal(findCuratedPhotos(beijing, '北京', place.name).length, place.photos.length, place.name);
});
