"""豫园五条异主体范围证据，只调整母项排名上界。"""
import json
from pathlib import Path
from rank import build_city

ROOT = Path(__file__).resolve().parent
snapshot = json.loads((ROOT / 'snapshot-20261009T205339699294Z/input.json').read_bytes())
reviews = json.loads((ROOT / 'seven-cities-mention-boundaries-07.json').read_bytes())
types = json.loads((ROOT / 'seven-cities-type-reviews-04.json').read_bytes())
geo = json.loads((ROOT / 'seven-cities-geography-reviews-01.json').read_bytes())
city = next(c for c in snapshot['cities'] if c['city'] == '上海')
eid = 'b507a4f0980e5d13106a169b7a0ad044'
entity = next(e for e in city['entities'] if e['entity_id'] == eid)
mentions = {m['id']: m for m in city['mentions']}
for mid, kind, quote, conclusion in [
    (10355, 'hotel', '离城隍庙，豫园都很近的', '酒店邻近参照。'),
    (11116, 'area', '吃饭尽量避开南京路、豫园核心游客区，能大幅降低踩雷概率。', '餐饮游客片区负评，不作为园林负评；原立场保留。'),
    (11181, 'activity', '7-8点抵达豫园，赏新春灯会夜景', '明确新春灯会，不能自动外推园林夜间开放或园林推荐。'),
    (11283, 'area', '📍 豫园老街\n古风建筑 + 灯笼倒影', '正文主语明确老街，与园林独立；不跨范围强行并入旧街道根。'),
    (11314, 'service', '距离豫园、城隍庙这些景点也很近', '餐厅邻近参照，正文餐后只明确去外滩。'),
]:
    m = mentions[mid]
    assert m['entityId'] is None and m['resolution']['status'] == 'review'
    assert quote in city['notes'][str(m['raw_note_id'])]['note_desc']
    reviews.append({'city': '上海', 'entityId': eid, 'name': entity['canonical_name'],
        'expectedRevision': entity['revision'], 'mentionId': mid, 'inputHash': m['inputHash'],
        'expectedResolution': m['resolution'], 'noteId': m['raw_note_id'], 'quote': quote,
        'relation': 'not_same_entity', 'subjectType': kind, 'conclusion': conclusion,
        'businessMutation': False, 'limit': '保留业务待审，不新增活动、经营场所或正式组成关系。'})
assert len(reviews) == 60
for c in snapshot['cities']:
    before, after = build_city(c, types, geo, reviews[:-5]), build_city(c, types, geo, reviews)
    assert [(p['entityId'], p['score']) for p in before['top30']] == [(p['entityId'], p['score']) for p in after['top30']]
with (ROOT / 'seven-cities-mention-boundaries-08.json').open('x', encoding='utf-8') as handle:
    json.dump(reviews, handle, ensure_ascii=False, indent=2)
print(json.dumps({'boundaries': len(reviews), 'new': 5, 'allTop30AndScoresUnchanged': True}))
