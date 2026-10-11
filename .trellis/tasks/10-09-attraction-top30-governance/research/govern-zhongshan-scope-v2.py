"""108原计划引文门禁失败后的新版本：不改原文，不隔离有效路线规避门禁。"""
import asyncio
import importlib.util
import json
import sys
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('zhongshan', ROOT / 'govern-zhongshan-scope.py')
original = importlib.util.module_from_spec(spec)
spec.loader.exec_module(original)
runner = original.runner
runner.BATCH = 'batch-108-v2'
# 5363的真实正文只有中山路，未含抽取全名中山路步行街；旧校验器不接受该事实排除。
# 有限Citywalk路线身份保持，描述问题单列待核，不把正确定向转为null。
del original.FACTS[5363]
original.FACTS[6429] = (['reason'], '🌃 中山路＋八市\n晚上逛骑楼老街，再去八市吃海鲜、沙茶面、五香卷、土笋冻，厦门味直接拉满🦐')


def inputs():
    frozen,scopes,expected = original.inputs()
    for scope in scopes:
        scope['key'] = scope['key'].replace('batch-108-', 'batch-108-v2-')
        evidence = scope['evidence'][0]
        evidence['file'] = str(Path(__file__).relative_to(ROOT.parents[3]))
        evidence['conclusion'] = evidence['conclusion'].replace(
            '5363和6857明确提出中山路citywalk/骑楼后去吃饭，保留有限路线指向，排餐厅两个描述字段，不将其当街道亲历或骑楼详实证据。',
            '6857明确提出逛完中山路骑楼后顺路吃饭，保留有限路线指向，只排餐厅两个描述字段，不当街道亲历证据。5363也明确中山路Citywalk后吃饭，但正文无抽取全名中山路步行街，现行事实引文门禁不接受；保留身份和原描述，把餐厅混入reason/evidence_text继续单列待核，不改字、不放宽门禁，也不将正确路线隔离为null。')
    return frozen,scopes,expected


runner.inputs = inputs
if __name__ == '__main__':
    try:
        asyncio.run(runner.main())
    except Exception as error:
        print(json.dumps({'failed':True,'errorType':type(error).__name__,'frames':[
            {'file':Path(f.filename).name,'line':f.lineno,'function':f.name}
            for f in traceback.extract_tb(error.__traceback__) if str(ROOT) in f.filename]},ensure_ascii=False))
        sys.exit(1)
