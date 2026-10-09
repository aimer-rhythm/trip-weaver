"""读取本次用户纠正前冻结状态，定位历史决策与当前影响。"""
import json
import sys
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8')
root=Path(__file__).resolve().parent
city=json.loads((root/'snapshot-20261009T111626632432Z/input.json').read_bytes())['cities'][0]
ids={'981bfe8125feb36e052dcfee1e0df8b5','a94865355cdbf6fccfda6fc748b9e9fe',
     '298e600416cbc4f85119932e8a3c966c','21152db5b05aff609cffa2bee47f16b4'}
for e in city['entities']:
    if e['entity_id'] not in ids:continue
    print(json.dumps({'entity':{k:v for k,v in e.items() if k!='evidence'},'evidence':e['evidence']},ensure_ascii=False))
    source_ids=[int(s) for s,target in city['members'].items() if target==e['entity_id']]
    for s in city['sources']:
        if s['id'] in source_ids:
            print(json.dumps({'source':{k:v for k,v in s.items() if k!='content_profile'},'profile':s['content_profile']},ensure_ascii=False))
    p=next((p for p in city['downstream'] if p['id']==e['entity_id']),None)
    if p:print(json.dumps({'downstream':p},ensure_ascii=False))
print(json.dumps({'reviews':[r for r in city['reviews'] if ids.intersection(r['detail'].get('entityIds',[]))]},ensure_ascii=False))
print(json.dumps({'mentions':[m for m in city['mentions'] if m['entityId'] in ids or m['id']==3148]},ensure_ascii=False))
