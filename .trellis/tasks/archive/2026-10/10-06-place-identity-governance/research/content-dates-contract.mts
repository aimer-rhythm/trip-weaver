// 元数据刷新只允许已溯源日期与compiledAt变化，所有其他地点字段（含向量）严格保全。
import assert from 'node:assert/strict';
import {placeEmbeddingText} from '../../../../apps/server/src/lib/placeEmbeddingText';

export function verifyContentDates(before:any[],after:any[],exported:any[],changes:any[]) {
  const byId=new Map(after.map(p=>[p.id,p])),exports=new Map(exported.map(p=>[p.id,p]));
  const expectedChanges=new Map(changes.map(r=>[`${r.entityId}/${r.highlightIndex}`,r]));
  const seen=new Set<string>();let fields=0,embeddings=0;
  assert.equal(after.length,before.length);
  for(const old of before) {
    const current=byId.get(old.id);assert.ok(current);const expected=structuredClone(old),source=exports.get(old.id);
    if(source?.payload?.content) {
      const content=current.payload.content,prior=expected.payload.content;
      assert.deepEqual(content,source.payload.content,`${old.name}/正式消费内容`);
      assert.equal(content.highlights.length,prior.highlights.length);
      content.highlights.forEach((h:any,i:number)=>{
        if(h.observedAt!==prior.highlights[i].observedAt) {
          const key=`${old.id}/${i}`,change=expectedChanges.get(key);assert.ok(change,key);
          assert.equal(prior.highlights[i].observedAt,change.beforeObservedAt);
          assert.equal(h.observedAt,change.observedAt);prior.highlights[i].observedAt=h.observedAt;seen.add(key);
        }
      });
      prior.compiledAt=content.compiledAt;
    }
    assert.deepEqual(current,expected,`${old.name}/其他地点字段`);
    assert.equal(placeEmbeddingText(current),placeEmbeddingText(old));
    if(old.embedding)embeddings++;
    fields+=['coverImage','imageGallery','amapPhoto'].filter(k=>old.payload?.[k]!==undefined).length;
  }
  assert.deepEqual([...seen].sort(),[...expectedChanges.keys()].sort());
  return {rows:before.length,exported:exported.length,changedHighlights:seen.size,changedEntities:new Set(changes.map(r=>r.entityId)).size,
    photoFieldsPreserved:fields,existingEmbeddingsPreserved:embeddings};
}

export function verifyEvidenceRefresh(before:any[],after:any[],exported:any[],startedAt:number,finishedAt:number) {
  const byId=new Map(after.map(r=>[r.id,r]));assert.equal(after.length,before.length);
  const sources=new Set(exported.flatMap(p=>(p.evidence??[]).map((e:any)=>JSON.stringify([p.id,e.kind,e.content,e.sourceUrl??'']))));
  let refreshed=0;
  for(const old of before) {
    const current=byId.get(old.id);assert.ok(current);const expected={...old};
    if(current.fetched_at!==old.fetched_at) {
      assert.ok(current.kind.startsWith('xhs_'));
      assert.ok(sources.has(JSON.stringify([current.place_id,current.kind,current.content,current.source_url])));
      assert.ok(Date.parse(current.fetched_at)>=startedAt&&Date.parse(current.fetched_at)<=finishedAt);
      expected.fetched_at=current.fetched_at;refreshed++;
    }
    assert.deepEqual(current,expected,`语料内容或来源变化/${old.id}`);
  }
  return {rows:before.length,importTimestampsRefreshed:refreshed,allOtherFieldsPreserved:true};
}
