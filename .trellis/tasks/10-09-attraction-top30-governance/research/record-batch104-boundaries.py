"""五主体十条非同体参照；保留业务待审，仅核对排名上界。"""
import json
from pathlib import Path
from rank import build_city

ROOT = Path(__file__).resolve().parent
B = ROOT.parents[1] / '10-06-place-identity-governance/research/all-cities'
snapshot = json.loads((ROOT / 'snapshot-20261009T211214228056Z/input.json').read_bytes())
reviews = json.loads((ROOT / 'seven-cities-mention-boundaries-08.json').read_bytes())
types = json.loads((ROOT / 'seven-cities-type-reviews-04.json').read_bytes())
geo = json.loads((ROOT / 'seven-cities-geography-reviews-01.json').read_bytes())
city = next(c for c in snapshot['cities'] if c['city'] == '上海')
scopes = json.loads((B / 'batch-104-scope-decisions.json').read_bytes())
mentions = {m['id']: m for m in city['mentions']}
subjects = {
    10358: ('hotel', '酒店地铁可达性参照。'),
    11115: ('area', '泛南京路游客餐饮区负评，不作为步行街自身评价；保留原立场。'),
    10335: ('hotel', '酒店地铁可达性参照。'),
    11221: ('photo_spot', '仅兴国路人行道或老麦咖啡馆二楼拍楼机位，没有独立楼体游览。'),
    9980: ('hotel', '住宿地铁口片区性价比。'),
    10018: ('hotel', '住宿片区吃喝方便。'),
    10146: ('area', '美食分区标题，下列都是商户。'),
    10340: ('hotel', '酒店邻近寺庙与房间性价比。'),
    10343: ('hotel', '青旅窗景及地铁可达性。'),
    10359: ('hotel', '酒店到寺庙步行可达性。'),
}
assert {a['mentionId'] for s in scopes for a in s['assignments'] if a['entityId'] is None} == set(subjects)
for mid, (kind, conclusion) in subjects.items():
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
        'businessMutation': False, 'limit': '保留业务待审，不新增酒店、商户、机位或正式组成关系。'})
assert len(reviews) == 70
for c in snapshot['cities']:
    before, after = build_city(c, types, geo, reviews[:-10]), build_city(c, types, geo, reviews)
    assert [(p['entityId'], p['score']) for p in before['top30']] == [(p['entityId'], p['score']) for p in after['top30']]
with (ROOT / 'seven-cities-mention-boundaries-09.json').open('x', encoding='utf-8') as handle:
    json.dump(reviews, handle, ensure_ascii=False, indent=2)
print(json.dumps({'boundaries': len(reviews), 'new': 10, 'allTop30AndScoresUnchanged': True}))
