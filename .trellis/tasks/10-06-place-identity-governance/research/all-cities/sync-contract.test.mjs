import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {batchCities, validateScopeExpectations, validateBatchExport, validateImportPreflight} from './sync-contract.mjs';

test('景点评分策略必须核对重算分数和提及数，拒绝旧缓存分及缺失预期', () => {
  const city='北京', decision={city,entityId:'a',canonicalName:'测试公园',mergeEntityIds:[],
    overrides:{recommendationPolicy:'resolved_attraction_mentions_v1'}};
  const expected={city,id:'a',name:'测试公园',revision:2,verified:true,recommendScore:7,mentionCount:2};
  const output={city,places:[{id:'a',name:'测试公园',verified:true,
    payload:{identity:{version:2,entityId:'a',revision:2},recommendScore:7,mentionCount:2}}]};
  validateBatchExport(output,city,[decision],[expected]);
  assert.throws(()=>validateBatchExport(output,city,[decision],null),/冻结推荐分/);
  assert.throws(()=>validateBatchExport(output,city,[decision],[{...expected,recommendScore:100}]),/推荐分不一致/);
  assert.throws(()=>validateBatchExport(output,city,[decision],[{...expected,mentionCount:40}]),/提及数量不一致/);
});

test('新导入拒绝漏跑、失败、错误城市和过期前置检查，事后补证不能当作前置成功', () => {
  const exportedAt='2026-10-08T20:00:00Z';
  const valid={mode:'before',at:'2026-10-08T20:01:00Z',failures:[],cities:[{city:'济南',unchangedSincePreview:true}]};
  validateImportPreflight(valid,'济南',exportedAt);
  for(const invalid of [undefined,{...valid,mode:'after'},{...valid,failures:['检查失败']},
    {...valid,cities:[{city:'上海',unchangedSincePreview:true}]},{...valid,cities:[{city:'济南',unchangedSincePreview:false}]},
    {...valid,at:'2026-10-08T19:59:59Z'},{...valid,at:'invalid'},
    {importBeforeStateEqualsFrozenLibrary:true,preflightSucceeded:false}]) {
    assert.throws(()=>validateImportPreflight(invalid,'济南',exportedAt));
  }
});

const city = '测试', scopes = [{city, expectedRevisions: {old1: 1, old2: 1}}];
const expected = ['old1', 'old2'].map(id => ({city, id, name: id, revision: 2, verified: false, mentionIds: [], candidateIds: []}));
const data = () => ({city, places: expected.map(e => ({id:e.id, name:e.name, verified:false, lat:null, lng:null,
  payload:{identity:{version:2, entityId:e.id, revision:2}, mentionSources:[], imageIdentity:{approved:[]},
    identityWithdrawal:{version:1, revision:2, candidateIds:[]}}}))});

test('scope-only城市完整纳入且拒绝空批次', () => {
  assert.deepEqual(batchCities([], scopes), [city]);
  assert.deepEqual(batchCities([{city:'重庆'}], scopes), ['重庆', city]);
  assert.throws(() => batchCities([], []));
});
test('scope-only必须预期所有旧源的显式撤回', () => {
  assert.throws(() => validateScopeExpectations([], scopes, null), /导出预期/);
  assert.throws(() => validateScopeExpectations([], scopes, expected.slice(0,1)), /缺少导出预期/);
  validateScopeExpectations([], scopes, expected);
});
test('省略、保留活动、过期版本和残留提及均不能伪装成撤回', () => {
  validateBatchExport(data(), city, [], expected);
  for (const mutate of [d=>d.places.pop(), d=>d.places[0].verified=true,
    d=>d.places[0].payload.identity.revision=1, d=>d.places[0].payload.mentionSources.push({mentionId:1})]) {
    const d=data(); mutate(d); assert.throws(()=>validateBatchExport(d, city, [], expected));
  }
});
test('batch24历史混合纠正导出保持兼容', () => {
  const read = file => JSON.parse(fs.readFileSync(new URL(file, import.meta.url),'utf8'));
  const decisions=read('batch-24-decisions.json'), oldScopes=read('batch-24-scope-decisions.json');
  validateScopeExpectations(decisions, oldScopes, null);
  validateBatchExport(read('batch-24/sync-01/xhs-places-重庆.json'), '重庆', decisions, null);
});
test('仅实体修订可核验普通来源，不能漏验受控来源或scope的提及清单', () => {
  const ordinary={city,id:'spring',name:'spring',revision:2,verified:true};
  const exported={city,places:[{id:'spring',name:'spring',verified:true,
    payload:{identity:{version:2,entityId:'spring',revision:2}}}]};
  validateBatchExport(exported,city,[],[ordinary]);
  assert.throws(()=>validateScopeExpectations([],[{city,expectedRevisions:{spring:1}}],[ordinary]));
  exported.places[0].payload.mentionSources=[];
  assert.throws(()=>validateBatchExport(exported,city,[],[ordinary]),/漏验受控提及/);
  delete exported.places[0].payload.mentionSources;
  assert.throws(()=>validateBatchExport(exported,city,[],[{...ordinary,mentionIds:[1]}]),/须列出提及/);
});

test('混合批次允许普通类别修订，仍拒绝漏验受控主体、未知主体和无提及撤回', () => {
  const ordinary={city,id:'street',name:'street',revision:2,verified:true};
  const decisions=[{city,entityId:'street'}];
  validateScopeExpectations(decisions,scopes,[...expected,ordinary]);
  assert.throws(()=>validateScopeExpectations(decisions,scopes,[...expected,{...ordinary,id:'unknown'}]),/对应本批实体决定/);
  assert.throws(()=>validateScopeExpectations(decisions,scopes,[...expected,{...ordinary,verified:false}]),/伪装撤回/);
  assert.throws(()=>validateScopeExpectations(decisions,[...scopes,{city,expectedRevisions:{street:1}}],[...expected,ordinary]),/显式列出提及/);
});
