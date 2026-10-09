import assert from 'node:assert/strict';

export function validateImportPreflight(preflight, city, exportedAt) {
  assert.equal(preflight?.mode, 'before', '缺少成功的导入前检查');
  assert.deepEqual(preflight.failures, []);
  assert.ok(preflight.cities.some(row => row.city === city && row.unchangedSincePreview === true));
  assert.ok(Date.parse(preflight.at) >= Date.parse(exportedAt), '前置检查早于本次冻结导出或日期无效');
}

export function batchCities(decisions, scopes) {
  const cities = [...new Set([...decisions, ...scopes].map(d => d.city))];
  assert.ok(cities.length && cities.every(c => typeof c === 'string' && c.trim()), '批次必须包含有效城市');
  return cities;
}

export function validateScopeExpectations(decisions, scopes, expectations) {
  if (!scopes.length) return;
  // 旧的混合纠正批次沿用实体断言；新增scope-only批次必须显式声明全部受影响主体。
  if (decisions.length && expectations === null) return;
  assert.ok(Array.isArray(expectations) && expectations.length, '逐提及批次缺少导出预期');
  const affected = new Set(scopes.flatMap(s => Object.keys(s.expectedRevisions).map(id => `${s.city}/${id}`)));
  const keys = expectations.map(e => `${e.city}/${e.id}`);
  assert.equal(new Set(keys).size, keys.length, '导出预期重复');
  for (const key of affected) assert.ok(keys.includes(key), `${key}缺少导出预期`);
  for (const e of expectations) {
    assert.ok(batchCities(decisions, scopes).includes(e.city), '预期城市超出批次');
    assert.ok(Number.isInteger(e.revision) && e.revision > 0 && typeof e.name === 'string');
    assert.equal(typeof e.verified, 'boolean');
    if (e.mentionIds === undefined) {
      assert.ok(!affected.has(`${e.city}/${e.id}`), '受控主体必须显式列出提及');
      assert.ok(decisions.some(d => d.city === e.city && d.entityId === e.id), '普通来源预期须对应本批实体决定');
      assert.equal(e.verified, true, '普通来源不能用缺省提及伪装撤回');
    } else assert.ok(Array.isArray(e.mentionIds));
    if (!e.verified) assert.ok(Array.isArray(e.candidateIds), '撤回须显式列出候选');
  }
}

export function validateBatchExport(data, city, decisions, expectations) {
  const byId = new Map(data.places.map(p => [p.id, p]));
  assert.equal(data.city, city); assert.equal(byId.size, data.places.length);
  for (const d of decisions.filter(d => d.city === city)) {
    const p = byId.get(d.entityId);
    assert.ok(p, `${city} ${d.canonicalName}未导出`);
    assert.equal(p.name, d.canonicalName); assert.equal(p.payload.identity.version, 2);
    for (const old of d.mergeEntityIds) {
      assert.ok(!byId.has(old), `旧实体${old}仍独立导出`);
      assert.ok(p.payload.identity.memberIds.includes(old));
    }
    for (const [key, value] of Object.entries(d.overrides)) {
      if (key === 'exportApproved') { assert.ok(!('exportApproved' in p.payload)); continue; }
      if (key === 'recommendationPolicy') {
        assert.equal(value, 'resolved_attraction_mentions_v1');
        assert.ok(!('recommendationPolicy' in p.payload));
        const expected = expectations?.find(e => e.city === city && e.id === d.entityId);
        assert.ok(expected && Number.isFinite(expected.recommendScore)
          && Number.isInteger(expected.mentionCount), '评分策略必须显式冻结推荐分和提及数');
        continue;
      }
      assert.deepEqual(['category', 'lat', 'lng'].includes(key) ? p[key] : p.payload[key], value, `${city}/${p.name}/${key}`);
    }
  }
  for (const e of (expectations ?? []).filter(e => e.city === city)) {
    const p = byId.get(e.id);
    assert.ok(p, `${e.id}必须显式导出，省略不能表达撤回`);
    assert.equal(p.name, e.name); assert.equal(p.verified, e.verified);
    assert.equal(p.payload.identity.version, 2); assert.equal(p.payload.identity.revision, e.revision);
    assert.equal(p.payload.identity.entityId, e.id);
    if (e.recommendScore !== undefined) assert.equal(p.payload.recommendScore, e.recommendScore, '实体重算推荐分不一致');
    if (e.mentionCount !== undefined) assert.equal(p.payload.mentionCount, e.mentionCount, '实体提及数量不一致');
    if (e.mentionIds === undefined) {
      // 普通来源类别修订可与其他主体的scope同批；受控主体仍须显式mentionIds。
      assert.equal(p.payload.mentionSources, undefined, '普通来源预期不能漏验受控提及');
    } else {
      assert.ok(Array.isArray(e.mentionIds) && Array.isArray(p.payload.mentionSources), '受控来源须列出提及');
      assert.deepEqual(p.payload.mentionSources.map(m => m.mentionId).sort((a,b) => a-b), [...e.mentionIds].sort((a,b) => a-b));
    }
    if (!e.verified) {
      const withdrawal = p.payload.identityWithdrawal;
      assert.equal(withdrawal.version, 1); assert.equal(withdrawal.revision, e.revision);
      assert.deepEqual([...withdrawal.candidateIds].sort(), [...e.candidateIds].sort());
      assert.equal(p.lat ?? null, null); assert.equal(p.lng ?? null, null);
      assert.deepEqual(p.payload.imageIdentity.approved, []);
      assert.deepEqual(p.payload.mentionSources, []);
    } else assert.equal(p.payload.identityWithdrawal, undefined);
  }
}
