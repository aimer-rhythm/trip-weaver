// 仅记录已安装协议及只读研究；禁止递增实体批次、提交、归档或重放旧批次。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const root=new URL('./',import.meta.url),url=p=>new URL(p,root);
const read=p=>JSON.parse(fs.readFileSync(url(p),'utf8'));
const hash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const json=v=>JSON.stringify(v,null,2)+'\n';
const at=new Date().toISOString(),dir='priority-cities/成都/';
const reportFile='numbered-warning-checkpoint-20261009.md';
const pointer=read('cleaning-scope/current.json'),before=structuredClone(pointer),task=read('../task.json');
assert.equal(pointer.latestAppliedEntityBatch,69);assert.equal(pointer.latestFlow,'../all-cities/flow/run-71');assert.equal(pointer.latestAudit,'../all-cities/audit/run-68');
assert.deepEqual(pointer.pendingVerification,[]);assert.equal(pointer.userAcceptance,false);assert.equal(task.status,'in_progress');
assert.equal(pointer.cityReviewLedgers['成都'],'../'+dir+'review-05.json');assert.equal(pointer.unappliedFindings.length,4);
assert.equal(pointer.imageComparisonPolicy.status,'deferred_by_user');assert.equal(pointer.mapCredentialGate.status,'rotation_required');
const source=read(dir+'wuhou-jinli-source-01.json'),review=read(dir+'wuhou-jinli-source-review-01.json');
assert.equal(hash(url(dir+'wuhou-jinli-source-01.json')),'d49aa33671cdf873ed879c9f93e2849e05db4a673fc4d3f0dfa506dd0d6191d6');
assert.equal(source.mentions.length,43);assert.equal(source.noteDetails.length,28);assert.equal(source.cityWideAssignments,47);
assert.equal(review.mentionReviews.length,43);assert.deepEqual(review.mentionReviews.map(m=>m.id).sort((a,b)=>a-b),source.mentions.map(m=>m.id).sort((a,b)=>a-b));
assert.ok(review.mentionReviews.every(m=>m.businessApplied===false));assert.equal(review.fullReviewPassed,false);assert.equal(review.businessScopeApplied,false);
const real=read(dir+'numbered-warning-real-proof-01.json'),content=read(dir+'wuhou-jinli-content-preflight-01.json'),media=read(dir+'wuhou-jinli-photo-preflight-01.json');
for(const r of [real,content,media])assert.deepEqual(r.failures,[]);
assert.equal(real.validatedQuotes,2);assert.equal(real.rejectedMutations,10);assert.equal(real.businessScopeApplied,false);assert.equal(real.noteUnchanged,true);
assert.ok(content.wuhou.unboundProfileReplaced&&content.wuhou.explicitBindingPreservesExactContentInMemory&&content.jinli.staticPlanningReintroducesName);
assert.ok(content.hypotheticalInputsOnly&&media.hypotheticalScopeOnly&&media.actualFactsChecked);assert.equal(media.mockEnqueues,2);assert.equal(media.actualEnqueues,0);
assert.deepEqual(media.results,[{name:'武侯祠',factsImages:0,lookupImages:0,independentSources:5,eligible:0,assignments:0},{name:'锦里',factsImages:0,lookupImages:0,independentSources:0,eligible:0,assignments:0}]);
const protocolDir='note-warning-preview-1791510212253/numbered/';
const protocolNames=fs.readdirSync(url(protocolDir)).filter(n=>/^downstream-verification-\d+\.json$/.test(n));assert.equal(protocolNames.length,1);
const protocolFile=protocolDir+protocolNames[0],protocol=read(protocolFile);assert.deepEqual(protocol.failures,[]);
for(const key of ['actualDualImport','authorWarningPreserved','otherFactsExcluded','warningRemovalAuthoritative','sqlIdentity','oldVersionRejected','idempotent','reverseRollback'])assert.equal(protocol[key],true);
const logs={upstreamFull:'upstream-full-place_identity_test_1791510199382.log',stagedWarning:'upstream-stage-place_identity_test_1791510212253.log',
  installedWarning:'upstream-installed-place_identity_test_1791510390012.log',downstreamProtocol:'downstream-place_identity_test_1791510297204.log',mediaPreflight:'downstream-place_identity_test_1791510317961.log'};
assert.match(fs.readFileSync(url(logs.upstreamFull),'utf8'),/743 passed, 1 deselected/);
for(const key of ['stagedWarning','installedWarning'])assert.match(fs.readFileSync(url(logs[key]),'utf8'),/28 passed/);
for(const key of ['downstreamProtocol','mediaPreflight'])assert.match(fs.readFileSync(url(logs[key]),'utf8'),/pass 1/);
const install=read('upstream-install.json');assert.equal(install.files.length,65);
const changed=install.files.filter(f=>f.before!==f.after);assert.equal(changed.length,3);
assert.deepEqual(changed.map(f=>f.path).sort(),['app/clean/note_text_warnings.py','tests/test_note_text_warning_lines.py','tests/test_note_text_warnings_db.py']);
for(const f of install.files)for(const path of [url('upstream/'+f.path),'D:/Project/xhs-travel-pipeline/'+f.path])assert.equal(hash(path),f.after);
assert.equal(real.validatorSha256,hash(url('upstream/app/clean/note_text_warnings.py')));
const ledger=read(dir+'review-05.json'),oldLedger=structuredClone(ledger);
const followups={
  '武侯祠':'26提及及相关原文只读审阅。合游150分钟、住宿片区字段须正式排除，4条原负评及历史教师条件优惠保留；完整scope会替换旧3条web看点，已复现并验证既有绑定机制的内存保全能力，尚未写入。两条网页营业口径冲突，旧点未新核；facts与lookup无图。',
  '锦里':'17提及只读审阅。主巷为路线子项，静态planning会在身份合同排除后补回主巷，已复现；住宿reason与含交通75分钟须正式处理。旧正负评价保留，编号原评价协议已通过但scope未应用；market类别仅为研究建议，旧点未新核，facts与lookup无图。',
};
for(const row of ledger.rows)if(Object.hasOwn(followups,row.name)){
  assert.equal(row.status,'pending');assert.equal(row.currentRevision,1);
  Object.assign(row,{readOnlyResearchAfterEntityBatch:69,researchEvidence:[dir+'wuhou-jinli-source-review-01.json',dir+'wuhou-jinli-content-preflight-01.json',dir+'wuhou-jinli-photo-preflight-01.json',dir+'numbered-warning-real-proof-01.json'],followup:followups[row.name]});
}
for(let i=0;i<ledger.rows.length;i++)if(!Object.hasOwn(followups,ledger.rows[i].name))assert.deepEqual(ledger.rows[i],oldLedger.rows[i]);
assert.deepEqual(ledger.rows.map(r=>[r.entityId,r.status,r.currentRevision,r.dimensions]),oldLedger.rows.map(r=>[r.entityId,r.status,r.currentRevision,r.dimensions]));
assert.deepEqual(ledger.summary,oldLedger.summary);assert.deepEqual(ledger.dependencyRows,oldLedger.dependencyRows);
ledger.createdAt=at;ledger.previousLedger=dir+'review-05.json';ledger.researchCheckpoint={afterEntityBatch:69,businessChanges:0,fullReviewsAdded:0,sourceReview:dir+'wuhou-jinli-source-review-01.json'};
const progress='实体69之后完成编号标题原评价协议安装与只读研究：上游743通过/1真实地图检查排除，暂存及已安装警示专项各28通过，编号夹具实际双导入/移除/旧版本拒绝/幂等/逆序回滚通过。真实note948两段完整原评价通过、10变体拒绝，未创建业务scope。武侯祠/锦里2源43提及、27直接正文及补充948已逐项记录；武侯祠150分钟为含锦里路线，锦里75分钟含打车，住宿片区描述和主巷粒度待正式治理。已复现未绑定web profile被替换及静态planning补回主巷。两点实际facts/lookup均无图，mock2/真实队列0仅为预检。成都review06仍0完整/113未完成（3部分scope、4位置部分、1类别部分、105其余），47分配不变；未应用发现4→6。实体69/flow71/audit68、济南review45、原范围和无待同步状态保持。扩展typecheck通过；不看图、地图凭据待轮换，未验收不提交归档。';
pointer.progressNote=progress;pointer.progressUpdatedAt=at;pointer.cityReviewLedgers['成都']='../'+dir+'review-06.json';
pointer.latestReadOnlyFindings.chengduWuhouJinliFollowup='../'+dir+'wuhou-jinli-source-review-01.json';
pointer.latestReviewEvidence={city:'成都',file:'../'+dir+'wuhou-jinli-source-review-01.json',supplement:'../'+dir+'numbered-warning-real-proof-01.json',fullReviewsAdded:0,partiallyReviewedScope:0,fullReviewsReopened:0,readOnlyResearch:true,afterEntityBatch:69};
pointer.latestNoteTextWarningProtocol={afterEntityBatch:69,kind:'numbered_subject_heading_extension',installedFiles:65,changedFiles:3,migration:null,hashVersion:'note_text_warning_v1',
  allowedQuoteLines:[1,2],textWarningsAdded:0,businessScopeApplied:false,design:'../numbered-warning-design-20261009.md',downstreamVerification:'../'+protocolFile,
  realSourceVerification:'../'+dir+'numbered-warning-real-proof-01.json',installedTests:'../'+logs.installedWarning,previousProtocol:before.latestNoteTextWarningProtocol};
for(const [name,id,sid,mentions]of [['武侯祠','300d2ae16b4e2787a84d7661a06f580e',1688,[3818,4031]],['锦里','8a433260acdd259716088f8009e0fbdc',1689,[3702,3822,4061]]])
  pointer.unappliedFindings.push({entityId:id,name,sourceId:sid,mentionIds:mentions,status:name==='武侯祠'?'unapplied_scope_preserve_web_profile_and_exclude_area_route_facts':'unapplied_subarea_export_boundary_and_scope_facts',
    reason:followups[name],discoveredAfterEntityBatch:69,evidence:'../'+dir+'wuhou-jinli-source-review-01.json',fullReviewPassed:false,actualConsumptionEvidence:'../'+dir+'wuhou-jinli-photo-preflight-01.json'});
assert.deepEqual(pointer.unappliedFindings.slice(0,4),before.unappliedFindings);assert.equal(pointer.unappliedFindings.length,6);
for(const key of ['summary','scopeSha256','currentScopeReviews','latestAppliedEntityBatch','latestFlow','latestAudit','pendingVerification','latestIndependentPhotoBatch','unappliedMetadataFindings','resolvedMetadataFindings','latestMetadataRefresh','cityMetadataRefreshes','mapCredentialGate','imageComparisonPolicy','resolvedFindings'])assert.deepEqual(pointer[key],before[key]);
assert.equal(pointer.cityReviewLedgers['济南'],before.cityReviewLedgers['济南']);task.notes=progress+'见research/'+reportFile+'。';
const report=`# 编号原评价协议与武侯祠／锦里检查点\n\n${progress}\n\n## 已安装与验证\n\n[协议设计](numbered-warning-design-20261009.md)保留七字段、原指纹和存储；允许严格编号格式的主体标题，quote不改写。已安装65文件中3文件更新，无迁移、无上游web重启。真实[两段原文校验](${dir}numbered-warning-real-proof-01.json)与[合成编号端到端验证](${protocolFile})分别留证；后者是隔离夹具，不是成都业务scope应用。\n\n测试：上游743通过/1真实地图检查排除；暂存及已安装警示专项各28通过；实际下游编号协议1项通过；实际媒体预检1项通过；新增预检已纳入扩展tsconfig并通过类型检查。日志名与文件hash见[校验记录](${dir}numbered-warning-checkpoint-verification-01.json)。本轮没有改动生产TypeScript；全仓typecheck沿用第69批成功记录。\n\n## 逐提及研究与下一步\n\n[43条逐项结论](${dir}wuhou-jinli-source-review-01.md)及[带日期/指纹的JSON](${dir}wuhou-jinli-source-review-01.json)记录27篇直接正文与补充note948。原正反意见、日期、历史教师优惠和note900的null分析保留。没有查看图片或把所有分析字段宣称已审。\n\n1. 武侯祠150分钟路线包含锦里，住宿片区reason/evidence需按主体排除。完整scope前必须保全3条网页看点，现行开放时间冲突仍未定；不直接给缓存补绑定。\n2. 锦里主巷为子项。已[复现静态补名](${dir}wuhou-jinli-content-preflight-01.json)，先治理最终导出的主巷入口，再做正式scope。住宿reason和含打车75分钟应分别处置；当前导出无独立时长，不得因scope引入该75分钟。\n3. 两处实际facts与专用lookup无图，武侯祠5个独立来源均不eligible，锦里0来源；[媒体预检](${dir}wuhou-jinli-photo-preflight-01.json)只是按假设scope门禁比较，正式应用仍需真实导出、双导入、字段/旧ID/媒体/行程核对。\n\n不创建batch70、不重放68/69。下一实体批次70、flow72、audit69，成都下次review07。当前实体仍69，累计flow71为338正例/113边界/52撤回零失败，audit68为313 PENDING；本次未重跑这两份未变数据的历史验证。冻结范围978主体+56依赖/1135源、183范围待审及4必去缺口不变。没有用户验收，不提交、归档或标记完成。\n`;
const verification={createdAt:at,kind:'research_and_installed_protocol_checkpoint',entityBatchUnchanged:69,fullReviewsAdded:0,
  tests:{upstreamFull:743,liveMapTestsDeselected:1,stagedWarning:28,installedWarning:28,downstreamProtocol:1,mediaPreflight:1,realQuotes:2,rejectedRealVariants:10},logs,
  installedFilesHashVerified:65,changedFiles:3,extendedTypecheck:{passed:true,command:'node node_modules/typescript/bin/tsc --noEmit -p .trellis/tasks/10-06-place-identity-governance/research/tsconfig.verify-joint.json'},
  sources:[dir+'wuhou-jinli-source-01.json',dir+'wuhou-jinli-source-review-01.json',dir+'numbered-warning-real-proof-01.json',dir+'wuhou-jinli-content-preflight-01.json',dir+'wuhou-jinli-photo-preflight-01.json',protocolFile,'upstream-install.json'].map(file=>({file,sha256:hash(url(file))})),
  userAcceptance:false,businessScopeApplied:false,failures:[]};
const fresh=new Map([[reportFile,report],['numbered-warning-checkpoint-before.json',json(before)],[dir+'review-06.json',json(ledger)],
  [dir+'review-06.md','# 成都113项重点台账（实体69之后的研究检查点）\n\n'+progress+'\n\n| 原名称 | 当前名称 | 版本 | 进度 | 说明 |\n| --- | --- | ---: | --- | --- |\n'+ledger.rows.map(r=>`| ${r.name} | ${r.currentName} | ${r.currentRevision} | ${r.status} | ${r.followup} |`).join('\n')+'\n'],
  [dir+'numbered-warning-checkpoint-verification-01.json',json(verification)]]);
for(const file of fresh.keys())assert.ok(!fs.existsSync(url(file)),file+'已存在，不可重放');
assert.ok(fs.readFileSync(new URL('../../../spec/server/backend/place-identity.md',import.meta.url),'utf8').includes('## 59.'));
const prd=fs.readFileSync(url('../prd.md'),'utf8'),continuation=fs.readFileSync(url('nine-cities-continuation-20261007.md'),'utf8');
const range=prd.split('\n').find(line=>line.startsWith('- 用户最新明确：'));assert.ok(range);
const nextPrd=prd.replace(range,'- 用户最新明确：**云南不处理，继续其他城市直到验收通过**。九城固定978主体＋56依赖/1135源，183范围待审及4必去缺口。当前实体69；编号标题协议已安装，武侯祠/锦里43提及只读研究，业务scope尚未应用。未应用发现6项，成都review06仍113未完成，济南review45仍76未完成。图片暂缓、地图凭据待轮换，未获用户验收。')
  .replace('## 已知事实\n','## 已知事实\n\n### 最新进展：实体69之后编号原评价与两地点研究\n\n'+progress+'见[研究检查点](research/'+reportFile+')。以下为历史快照。\n');
const nextContinuation=continuation.replace('## 本轮断点\n','## 本轮断点\n\n'+progress+'下一实体70/flow72/audit69，成都下一review07。禁止重放record-batch68、record-batch69及本次record-numbered-warning-checkpoint；本次已安装编号扩展、真实proof和研究预检已全部落盘。见['+reportFile+']('+reportFile+')。以下为历史断点。\n');
assert.notEqual(nextPrd,prd);assert.notEqual(nextContinuation,continuation);
const replacements=new Map([['../task.json',json(task)],['../prd.md',nextPrd],['nine-cities-continuation-20261007.md',nextContinuation]]);
for(const kind of ['implement','check']){
  const file=`../${kind}.jsonl`,old=fs.readFileSync(url(file),'utf8');
  const entries=[{file:'.trellis/tasks/10-06-place-identity-governance/research/'+reportFile,reason:'实体69后已安装编号原评价协议，43提及研究与两处消费阻点已复现；review06，未应用batch70，不看图不提交归档'},
    {file:'.trellis/tasks/10-06-place-identity-governance/research/numbered-warning-design-20261009.md',reason:'严格编号标题格式、完整原quote及真实来源校验；既有指纹存储不变，无迁移'}];
  for(const entry of entries)assert.ok(!old.includes(entry.file));replacements.set(file,old+entries.map(e=>JSON.stringify(e)+'\n').join(''));
}
for(const [p,v]of fresh)fs.writeFileSync(url(p),v,{flag:'wx'});
for(const [p,v]of replacements)fs.writeFileSync(url(p),v);
fs.writeFileSync(url('cleaning-scope/current.json'),json(pointer));
console.log(JSON.stringify({entityBatch:69,chengduLedger:'review-06',businessScopeApplied:false,unappliedFindings:6,fullReviewsAdded:0,pendingVerification:[],userAcceptance:false}));
