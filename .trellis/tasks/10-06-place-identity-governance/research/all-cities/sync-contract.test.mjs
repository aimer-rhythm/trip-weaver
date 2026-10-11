import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {batchCities, validateScopeExpectations, validateBatchExport, validateImportPreflight, validateBatchName,
  assertOldMediaPreserved, validateStrictMediaPreview} from './sync-contract.mjs';

test('新增图片身份或撤回标记不能绕过既有封面、图库和高德图片保全', () => {
  const before={coverImage:'old.webp',imageGallery:[{key:'old.webp'}],amapPhoto:null};
  assertOldMediaPreserved(before,{...before,imageIdentity:{approved:[]}},'fixture');
  assertOldMediaPreserved({}, {coverImage:null,imageGallery:[]}, 'empty');
  for (const patch of [{coverImage:null},{imageGallery:[]},{amapPhoto:'new.webp'}])
    for (const identity of [{imageIdentity:{approved:[]}},{canonicalRedirectTo:'next'},{}])
      assert.throws(()=>assertOldMediaPreserved(before,{...before,...patch,...identity},'fixture'),/旧图片字段变化/);
});

test('正式导入须有绑定当前冻结的严格媒体及实际消费预演，旧跳过检查报告被拒绝', () => {
  const state={city:'厦门',libraryHash:'library',placesHash:'places',relationsHash:'relations'};
  const valid={...state,preview:true,failures:[],mediaPreservationPolicy:'all_existing_fields_and_facts',
    photosPreserved:true,photoConsumptionPreserved:true,reverseRollback:true,repeatedImport:true};
  validateStrictMediaPreview(valid,state);
  for(const patch of [{mediaPreservationPolicy:undefined},{photoConsumptionPreserved:undefined},
    {photosPreserved:false},{reverseRollback:false},{repeatedImport:false},{preview:false},
    {libraryHash:'old'},{placesHash:'old'},{relationsHash:'old'},{city:'上海'},{failures:['failed']}])
    assert.throws(()=>validateStrictMediaPreview({...valid,...patch},state));
});

test('批次跨百兼容历史版本标签，拒绝路径穿越及非完整标签', () => {
  for (const batch of ['batch-09', 'batch-96-v2', 'batch-100', 'batch-101-v3']) {
    assert.equal(validateBatchName(batch), batch);
  }
  for (const batch of [undefined, null, 100, 'batch-1', '../batch-100', 'batch-100/../../',
    'batch-100\\file', 'batch-100-v', 'batch-100\n', 'batch-100 ']) {
    assert.throws(() => validateBatchName(batch));
  }
});

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

test('仅名称纠错必须冻结逐提及清单，完整scope不得借此省略事实媒体合同', () => {
  const scope = {city, mode:'name_correction', expectedRevisions:{a:1}, assignments:[{mentionId:7,entityId:'a'}]};
  const decision = {city, entityId:'a',canonicalName:'甲公园',mergeEntityIds:[],overrides:{}};
  const expected = {city,id:'a',name:'甲公园',revision:3,verified:true,scopeMode:'name_correction',correctionMentionIds:[7],excludedNames:['错名']};
  validateScopeExpectations([decision],[scope],[expected]);
  assert.throws(()=>validateScopeExpectations([decision],[{...scope,mode:'facts'}],[expected]));
  assert.throws(()=>validateScopeExpectations([decision],[scope],[{...expected,correctionMentionIds:[]}]));
  const output={city,places:[{id:'a',name:'甲公园',verified:true,payload:{aliases:['甲公园'],identity:{version:2,entityId:'a',revision:3,memberNames:['甲公园']}}}]};
  validateBatchExport(output,city,[decision],[expected]);
  for (const mutate of [p=>p.aliases.push('错名'),p=>p.identity.memberNames.push('错名'),p=>p.imageIdentity={},p=>p.mentionSources=[]]) {
    const bad=structuredClone(output); mutate(bad.places[0].payload);
    assert.throws(()=>validateBatchExport(bad,city,[decision],[expected]));
  }
});
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
