"""白城沙滩三条活动/酒店参照已隔离；记录排名边界，不改业务表。"""
import json
from pathlib import Path
from rank import build_city

ROOT = Path(__file__).resolve().parent
B = ROOT.parents[1]/'10-06-place-identity-governance/research/all-cities'
read = lambda path: json.loads(path.read_bytes())
snapshot = read(ROOT/'snapshot-20261009T224916589831Z/input.json')
reviews = read(ROOT/'seven-cities-mention-boundaries-13.json')
city = next(c for c in snapshot['cities'] if c['city']=='厦门')
scope, = read(B/'batch-110-scope-decisions.json')
eid, = scope['expectedRevisions']
entity = next(e for e in city['entities'] if e['entity_id']==eid)
for mid,kind in [(6293,'activity'),(6548,'hotel'),(6594,'hotel')]:
    m = next(m for m in city['mentions'] if m['id']==mid)
    assert m['entityId'] is None and m['resolution']['status']=='review'
    quote, = [q['quote'] for q in scope['evidence'][0]['noteQuotes'] if q['noteId']==m['raw_note_id']]
    assert quote in city['notes'][str(m['raw_note_id'])]['note_desc']
    reviews.append({'city':'厦门','entityId':eid,'name':entity['canonical_name'],'expectedRevision':entity['revision'],
        'mentionId':mid,'inputHash':m['inputHash'],'expectedResolution':m['resolution'],'noteId':m['raw_note_id'],
        'quote':quote,'relation':'not_same_entity','subjectType':kind,
        'conclusion':'仅跨年烟花活动的观赏位置，无独立沙滩游览。' if kind=='activity' else '仅酒店周边交通参照，无独立沙滩游览。',
        'businessMutation':False,'limit':'原文与PENDING保持，不新建活动、酒店或观赏机位。'})
assert len(reviews)==97
types,geo = read(ROOT/'seven-cities-type-reviews-04.json'),read(ROOT/'seven-cities-geography-reviews-01.json')
for c in snapshot['cities']:
    before,after = build_city(c,types,geo,reviews[:-3]),build_city(c,types,geo,reviews)
    assert [(p['entityId'],p['score']) for p in before['top30']]==[(p['entityId'],p['score']) for p in after['top30']]
with (ROOT/'seven-cities-mention-boundaries-14.json').open('x',encoding='utf-8') as file:
    json.dump(reviews,file,ensure_ascii=False,indent=2)
print(json.dumps({'boundaries':97,'new':3,'currentTop30AndScoresPreserved':True}))
