from pathlib import Path
root=Path(__file__).resolve().parent
s=(root/'verify-remaining-streets-consumption.test.mts').read_text(encoding='utf-8')
s=s.replace('assertRemainingStreetRow','assertFurongRow').replace('remaining-streets-assertions','furong-assertions').replace('remaining-streets','furong').replace('batch-62','batch-63').replace('batch:62','batch:63')
s=s.replace('街道/廊道类别、独立停留和分店撤回；芙蓉街正负评价保留','芙蓉街原文警示、两餐馆隔离、独立停留与实际图库消费')
s=s.replace('assert.equal(beforeMockEnqueues,5)','assert.equal(beforeMockEnqueues,1)').replace('assert.equal(queued,3)','assert.equal(queued,0)')
a=s.index('    if(withdrawn)assert.equal(current,undefined);');b=s.index('\n  }\n  for(const [name,value]',a)
s=s[:a]+"""    assert.ok(current);assert.equal(current.canonicalPlaceId,eid);
    assert.equal(current.category,'文化');assert.equal(current.placeType,'other');
    assert.equal(current.mentionCount,28);assert.equal(current.visitMinutes,30);
    assert.deepEqual(current.lat,old.lat);assert.deepEqual(current.lng,old.lng);"""+s[b:]
a=s.index('    actualPlaceFacts:true');b=s.index("    imageComparison:'deferred_by_user'",a)
s=s[:a]+"""    actualPlaceFacts:true,priorGovernedFactsPreserved:true,confirmedIdentityPreserved:true,validOldOpinionsAndHighlightsPreserved:true,
    textWarnings:1,fieldExcludedMentionIds:[11699],pendingRestaurantMentions:[12904,12948],duration:30,
    coordinatesCleared:0,newPreciseLocations:0,media,canonicalized,
    independentSourceDigestUnchanged:true,mockEnqueueCalls:{before:beforeMockEnqueues,after:afterMockEnqueues},actualEnqueues:0,
    enqueueMeaning:'芙蓉街实际无图，完整scope阻止补图，mock1→0；旧3/1/2图库保持，真实队列未写入。',
"""+s[b:]
with (root/'verify-furong-consumption.test.mts').open('x',encoding='utf-8') as f:f.write(s)
import json
p=root/'tsconfig.verify-joint.json';c=json.loads(p.read_text(encoding='utf-8'))
c['include']+=['./verify-furong-data.mts','./verify-furong-consumption.test.mts','./verify-furong-photo-preflight.test.mts','./furong-assertions.ts']
p.write_text(json.dumps(c,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
