"""人民广场四条非同体参照，保留两条确有路线身份的住宿描述提及。"""
import json
from pathlib import Path
from rank import build_city

ROOT = Path(__file__).resolve().parent
B = ROOT.parents[1] / '10-06-place-identity-governance/research/all-cities'
snapshot = json.loads((ROOT / 'snapshot-20261009T212651757971Z/input.json').read_bytes())
reviews = json.loads((ROOT / 'seven-cities-mention-boundaries-09.json').read_bytes())
types = json.loads((ROOT / 'seven-cities-type-reviews-04.json').read_bytes())
geo = json.loads((ROOT / 'seven-cities-geography-reviews-01.json').read_bytes())
city = next(c for c in snapshot['cities'] if c['city'] == '上海')
scope, = json.loads((B / 'batch-105-scope-decisions.json').read_bytes())
eid, = scope['expectedRevisions']
entity = next(e for e in city['entities'] if e['entity_id'] == eid)
mentions = {m['id']: m for m in city['mentions']}
subjects = {9981: ('hotel', '住宿地铁口片区性价比。'), 10017: ('hotel', '住宿选择与交通便利性。'),
    10049: ('hotel', '优先住宿片区参照。'), 10148: ('area', '美食清单分区标题，下列是商户。')}
assert {a['mentionId'] for a in scope['assignments'] if a['entityId'] is None} == set(subjects)
for mid, (kind, conclusion) in subjects.items():
    m = mentions[mid]
    assert m['entityId'] is None and m['resolution']['status'] == 'review'
    quote, = [q['quote'] for q in scope['evidence'][0]['noteQuotes'] if q['noteId'] == m['raw_note_id']]
    assert quote in city['notes'][str(m['raw_note_id'])]['note_desc']
    reviews.append({'city': '上海', 'entityId': eid, 'name': entity['canonical_name'],
        'expectedRevision': entity['revision'], 'mentionId': mid, 'inputHash': m['inputHash'],
        'expectedResolution': m['resolution'], 'noteId': m['raw_note_id'], 'quote': quote,
        'relation': 'not_same_entity', 'subjectType': kind, 'conclusion': conclusion,
        'businessMutation': False, 'limit': '原业务待审保持，不新建酒店、商户或正式组成关系。'})
assert len(reviews) == 74
assert all(mentions[mid]['entityId'] == eid for mid in [10259, 11255])
for c in snapshot['cities']:
    before, after = build_city(c, types, geo, reviews[:-4]), build_city(c, types, geo, reviews)
    assert [(p['entityId'], p['score']) for p in before['top30']] == [(p['entityId'], p['score']) for p in after['top30']]
with (ROOT / 'seven-cities-mention-boundaries-10.json').open('x', encoding='utf-8') as handle:
    json.dump(reviews, handle, ensure_ascii=False, indent=2)
print(json.dumps({'boundaries': len(reviews), 'new': 4, 'allTop30AndScoresUnchanged': True}))
