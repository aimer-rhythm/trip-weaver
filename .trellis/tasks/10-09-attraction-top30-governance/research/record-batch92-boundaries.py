"""绑定已在89—92批正式隔离的非同体提及；只更新任务证据，不改业务。"""
import json
from pathlib import Path
from rank import build_city

ROOT = Path(__file__).resolve().parent
snapshot = json.loads((ROOT / 'snapshot-20261009T182425163301Z/input.json').read_bytes())
ranking = json.loads((ROOT / 'seven-cities-ranking-13.json').read_bytes())
reviews = json.loads((ROOT / 'seven-cities-mention-boundaries-01.json').read_bytes())
decisions = [
    ('上海', 10337, 'hotel', '先来夸夸酒店的位置吧，从酒店出来就是地铁站', '未具名酒店的位置广告，迪士尼只是交通参照，不等同度假区。'),
    ('上海', 10341, 'hotel', '上海迪士尼附近的一家酒店，去迪士尼玩的首选这家，酒店有接驳车', '未具名酒店的接驳服务，不等同度假区。'),
    ('上海', 10407, 'photo_spot', '9️⃣迪士尼门口', '全文为免费拍照清单，此项明确为门口机位，不等同园内乐园。'),
    ('上海', 10145, 'area', '3️⃣城隍庙\n📍松月楼素菜包\n📍宁波汤团店', '美食分区标题与小吃商户列表，不等同道观主体。'),
    ('上海', 10354, 'hotel', '离城隍庙，豫园都很近的', '整段主语为未具名酒店，邻近参照不是道观推荐。'),
    ('上海', 10372, 'area', '城隍庙小吃多，适量品尝，避免肠胃不适', '此条警示针对周边小吃消费，不等同道观游览事实；原作者观点保持。'),
    ('上海', 11000, 'area', '城隍庙里面有各式各样的小吃！其中最出名的就是南翔馒头，绿波廊，沈大成', '此段主语为小吃商业片区并含九曲桥及楼宇灯光，不等同道观。'),
    ('上海', 11027, 'area', '2. 城隍庙（10:00–11:00）\n• 免费街区\n• 吃：南翔小笼、梨膏糖、海棠糕', '明确为免费街区吃小吃拍九曲桥，不等同道观及其游览时长。'),
    ('上海', 11157, 'area', '城隍庙小吃别抱太高期望，就是游客价，尝个鲜就行', '负评限定小吃消费，不等同道观；保持原文，不由此认定道观好坏。'),
    ('上海', 11262, 'photo_spot', '城隍庙主街灯笼群：成片红灯笼连成街巷', '打卡机位段的主街灯笼群，不等同道观。'),
    ('广州', 7394, 'photo_spot', '白云山——洞穴看广州塔\n很少人知道的隐藏机位', '原文定位广州碑林洞穴机位，不等同整个白云山。'),
    ('广州', 7659, 'photo_spot', '导航白云山风景名胜区濂泉门—往碧箫亭方向走15分钟即可到达', '机位清单中的指定拍摄位置，不等同整座景区或濂泉门本身。'),
    ('广州', 8054, 'activity', '白云山有非遗雅集、森林康养和音乐市集', '中秋活动清单中的限时项目，不等同常设景区主体。'),
    ('广州', 8140, 'activity', '🌙主题活动：白云山I中秋灯月会·非遗古乐夜', '明确的节庆主题活动，不等同常设景区主体。'),
    ('重庆', 575, 'transport', '走到李子坝再换乘其他地铁也很方便', '终点换乘语境，没有轻轨穿楼观看行为，不计入景观推荐上界。'),
]
for city_name, mid, typ, quote, conclusion in decisions:
    city = next(c for c in snapshot['cities'] if c['city'] == city_name)
    ranked = next(c for c in ranking['cities'] if c['city'] == city_name)
    candidates = [p for p in [*ranked['allAttractions'], *ranked['withdrawnOrReview']] if mid in p['uncertainMentionIds']]
    assert len(candidates) == 1, (city_name, mid)
    parent = candidates[0]
    mention = next(m for m in city['mentions'] if m['id'] == mid)
    assert mention['entityId'] is None and mention['resolution']['status'] == 'review'
    reviews.append({'city': city_name, 'entityId': parent['entityId'], 'name': parent['name'],
        'expectedRevision': parent['revision'], 'mentionId': mid, 'inputHash': mention['inputHash'],
        'expectedResolution': mention['resolution'], 'noteId': mention['raw_note_id'], 'quote': quote,
        'relation': 'not_same_entity', 'subjectType': typ, 'conclusion': conclusion,
        'businessMutation': False, 'limit': '只排除所列母项潜在加分；原始待审、原文和分配保持，不创建新实体或正式组成关系。'})
classifications = json.loads((ROOT / 'seven-cities-type-reviews-04.json').read_bytes())
geography = json.loads((ROOT / 'seven-cities-geography-reviews-01.json').read_bytes())
for city in snapshot['cities']:
    out = build_city(city, classifications, geography, reviews)
    before = next(c for c in ranking['cities'] if c['city'] == city['city'])
    assert [(p['entityId'], p['score']) for p in out['top30']] == [(p['entityId'], p['score']) for p in before['top30']]
with (ROOT / 'seven-cities-mention-boundaries-02.json').open('x', encoding='utf-8') as handle:
    json.dump(reviews, handle, ensure_ascii=False, indent=2)
print(json.dumps({'boundaries': len(reviews), 'new': len(decisions), 'allTop30AndScoresUnchanged': True, 'businessMutation': False}))
