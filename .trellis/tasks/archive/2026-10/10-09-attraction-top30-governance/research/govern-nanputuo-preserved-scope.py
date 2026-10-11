"""112-v2使用明确旧运营来源绑定重做完整预演；暂存模式禁止实库应用。"""
import asyncio
import hashlib
import importlib.util
import json
import sys
import traceback
from pathlib import Path

ROOT=Path(__file__).resolve().parent
STAGE=ROOT.parents[1]/'10-06-place-identity-governance/research/upstream'
staged='--staged' in sys.argv
if staged:
    assert '--apply' not in sys.argv,'暂存代码不能应用实库'
    sys.argv.remove('--staged')
    sys.path.insert(0,'D:/Project/xhs-travel-pipeline')
    import app
    app.__path__.insert(0,str(STAGE/'app'))
    for name in ['clean','aggregate','photography','resolve','extract','qa','web']:
        package=__import__(f'app.{name}',fromlist=['_'])
        package.__path__.insert(0,str(STAGE/'app'/name))
    import scripts
    scripts.__path__=[str(STAGE/'scripts'),*scripts.__path__]
spec=importlib.util.spec_from_file_location('nanputuo',ROOT/'govern-nanputuo-scope.py')
original=importlib.util.module_from_spec(spec)
spec.loader.exec_module(original)
runner=original.runner
from app.clean.legacy_operational_facts import FIELDS,fact_names,relevant_images
from app.clean.mention_identity import digest

runner.BATCH='batch-112-v2'
runner.SNAPSHOT=ROOT/'snapshot-20261009T234942074836Z/input.json'
runner.EXTRAS=ROOT/'xiamen-operations-01-extras.json'
runner.BASELINE=ROOT/'xiamen-operations-01-baseline.json'
runner.PRESERVED_TARGET_PAYLOAD_FIELDS=[*FIELDS,'typicalVisitMinutes','images','coverImage','imageGallery','amapPhoto']
original_inputs=original.inputs


def operational_request(frozen,eid,baseline):
    entity=next(e for e in frozen['entities'] if e['entity_id']==eid)
    source=next(s for s in frozen['sources'] if s['id']==entity['primary_place_id'])
    notes={n['id']:n for n in frozen['governanceState']['rawNotes']}
    ordered=[]
    for n in frozen['governanceState']['imageNoteOrder']:
        note=notes[n['id']]
        ordered.append((note['id'],{'city':note['city'],'title':note['title'],'desc':note['desc'],
            'images':note['img_analysis'],'unavailable':note['status'] in ['DELETED','PRIVATE'],
            'sourceUrl':note['source_url'] or '', 'observedAt':note['created_at'],'publishedAt':note['publish_time']}))
    payload=next(p['payload'] for p in baseline['places'] if p['id']==eid)
    return {'entityId':eid,'sourcePlaceId':source['id'],
        'sources':relevant_images(ordered,fact_names(source['name'],frozen['city'])),
        'payloadHash':digest({k:v for k,v in payload.items() if k in FIELDS}),
        'evidence':[{'kind':'subject_only_preservation','file':str(Path(__file__).relative_to(ROOT.parents[3])),
            'conclusion':'已逐一追溯原主源旧运营资料匹配到的笔记及图片文字索引；只保留同一景点旧价格、营业和预约投影及原冲突，不伪造当前事实核验或图片已审。酒店窗景隔离仍由完整scope执行，不能恢复被排除的描述。'}]}


def inputs():
    frozen,scopes,expected=original_inputs()
    baseline=json.loads(runner.BASELINE.read_bytes())
    scope,=scopes
    scope['key']='top30-20261010-batch-112-v2-scope-2534'
    scope['preserveOperationalFacts']=[operational_request(frozen,original.EID,baseline)]
    files=['app/clean/legacy_operational_facts.py','app/aggregate/operational_preservation.py',
        'app/aggregate/place_export_inputs.py','app/aggregate/mention_identity.py','app/clean/mention_identity.py',
        'app/clean/scoped_place_export.py','app/models.py','scripts/export_to_tripweaver.py','scripts/migrate_place_identity.py']
    root=STAGE if staged else Path('D:/Project/xhs-travel-pipeline')
    scope['evidence'].append({'kind':'legacy_operational_preservation_implementation',
        'files':{name:hashlib.sha256((root/name).read_bytes()).hexdigest() for name in files},
        'conclusion':'只保留已存在原主体资料，不重新审核当前运营或图片；严格字段、来源指纹、实际导出、完整回滚均为应用前置。'})
    return frozen,scopes,expected


runner.inputs=inputs
if __name__=='__main__':
    try:
        asyncio.run(runner.main())
    except Exception as error:
        print(json.dumps({'failed':True,'errorType':type(error).__name__,'frames':[
            {'file':Path(f.filename).name,'line':f.lineno,'function':f.name}
            for f in traceback.extract_tb(error.__traceback__) if str(ROOT) in f.filename]},ensure_ascii=False))
        sys.exit(1)
