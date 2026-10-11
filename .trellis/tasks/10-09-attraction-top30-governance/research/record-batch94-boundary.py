"""第94批之后绑定天泉广场上方步道边界；不改写原待审及业务分配。"""
import json
from pathlib import Path
from rank import build_city

ROOT = Path(__file__).resolve().parent
snapshot = json.loads((ROOT / 'snapshot-20261009T184019187146Z/input.json').read_bytes())
reviews = json.loads((ROOT / 'seven-cities-mention-boundaries-02.json').read_bytes())
city = next(c for c in snapshot['cities'] if c['city'] == '厦门')
entity = next(e for e in city['entities'] if e['entity_id'] == 'c2f0df60bef3612fec9ed56021ac090f')
mention = next(m for m in city['mentions'] if m['id'] == 6876)
reviews.append({'city': '厦门', 'entityId': entity['entity_id'], 'name': entity['canonical_name'],
    'expectedRevision': entity['revision'], 'mentionId': 6876, 'inputHash': mention['inputHash'],
    'expectedResolution': mention['resolution'], 'noteId': 1263, 'quote': '图❼ ：天泉步道广场上面的步道',
    'relation': 'not_same_entity', 'subjectType': 'photo_spot',
    'conclusion': '机位为广场上方步道，不等同广场；第94批null待审保持，不计广场潜在分数。',
    'businessMutation': False, 'limit': '不认定新机位实体或正式part_of关系，不把天泉步道与广场合并。'})
types = json.loads((ROOT / 'seven-cities-type-reviews-04.json').read_bytes())
geo = json.loads((ROOT / 'seven-cities-geography-reviews-01.json').read_bytes())
for city in snapshot['cities']:
    before = build_city(city, types, geo, reviews[:-1])
    after = build_city(city, types, geo, reviews)
    assert [(p['entityId'], p['score']) for p in before['top30']] == [(p['entityId'], p['score']) for p in after['top30']]
with (ROOT / 'seven-cities-mention-boundaries-03.json').open('x', encoding='utf-8') as handle:
    json.dump(reviews, handle, ensure_ascii=False, indent=2)
print(json.dumps({'boundaries': len(reviews), 'allTop30AndScoresUnchanged': True, 'businessMutation': False}))
