// 记录已验证的第43批与未处理发现，不提交、归档或标记完成。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const url=p=>new URL(p,import.meta.url),read=p=>JSON.parse(fs.readFileSync(url(p),'utf8'));
const write=(p,v,fresh=true)=>fs.writeFileSync(url(p),JSON.stringify(v,null,2)+'\n',{flag:fresh?'wx':'w'});
const dir='priority-cities/济南/',batch='all-cities/batch-43/',at=new Date().toISOString();
const pointer=read('cleaning-scope/current.json');assert.equal(pointer.latestAppliedEntityBatch,42);
assert.equal(pointer.cityReviewLedgers['济南'],'../'+dir+'review-21.json');assert.equal(pointer.userAcceptance,false);
assert.equal(pointer.imageComparisonPolicy.status,'deferred_by_user');assert.equal(pointer.latestIndependentPhotoBatch,3);
assert.deepEqual(pointer.pendingVerification,[]);assert.deepEqual(pointer.unappliedFindings,[]);
const applied=read('all-cities/batch-43-applied.json');assert.equal(applied.apply,true);assert.equal(applied.changes.length,4);
const sync=read(batch+'sync-01/sync-state.json').cities['济南'];assert.ok(sync.importedAt&&sync.relationsImportedAt&&sync.embeddingRunAt);
assert.equal(sync.relationSnapshotRevision,17);
const actual=read(dir+'main-sights-downstream-check-01.json');assert.equal(actual.consumedFieldsVerified,228);assert.equal(actual.assignmentRows,141);
const consumption=read(batch+'sync-01/main-sights-consumption-1791481250359.json');assert.equal(consumption.actualPlaceFacts,true);
assert.deepEqual(consumption.afterMinutes,{黑虎泉:50,千佛山:null});
const post=read(batch+'sync-01/post-import-check-1791481169454.json');
assert.equal(post.cities[0].photoFieldsPreserved,54);assert.equal(post.cities[0].strongUsable,6);
const isolated=read(batch+'scope-preview-1791481063617684100/report.json');assert.ok(isolated.idempotent&&isolated.reverseRollback);
const flow=read('all-cities/flow/run-45/report.json'),audit=read('all-cities/audit/run-41/report.json');
for(const r of [actual,consumption,post,isolated,flow,audit,read('all-cities/batch-43-upstream-check.json'),read(batch+'sync-01/verification-vectors.json')])assert.deepEqual(r.failures,[]);
assert.equal(read('all-cities/flow/run-45/cleanup.json').removed,true);
assert.deepEqual(read(dir+'scoped-duration-sample-audit-01.json').affectedExistingScopes,[]);
assert.match(fs.readFileSync(url('upstream-installed-place_identity_test_1791480924544.log'),'utf8'),/605 passed/);
assert.match(fs.readFileSync(url('downstream-place_identity_test_1791481241532.log'),'utf8'),/pass 1/);
const install=read('upstream-install.json');assert.equal(install.apply,true);
for(const f of install.files)for(const path of [url('upstream/'+f.path),'D:/Project/xhs-travel-pipeline/'+f.path])
  assert.equal(createHash('sha256').update(fs.readFileSync(path)).digest('hex'),f.after);
const stats={positive:flow.cities.reduce((n,c)=>n+c.probes.length,0),boundaries:flow.cities.reduce((n,c)=>n+c.negativeProbes.length,0),
  withdrawals:flow.cities.reduce((n,c)=>n+c.withdrawalProbes.length,0),pending:audit.cities.reduce((n,c)=>n+(c.statuses.PENDING??0),0)};
assert.deepEqual(stats,{positive:293,boundaries:113,withdrawals:47,pending:271});
const ledger=read(dir+'review-21.json'),originalRows=ledger.rows.map(r=>[r.entityId,r.name]);
const scopes=read('all-cities/batch-43-scope-decisions.json');
for(const result of actual.results) {
  const row=ledger.rows.find(r=>r.entityId===result.entityId);assert.ok(row);assert.equal(row.status,'pending');
  const scope=scopes.find(s=>s.expectedRevisions[result.entityId]!==undefined);assert.ok(scope);
  const confirmed=scope.assignments.filter(a=>a.entityId).map(a=>a.mentionId),pending=scope.assignments.filter(a=>!a.entityId).map(a=>a.mentionId);
  Object.assign(row,{currentName:row.name,currentRevision:3,changeBatch:43,reviewBatch:43,status:'reviewed_scope_partial',
    governedSourceIds:[scope.sourcePlaceId],scopeMentionIds:scope.assignments.map(a=>a.mentionId),currentMentionIds:confirmed,pendingScopeMentionIds:pending,
    dimensions:{...row.dimensions,identity:'main_subject_confirmed_with_partial_pending',category:'nature_confirmed',location:'existing_coordinates_preserved_review_pending',
      media:'deferred_by_user',consumedFacts:row.name==='黑虎泉'?'group_duration_and_boat_reservation_excluded_effective_50':'ascent_duration_excluded_visit_unknown'},
    followup:`第43批${confirmed.length}确认/${pending.length}待审已双同步，原ID/坐标保持、自然类revision3。${row.name==='黑虎泉'?'组合60分钟及错误reason、游船预约字段已排除，独立篇次时长50分钟。':'仅登顶的30分钟已排除，整次游览时长未知。'}位置和媒体仍待复核，未完成自查。`,
    mediaBoundary:'图片比对依用户要求暂缓；空图库字段保持不等于完整独立原图核查。',
    evidenceFiles:[...new Set([...(row.evidenceFiles??[]),dir+'main-sights-source-review-01.json',dir+'main-sights-downstream-check-01.json',
      'all-cities/batch-43-applied.json','all-cities/batch-43-upstream-check.json',batch+'sync-01/verification-vectors.json',batch+'sync-01/main-sights-consumption-1791481250359.json'])]});
}
const raw=read(dir+'run-1791385235272324900/sources.json');
const bytes=fs.readFileSync(url(batch+'sync-01/xhs-places-济南.json'));assert.equal(createHash('sha256').update(bytes).digest('hex'),sync.exportHash);
const exported=JSON.parse(bytes.toString('utf8')).places;
const findings=[];
for(const [name,ids,minutes,quote]of [
  ['解放阁',[11337,12565],60,'▪️黑虎泉+解放阁\n游玩1h｜免费｜可接泉水'],
  ['曲水亭街',[11340,12568],90,'▪️曲水亭街+百花洲\n游玩1.5h｜老济南街巷，有很多有意思的小店'],
  ['百花洲',[11341,12569],90,'▪️曲水亭街+百花洲\n游玩1.5h｜老济南街巷，有很多有意思的小店']]) {
  const row=ledger.rows.find(r=>r.name===name);assert.ok(row);
  const mentions=raw.mentions.filter(m=>ids.includes(m.id));assert.equal(mentions.length,2);
  assert.ok(mentions.every(m=>m.raw_note_id===2545&&m.fact_value.minutes===minutes));
  assert.ok(raw.notes.find(n=>n.id===2545).note_desc.includes(quote));
  const p=exported.find(p=>p.id===row.entityId);assert.ok(p);
  const finding={entityId:row.entityId,name,sourceId:row.sourceIds[0],mentionIds:ids,noteId:2545,
    status:'unapplied_shared_duration_findings',quote,originalMinutes:minutes,currentTypicalMinutes:p.payload.typicalVisitMinutes,
    additionalConcern:name==='曲水亭街'?'当前360分钟旧缓存尚须全量追溯':null,
    evidence:'../'+dir+'shared-route-duration-findings-01.json',fullReviewPassed:false};
  findings.push(finding);
  if(name==='解放阁') {
    assert.equal(row.status,'reviewed_identity');row.reopenedFrom={status:row.status,ledger:dir+'review-21.json',reason:'共同一小时被提取为单点，事实未完整治理'};
    row.status='pending';row.dimensions.consumedFacts='shared_duration_review_reopened';
  } else row.dimensions.consumedFacts='shared_duration_review_pending';
  row.reviewBatch=43;row.followup=`第43批交叉发现note2545两条提及误用组合${minutes}分钟；尚未应用治理，需完整scope核查。当前有效时长${p.payload.typicalVisitMinutes}分钟${name==='曲水亭街'?'另须追溯360分钟旧缓存':''}，不等于原始错误已排除。`;
  row.evidenceFiles=[...new Set([...(row.evidenceFiles??[]),dir+'shared-route-duration-findings-01.json'])];
}
assert.deepEqual(ledger.rows.map(r=>[r.entityId,r.name]),originalRows);assert.equal(ledger.rows.length,98);
assert.equal(ledger.rows.filter(r=>['reviewed_identity','reviewed_same_entity','reviewed_alias_redirect'].includes(r.status)).length,18);
assert.equal(ledger.rows.filter(r=>['reviewed_scope_partial','mixed_source_withdrawn_assignment_pending'].includes(r.status)).length,12);
Object.assign(ledger,{createdAt:at,previousLedger:dir+'review-21.json'});
Object.assign(ledger.summary,{fullyReviewed:18,remainingPrimaryToReview:76,partiallyReviewedScopeRows:12,otherPendingPrimaryRows:64,
  reviewedOrdinaryPrimaryRows:10,reopenedFactReviewRows:1,unappliedSemanticFindings:3,governedScopeMentions:278,pendingScopeMentions:91,
  confirmedBlackTigerMentions:36,confirmedQianfoshanMentions:10,
  fullyReviewedMeaning:'18原入选行对应16现行主体；第43批新增完整自查0，解放阁事实重开1行，用户未验收。',
  scopeProgressMeaning:'98行保留：4非地点、18行AI自查、76未完成（12部分scope、其余64）；141正式范围审核、4必去缺口，另3未应用发现。'});
const progress='第43批黑虎泉/千佛山60提及及42全文已完整scope并双同步：黑虎泉36确认/11待审、有效50分钟；千佛山10确认/3待审、登顶30分钟清除而游览时长未知。原ID/坐标保持，自然类revision3；组合时长、错误reason及船票预约事实投影修正，重复笔记时长不再加权。605上游全套、实际上下游导入回滚、2SQL/2真实向量、9独立主体边界及全仓/扩展typecheck通过。228地点/20关系/direct6，来源revision17；107原源/662提及/82全文、238旧行/54图片字段/9绑定及201历史行程保持。flow45为293正例/113边界/47撤回0失败，audit41为271PENDING。解放阁原组合60分钟及曲水亭街/百花洲组合90分钟另记3未应用发现，曲水亭街当前360分钟待追溯；解放阁旧AI自查重开。review22仍98行：4非地点、18行AI自查、76未完成（12部分scope、其余64）；141正式范围审核、4必去缺口。实体43/图片03，无未同步或向量待复核。图片暂缓、云南不处理，未验收不提交归档。';
const docs=[['../prd.md','## 已知事实\n','\n### 最新进展：第43批两景点事实与独立时长样本\n\n'+progress+'见[第43批记录](research/batch43-jinan-main-sights-20261009.md)。以下为历史快照。\n'],
  ['nine-cities-continuation-20261007.md','## 本轮断点\n','\n当前以review22为准。'+progress+'下一步解放阁/曲水亭街/百花洲完整scope核查，新回归flow46/audit42。以下为历史断点。\n']];
for(const [p,marker]of docs)assert.ok(fs.readFileSync(url(p),'utf8').includes(marker));
for(const p of [dir+'review-22.json',dir+'review-22.md',dir+'shared-route-duration-findings-01.json','cleaning-scope/current-before-batch43.json',dir+'main-sights-final-verification-01.json'])assert.ok(!fs.existsSync(url(p)));
write(dir+'shared-route-duration-findings-01.json',{readOnly:true,at,foundAfterBatch:43,applied:false,
  originalSourceFile:dir+'run-1791385235272324900/sources.json',originalSourceSha256:'9aa559e894e1cfbcdf74db2214c8eeb6614739064a96967780c6b32af59a889b',
  currentExport:batch+'sync-01/xhs-places-济南.json',currentExportSha256:sync.exportHash,findings,
  mentions:raw.mentions.filter(m=>findings.some(f=>f.mentionIds.includes(m.id))).map(m=>Object.fromEntries(['id','raw_note_id','name','reason','evidence_text','fact_type','fact_value','inputHash'].map(k=>[k,m[k]]))),
  note:{id:2545,title:raw.notes.find(n=>n.id===2545).note_title,desc:raw.notes.find(n=>n.id===2545).note_desc},imageComparison:'deferred_by_user'});
write(dir+'review-22.json',ledger);
fs.writeFileSync(url(dir+'review-22.md'),'# 济南98项重点清单核查台账（第43批）\n\n'+progress+'\n\n| 原名称 | 当前名称 | 版本 | 进度 | 说明 |\n| --- | --- | ---: | --- | --- |\n'+ledger.rows.map(r=>`| ${r.name} | ${r.currentName??r.name} | ${r.currentRevision} | ${r.status} | ${r.followup} |`).join('\n')+'\n',{flag:'wx'});
write('cleaning-scope/current-before-batch43.json',pointer);
Object.assign(pointer,{latestAppliedEntityBatch:43,latestFlow:'../all-cities/flow/run-45',latestAudit:'../all-cities/audit/run-41',
  progressNote:progress,progressUpdatedAt:at,unappliedFindings:findings,
  latestReviewEvidence:{file:'../'+dir+'main-sights-downstream-check-01.json',fullReviewsAdded:0,partiallyReviewed:2,fullReviewsReopened:1}});
pointer.cityReviewLedgers['济南']='../'+dir+'review-22.json';
Object.assign(pointer.currentScopeReviews,{addedPendingMentions:91,currentReviewRows:141,
  meaning:'50固定重点实体对加91当前提及待审；第43批新增黑虎泉11及千佛山3。另3新发现尚未应用，不提前计入正式队列。'});
pointer.currentScopeReviews.evidence.push('../'+dir+'main-sights-source-review-01.json');
for(const result of actual.results)pointer.resolvedFindings.push({entityId:result.entityId,name:result.name,resolvedByEntityBatch:43,
  status:'resolved_main_sight_scope_and_fact_projection_batch43',confirmed:result.confirmed,pending:result.pending,
  evidence:'../'+dir+'main-sights-downstream-check-01.json',fullReviewPassed:false});
write('cleaning-scope/current.json',pointer,false);
const task=read('../task.json');assert.equal(task.status,'in_progress');task.notes=progress+'见research/batch43-jinan-main-sights-20261009.md。';write('../task.json',task,false);
for(const [p,marker,insert]of docs) {let t=fs.readFileSync(url(p),'utf8').replace(marker,marker+insert);
  if(p==='../prd.md')t=t.replace('第42批已双同步，图片比对暂缓','第43批已双同步，图片比对暂缓');fs.writeFileSync(url(p),t);}
for(const kind of ['implement','check']) {const p=url(`../${kind}.jsonl`),entry={file:'.trellis/tasks/10-06-place-identity-governance/research/batch43-jinan-main-sights-20261009.md',reason:'第43批已同步，两景点事实修正；review22有3新未应用共享时长发现，解放阁事实重开，图片暂缓，不重放'};
  assert.ok(!fs.readFileSync(p,'utf8').includes(entry.file));fs.appendFileSync(p,JSON.stringify(entry)+'\n');}
write(dir+'main-sights-final-verification-01.json',{batch:43,at,stats,fullUpstreamTests:605,rootTypecheck:true,extendedTypecheck:true,
  fullReviewsAdded:0,fullReviewsReopened:1,remainingPrimaryToReview:76,partiallyReviewed:12,unappliedFindings:3,imageComparison:'deferred_by_user',userAcceptance:false});
console.log(JSON.stringify({batch:43,ledger:'review-22',fullyReviewed:18,remaining:76,partial:12,unapplied:3,stats}));
