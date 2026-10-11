"""把已读原文的明确非景点结论绑定到本次完整提及集合；仅改变任务配额，不改业务类别。"""
import json
import argparse
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SNAPSHOT = ROOT / 'snapshot-20261009T141514441892Z/input.json'
REVIEWED = [
    ('上海', '东昌路渡口', 'transport', 2314, '继续步行到东昌路渡口，花2元坐轮渡横渡黄浦江到浦西',
     '明确用于轮渡登船的交通设施，不作为新增景点主体；原业务记录保持。'),
    ('上海', '外滩码头', 'transport', 2279, '国金中心 → 外滩 → 外滩码头',
     '原文路线中的登船码头泛称，没有独立景观主体证据；交通设施不占景点配额，具体码头未确认。'),
    ('厦门', '鹭江夜游', 'activity', 1249, '就在中山路附近的和平码头坐船',
     '原文为约一小时的乘船夜游活动，不等同码头或沿岸景点；活动记录不占景点配额。'),
    ('广州', '珠江夜游', 'activity', 1685, '傍晚坐游船夜游珠江，看两岸灯火',
     '乘船夜游活动，既有待审256仍保留；不把活动归入省总码头或天字码头，不占景点配额。'),
    ('广州', '长隆国际大马戏', 'activity', 1889, '大马戏普通座选中间过道，小丑会送小礼物',
     '本组原文指有座次与场次的马戏表演，不是新确认的独立园区或剧院建筑，不占景点配额。'),
    ('西安', '长恨歌演出', 'activity', 2628, '长恨歌演出（只有晚上才有），推荐看，根据位置不同票价不同',
     '华清宫演出活动，不能占用景点主体名额，也不与华清宫或骊山同义合并。'),
    ('重庆', '我在重庆大屏', 'photo_spot', 319, '天桥对面的大屏幕滚动播放“我爱重庆”',
     '原文与全部现行提及均指大屏合影打卡点，不是观音桥街区整体；按独立机位排除本轮配额。'),
    ('重庆', '八一好吃街', 'market', 30, '八一路好吃街',
     '原文为解放碑旁集中售卖川渝小吃的美食街，现行提及均为market/food；保留业务记录，不占景点配额。'),
]

EXTENDED = [
    ('成都', '成都太古里', 'market', 900, '太古里：很雅的一个顶奢品牌聚集地',
     '原文明确品牌商业街区，购物及商户维持只读；不将商业体或大慈寺摄影参照并为景点。'),
    ('成都', '中车·源STAGE', 'photo_spot', 935, '中车·源STAGE（我在成都）',
     '两篇当前来源均为机位合集，指“我在成都”文字拍照点，没有独立园区游览证据；该来源范围按机位只读，不宣称整个园区仅为机位。'),
    ('重庆', '观音桥', 'market', 316, '时尚商圈）：晚上很热闹，有9吧街、美食街和商场',
     '现有主体为观音桥商圈及其住宿/逛街/街拍语境，不能按名称当作独立古桥景点；保留北仓、塔坪等具名景点单独核查。'),
    ('重庆', '重庆之圆', 'photo_spot', 319, '与来福士合影的超赞机位',
     '当前提及均指圆形构图拍摄点，不是来福士或钟楼广场的同义主体，按独立机位排除配额。'),
]

parser = argparse.ArgumentParser()
parser.add_argument('--extended', action='store_true')
args = parser.parse_args()

snapshot = json.loads(SNAPSHOT.read_bytes())
result = []
for city_name, name, typ, note_id, quote, conclusion in [*REVIEWED, *(EXTENDED if args.extended else [])]:
    city = next(c for c in snapshot['cities'] if c['city'] == city_name)
    entity = next(e for e in city['entities'] if e['canonical_name'] == name and not e['redirect_to'])
    assert quote in city['notes'][str(note_id)]['note_desc']
    mentions = [m for m in city['mentions'] if m['entityId'] == entity['entity_id']]
    assert mentions and note_id in {m['raw_note_id'] for m in mentions}
    result.append({'city': city_name, 'entityId': entity['entity_id'], 'name': name,
        'expectedRevision': entity['revision'], 'effectiveType': typ,
        'mentionHashes': {str(m['id']): m['inputHash'] for m in mentions},
        'noteQuotes': [{'noteId': note_id, 'quote': quote}], 'conclusion': conclusion,
        'businessMutation': False})
with (ROOT / ('seven-cities-type-reviews-02.json' if args.extended else 'seven-cities-type-reviews-01.json')).open('x', encoding='utf-8') as handle:
    json.dump(result, handle, ensure_ascii=False, indent=2)
print(f'{len(result)} reviewed classifications written; no business mutation')
