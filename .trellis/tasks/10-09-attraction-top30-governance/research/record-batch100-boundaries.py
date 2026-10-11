"""绑定兴庆宫爱心树非同体提及，不改变其原负评及业务待审状态。"""
import json
from pathlib import Path
from rank import build_city

ROOT = Path(__file__).resolve().parent
snapshot = json.loads((ROOT / 'snapshot-20261009T193641750410Z/input.json').read_bytes())
reviews = json.loads((ROOT / 'seven-cities-mention-boundaries-05.json').read_bytes())
types = json.loads((ROOT / 'seven-cities-type-reviews-04.json').read_bytes())
geo = json.loads((ROOT / 'seven-cities-geography-reviews-01.json').read_bytes())
city = next(c for c in snapshot['cities'] if c['city'] == '西安')
entity = next(e for e in city['entities'] if e['entity_id'] == 'f54a5c3ac9f95600f01e2c41b0dc5860')
mention = next(m for m in city['mentions'] if m['id'] == 12266)
assert mention['entityId'] is None
reviews.append({'city': '西安', 'entityId': entity['entity_id'], 'name': entity['canonical_name'],
    'expectedRevision': entity['revision'], 'mentionId': 12266, 'inputHash': mention['inputHash'],
    'expectedResolution': mention['resolution'], 'noteId': 2628,
    'quote': '④兴庆宫爱心树（除了拍照打卡，没啥东西，可以不去）',
    'relation': 'not_same_entity', 'subjectType': 'component',
    'conclusion': '明确评价爱心树，不直接外推公园整体；同篇11883原归独立爱心树，原负评与身份保持。',
    'businessMutation': False, 'limit': '不重复分配、不合并独立树，不新增正式组成关系。'})
assert 11245 not in {r['mentionId'] for r in reviews}
for city in snapshot['cities']:
    before = build_city(city, types, geo, reviews[:-1])
    after = build_city(city, types, geo, reviews)
    assert [(p['entityId'], p['score']) for p in before['top30']] == [(p['entityId'], p['score']) for p in after['top30']]
with (ROOT / 'seven-cities-mention-boundaries-06.json').open('x', encoding='utf-8') as handle:
    json.dump(reviews, handle, ensure_ascii=False, indent=2)
print(json.dumps({'boundaries': len(reviews), 'new': 1, 'allTop30AndScoresUnchanged': True}))
