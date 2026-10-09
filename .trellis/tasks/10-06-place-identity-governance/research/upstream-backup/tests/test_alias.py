"""app/clean/alias.py 回归：城市维度地点别名归一。"""
from __future__ import annotations

from app.clean.alias import aliases_for, resolve_alias
from app.clean.dedup import normalize_name


def test_resolve_alias_to_official_name():
    assert resolve_alias("故宫", "北京") == "故宫博物院"
    assert resolve_alias("奥森", "北京") == "奥林匹克森林公园"


def test_alias_is_city_scoped():
    """同一别名在不同城市指不同实体；未配置的城市不迁移。"""
    assert resolve_alias("故宫", "上海") == "故宫"
    assert resolve_alias("太古里", "北京") == "三里屯太古里"
    assert resolve_alias("太古里", "成都") == "成都太古里"


def test_resolve_alias_falls_back_to_normalized_name():
    assert resolve_alias("某野地点", "北京") == normalize_name("某野地点")


def test_aliases_for_reverse_lookup():
    assert aliases_for("北京", "故宫博物院") == ["故宫", "故宫博物馆"]


def test_aliases_for_city_isolation():
    assert aliases_for("成都", "故宫博物院") == []


def test_same_district_alias_merges():
    """同片区细分（高德 POI 不同）按语义归并。"""
    assert resolve_alias("后海", "北京") == "什刹海"
    assert resolve_alias("前门大栅栏", "北京") == "大栅栏"
    assert aliases_for("北京", "什刹海") == ["后海", "后海公园"]


def test_hangzhou_photograph_names_preserve_separate_sights():
    assert aliases_for('杭州', '西湖断桥') == ['断桥', '断桥残雪']
    assert resolve_alias('苏堤春晓', '杭州') == '苏堤'
    assert resolve_alias('西溪国家湿地公园', '杭州') == '西溪湿地'
    for name in ['西湖', '灵隐寺', '飞来峰', '九溪烟树', '九溪十八涧']:
        assert resolve_alias(name, '杭州') == name
    assert resolve_alias('断桥', '成都') == '断桥'
