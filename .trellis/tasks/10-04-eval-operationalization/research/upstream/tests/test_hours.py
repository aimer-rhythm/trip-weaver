"""app/clean/hours.py 回归：营业/闭馆时间规则挖掘。"""
from __future__ import annotations

import pytest

from app.clean.hours import _parse_time, _mine_hours as mine_open_hours


def test_hours_and_closed_weekday():
    got = mine_open_hours(["故宫 08:30-17:00 开放，周一闭馆"])
    assert (got["openTime"], got["closeTime"], got["closedWeekdays"]) == ("08:30", "17:00", [1])
    assert got["text"].startswith("08:30-17:00；周一闭馆")


def test_ticket_release_time_is_not_opening_hours():
    """「20:00放票」是预约信息，不能当营业时段。"""
    assert mine_open_hours(["20:00放票"]) is None


def test_24h_open():
    got = mine_open_hours(["24小时开放"])
    assert (got["openTime"], got["closeTime"]) == ("00:00", "23:59")


def test_stop_entry_goes_to_note():
    got = mine_open_hours(["开放 09:00-16:00，15:30停止入场"])
    assert got["note"] == "15:30停止入场"


def test_overnight_range_dropped():
    """跨夜时段（18:00-02:00）当前不支持，保持丢弃而非产出反向区间。"""
    assert mine_open_hours(["18:00-02:00"]) is None


@pytest.mark.parametrize("texts", [[], [""], [None], [123]])
def test_no_signal_returns_none(texts):
    assert mine_open_hours(texts) is None


@pytest.mark.parametrize(
    ("h", "m", "want"),
    [("08", "30", "08:30"), ("9", None, "09:00"), ("25", "00", None), ("10", "99", None)],
)
def test_parse_time(h, m, want):
    assert _parse_time(h, m) == want
