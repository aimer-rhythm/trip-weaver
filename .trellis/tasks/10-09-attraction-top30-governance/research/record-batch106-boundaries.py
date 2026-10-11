"""咖啡和洋房已证实非同体；北外滩纯标签仍保持未知潜在分。"""
import json
from pathlib import Path
from rank import build_city

ROOT = Path(__file__).resolve().parent
B = ROOT.parents[1] / '10-06-place-identity-governance/research/all-cities'
snapshot = json.loads((ROOT / 'snapshot-20261009T213645389978Z/input.json').read_bytes())
reviews = json.loads((ROOT / 'seven-cities-mention-boundaries-10.json').read_bytes())
types = json.loads((ROOT / 'seven-cities-type-reviews-04.json').read_bytes())
geo = json.loads((ROOT / 'seven-cities-geography-reviews-01.json').read_bytes())
city = next(c for c in snapshot['cities'] if c['city'] == '上海')
scopes = json.loads((B / 'batch-106-scope-decisions.json').read_bytes())
mentions = {m['id']: m for m in city['mentions']}
for mid, kind, conclusion in [(10925, 'service', '原文仅桥旁咖啡，路线没有独立桥体游览。'),
    (11271, 'component', '原文只列沿路未具名洋房，不是整条道路；不新建建筑或正式组成关系。')]:
    scope, = [s for s in scopes if any(a['mentionId'] == mid for a in s['assignments'])]
    eid, = scope['expectedRevisions']
    entity = next(e for e in city['entities'] if e['entity_id'] == eid)
    m = mentions[mid]
    assert m['entityId'] is None and m['resolution']['status'] == 'review'
    quote, = [q['quote'] for q in scope['evidence'][0]['noteQuotes'] if q['noteId'] == m['raw_note_id']]
    assert quote in city['notes'][str(m['raw_note_id'])]['note_desc']
    reviews.append({'city': '上海', 'entityId': eid, 'name': entity['canonical_name'],
        'expectedRevision': entity['revision'], 'mentionId': mid, 'inputHash': m['inputHash'],
        'expectedResolution': m['resolution'], 'noteId': m['raw_note_id'], 'quote': quote,
        'relation': 'not_same_entity', 'subjectType': kind, 'conclusion': conclusion,
        'businessMutation': False, 'limit': '原业务待审保持，不新建经营场所、建筑或正式组成关系。'})
assert len(reviews) == 76
assert mentions[10944]['entityId'] is None and mentions[10944]['resolution']['status'] == 'review'
assert not any(r['mentionId'] == 10944 for r in reviews)
for c in snapshot['cities']:
    before, after = build_city(c, types, geo, reviews[:-2]), build_city(c, types, geo, reviews)
    assert [(p['entityId'], p['score']) for p in before['top30']] == [(p['entityId'], p['score']) for p in after['top30']]
    if c['city'] == '上海':
        north = next(p for p in after['top30'] if p['entityId'] == '6fd07ebb97c1fdeeb2aa94f06e40b30f')
        assert 10944 in north['uncertainMentionIds']
with (ROOT / 'seven-cities-mention-boundaries-11.json').open('x', encoding='utf-8') as handle:
    json.dump(reviews, handle, ensure_ascii=False, indent=2)
print(json.dumps({'boundaries': len(reviews), 'new': 2, 'allTop30AndScoresUnchanged': True, 'unknownTagStillPotential': True}))
