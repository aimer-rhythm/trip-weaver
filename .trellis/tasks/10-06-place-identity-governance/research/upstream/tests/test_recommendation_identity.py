"""景点推荐分按实体提及重算；防止合并沿用最大旧分、子项串分及非景点扩围。"""
from __future__ import annotations

import copy
import pytest
from app.clean.identity import IdentityCatalog
from app.clean.place_export import consolidate_places
from app.clean.recommendation import recommendation_metrics, recommendation_binding


def fixture(kind='attraction', policy=True):
    entity = dict(entity_id='a', city='北京', canonical_name='测试公园', primary_place_id=1,
        aliases=['测试公园', '公园旧名'], legacy_ids=['a'], status='ACTIVE', redirect_to=None,
        revision=2, evidence=[], overrides={'recommendationPolicy': 'resolved_attraction_mentions_v1'} if policy else {})
    catalog = IdentityCatalog('北京', [entity], [{'place_id': i, 'entity_id': 'a'} for i in [1, 2]])
    rows = [{'id': str(i), 'sourcePlaceId': i, 'name': name, 'category': '自然',
        'payload': {'xhsPlaceType': kind, 'recommendScore': 100 + i, 'mentionCount': 40}, 'evidence': []}
        for i, name in [(1, '测试公园'), (2, '公园旧名')]]
    mentions = [{'id': 1, 'raw_note_id': 10, 'mention_type': 'recommend'},
                {'id': 2, 'raw_note_id': 10, 'mention_type': 'warning'}]
    return catalog, rows, mentions


def test_按提及ID去重_同笔记不同提及不增加来源数():
    _, _, mentions = fixture()
    assert recommendation_metrics([*mentions, mentions[0]]) == {'mentionCount': 2, 'recommendScore': 7.0}
    assert recommendation_metrics([]) == {'mentionCount': 0, 'recommendScore': 0.0}


def test_显式景点策略替换最大旧分_重复导出稳定_原输入不改():
    catalog, rows, mentions = fixture()
    before = copy.deepcopy(rows)
    output = consolidate_places(rows, '北京', '2026-10-09', catalog, recommendation_mentions={'a': mentions})
    assert output[0]['payload']['recommendScore'] == 7
    assert output[0]['payload']['mentionCount'] == 2
    assert 'recommendationPolicy' not in output[0]['payload']
    assert output == consolidate_places(rows, '北京', '2026-10-09', catalog, recommendation_mentions={'a': mentions})
    assert rows == before


def test_已启用策略不能缺失实体提及后退回旧缓存():
    catalog, rows, _ = fixture()
    with pytest.raises(ValueError, match='禁止退回旧缓存'):
        consolidate_places(rows, '北京', '2026-10-09', catalog)
    assert consolidate_places(rows, '北京', '2026-10-09', catalog,
        recommendation_mentions={})[0]['payload']['recommendScore'] == 0


def test_非景点禁止套用策略_未治理类型保持原分数():
    catalog, rows, mentions = fixture(kind='food')
    with pytest.raises(ValueError, match='其它地点类型'):
        consolidate_places(rows, '北京', '2026-10-09', catalog, recommendation_mentions={'a': mentions})
    catalog, rows, mentions = fixture(kind='food', policy=False)
    assert consolidate_places(rows, '北京', '2026-10-09', catalog,
        recommendation_mentions={'a': mentions})[0]['payload']['recommendScore'] == 102


def test_其它实体提及不能抬高目标分数():
    catalog, rows, mentions = fixture()
    assert consolidate_places(rows, '北京', '2026-10-09', catalog,
        recommendation_mentions={'a': [], 'child': mentions})[0]['payload']['recommendScore'] == 0


def test_推荐分绑定实体版本和唯一输入_顺序或重复不改哈希():
    catalog, rows, mentions = fixture()
    entity = catalog.root('a')
    bound = recommendation_binding(entity, mentions)
    assert bound == recommendation_binding(entity, [*reversed(mentions), mentions[0]])
    assert bound['entityId'] == 'a' and bound['revision'] == 2
    assert bound['mentionCount'] == 2 and bound['recommendScore'] == 7
    assert len(bound['inputHash']) == 64
    assert recommendation_binding(entity, [{**mentions[0], 'mention_type': 'warning'}])['inputHash'] != bound['inputHash']
    output = consolidate_places(rows, '北京', '2026-10-09', catalog, recommendation_mentions={'a': mentions})
    assert output[0]['payload']['recommendationIdentity'] == bound
