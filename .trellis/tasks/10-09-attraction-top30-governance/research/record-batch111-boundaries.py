"""黄厝四条住宿/活动隔离的排名证据，保留业务待审。"""
import json
from pathlib import Path
from rank import build_city

ROOT = Path(__file__).resolve().parent
B = ROOT.parents[1]/'10-06-place-identity-governance/research/all-cities'
read = lambda path: json.loads(path.read_bytes())
snapshot = read(ROOT/'snapshot-20261009T231058589044Z/input.json')
reviews = read(ROOT/'seven-cities-mention-boundaries-14.json')
city = next(c for c in snapshot['cities'] if c['city']=='厦门')
scope, = read(B/'batch-111-scope-decisions.json')
eid, = scope['expectedRevisions']
entity = next(e for e in city['entities'] if e['entity_id']==eid)
for mid,kind in [(6163,'hotel'),(6238,'activity'),(6572,'activity'),(6853,'activity')]:
    m = next(m for m in city['mentions'] if m['id']==mid)
    assert m['entityId'] is None and m['resolution']['status']=='review'
    quote, = [q['quote'] for q in scope['evidence'][0]['noteQuotes'] if q['noteId']==m['raw_note_id']]
    assert quote in city['notes'][str(m['raw_note_id'])]['note_desc']
    reviews.append({'city':'厦门','entityId':eid,'name':entity['canonical_name'],'expectedRevision':entity['revision'],
        'mentionId':mid,'inputHash':m['inputHash'],'expectedResolution':m['resolution'],'noteId':m['raw_note_id'],
        'quote':quote,'relation':'not_same_entity','subjectType':kind,
        'conclusion':'仅春节焰火或营地/餐酒吧跨年活动，无独立沙滩游览。' if kind=='activity' else '只有住宿选区建议，无独立沙滩游览。',
        'businessMutation':False,'limit':'原文与PENDING保持，不新建酒店、活动、营地或餐酒吧。'})
assert len(reviews)==101
types,geo = read(ROOT/'seven-cities-type-reviews-04.json'),read(ROOT/'seven-cities-geography-reviews-01.json')
for c in snapshot['cities']:
    before,after = build_city(c,types,geo,reviews[:-4]),build_city(c,types,geo,reviews)
    assert [(p['entityId'],p['score']) for p in before['top30']]==[(p['entityId'],p['score']) for p in after['top30']]
with (ROOT/'seven-cities-mention-boundaries-15.json').open('x',encoding='utf-8') as file:
    json.dump(reviews,file,ensure_ascii=False,indent=2)
print(json.dumps({'boundaries':101,'new':4,'currentTop30AndScoresPreserved':True}))
