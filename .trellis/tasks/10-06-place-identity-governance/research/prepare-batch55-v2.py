"""保留失败预演，第二方案保留纪念馆原主名以维持实际图库。"""
from pathlib import Path
import json,shutil
root=Path(__file__).resolve().parent
def read(p):return json.loads((root/p).read_text(encoding='utf-8'))
def write(p,v):
    with (root/p).open('x',encoding='utf-8') as f:json.dump(v,f,ensure_ascii=False,indent=2)
assert read('cleaning-scope/current.json')['latestAppliedEntityBatch']==54
assert not (root/'all-cities/batch-55-applied.json').exists()
review=read('priority-cities/济南/laoshe-source-review-01.json')
review['variant']='v2';review['supersedesUnappliedVariant']='batch-55'
review['museumCanonicalName']='老舍故居'
review['museumAliasAddition']=['济南老舍纪念馆','老舍纪念馆']
review['photoPlanFinding']='第一方案实际临时库导入后，旧名仍2图，新规范名/别名均0图。维持原主名，别名统一解析到旧主名；不扩图库名称、不建立逐图绑定。第55批原方案未正式应用。'
review['rows'][0]['canonicalNameConclusion']='主名老舍故居保持，增加纪念馆两个已证实别名和南新街58号地址；生成采用原规范名时仍可使用既有2图。直接以新别名查询旧图库原本0图，此行为不改变。'
path='priority-cities/济南/laoshe-source-review-02.json'
write(path,review)
for kind in ['source','catalog','scope-decisions','decisions','export-expectations']:
    src=root/f'all-cities/batch-55-{kind}.json';dst=root/f'all-cities/batch-55-v2-{kind}.json';assert not dst.exists()
    if kind in ['source','catalog','export-expectations']:
        with dst.open('xb') as f:f.write(src.read_bytes())
    else:
        values=read(str(src.relative_to(root)))
        for d in values:
            d['key']+='-v2'
            for evidence in d['evidence']:evidence['file']=path
            if d.get('entityId')=='6a111b28c08cc7853140187bfd852b16':
                d['canonicalName']='老舍故居'
                d['evidence'][0]['conclusion']='保留原主名、增加已证实纪念馆别名和南新街58号；不加scope。生成通过规范名使用既有2图，精确坐标和距离描述仍待核。'
        write(str(dst.relative_to(root)),values)
write('priority-cities/济南/laoshe-photo-plan-rejected-01.json',{'batch':55,'variant':'initial','formallyApplied':False,
    'findings':{'oldNamePhotos':2,'proposedCanonicalNamePhotos':0,'newAliasDirectPhotos':0,'hypotheticalScopedPhotos':0},
    'evidence':'downstream-place_identity_test_1791493551282.log',
    'initialImportFixtureFailure':'downstream-place_identity_test_1791493481516.log',
    'fixtureCorrection':'局部隔离导出的revision1不能导入已有实城revision28的关系快照；媒体专项改为只重建旧地点/语料/图片绑定的临时库，正式整城双导入另验。',
    'next':'batch-55-v2保留原主名，验证新增别名解析到旧规范名后的图库保持。','imageComparison':'deferred_by_user'})
