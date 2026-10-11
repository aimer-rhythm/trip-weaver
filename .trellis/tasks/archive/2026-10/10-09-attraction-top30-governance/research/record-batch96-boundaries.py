"""绑定95/96-v2正式隔离的六条异类提及，不改变业务PENDING。"""
import json
from pathlib import Path
from rank import build_city

ROOT = Path(__file__).resolve().parent
snapshot = json.loads((ROOT / 'snapshot-20261009T190108845368Z/input.json').read_bytes())
reviews = json.loads((ROOT / 'seven-cities-mention-boundaries-03.json').read_bytes())
types = json.loads((ROOT / 'seven-cities-type-reviews-04.json').read_bytes())
geo = json.loads((ROOT / 'seven-cities-geography-reviews-01.json').read_bytes())
entries = [
    ('上海', 10357, '苏州河', 'hotel', '酒店紧挨着苏州河，傍晚沿河散步巨舒服', '未具名酒店广告的位置参照，不等同河岸景观推荐。'),
    ('西安', 12030, '大唐不夜城', 'photo_spot', 'P8、P9➡️大唐不夜城牡丹亭茶叙门口处', '明确商户门口机位，不等同整个景区。'),
    ('西安', 12352, '大唐不夜城', 'photo_spot', 'P8、P9➡️大唐不夜城牡丹亭茶叙门口处', '同篇另一提及仍为商户门口机位，不计景区推荐。'),
    ('西安', 12473, '大唐不夜城', 'service', '看中的摄影师有档期，拍了一套，看到样片的第一秒已经爱上了', '评价摄影服务，地点仅在大唐不夜城与大唐芙蓉园标签中，不认定景区主体。'),
    ('西安', 12504, '大唐不夜城', 'service', '238=服装任选+精致妆造（不含拍摄）', '未具名商户妆造服务广告，不等同景区。'),
    ('西安', 12487, '大唐不夜城', 'photo_spot', 'P1 大唐不夜城和大雁塔中间交叉的广场\nP2 大唐不夜城（在树的灯带下拍！）', '跨两处具体拍摄位置的提及，不等同整个步行景区，也不据此创建一个混合机位。'),
]
for city_name, mid, name, typ, quote, conclusion in entries:
    city = next(c for c in snapshot['cities'] if c['city'] == city_name)
    entity = next(e for e in city['entities'] if e['canonical_name'] == name and not e['redirect_to'])
    mention = next(m for m in city['mentions'] if m['id'] == mid)
    reviews.append({'city': city_name, 'entityId': entity['entity_id'], 'name': name,
        'expectedRevision': entity['revision'], 'mentionId': mid, 'inputHash': mention['inputHash'],
        'expectedResolution': mention['resolution'], 'noteId': mention['raw_note_id'], 'quote': quote,
        'relation': 'not_same_entity', 'subjectType': typ, 'conclusion': conclusion,
        'businessMutation': False, 'limit': '仅排除母项潜在加分，不创建具体服务/酒店/机位实体或关系，原文与PENDING保持。'})
for city in snapshot['cities']:
    before = build_city(city, types, geo, reviews[:-len(entries)])
    after = build_city(city, types, geo, reviews)
    assert [(p['entityId'], p['score']) for p in before['top30']] == [(p['entityId'], p['score']) for p in after['top30']]
with (ROOT / 'seven-cities-mention-boundaries-04.json').open('x', encoding='utf-8') as handle:
    json.dump(reviews, handle, ensure_ascii=False, indent=2)
print(json.dumps({'boundaries': len(reviews), 'new': len(entries), 'allTop30AndScoresUnchanged': True}))
