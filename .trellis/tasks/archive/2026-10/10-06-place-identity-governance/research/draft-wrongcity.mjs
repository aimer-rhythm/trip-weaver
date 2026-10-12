import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=new URL('./',import.meta.url),file='cleaning-scope/run-1791371057197/wrongcity-scope-source-01.json';
const bytes=await readFile(new URL(file,root)),snapshot=JSON.parse(bytes),hash=createHash('sha256').update(bytes).digest('hex');
// 使用落盘CRLF字节摘要；首轮冻结日志误报了写入前LF字符串摘要，原文件保持不变。
assert.equal(hash,'addf1eeb08b00d1dec9874b4f492adc34a2375c18bd47ec24fe2f3477382da2c');
const scopes=[],expected=[];
for(const g of snapshot.groups){
  assert.equal(g.city,'成都');assert.equal(g.sources.length,1);assert.equal(g.mentions.length,1);
  assert.equal(g.images.length,0);assert.equal(g.existingScopes.length,0);assert.equal(g.reviews.length,0);
  const s=g.sources[0],m=g.mentions[0],e=s.entity;
  assert.equal(m.raw_note_id,759);assert.match(m.note_title,/北京夏日必逛八条Citywalk路线/);
  assert.equal(e.revision,1);assert.equal(e.redirect_to,null);assert.equal(e.status,'ACTIVE');
  const conclusion='原笔记标题及全文八条路线均在北京，被错误收录到成都。该源只有本篇一条提及，无成都归属证据；同名成都POI及中心兜底坐标不能作为证明。逐提及隔离并撤回成都候选，保留原文、旧ID和审计，不跨城合并。null归属按现有契约保留待审，不将隔离计为北京具体身份已经解决。';
  scopes.push({key:`all-cities-20261007-batch-29-wrongcity-${s.id}`,city:g.city,sourcePlaceId:s.id,
    expectedSourceHash:s.sourceHash,expectedScopeRevision:0,expectedRevisions:{[e.entity_id]:e.revision},
    assignments:[{mentionId:m.id,inputHash:m.inputHash,entityId:null}],
    evidence:[{kind:'reviewed_wrong_city_source',file,sha256:hash,sourcePlaceIds:[s.id],mentionIds:[m.id],
      noteId:759,quote:m.note_title,conclusion}]});
  expected.push({city:g.city,id:e.entity_id,name:e.canonical_name,revision:e.revision+1,verified:false,mentionIds:[],candidateIds:[]});
}
assert.equal(scopes.length,37);
for(const [kind,value] of Object.entries({'decisions':[],'scope-decisions':scopes,'export-expectations':expected}))
  await writeFile(new URL(`all-cities/batch-29-${kind}.json`,root),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({batch:'batch-29',scopes:37,withdrawals:37,pendingMentions:37,merges:0}));
