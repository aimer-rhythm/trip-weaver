"""游览时长整句语义、地点边界与同篇重复证据回归，不访问生产库。"""
from __future__ import annotations

import pytest

from app.clean.duration import aggregate_minutes
from scripts.build_visit_duration import extract_note_durations


@pytest.mark.parametrize("sentence", [
    "避雷5：灵岩寺距离市区较远，来回路程长，如果只有半天时间不建议安排，容易太赶",
    "灵岩寺距离远半天不够",
    "灵岩寺适合看彩塑，如果只有半天时间不建议安排，容易太赶",
    "灵岩寺半天逛不完",
    "灵岩寺游玩3小时不够",
    "灵岩寺游玩3小时，不够",
    "灵岩寺不建议安排半天",
    "灵岩寺不用安排3小时",
    "只有半天时间，灵岩寺适合拍照",
    "灵岩寺还剩下半天可以安排",
    "灵岩寺大概3小时，包含从市区出发再返回酒店的全部往返交通",
    "灵岩寺大概2小时车程",
    "Day1 灵岩寺安排半天",
    "灵岩寺→其他景点游玩半天",
])
def test_预算否定与通勤不成为停留时长(sentence):
    assert extract_note_durations(sentence, [], [("灵岩寺", "灵岩寺", "attraction")]) == []


@pytest.mark.parametrize("name,sentence,expected", [
    ("灵岩寺", "灵岩寺建议游玩半天", 180),
    ("灵岩寺", "灵岩寺安排3小时", 180),
    ("灵岩寺", "灵岩寺游玩2小时足够", 120),
    ("灵岩寺", "灵岩寺距离市区较远，建议游玩3小时", 180),
    ("灵岩寺", "灵岩寺不建议周末去，建议游玩3小时", 180),
    ("灵岩寺", "灵岩寺建议游玩半天，不建议周末去", 180),
    ("西更道街", "西更道街建议停留60分钟", 60),
    ("起凤桥八号", "起凤桥八号安排30分钟拍照", 30),
])
def test_独立明确推荐继续保留(name, sentence, expected):
    facts = extract_note_durations(sentence, [], [(name, name, "attraction")])
    assert [(norm, minutes) for norm, minutes, _ in facts] == [(name, expected)]


def test_同篇图片正文摘要和重复提及不重复加权():
    name = "灵岩寺"
    repeated = f"{name}建议游玩1小时"
    first = extract_note_durations(repeated, [{"has_text": True, "text_content": repeated,
        "key_info": {"tips": repeated, "duration": repeated}}], [(name, name, "attraction")] * 2)
    second = extract_note_durations(f"{name}建议游玩3小时", [], [(name, name, "attraction")])
    third = extract_note_durations(f"{name}建议游玩4小时", [], [(name, name, "attraction")])
    assert len(first) == 1
    assert aggregate_minutes([m for _, m, _ in first + second + third]) == (180, 3)
    assert aggregate_minutes([m for _, m, _ in first + first]) == (60, 2), "独立笔记仍各贡献证据"


def test_分别陈述的游览与通勤事实不互相传播():
    facts = extract_note_durations("灵岩寺往返3小时；灵岩寺建议停留2小时", [],
        [("灵岩寺", "灵岩寺", "attraction")])
    assert [(norm, minutes) for norm, minutes, _ in facts] == [("灵岩寺", 120)]


def test_组合时长不摊给邻近地点():
    mentions = [(name, name, "attraction") for name in ["王府池子", "腾蛟泉", "起凤泉", "刘氏泉"]]
    assert extract_note_durations("王府池子、腾蛟泉、起凤泉、刘氏泉一起游玩半小时", [], mentions) == []


@pytest.mark.parametrize("sentence", [
    "‼️可能会有朋友选择汉服妆造，不太推荐曲水亭街的店建议提前一天找好，避免浪费时间",
    "曲水亭街拍照建议提前两小时预约妆造",
    "曲水亭街打卡建议提早半天准备服装",
    "曲水亭街建议游玩1小时，提前一天找好妆造店",
])
def test_提前准备时间不成为游览时长(sentence):
    mentions = [("曲水亭街", "曲水亭街", "attraction")]
    assert extract_note_durations(sentence, [], mentions) == []
    assert extract_note_durations(None, [{"has_text": True, "text_content": sentence,
        "key_info": {"tips": sentence}}], mentions) == []


def test_独立游览建议不受预约提示影响():
    mentions = [("曲水亭街", "曲水亭街", "attraction")]
    for text in ["曲水亭街建议提前预约，游玩1小时", "曲水亭街提前一天找好妆造店；曲水亭街建议游玩1小时"]:
        facts = extract_note_durations(text, [], mentions)
        assert [(name, minutes) for name, minutes, _ in facts] == [("曲水亭街", 60)]
