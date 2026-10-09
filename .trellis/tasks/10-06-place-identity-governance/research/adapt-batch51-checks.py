"""从已验证的同类探针建立本批检查；不执行业务写入。"""
from pathlib import Path
root=Path(__file__).resolve().parent
p=(root/'preview-vintage.py').read_text(encoding='utf-8').replace('第50批','第51批').replace('batch-50','batch-51')
p=p.replace('5e5409177eb93db984ddf3c2e1b7f8f7c4bdc187d161990eec5e2bcad68358e4','b09a52110ec2d34818fe494c2042a707e6d3ef2571356a6d7a74db3992204793')
p=p.replace('len(cat.catalog.entities)==2','len(cat.catalog.entities)==6').replace("len(exported['places'])==2","len(exported['places'])==6")
p=p.replace(";shop=g['entity']['primary_place_id']==5398", "\n            decision=next(d for d in decisions if d['entityId']==p['id'])")
p=p.replace("assert p['category']==('购物' if shop else '美食') and p['payload']['xhsPlaceType']==('shop' if shop else 'cafe')", "assert p['category']==old['category']=='美食' and p['payload']['xhsPlaceType']=='food'")
p=p.replace("('山东省济南市市中区经三路120号' if shop else '')", "decision['overrides']['address']")
p=p.replace("p['payload']['mentionCount']==1", "p['payload']['mentionCount']==2\n            assert len(g['mentionIds'])==2 and {m['raw_note_id'] for m in originals if m['id'] in g['mentionIds']}=={2585}")
p=p.replace("            assert all('纬四路' not in n and '上新街' not in n for n in p['payload']['aliases'])\n",'')
p=p.replace("'batch':50", "'batch':51").replace("'sources':2,'historicalEntities':2,'mentions':2", "'sources':6,'historicalEntities':6,'mentions':12")
p=p.replace("'coordinatesCleared':2,'categoriesCorrected':1", "'coordinatesCleared':6,'categoriesCorrected':0,'addressesAdded':6")
with (root/'preview-food-address.py').open('x',encoding='utf-8') as f:f.write(p)

p=(root/'verify-vintage-data.mts').read_text(encoding='utf-8').replace('第50批','第51批').replace('batch-50','batch-51').replace('vintage-downstream','food-address-downstream')
p=p.replace("vectorProbes.length,2", "vectorProbes.length,6")
p=p.replace("    const shop=g.entity.primary_place_id===5398;", "    const reviewed=(await read('priority-cities/济南/food-address-source-review-01.json')).rows.find((r:any)=>r.entityId===eid);assert.ok(reviewed);")
p=p.replace("shop?'购物':'美食'", "'美食'").replace("shop?'其他':'美食'", "'美食'").replace("shop?'shop':'cafe'", "'food'")
p=p.replace("assert.equal(old.lat,36.664939);assert.equal(old.lng,117.025436);", "assert.equal(old.lat,Number(reviewed.priorPoint.lat.toFixed(6)));assert.equal(old.lng,Number(reviewed.priorPoint.lng.toFixed(6)));")
p=p.replace("shop?'山东省济南市市中区经三路120号':''", "reviewed.address").replace("p.payload?.mentionCount,1", "p.payload?.mentionCount,2")
a=p.index('    const names=shop?');b=p.index('    for(const name of names)',a)
p=p[:a]+"    const names=[g.entity.canonical_name,...g.entity.aliases];\n    const boundaries=[...source.groups.filter((v:any)=>v.entity.entity_id!==eid).map((v:any)=>v.entity.canonical_name),reviewed.address];\n    assert.equal(g.mentionIds.length,2);assert.deepEqual([...new Set(source.mentions.filter((m:any)=>g.mentionIds.includes(m.id)).map((m:any)=>m.raw_note_id))],[2585]);\n"+p[b:]
a=p.index('      expectedContent.highlights.forEach');b=p.index('      expectedContent.compiledAt=',a)
p=p[:a]+"      assert.deepEqual(actualContent.highlights,expectedContent.highlights,'metadata01修复后来源日期必须稳定');\n"+p[b:]
p=p.replace('graph.manifest.revision,24','graph.manifest.revision,25').replace('audit/run-47','audit/run-49').replace('audit/run-48','audit/run-50')
p=p.replace('batch:50','batch:51').replace('coordinatesCleared:2','coordinatesCleared:6').replace('categoriesCorrected:1','categoriesCorrected:0,addressesAdded:6').replace('realVectorProbes:2','realVectorProbes:6')
p=p.replace("fallbackObservedAtMeaning:'未携带observedAt的旧看点使用各自导出的compiledAt；不代表原始来源无日期。仅此字段按同源编译时间变化，文字/引文/来源/顺序保持。'", "fallbackObservedAtMeaning:'metadata01后148旧看点来源日期保持；仅compiledAt随本次导出更新。'")
with (root/'verify-food-address-data.mts').open('x',encoding='utf-8') as f:f.write(p)

p=(root/'verify-vintage-consumption.test.mts').read_text(encoding='utf-8').replace('第50批','第51批').replace('batch-50','batch-51').replace('vintage-photo','food-address-photo').replace('vintage-consumption','food-address-consumption')
p=p.replace("  const before=await loadCityPlaceFacts('济南');", "  const reviewed=JSON.parse(await readFile(new URL('priority-cities/济南/food-address-source-review-01.json',import.meta.url),'utf8'));\n  const targetNames=reviewed.rows.map((r:any)=>r.name);\n  const before=await loadCityPlaceFacts('济南');")
p=p.replace("['老商埠','经三路','VILLASHAKA','BLUEDUCK骨董屋']", "['老商埠','经三路',...targetNames]").replace('beforeMockEnqueues,2','beforeMockEnqueues,6')
a=p.index('  const targets=[');b=p.index('    const p=facts.get',a)
p=p[:a]+"  const targets=reviewed.rows.map((r:any)=>r.entityId);\n  for(const row of reviewed.rows) {\n    const {name,entityId:id,category,xhsPlaceType:type}=row;\n"+p[b:]
p=p.replace('p.mentionCount,1','p.mentionCount,2').replace('assert.equal(old.lat,36.664939);assert.equal(old.lng,117.025436);', 'assert.equal(old.lat,Number(row.priorPoint.lat.toFixed(6)));assert.equal(old.lng,Number(row.priorPoint.lng.toFixed(6)));')
p=p.replace("['VILLASHAKA','BLUEDUCK骨董屋']", 'targetNames').replace('batch:50','batch:51').replace('coordinatesCleared:2,categoriesCorrected:1','coordinatesCleared:6,categoriesCorrected:0,addressesAdded:6').replace('两无图主体','六无图主体').replace('前后各2次','前后各6次')
with (root/'verify-food-address-consumption.test.mts').open('x',encoding='utf-8') as f:f.write(p)
