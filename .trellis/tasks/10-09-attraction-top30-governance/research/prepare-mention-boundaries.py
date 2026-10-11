"""确认不等同母项的提及不构成母项潜在加分；原业务待审不动。"""
import json
from pathlib import Path
from rank import build_city

ROOT = Path(__file__).resolve().parent
snapshot = json.loads((ROOT / 'snapshot-20261009T171425234590Z/input.json').read_bytes())
ranking = json.loads((ROOT / 'seven-cities-ranking-10.json').read_bytes())
source = json.loads((ROOT / 'seven-cities-next-evidence-02.json').read_bytes())
decisions = [(e['city'], e['mentionId'], e['quote'], e['conclusion']) for e in source['evidence']]
decisions += [
    ('西安', 11999, '钟楼周围最热闹，美食也多，但是价格偏贵。', '本条主语为周围住宿片区，不等于塔体，不计入塔体排名上界；86批null待审保持。'),
    ('西安', 12132, '干净又便宜！而且就在钟楼旁，步行地铁口十分钟', '原文标题和全文推荐未具名民宿，不是钟楼塔体，不计入塔体排名上界；86批null待审保持。'),
    ('西安', 12488, 'P3-5 钟楼饭店门前广场', '原文为饭店门前广场机位，不能因含钟楼二字归入塔体；86批null待审保持。'),
]
types = {6042: 'route_segment', 3459: 'component', 4178: 'component', 12305: 'component',
         1147: 'photo_spot', 759: 'route_segment', 1295: 'route_segment', 11999: 'area', 12132: 'hotel', 12488: 'photo_spot'}
reviews = []
for city_name, mid, quote, conclusion in decisions:
    city = next(c for c in snapshot['cities'] if c['city'] == city_name)
    ranked = next(c for c in ranking['cities'] if c['city'] == city_name)
    parents = [p for p in [*ranked['allAttractions'], *ranked['withdrawnOrReview']] if mid in p['uncertainMentionIds']]
    assert len(parents) == 1
    parent = parents[0]
    mention = next(m for m in city['mentions'] if m['id'] == mid)
    reviews.append({'city': city_name, 'entityId': parent['entityId'], 'name': parent['name'],
        'expectedRevision': parent['revision'], 'mentionId': mid, 'inputHash': mention['inputHash'],
        'expectedResolution': mention['resolution'], 'noteId': mention['raw_note_id'], 'quote': quote,
        'relation': 'not_same_entity', 'subjectType': types[mid], 'conclusion': conclusion,
        'businessMutation': False, 'limit': '仅排除与此母项同义及母项潜在加分，不认定新的具体实体或建立正式part_of关系。'})
assert len(reviews) == 10
classifications = json.loads((ROOT / 'seven-cities-type-reviews-03.json').read_bytes())
geography = json.loads((ROOT / 'seven-cities-geography-reviews-01.json').read_bytes())
for city in snapshot['cities']:
    current = build_city(city, classifications, geography, reviews)
    before = next(c for c in ranking['cities'] if c['city'] == city['city'])
    assert [(p['entityId'], p['score']) for p in current['top30']] == [(p['entityId'], p['score']) for p in before['top30']]
with (ROOT / 'seven-cities-mention-boundaries-01.json').open('x', encoding='utf-8') as handle:
    json.dump(reviews, handle, ensure_ascii=False, indent=2)
print('10 non-equivalent mention boundaries bound; all top30 IDs and scores unchanged; no business mutation')
