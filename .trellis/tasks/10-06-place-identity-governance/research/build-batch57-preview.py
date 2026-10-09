from pathlib import Path
root=Path(__file__).resolve().parent
p=(root/'preview-food-branches.py').read_text(encoding='utf-8')
for a,b in [
 ('第53批','第57批'),('batch-53','batch-57'),("'batch':53","'batch':57"),
 ('63f73a5c07c562769ed6413129bbabecdbade9ac7a569d6ae671d28280789392','1d01897c1e894bc5addaebf8f216e65a4e935bf4610933b38a859086a6f5fc78'),
 ("**g['source'],**g['derivedBefore']","**g['source'],**g['derivedBefore'],**g['supplement']"),
 ('len(cat.assignments)==6 and len(cat.catalog.entities)==2','len(cat.assignments)==8 and len(cat.catalog.entities)==3'),
 ('[11708,12846,12890]','[12798,11525,11481,12741]'),
 ('len(pending)==3','len(pending)==4'),('{11708,12846,12890}','{12798,11525,11481,12741}'),
 ("len(exported['places'])==2","len(exported['places'])==3"),
 ("assert (p['lat'],p['lng'])==(round(src['latitude'],6),round(src['longitude'],6)) and p['payload']['address']==src['address']","assert p['lat'] is None and p['lng'] is None and p['payload']['address']==decision['overrides']['address'] and p['payload']['geoStatus']=='unresolvable'"),
 ("['锅底收费17','口味太单调','乱收费','17元','蔬菜32']","['位于Day2路线中，是济南鲁菜代表','济南特色美食店铺推荐','骨汤浓郁，拉面劲道牛肉大块']"),
 ("'locationPreservedNotNewlyVerified':True","'unsupportedBranchPointClearedPreciseLocationPending':True"),
 ("'sources':2,'historicalEntities':2,'mentions':6,'notes':6","'sources':3,'historicalEntities':3,'mentions':8,'notes':6"),
 ("'confirmed':3,'pendingAdded':3","'confirmed':4,'pendingAdded':4")
]:
    assert a in p,a
    p=p.replace(a,b)
start=p.index("            texts={'cc3eb")
end=p.index("            assert [h['text']",start)
p=p[:start]+"""            texts={'84929fb3085880c48c0cebb71aae3ad4':['老板专注研发菜品，有海肠捞饭、烤鸭、砂锅九转大肠等','鲁菜馆，Day2路线顺路'],
                '58d542ebe18a1dd3505b7cdc60db030c':['联四路，把子肉不错'],
                '92a39f8f2d95070cc627828807686bac':['经十一路面馆，拉面推荐']}[p['id']]
"""+p[end:]
with (root/'preview-restaurant-branches.py').open('x',encoding='utf-8') as f:f.write(p)
runner=root/'run-upstream-tests.mjs'
p=runner.read_text(encoding='utf-8');needle="    process.argv.includes('--park-culture-v2-preview')"
assert needle in p and '--restaurant-branches-preview' not in p
p=p.replace(needle,"    process.argv.includes('--restaurant-branches-preview') ? ['-B', '.trellis/tasks/10-06-place-identity-governance/research/preview-restaurant-branches.py'] :\n"+needle,1)
runner.write_text(p,encoding='utf-8')
