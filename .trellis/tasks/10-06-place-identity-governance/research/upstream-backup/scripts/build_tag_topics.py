"""从小红书笔记 tag_list 聚合话题标签到地点（补充高德分类覆盖不到的小众地点）。

流程：
1. 从 raw_note.raw_json.tag_list 抽话题
2. 过滤无区分度的泛话题（"重庆旅游"/"周末去哪儿"…）
3. 笔记级话题 → 传播到该笔记提及的地点
4. 阈值过滤：某地点需 ≥2 篇笔记带此话题，或占比 ≥50%
5. 话题映射到主题 → 合并进 canonical_place.theme_tags

用法:
  python scripts/build_tag_topics.py                       # 全库
  python scripts/build_tag_topics.py --city 杭州
  python scripts/build_tag_topics.py --city 杭州 --dry-run
"""

import argparse
import asyncio
import re
import sys
from collections import Counter, defaultdict

sys.path.insert(0, ".")
sys.path.insert(0, "vendor/spider_xhs")

from sqlalchemy import select

from app.db import SessionFactory
from app.models import CanonicalPlace, PlaceMention, RawNote

# 无区分度泛话题（每个地点都会被带上）
_GENERIC_TOPICS = {
    "重庆", "重庆旅游", "重庆旅行", "重庆打卡", "重庆旅游攻略", "重庆攻略", "重庆旅行攻略",
    "重庆景点", "重庆吃喝玩乐", "重庆周末去哪儿", "周末去哪儿", "旅游攻略", "旅行",
    "旅游", "假期去哪玩", "重逢便是庆", "重庆人的浪漫", "山城的浪漫至死不渝",
    "大声安利本地美食", "本地人推荐", "本地人做的攻略", "重庆周边游", "重庆citywalk",
    "重庆拍照", "重庆探店", "citywalk", "city walk",
}

# 话题关键词 → 主题
_TOPIC_RULES: tuple[tuple[tuple[str, ...], str], ...] = (
    (("徒步", "登山", "爬山", "露营", "溯溪", "骑行", "户外", "森林", "溪流", "云海", "看日出", "爬山虎"), "自然风光"),
    (("涂鸦", "艺术", "书店", "文创", "咖啡", "画展", "展览", "音乐节", "livehouse"), "文艺"),
    (("夜景", "灯光", "夜游", "日落", "晚霞", "蓝调"), "夜景"),
    (("火锅", "串串", "烧烤", "小吃", "甜品", "冰粉", "江湖菜", "川菜", "面", "烙锅", "美食"), "美食"),
    (("古镇", "老街", "历史", "人文", "博物馆", "旧址", "文物", "寺庙", "民俗"), "历史人文"),
    (("亲子", "遛娃", "带娃", "儿童"), "亲子"),
    (("民宿", "酒店", "住宿", "青旅"), "住宿"),
    (("商场", "购物", "市集"), "购物"),
    (("小众", "冷门", "隐秘", "秘境", "巷子", "老巷"), "文艺"),
)

_MIN_CROSS = 2  # 至少 2 篇笔记交叉验证


def _topics_of(raw: dict | None) -> set[str]:
    card = (raw or {}).get("note_card") or raw or {}
    out: set[str] = set()
    for t in card.get("tag_list") or []:
        if isinstance(t, dict) and t.get("name"):
            name = str(t["name"]).strip()
            if name and name not in _GENERIC_TOPICS:
                out.add(name)
    return out


def _topic_to_theme(topic: str) -> str | None:
    for keywords, theme in _TOPIC_RULES:
        if any(k in topic for k in keywords):
            return theme
    return None


async def main() -> None:
    ap = argparse.ArgumentParser(description="从笔记 tag_list 聚合话题标签到 canonical_place.theme_tags")
    ap.add_argument("--city", default=None, help="只处理该城市（默认全库）")
    ap.add_argument("--dry-run", action="store_true", help="只看结果不写库")
    args = ap.parse_args()
    city = args.city
    if not city:
        print("[警告] 未指定 --city，将处理全部城市")

    async with SessionFactory() as s:
        note_stmt = select(RawNote.id, RawNote.raw_json)
        if city:
            note_stmt = note_stmt.where(RawNote.city == city)
        notes = (await s.execute(note_stmt)).all()
        mention_stmt = select(PlaceMention.raw_note_id, PlaceMention.normalized_name).join(
            RawNote, RawNote.id == PlaceMention.raw_note_id
        )
        if city:
            mention_stmt = mention_stmt.where(RawNote.city == city)
        mentions = (await s.execute(mention_stmt)).all()
        place_stmt = select(
            CanonicalPlace.id,
            CanonicalPlace.normalized_name,
            CanonicalPlace.name,
            CanonicalPlace.theme_tags,
        )
        if city:
            place_stmt = place_stmt.where(CanonicalPlace.city == city)
        places = (await s.execute(place_stmt)).all()

    topics_by_note = {nid: _topics_of(raw) for nid, raw in notes}
    mentions_by_note: dict[int, set[str]] = defaultdict(set)
    mention_total: Counter[str] = Counter()
    for nid, norm in mentions:
        mentions_by_note[nid].add(norm)
        mention_total[norm] += 1

    # 话题 → 地点 交叉计数
    theme_votes: dict[str, Counter[str]] = defaultdict(Counter)  # norm -> Counter[theme]
    raw_topic_votes: dict[str, Counter[str]] = defaultdict(Counter)
    for nid, norms in mentions_by_note.items():
        for topic in topics_by_note.get(nid, set()):
            theme = _topic_to_theme(topic)
            if theme is None:
                continue
            for norm in norms:
                theme_votes[norm][theme] += 1
                raw_topic_votes[norm][topic] += 1

    # 阈值过滤
    accepted: dict[str, set[str]] = {}
    for norm, counter in theme_votes.items():
        total = mention_total.get(norm, 1)
        ok = {
            theme
            for theme, n in counter.items()
            if n >= _MIN_CROSS or n / total >= 0.5
        }
        if ok:
            accepted[norm] = ok

    print(f"话题可补主题的地点: {len(accepted)} 个\n样例:")
    meta = {norm: (name, tags) for _pid, norm, name, tags in places}
    shown = 0
    for norm, themes in accepted.items():
        name, existing = meta.get(norm, (norm, None))
        if existing:
            continue  # 只看原本无标签的
        topics = [t for t, _ in raw_topic_votes[norm].most_common(3)]
        print(f"  {name}: {sorted(themes)}  ← 话题 {topics}")
        shown += 1
        if shown >= 25:
            break

    if args.dry_run:
        print("\n[dry-run] 未写库")
        return

    written = 0
    async with SessionFactory() as s:
        for pid, norm, _name, existing in places:
            new_themes = accepted.get(norm)
            if not new_themes:
                continue
            merged = list(dict.fromkeys(list(existing or []) + sorted(new_themes)))[:3]
            place = await s.get(CanonicalPlace, pid)
            if place:
                place.theme_tags = merged
                written += 1
        await s.commit()
    print(f"\n已更新 {written} 个地点的 theme_tags")


if __name__ == "__main__":
    asyncio.run(main())
