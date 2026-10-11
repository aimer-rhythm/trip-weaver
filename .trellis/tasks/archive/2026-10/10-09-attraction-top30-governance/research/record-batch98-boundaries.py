"""绑定97/98批正式隔离提及；路线身份与事实排除仍以业务scope为准。"""
import json
from pathlib import Path
from rank import build_city

ROOT = Path(__file__).resolve().parent
snapshot = json.loads((ROOT / 'snapshot-20261009T192058158076Z/input.json').read_bytes())
reviews = json.loads((ROOT / 'seven-cities-mention-boundaries-04.json').read_bytes())
types = json.loads((ROOT / 'seven-cities-type-reviews-04.json').read_bytes())
geo = json.loads((ROOT / 'seven-cities-geography-reviews-01.json').read_bytes())
entries = [
    ('杭州', 8750, '九溪', 'transport', '1️⃣\xa0九溪(公交站)\n2️⃣\xa0九溪十八涧',
     '原文明确为公交站路线起点，不等同九溪景观推荐。'),
    ('杭州', 9336, '九溪十八涧', 'hotel', '有泳池、小院和公共茶室，步行能去九溪十八涧、满觉陇',
     '明确十八涧名称仅为民宿步行范围；其余九溪泛称不足以确定具体十八涧推荐，不仅凭酒店标题排除。'),
    *[('重庆', mid, '来福士', 'photo_spot', '轨道小什字站8号出口，步行导航港渝广场',
       '定位港渝广场的远观机位，不等同来福士建筑主体，不创建机位实体。')
      for mid in [550, 1173, 1599, 1632]],
    ('重庆', 1068, '来福士', 'component', '1，来福士就一个商场，没啥亮点。',
     '原作者评价购物商场组件，不能不加区分计入建筑整体；负评原文及独立商场保持，不改写其评价立场。'),
]
for city_name, mid, name, typ, quote, conclusion in entries:
    city = next(c for c in snapshot['cities'] if c['city'] == city_name)
    entity = next(e for e in city['entities'] if e['canonical_name'] == name and not e['redirect_to'])
    mention = next(m for m in city['mentions'] if m['id'] == mid)
    assert mention['entityId'] is None
    reviews.append({'city': city_name, 'entityId': entity['entity_id'], 'name': name,
        'expectedRevision': entity['revision'], 'mentionId': mid, 'inputHash': mention['inputHash'],
        'expectedResolution': mention['resolution'], 'noteId': mention['raw_note_id'], 'quote': quote,
        'relation': 'not_same_entity', 'subjectType': typ, 'conclusion': conclusion,
        'businessMutation': False, 'limit': '仅排除母项潜在加分，不创建域外主体或正式关系，原文与PENDING保持。'})
assert 1207 not in {r['mentionId'] for r in reviews}
for city in snapshot['cities']:
    before = build_city(city, types, geo, reviews[:-len(entries)])
    after = build_city(city, types, geo, reviews)
    assert [(p['entityId'], p['score']) for p in before['top30']] == [(p['entityId'], p['score']) for p in after['top30']]
with (ROOT / 'seven-cities-mention-boundaries-05.json').open('x', encoding='utf-8') as handle:
    json.dump(reviews, handle, ensure_ascii=False, indent=2)
print(json.dumps({'boundaries': len(reviews), 'new': len(entries), 'allTop30AndScoresUnchanged': True}))
