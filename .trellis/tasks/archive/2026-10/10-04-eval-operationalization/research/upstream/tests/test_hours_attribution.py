"""营业信息必须绑定实体和原句，混合地点/子设施/无主语不污染主地点。"""
from __future__ import annotations

import pytest
from app.clean.hours import HoursEvidence, mine_open_hours


def extract(text, target="奎星楼街", **kwargs):
    return mine_open_hours([HoursEvidence(target, text, "https://example.org/source")], target=target, **kwargs)


@pytest.mark.parametrize("separator", ["；", "，", "", "。"])
def test_同句多地点不把博物馆闭馆归给街区(separator):
    raw = f"奎星楼街24小时开放{separator}成都博物馆周一不对外开放。"
    got = extract(raw, known_names=["奎星楼街", "成都博物馆"])
    assert got["closedWeekdays"] == []
    assert got["openTime"] == "00:00"
    assert got["review"][0]["rawText"] == raw
    assert got["review"][0]["sourceUrl"] == "https://example.org/source"


def test_正确主体与别名保留闭馆规则():
    got = extract("故宫08:30-17:00开放，周一闭馆", "故宫博物院", aliases=["故宫"])
    assert got["closedWeekdays"] == [1]
    assert got["attributions"][0]["subject"] == "故宫"
    assert got["evidence"] == ["故宫08:30-17:00开放，周一闭馆"]


@pytest.mark.parametrize("text", ["物馆周一不对外开放", "周一闭馆", "其他博物馆周一闭馆", "锦里有博物馆周一闭馆"])
def test_无归属截断或其他主体只能待审(text):
    got = extract(text, "锦里")
    assert got["status"] == "unknown"
    assert got["closedWeekdays"] == []
    assert got["review"]


def test_父子同段只取主地点开放事实():
    got = extract("故宫全天开放，故宫珍宝馆周一闭馆", "故宫", known_names=["故宫", "故宫珍宝馆"])
    assert got["closedWeekdays"] == []
    assert got["review"][0]["subject"] == "故宫珍宝馆"
    implicit = extract("故宫馆内餐厅周一闭馆", "故宫")
    assert implicit["status"] == "unknown"


def test_馆内餐厅自身有明确主体仍可闭馆():
    got = extract("珍宝餐厅周一休息", "珍宝餐厅")
    assert got["closedWeekdays"] == [1]


def test_全天开放街区与商铺局部休息分别归属():
    got = extract("锦里全天开放（商铺周一休息，10:00-22:00）", "锦里")
    assert got["openTime"] == "00:00"
    assert got["closedWeekdays"] == []
    assert any(item["subject"] == "商铺" for item in got["review"])


def test_来源链接保留出处且去掉签名参数():
    got = mine_open_hours([HoursEvidence("甲馆", "甲馆周一闭馆", "https://example.org/note?id=token#frag")], target="甲馆")
    assert got["attributions"][0]["sourceUrl"] == "https://example.org/note"


def test_放票时间不污染同句营业时间():
    got = extract("故宫08:30-17:00开放，20:00放票", "故宫")
    assert (got["openTime"], got["closeTime"]) == ("08:30", "17:00")
    assert extract("故宫20:00放票", "故宫") is None


def test_已确认的单实体来源可有无主语短句_子设施仍隔离():
    got = mine_open_hours([HoursEvidence("甲馆", "周一闭馆", scope="place")], target="甲馆")
    assert got["closedWeekdays"] == [1]
    other = mine_open_hours([HoursEvidence("甲馆", "周一闭馆", scope="component")], target="甲馆")
    assert other["status"] == "unknown"


def test_不再允许导出入口传无归属字符串():
    with pytest.raises(TypeError):
        mine_open_hours(["周一闭馆"], target="锦里")
