import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {auditReviews} from './audit-reviews.mjs';

const entity = (entity_id, city = '北京', redirect_to = null) => ({entity_id, city, redirect_to,
  canonical_name: entity_id, status: redirect_to ? 'MERGED' : 'ACTIVE'});
const entities = [entity('a'), entity('b'), entity('old-a', '北京', 'a'), entity('foreign', '厦门')];
const scopes = [{place_id: 1, city: '北京'}];
const review = (id, detail, status = 'PENDING', city = '北京') => ({id, detail, status, city});
const uncertain = {assessment: {verdict: 'uncertain'}};
const mention = (mentionId, inputHash = 'a'.repeat(64)) => ({reason: 'mention_scope', mentionId, inputHash, scopePlaceIds: [1]});
const image = (imageKey, inputHash = 'b'.repeat(64)) => ({reason: 'image_scope', imageKey, inputHash, statusReason: 'unreviewed_image'});

test('实体对、提及、图片分开计数，scope待审不产生同根误报', () => {
  const result = auditReviews(entities, [
    review(1, {reason: 'similar_name', entityIds: ['a', 'b'], ...uncertain}),
    review(2, {reason: 'similar_name', entityIds: ['b', 'old-a'], ...uncertain}),
    review(3, mention(101)), review(4, mention(102)),
    review(5, image('note_image:201')), review(6, image('photography:abcdef:0')),
  ], scopes);
  assert.deepEqual(result.failures, []);
  const row = result.cities.find(row => row.city === '北京');
  assert.equal(row.statuses.PENDING, 6);
  assert.equal(row.pendingPairs, 1);
  assert.equal(row.assessedUncertainPairs, 1);
  assert.equal(row.duplicatePendingRows, 1);
  assert.equal(row.pendingMentions, 2);
  assert.equal(row.unassessedMentions, 2);
  assert.equal(row.pendingImages, 2);
  assert.equal(row.unassessedImages, 2);
});

test('不同证据版本分别待审，已解决旧版不抵消新版；缺失图片仍是有效待审', () => {
  const result = auditReviews(entities, [
    review(1, {...mention(101), ...uncertain}, 'RESOLVED'),
    review(2, mention(101, 'c'.repeat(64))),
    review(3, {...mention(101, 'c'.repeat(64)), ...uncertain}),
    review(4, {...mention(101, 'd'.repeat(64)), ...uncertain}),
    review(5, {...image('note_image:201'), statusReason: 'missing_image'}),
  ], scopes);
  assert.deepEqual(result.failures, []);
  const row = result.cities.find(row => row.city === '北京');
  assert.equal(row.pendingMentions, 2);
  assert.equal(row.duplicatePendingMentionRows, 1);
  assert.equal(row.assessedUncertainMentions, 1);
  assert.equal(row.unassessedMentions, 1);
  assert.equal(row.pendingImages, 1);
});

test('真实同根、悬空、跨城及重定向环继续失败，解析环不挂住审计', () => {
  const catalog = [...entities, entity('cycle-1', '北京', 'cycle-2'), entity('cycle-2', '北京', 'cycle-1'),
    entity('cross-city', '厦门', 'a')];
  const result = auditReviews(catalog, [
    review(1, {entityIds: ['a', 'old-a']}), review(2, {entityIds: ['a', 'missing']}),
    review(3, {entityIds: ['a', 'foreign']}), review(4, {entityIds: ['a', 'cycle-1']}),
    review(5, {entityIds: ['a', 'cross-city']}),
    review(6, {entityIds: ['a', 'old-a']}, 'RESOLVED'),
  ]);
  assert.deepEqual(result.failures.map(row => [row.reviewId, row.kind]), [
    [1, 'pending_same_root'], [2, 'invalid_root'], [3, 'invalid_root'], [4, 'invalid_root'], [5, 'invalid_root'],
  ]);
  assert.equal(result.cities.find(row => row.city === '北京').invalidPendingRows, 5);
});

test('缺字段、伪造scope和未知队列格式显式失败；没有实体的城市也进入统计', () => {
  const result = auditReviews(entities, [review(1, {}), review(2, {...mention(1), inputHash: 'bad'}),
    review(3, {...mention(1), scopePlaceIds: [999]}), review(4, mention(1), 'PENDING', '厦门'),
    review(5, image('invalid')), review(6, {reason: 'future_scope'}, 'PENDING', '新城市')], scopes);
  assert.deepEqual(result.failures.map(row => row.kind), ['invalid_entity_pair', 'invalid_mention_review',
    'invalid_mention_scope', 'invalid_mention_scope', 'invalid_image_review', 'invalid_entity_pair']);
  assert.equal(result.cities.find(row => row.city === '新城市').invalidPendingRows, 1);
});

test('run-20冻结实城队列原统计不变，仍139行138对，不能把uncertain计作解决', () => {
  const snapshot = JSON.parse(fs.readFileSync(new URL('./audit/run-20/snapshot.json', import.meta.url)));
  const oldReport = JSON.parse(fs.readFileSync(new URL('./audit/run-20/report.json', import.meta.url)));
  const result = auditReviews(snapshot.entities, snapshot.reviews);
  assert.deepEqual(result.failures, oldReport.failures);
  for (const expected of oldReport.cities) {
    const actual = result.cities.find(row => row.city === expected.city);
    assert.deepEqual(Object.fromEntries(Object.keys(expected).map(key => [key, actual[key]])), expected);
    assert.equal(actual.pendingMentions + actual.pendingImages + actual.invalidPendingRows, 0);
  }
  assert.equal(result.cities.reduce((sum, row) => sum + row.statuses.PENDING, 0), 139);
  assert.equal(result.cities.reduce((sum, row) => sum + row.pendingPairs, 0), 138);
});
