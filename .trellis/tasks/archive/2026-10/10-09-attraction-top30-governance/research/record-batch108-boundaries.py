"""已明确住宿/活动/店铺来源仅排母项潜在分；无正文的6808继续未知。"""
import json
import sys
from pathlib import Path
from rank import build_city

sys.stdout.reconfigure(encoding='utf-8')
ROOT = Path(__file__).resolve().parent
B = ROOT.parents[1] / '10-06-place-identity-governance/research/all-cities'
snapshot = json.loads((ROOT / 'snapshot-20261009T221643288652Z/input.json').read_bytes())
reviews = json.loads((ROOT / 'seven-cities-mention-boundaries-11.json').read_bytes())
types = json.loads((ROOT / 'seven-cities-type-reviews-04.json').read_bytes())
geo = json.loads((ROOT / 'seven-cities-geography-reviews-01.json').read_bytes())
city = next(c for c in snapshot['cities'] if c['city']=='厦门')
scope, = json.loads((B / 'batch-108-v2-scope-decisions.json').read_bytes())
eid, = scope['expectedRevisions']
entity = next(e for e in city['entities'] if e['entity_id']==eid)
mentions = {m['id']:m for m in city['mentions']}
groups = [([5437,5543,5631,6160,6320,6389,6584,6597,6802], 'hotel',
    '正文仅住宿选择、酒店周边可达性或窗景，未独立推荐街道游览；不创建酒店。'),
    ([6168,6240,6679,6852], 'activity',
    '正文仅节庆活动；6240兼列食店但无独立街道游览，不把限时活动归为街道常设看点。'),
    ([5966], 'service', '正文只有中山路地域下小吃店推荐，标题明确12家，不是步行街整体游览。')]
for mids,kind,conclusion in groups:
    for mid in mids:
        m = mentions[mid]
        assert m['entityId'] is None and m['resolution']['status']=='review'
        quote, = [q['quote'] for q in scope['evidence'][0]['noteQuotes'] if q['noteId']==m['raw_note_id']]
        assert quote in city['notes'][str(m['raw_note_id'])]['note_desc']
        reviews.append({'city':'厦门','entityId':eid,'name':entity['canonical_name'],
            'expectedRevision':entity['revision'],'mentionId':mid,'inputHash':m['inputHash'],
            'expectedResolution':m['resolution'],'noteId':m['raw_note_id'],'quote':quote,
            'relation':'not_same_entity','subjectType':kind,'conclusion':conclusion,
            'businessMutation':False,'limit':'原提及/正文/PENDING保留，不创建域外主体；只约束母项潜在分。'})
assert len(reviews)==90 and not any(r['mentionId']==6808 for r in reviews)
assert mentions[6808]['entityId'] is None
for c in snapshot['cities']:
    ranked = build_city(c,types,geo,reviews)
    if c['city']=='厦门':
        zhongshan = next(p for p in ranked['top30'] if p['entityId']==eid)
        assert 6808 in zhongshan['uncertainMentionIds']
with (ROOT / 'seven-cities-mention-boundaries-12.json').open('x',encoding='utf-8') as file:
    json.dump(reviews,file,ensure_ascii=False,indent=2)
print(json.dumps({'boundaries':90,'new':14,'unknownTagStillPotential':True}))
