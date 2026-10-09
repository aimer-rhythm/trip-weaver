"""核实旧看点日期修复的每一条来源，而不是笼统忽略observedAt差异。"""
import json
import sys
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8')
root=Path(__file__).resolve().parent
before=json.loads((root/'snapshot-20261009T081112091980Z/input.json').read_bytes())
after=json.loads((root/'snapshot-20261009T094259676338Z/input.json').read_bytes())
deltas=json.loads((root/'content-delta-01.json').read_bytes())
verified=[];failures=[]
for row in deltas:
    old=next(c for c in before['cities'] if c['city']==row['city'])
    new=next(c for c in after['cities'] if c['city']==row['city'])
    old_content=next(p for p in old['downstream'] if p['id']==row['id'])['payload']['content']
    content=next(p for p in new['downstream'] if p['id']==row['id'])['payload']['content']
    for d in row['changes']:
        index=int(d['path'].split('/')[2]);highlight=content['highlights'][index]
        matches=[(i,n) for i,n in old['notes'].items() if n['source_url']==highlight.get('sourceUrl') and n['observed_at']==d['after']]
        valid=d['path']==f'/highlights/{index}/observedAt' and d['before']==old_content['compiledAt'] and bool(matches)
        item={'city':row['city'],'id':row['id'],'name':row['name'],'field':d['path'],
            'oldEqualsCompiledAt':d['before']==old_content['compiledAt'],'sourceNoteIds':[i for i,n in matches],
            'before':d['before'],'after':d['after']}
        (verified if valid else failures).append(item)
report={'passed':not failures,'changedRecords':len(deltas),'verifiedDates':len(verified),'rows':verified,'failures':failures}
with (root/'content-dates-verification-01.json').open('x',encoding='utf-8') as f:json.dump(report,f,ensure_ascii=False,indent=2)
print(json.dumps({k:v for k,v in report.items() if k!='rows'},ensure_ascii=False))
if failures:raise SystemExit(1)
