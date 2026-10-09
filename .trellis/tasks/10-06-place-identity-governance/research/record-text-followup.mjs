// 文本补查台账；不变更实体、不提交或归档。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const url=p=>new URL(p,import.meta.url);
const read=p=>JSON.parse(fs.readFileSync(url(p),'utf8'));
const write=(p,v,fresh=true)=>fs.writeFileSync(url(p),JSON.stringify(v,null,2)+'\n',{flag:fresh?'wx':'w'});
const dir='priority-cities/济南/';
const pointer=read('cleaning-scope/current.json');
assert.equal(pointer.latestAppliedEntityBatch,40);
assert.equal(pointer.cityReviewLedgers['济南'],'../'+dir+'review-18.json');
const packet=read(dir+'shops-source-packet-01.json');
assert.equal(packet.entityBatch,40);assert.equal(packet.rawSourcesUnchanged,107);assert.equal(packet.originalMentionsUnchanged,662);
assert.equal(packet.mentions.length,4);assert.equal(packet.notes.length,3);
const zoo=read(dir+'zoo-baike-fetch-20261009.json'),town=read(dir+'mingshui-ctrip-fetch-20261009.json');
assert.ok(zoo.ok && town.ok);
assert.ok(zoo.content.includes('埠村街道') && town.content.includes('章丘供销大厦'));
const retry=read(dir+'zoo-name-search-retry-20261009.json');
assert.equal(retry.sources.length,0);assert.equal(retry.extra_sources.length,0);
const geo=read(dir+'geo-15.json');
const old=read('all-cities/batch-40-source.json').groups.find(g=>g.source.id===5974).source;
const toilet=geo.find(p=>p.name==='公厕' && p.gcj02.latitude===old.latitude && p.gcj02.longitude===old.longitude);
assert.ok(toilet);
const original=packet.notes.find(n=>n.id===2795);
assert.ok(original.note_desc.includes('第二个机位搜索“尚泉尚水茶馆”（图5位置），其前面平台即可拍摄湖面与楼阁全景'));
const ledger=read(dir+'review-18.json'),ids=ledger.rows.map(r=>r.entityId);
for(const g of packet.groups) {
  const row=ledger.rows.find(r=>r.entityId===g.entity.entity_id);assert.ok(row);
  assert.equal(row.currentRevision,g.entity.revision);assert.equal(row.status,'pending');
  row.dimensions.media='deferred_by_user';
  row.evidenceFiles=[...new Set([...(row.evidenceFiles??[]),dir+'shops-source-packet-01.json','text-followup-20261009.md'])];
  if(row.name==='尚泉尚水茶馆') {
    row.dimensions.identity='text_confirms_front_platform_not_cafe';
    row.dimensions.consumedFacts='platform_facts_still_exported_as_cafe_pending_correction';
    row.followup='2795全文确认茶馆仅为导航参照，实际推荐前面平台；完整scope与主名/排除裸名治理尚未应用。第30批清空旧错点继续保持，图片暂不比对，完整自查未通过。';
  } else if(['VILLASHAKA','BLUEDUCK骨董屋'].includes(row.name)) {
    row.dimensions.identity='text_supports_separate_store';
    row.followup='2573正文分别介绍咖啡店和vintage杂货铺；同坐标不合并。位置、真实检索及其他维度继续，图片暂不比对，完整自查未通过。';
  } else row.followup='2817文字将其标为白底书法济南文字墙；店铺本体/外墙机位具体边界与位置继续，图片暂不比对。';
}
assert.deepEqual(ledger.rows.map(r=>r.entityId),ids);
ledger.createdAt=new Date().toISOString();ledger.previousLedger=dir+'review-18.json';
ledger.summary.unappliedSemanticFindings=1;
write(dir+'review-19.json',ledger);
const note='第40批保持双同步完成；追加园区正文与4小店/机位的4提及/3原文补查。尚泉尚水茶馆12653明确是前平台摄影点，身份修正尚未应用；动物园旧点与公厕POI一致，但原文名称到具体园区的对应继续补证。review19仍98行、19行AI自查、75未完成，110正式待审和4必去缺口保持。图片暂不比对，实体40/图片03、flow42/audit38，无batch41或未同步步骤。未验收，不提交归档。';
fs.writeFileSync(url(dir+'review-19.md'),'# 济南重点清单文本补查\n\n'+note+'\n\n详见[text-followup-20261009.md](../../text-followup-20261009.md)。\n',{flag:'wx'});
write('cleaning-scope/current-before-text-followup.json',pointer);
pointer.cityReviewLedgers['济南']='../'+dir+'review-19.json';pointer.progressUpdatedAt=ledger.createdAt;
pointer.progressNote=note;
pointer.unappliedFindings.push({entityId:'2c8372d3a47dbcb68abd998af495436d',name:'尚泉尚水茶馆',sourceId:5945,mentionIds:[12653],
  status:'text_confirmed_platform_identity_correction_unapplied',evidence:'../'+dir+'shops-source-packet-01.json',
  next:'完整scope及excludeNames纠正为前平台，保留原ID、原文和无坐标状态；按既有流程预演、应用、双同步及验证。'});
pointer.latestReadOnlyFindings={...pointer.latestReadOnlyFindings,textFollowup:'../text-followup-20261009.md',shopsPacket:'../'+dir+'shops-source-packet-01.json',
  zooOldPointMatchesToilet:true,zooNameLinkUnverified:true,imagesCompared:false};
write('cleaning-scope/current.json',pointer,false);
const task=read('../task.json');assert.equal(task.status,'in_progress');task.notes=note+'见research/batch40-jinan-descriptions-20261009.md及research/text-followup-20261009.md。';write('../task.json',task,false);
for(const [file,marker] of [['../prd.md','## 已知事实\n'],['nine-cities-continuation-20261007.md','## 本轮断点\n']]) {
  let content=fs.readFileSync(url(file),'utf8');assert.ok(content.includes(marker));
  content=content.replace(marker,marker+'\n### 第40批后文本补查\n\n'+note+'详见'+(file==='../prd.md'?'research/':'')+'text-followup-20261009.md。以下为历史快照。\n');
  fs.writeFileSync(url(file),content);
}
for(const kind of ['implement','check']) {
  const entry={file:'.trellis/tasks/10-06-place-identity-governance/research/text-followup-20261009.md',
    reason:'review19：图片比对暂缓；尚泉尚水12653前平台已具文字依据，下一批优先纠正，动物园名称到园区仍缺证据，无batch41'};
  fs.appendFileSync(url(`../${kind}.jsonl`),JSON.stringify(entry)+'\n');
}
write(dir+'text-followup-evidence-01.json',{at:ledger.createdAt,entityBatch:40,cityLedger:'review-19.json',
  files:['shops-source-packet-01.json','geo-15.json','zoo-baike-fetch-20261009.json','mingshui-ctrip-fetch-20261009.json',
    'zoo-amap-fetch-20261009.json','zoo-name-search-20261009.json','zoo-name-search-retry-20261009.json'].map(f=>({file:dir+f,
      sha256:createHash('sha256').update(fs.readFileSync(url(dir+f))).digest('hex')})),
  fullReviewsAdded:0,imagesCompared:false,userAcceptance:false});
console.log(JSON.stringify({ledger:'review-19',entityBatch:40,fullReviewsAdded:0,remaining:75,unappliedIdentityFinding:12653}));
