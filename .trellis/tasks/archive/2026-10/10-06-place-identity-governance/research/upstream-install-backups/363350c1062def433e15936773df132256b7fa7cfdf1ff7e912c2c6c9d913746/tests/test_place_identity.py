"""稳定身份、负例、导出类别与组成关系的纯函数回归。"""
from __future__ import annotations

from app.clean.identity import IdentityCatalog, name_key
from app.clean.alias import resolve_alias
from app.clean.place_export import consolidate_places


def entity(eid='a', name='大明湖', aliases=None, city='济南'):
    return dict(entity_id=eid, city=city, canonical_name=name, aliases=aliases or [],
                legacy_ids=[eid, 'old'], revision=2, primary_place_id=1,
                status='ACTIVE', redirect_to=None, overrides={}, evidence=[])


def test_保留分店括号和后缀_仅空白全角大小写等价():
    assert name_key(' ＡＢＣ（大明湖店） ') == 'abc(大明湖店)'
    assert name_key('大明湖景区') != name_key('大明湖')
    assert resolve_alias('桔子酒店（大明湖店）', '济南') != resolve_alias('桔子酒店（趵突泉店）', '济南')
    assert resolve_alias('后海', '北京') != resolve_alias('什刹海', '北京')


def test_按稳定身份解析_同名有歧义_不同城市不串用():
    a = entity(aliases=['大明湖景区', '大明湖公园'])
    c = IdentityCatalog('济南', [a, entity('b', city='杭州')], [{'place_id': 1, 'entity_id': 'a'}])
    assert c.resolve('大明湖景区')['entity_id'] == c.resolve(place_id=1)['entity_id'] == 'a'
    a['canonical_name'] = '新展示名'
    assert IdentityCatalog('济南', [a], []).resolve('大明湖景区')['entity_id'] == 'a'
    b = entity('b', aliases=['大明湖景区'])
    assert IdentityCatalog('济南', [a, b], []).resolve('大明湖景区') is None


def test_相似名只供审核_子景点不等价():
    c = IdentityCatalog('济南', [entity()], [])
    assert c.resolve('大明湖公园') is None
    assert c.candidates('大明湖公园') == ['a']
    assert c.resolve('大明湖超然楼') is None


def test_导出合并别名保留稳定ID_覆盖错误坐标并隔离待审():
    a = entity(aliases=['大明湖景区'])
    a['overrides'] = {'lat': None, 'lng': None, 'category': '自然'}
    b = entity('b', '大明湖附近旅店')
    b['status'] = 'REVIEW'
    c = IdentityCatalog('济南', [a, b], [{'place_id': 1, 'entity_id': 'a'},
        {'place_id': 2, 'entity_id': 'a'}, {'place_id': 3, 'entity_id': 'b'}])
    rows = [dict(id=str(i), sourcePlaceId=i, name=n, lat=99, lng=99, category='美食',
            payload={'originalName': n}, evidence=[]) for i, n in [(1, '大明湖'), (2, '大明湖景区'), (3, '大明湖附近旅店')]]
    result = consolidate_places(rows, '济南', '2026-10-06', c)
    assert len(result) == 1
    assert result[0]['id'] == 'a' and result[0]['lat'] is None and result[0]['category'] == '自然'
    assert result[0]['payload']['identity']['memberIds'] == ['a', 'old']


def test_导出同名独立实体按ID保留_不靠唯一名称猜测():
    a = entity('a', '同名饭店')
    a['legacy_ids'] = ['a']
    b = entity('b', '同名饭店')
    b['primary_place_id'] = 2
    b['legacy_ids'] = ['b']
    catalog = IdentityCatalog('济南', [a, b], [{'place_id':1,'entity_id':'a'}, {'place_id':2,'entity_id':'b'}])
    assert catalog.resolve('同名饭店') is None
    rows = [dict(id=str(i),sourcePlaceId=i,name='同名饭店',category='美食',lat=36+i/100,lng=117,
        payload={'originalName':'同名饭店'},evidence=[]) for i in [1,2]]
    result = consolidate_places(rows,'济南','2026-10-06',catalog)
    assert {row['id'] for row in result} == {'a','b'}
    assert {row['lat'] for row in result} == {36.01,36.02}


def test_v2组合保留子项独立身份与事实_旧格式仍兼容():
    names = ['天安门', '天安门城楼', '天安门升旗', '天安门降旗']
    entities, memberships, rows = [], [], []
    for i, name in enumerate(names, 1):
        e = entity(str(i), name, city='北京')
        e.update(primary_place_id=i, legacy_ids=[str(i)])
        entities.append(e)
        memberships.append(dict(place_id=i, entity_id=str(i)))
        rows.append(dict(id=str(i), sourcePlaceId=i, name=name, category='文化', lat=39.9, lng=116.4,
            payload={'originalName': name, 'openHours': {'text': f'时段{i}'}}, evidence=[]))
    catalog = IdentityCatalog('北京', entities, memberships)
    output = consolidate_places(rows, '北京', '2026-10-06', catalog)
    assert {p['id'] for p in output} == {'1', '2', '3', '4'}
    root = next(p for p in output if p['id'] == '1')
    assert root['payload']['identity']['memberIds'] == ['1']
    assert {p['canonicalPlaceId'] for p in root['payload']['components']} == {'2', '3', '4'}
    assert 'openHours' not in root['payload']
    for p in output:
        if p['id'] != '1':
            assert p['payload']['identity']['kind'] == 'same_entity'
            assert p['payload']['identity']['memberIds'] == [p['id']]
            assert p['payload']['components'] == []
            assert p['payload']['openHours']['text'] == f"时段{p['id']}"
    assert len(consolidate_places(rows, '北京', '2026-10-06')) == 1
    # 没导出父项时也不能改名造父实体或丢弃独立子项。
    children = consolidate_places(rows[1:], '北京', '2026-10-06', catalog)
    assert {p['id'] for p in children} == {'2', '3', '4'}
