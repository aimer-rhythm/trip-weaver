"""外滩、建筑群与东方明珠的非同体来源，只影响排名上界，不改业务待审。"""
import argparse
import json
from pathlib import Path
from rank import build_city

ROOT = Path(__file__).resolve().parent
parser = argparse.ArgumentParser()
parser.add_argument('--snapshot', required=True)
args = parser.parse_args()
snapshot = json.loads((ROOT / args.snapshot).read_bytes())
reviews = json.loads((ROOT / 'seven-cities-mention-boundaries-06.json').read_bytes())
old_count = len(reviews)
types = json.loads((ROOT / 'seven-cities-type-reviews-04.json').read_bytes())
geo = json.loads((ROOT / 'seven-cities-geography-reviews-01.json').read_bytes())
city = next(c for c in snapshot['cities'] if c['city'] == '上海')
entities = {e['entity_id']: e for e in city['entities']}
mentions = {m['id']: m for m in city['mentions']}
bund = '97930a0a0c32d968eeed64e754e58382'
buildings = '0700e088ebd6e984525c32fecc476cef'
pearl = '2af1d8c8816a1645942015d16738c9fd'
rows = [
    (bund, 10143, 'area', '1️⃣外滩\n📍李百蟹・蟹黄面\n📍外滩家宴上海菜', '美食清单片区标题，不是景点推荐。'),
    (bund, 10236, 'component', '和平饭店🔜外滩万国建筑群', '明确建筑群，不直接给泛区域加分，不跨scope强行重分配。'),
    (bund, 10336, 'hotel', '从酒店出来就是地铁站🚇，去陆家嘴和外滩都很方便', '酒店交通参照。'),
    (bund, 10339, 'hotel', '2️⃣位置外滩附近，不管是去外滩还是南京路都超方便', '酒店位置参照。'),
    (bund, 10350, 'hotel', '出门就是地铁站，就在外滩旁', '酒店位置及视野。'),
    (bund, 10990, 'service', '过个马路就是外滩，坐在店里就能看到东方明珠、黄浦江景', '餐厅位置与窗景，正文餐后清单未列外滩。'),
    (bund, 11147, 'service', '靠窗位景观很好…隔壁就是红房子的屋顶', '餐厅窗景，非外滩游览。'),
    (bund, 11328, 'service', '外滩22号的景观位复古风李百蟹面馆！！\n窗边就是外滩和东方明珠！', '餐饮景观位，不将窗景归为景区评价。'),
    (buildings, 10353, 'hotel', '可以近距离看三件套，东方明珠，黄浦江，还有金碧辉煌的万国建筑群', '酒店视野参照。'),
    (buildings, 10993, 'service', '晚上万国建筑群亮灯超有氛围，用餐时还有小提琴演奏', '餐厅窗景与用餐体验。'),
    (pearl, 10342, 'hotel', '7️⃣躺着就能看到东方明珠，拍照超出片的一家', '酒店房间视野参照。'),
    (pearl, 10351, 'hotel', '房间还能看到东方明珠夜景，真的很漂亮', '酒店房间视野参照。'),
    (pearl, 10991, 'service', '坐在店里就能看到东方明珠、黄浦江景', '餐厅窗景，不是塔体游览。'),
    (pearl, 11311, 'service', '这个大落地窗！美到失语！！可以看到东方明珠', '餐厅窗景；同篇餐后仅明确去外滩，不把外滩游览泛化成登塔。'),
    (pearl, 11329, 'service', '外滩22号的景观位复古风李百蟹面馆！！\n窗边就是外滩和东方明珠！', '餐厅窗景。'),
]
for eid, mid, kind, quote, conclusion in rows:
    entity, mention = entities[eid], mentions[mid]
    assert mention['entityId'] is None and mention['resolution']['status'] == 'review'
    assert quote in city['notes'][str(mention['raw_note_id'])]['note_desc'], mid
    reviews.append({'city': '上海', 'entityId': eid, 'name': entity['canonical_name'],
        'expectedRevision': entity['revision'], 'mentionId': mid, 'inputHash': mention['inputHash'],
        'expectedResolution': mention['resolution'], 'noteId': mention['raw_note_id'], 'quote': quote,
        'relation': 'not_same_entity', 'subjectType': kind, 'conclusion': conclusion,
        'businessMutation': False, 'limit': '不创建餐厅、酒店或机位，不强行重分配，不新增正式组成关系。'})
assert not {9947, 10260, 11011, 11256, 11236, 9966, 10132, 11159, 11239}.intersection(r['mentionId'] for r in reviews)
for frozen in snapshot['cities']:
    before = build_city(frozen, types, geo, reviews[:old_count])
    after = build_city(frozen, types, geo, reviews)
    assert [(p['entityId'], p['score']) for p in before['top30']] == [(p['entityId'], p['score']) for p in after['top30']]
with (ROOT / 'seven-cities-mention-boundaries-07.json').open('x', encoding='utf-8') as handle:
    json.dump(reviews, handle, ensure_ascii=False, indent=2)
print(json.dumps({'boundaries': len(reviews), 'new': len(rows), 'allTop30AndScoresUnchanged': True}))
