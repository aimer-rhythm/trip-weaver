"""114-v2基于南普陀落地后新冻结，保全原运营投影并隔离厦大酒店参照。"""
import asyncio
import hashlib
import importlib.util
import json
import sys
import traceback
from pathlib import Path

ROOT=Path(__file__).resolve().parent
def module(name,file):
    spec=importlib.util.spec_from_file_location(name,ROOT/file)
    result=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result

helper=module('operations_support','govern-nanputuo-preserved-scope.py')
original=module('university','govern-xiamen-university-scope.py')
runner=original.runner
runner.BATCH='batch-114-v2'
runner.SNAPSHOT=ROOT/'snapshot-20261010T002859093513Z/input.json'
runner.EXTRAS=ROOT/'xiamen-operations-02-extras.json'
runner.BASELINE=ROOT/'xiamen-operations-02-baseline.json'
runner.PRESERVED_TARGET_PAYLOAD_FIELDS=[*helper.FIELDS,'typicalVisitMinutes','images','coverImage','imageGallery','amapPhoto']
original_inputs=original.inputs

def inputs():
    frozen,scopes,expected=original_inputs()
    scope,=scopes
    scope['key']='top30-20261010-batch-114-v2-scope-2554'
    preservation=helper.operational_request(frozen,original.EID,json.loads(runner.BASELINE.read_bytes()))
    preservation['evidence'][0]['file']=str(Path(__file__).relative_to(ROOT.parents[3]))
    preservation['evidence'][0]['conclusion']='已追溯原厦大运营资料到原笔记及图片文字索引；保留旧免费需预约、营业与预约证据及冲突，不称现行政策已核。两篇酒店参照隔离，不恢复其描述。'
    scope['preserveOperationalFacts']=[preservation]
    ready=json.loads((ROOT/'operational-install-ready-01.json').read_bytes())
    hashes=ready['implementationFiles']
    assert all(hashlib.sha256((Path('D:/Project/xhs-travel-pipeline')/name).read_bytes()).hexdigest()==h for name,h in hashes.items())
    scope['evidence'].append({'kind':'legacy_operational_preservation_implementation','files':hashes,
        'conclusion':'沿用112-v2已验证同一版本运营保全协议；本批仍须完整导出、旧字段、媒体、逆序回滚和正式双同步。'})
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
