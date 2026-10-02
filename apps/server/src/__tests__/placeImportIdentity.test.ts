import assert from 'node:assert/strict';
import { after, mock, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import type { GenerateForm } from '@tripweaver/shared';
import { pool } from '../db/client';
import { reconcileImportedPlaces } from '../services/placeImportIdentity';
import { createPlaceRetriever } from '../generation/placeRetrieval';
import { renderRetrievedPlaces } from '../generation/researchContext';
import { buildResearchTools, type ResearchOutcome } from '../generation/tools/researchTools';
import { getNullPoiSource } from '../integrations/nullPoiSource';
import { getNullSearchSource } from '../integrations/websearch/searchSource';
import { DraftTrip } from '../generation/draft';
import { applyDeterministicSchedule } from '../generation/scheduling/buildDraft';
import { loadCityPlaceFacts } from '../generation/scheduling/placeFacts';

after(() => pool.end());

test('导入主实体后旧名只重定向，检索仍可用别名且不串用城楼闭馆信息', async () => {
  const city = `实体-${randomUUID()}`;
  const names = ['天安门', '天安门广场', '天安门城楼', '奥林匹克森林公园', '奥森', '奥林匹克公园'];
  const rows = names.map((name) => ({ id: randomUUID(), name }));
  const client = await pool.connect();
  await client.query('BEGIN');
  try {
    for (const row of rows) await client.query(`INSERT INTO canonical_places(id,city,name,category,source,verified,lat,lng,payload,created_at)
      VALUES($1,$2,$3,'文化','goldset',true,39.9,116.4,$4,now())`, [row.id, city, row.name,
      { coverImage: 'keep.webp', reservation: 'required', openHours: { closedWeekdays: [1] } }]);
    const root = { ...rows[0]!, payload: {
      identity: { version: 1, canonicalName: '天安门', kind: 'complex', memberNames: names.slice(0, 3) },
      components: [{ name: '天安门城楼', openHours: { closedWeekdays: [1] }, reservation: 'required', reservationNote: '城楼需单独预约' }],
      reservation: 'unknown', reservationNote: '分项核实',
      content: { version: 1, intro: '天安门位于北京中轴线上，红墙与城楼构成标志性景观。广场参观、登城楼与观看升旗可按兴趣选择，各项预约要求应通过对应官方渠道确认。' },
    } };
    const forest = { ...rows[3]!, payload: { identity: { version: 1, canonicalName: '奥林匹克森林公园', kind: 'same_entity', memberNames: names.slice(3, 5) }, aliases: ['奥森'] } };
    assert.equal(await reconcileImportedPlaces(client, city, [root, forest]), 3);
    assert.equal(await reconcileImportedPlaces(client, city, [root, forest]), 0, '重跑幂等');
    const saved = (await client.query('SELECT payload FROM canonical_places WHERE id=$1', [root.id])).rows[0].payload;
    assert.equal(saved.coverImage, 'keep.webp');
    assert.equal(saved.openHours, undefined);
    assert.equal(saved.components[0].openHours.closedWeekdays[0], 1);
    const retrieve = createPlaceRetriever({ query: (sql, values) => client.query(sql, values), embed: async () => null });
    const all = await retrieve([], { city, browse: true, vector: 'off' });
    assert.deepEqual(new Set(all.map((p) => p.name)), new Set(['天安门', '奥林匹克森林公园', '奥林匹克公园']));
    assert.equal((await retrieve(['天安门城楼'], { city, vector: 'off' }))[0]?.name, '天安门');
    assert.equal((await retrieve(['奥森'], { city, vector: 'off' }))[0]?.name, '奥林匹克森林公园');
    assert.match(renderRetrievedPlaces(all), /分项政策/);
    assert.match(renderRetrievedPlaces(all), /红墙与城楼/);
    const routedQuery = mock.method(pool, 'query', client.query.bind(client));
    try {
      const facts = await loadCityPlaceFacts(city);
      assert.equal(facts.get('天安门')?.openTime, undefined, '排程补全不能重新引入被重定向子项的闭馆日');
      assert.equal(facts.get('天安门城楼'), undefined);
    } finally { routedQuery.mock.restore(); }
    const outcome: ResearchOutcome = { pool: [], summary: '', locations: new Map() };
    const tools = buildResearchTools({ destination: city, verifiedPlaces: all, outcome, poiSource: getNullPoiSource(),
      searchSource: getNullSearchSource(), searchWebMax: 2, reviewedCover: async () => null });
    await tools.find((t) => t.name === 'submit_research')!.execute('submit', { candidates: [{ placeId: root.id, intro: '模型给了一个短句' }] });
    assert.equal(outcome.pool[0]?.intro, root.payload.content.intro, '完整介绍原文复用，不被短句覆盖');
    assert.equal(outcome.pool[0]?.reservation, 'unknown', '主景区不能套用广场预约种子');
    const form: GenerateForm = { destination: city, days: 1, preferences: [], partySize: 2, budgetLevel: '舒适', totalBudget: 0, extraNotes: '', startDate: '' };
    const draft = new DraftTrip(form);
    applyDeterministicSchedule({ draft, form, pool: outcome.pool, locations: outcome.locations, longHaul: [], foodFocused: false, facts: new Map(), relations: new Map() });
    assert.equal(draft.mutableDays()[0]?.activities[0]?.description, root.payload.content.intro, '排程后不截到60字');
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
});

test('有冲突的归一清单在任何写入之前拒绝', async () => {
  let calls = 0;
  const client = { query: async () => { calls++; return { rows: [], rowCount: 0 }; } };
  const item = (name: string) => ({ id: name, name, payload: { identity: { version: 1, canonicalName: name, memberNames: [name, '冲突名'] } } });
  await assert.rejects(reconcileImportedPlaces(client, '北京', [item('甲'), item('乙')]), /归属冲突/);
  assert.equal(calls, 0);
});
