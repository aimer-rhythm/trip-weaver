import json
import sys
from collections import Counter
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8')
root=Path(__file__).resolve().parent
old=json.loads((root/'snapshot-20261009T081112091980Z/input.json').read_bytes())
new=json.loads((root/'snapshot-20261009T094259676338Z/input.json').read_bytes())
def diff(a,b,p=''):
    if type(a)!=type(b):return [{'path':p,'before':a,'after':b}]
    if isinstance(a,dict):return [r for k in a.keys()|b.keys() for r in diff(a.get(k),b.get(k),p+'/'+k)]
    if isinstance(a,list):
        if len(a)!=len(b):return [{'path':p,'before':a,'after':b}]
        return [r for i,(x,y) in enumerate(zip(a,b)) for r in diff(x,y,p+'/'+str(i))]
    return [] if a==b else [{'path':p,'before':a,'after':b}]
output=[]
for city in old['cities']:
    current={p['id']:p for p in next(c for c in new['cities'] if c['city']==city['city'])['downstream']}
    for p in city['downstream']:
        changes=[d for d in diff(p['payload'].get('content'),current[p['id']]['payload'].get('content')) if d['path']!='/compiledAt']
        if changes:output.append({'city':city['city'],'id':p['id'],'name':p['name'],'changes':changes})
with (root/'content-delta-01.json').open('x',encoding='utf-8') as f:json.dump(output,f,ensure_ascii=False,indent=2)
print(json.dumps({'records':len(output),'paths':dict(Counter(d['path'] for r in output for d in r['changes'])),'examples':output[:2]},ensure_ascii=False))
