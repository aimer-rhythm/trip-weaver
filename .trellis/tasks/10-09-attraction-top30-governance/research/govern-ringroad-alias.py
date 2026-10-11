"""环岛路与厦门环岛路同体合并；主根旧资料严格保全。"""
import asyncio
import hashlib
import importlib.util
import json
import sys
import traceback
from pathlib import Path

ROOT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('alias_runner',ROOT/'govern-botanical-alias.py')
runner=importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)
from app.aggregate.mention_identity import load_mention_catalog

runner.BATCH='batch-115'
runner.TARGET='13abadcd531dd9b70a031c9925f096f0'
runner.OLD='6ed8ab805ffd7c46bdacd535030ab4f6'
runner.SNAPSHOT=ROOT/'snapshot-20261009T233649612752Z/input.json'
runner.BASELINE=ROOT/'xiamen-scope-08-baseline.json'
runner.EXTRAS=ROOT/'xiamen-scope-08-extras.json'


def inputs():
    raw=runner.SNAPSHOT.read_bytes()
    frozen=next(c for c in json.loads(raw)['cities'] if c['city']=='厦门')
    entities={e['entity_id']:e for e in frozen['entities']}
    assert entities[runner.TARGET]['revision']==entities[runner.OLD]['revision']==1
    assert entities[runner.TARGET]['primary_place_id']==2537
    rows=[m for m in frozen['mentions'] if m['entityId'] in {runner.TARGET,runner.OLD}]
    assert len(rows)==27 and len({m['raw_note_id'] for m in rows})==26
    record=json.loads((ROOT/'seven-cities-semantic-readthrough-15.json').read_bytes())
    assert record['snapshotSha256']==hashlib.sha256(raw).hexdigest()
    reviewed=next(r for r in record['reviews'] if r['entityId']==runner.TARGET)
    for n in [*reviewed['noteEvidence'],*reviewed['additionalBoundaryMentions']]:
        assert hashlib.sha256(frozen['notes'][str(n['noteId'])]['note_desc'].encode()).hexdigest()==n['noteDescSha256']
    plan={'batch':runner.BATCH,'city':'厦门','snapshot':str(runner.SNAPSHOT.relative_to(ROOT)),
        'snapshotSha256':hashlib.sha256(raw).hexdigest(),'baselineExport':str(runner.BASELINE),
        'merges':[{'primaryName':'环岛路','mergeNames':['厦门环岛路'],'aliases':['环岛路','厦门环岛路'],
            'evidenceMentions':[5666,5745,5791,6709],
            'noteQuotes':[{'noteId':1260,'quote':'沿着环岛路慢慢骑，从黄厝晃到曾厝垵，再往厦大白城走'},
                {'noteId':1350,'quote':'环岛路上面骑车真的好好玩呀，晚上吹着海风，骑着小车逛一路打卡一路'},
                {'noteId':1456,'quote':'下午：回住处休息，或者骑车沿环岛路慢慢走'}],
            'conclusion':reviewed['conclusion']+' 本批仅合并同体：主根环岛路2537、旧根厦门环岛路2786重定向，27条/26笔记并集重算。主根旧位置、类别、价格、营业、预约、提示和内容严格保全，不用更具体的另一路段坐标替换。所有有效提及原观点保持，不新增完整scope或摄影/酒店/商户主体；长道路的路线点定位与骑行许可仍未核。'}]}
    actual,decisions,expected=runner.merges.prepare(plan,Path(__file__).relative_to(ROOT.parents[3]))
    assert actual==frozen and expected[0]['mentionCount']==27
    return frozen,decisions,expected


async def apply_checked(session,frozen,decisions,expected):
    extra=json.loads(runner.EXTRAS.read_bytes())
    assert extra.pop('snapshotSha256')==hashlib.sha256(runner.SNAPSHOT.read_bytes()).hexdigest()
    assert extra.pop('city')=='厦门'
    before=await runner.baseline.extra_state(session,'厦门')
    assert runner.normalize_extras(before)==runner.normalize_extras(extra)
    report=await runner.merges.apply_checked(session,frozen,decisions,expected)
    assert await runner.baseline.extra_state(session,'厦门')==before
    now=await load_mention_catalog(session,'厦门')
    old=next(e for e in frozen['entities'] if e['entity_id']==runner.TARGET)
    assert now.catalog.entities[runner.TARGET]['overrides']=={**old['overrides'],'recommendationPolicy':'resolved_attraction_mentions_v1'}
    report['checks'].update(provenanceAndOriginalRelationsPreserved=True,onlyScorePolicyOverrideAdded=True)
    return report


runner.inputs,runner.apply_checked=inputs,apply_checked
if __name__=='__main__':
    try:
        asyncio.run(runner.main())
    except Exception as error:
        print(json.dumps({'failed':True,'errorType':type(error).__name__,'frames':[
            {'file':Path(f.filename).name,'line':f.lineno,'function':f.name}
            for f in traceback.extract_tb(error.__traceback__) if str(ROOT) in f.filename]},ensure_ascii=False))
        sys.exit(1)
