"""从笔记正文抽取游览时长事实，聚合写入 canonical_place.typical_visit_minutes。

策略（对齐 Yuntu xhs_median）：
1. 笔记正文切句
2. 句子须含时长提示词（逛/玩/停留/打卡…）且能抽出时长
3. 句中出现的地点名 → 建立 (地点, 分钟) 关联
4. 按 normalized_name 聚合取中位数 → 写 canonical_place

用法:
  python scripts/build_visit_duration.py --dry-run            # 只看结果不写库
  python scripts/build_visit_duration.py --city 杭州
  python scripts/build_visit_duration.py                      # 不加 --city 则处理全库
"""

import argparse
import asyncio
import re
import sys
from collections import defaultdict

sys.path.insert(0, ".")
sys.path.insert(0, "vendor/spider_xhs")

from sqlalchemy import select

from app.clean.duration import aggregate_minutes, has_duration_hint, normalize_visit_duration
from app.db import SessionFactory
from app.aggregate.mention_identity import load_mention_catalog
from app.aggregate.place_identity import lock_city
from app.models import CanonicalPlace, PlaceMention, RawNote

_SENT_SPLIT = re.compile(r"[。！？!?；;\n]+")

# 通勤/交通语境：句里的时长常是路程时间，不是游览时间
_COMMUTE_WORDS = (
    "步行", "走路", "不行", "打车", "地铁", "公交", "开车", "驾车",
    "车程", "骑行", "轻轨", "自驾", "坐车", "换乘", "导航",
)

# 地点名前后多少字符内出现时长表达才认为相关
_WINDOW = 20

_DURATION_TEXT = r"(?:半(?:个)?小时|半天|一上午|一下午|一整天|全天|一天|[\d一二两三四五六七八九十]+(?:\.\d+)?\s*(?:个小时|小时|分钟|h|min))"
_DURATION_LIMIT = re.compile(
    rf"{_DURATION_TEXT}.{{0,8}}(?:不够|不足|不建议|不推荐|不适合|逛不完|玩不完|游不完|太赶)"
    rf"|(?:不建议|不推荐|不适合|不必|不用|无需|不需要|不到)[^，,。；;]{{0,12}}{_DURATION_TEXT}"
    rf"|(?:只有|仅有|只剩|仅剩|剩下).{{0,8}}{_DURATION_TEXT}", re.I,
)
_ROUTE_CONTEXT = re.compile(r"→|➡|全天行程|\bday\s*\d", re.I)


def extract_note_durations(
    desc: str | None,
    img_analysis: list | None,
    note_mentions: list[tuple[str, str, str]],
) -> list[tuple[str, int, str]]:
    """先保留整句限制语义，再按地点窗口取值；同篇相同地点/分钟只计一次。

    否定、可用预算和通勤不是推荐停留时长。混合句不靠截窗消除歧义；
    独立分句中的明确推荐仍可抽取。纯时长归一器不承担文本语义判断。
    """
    texts = [desc or ""]
    for item in img_analysis or []:
        if item.get("has_text"):
            texts.append(str(item.get("text_content") or ""))
            texts.extend(str(v) for v in (item.get("key_info") or {}).values() if v)
    results: list[tuple[str, int, str]] = []
    seen: set[tuple[str, int]] = set()
    for text in texts:
        for sent in _SENT_SPLIT.split(text):
            sent = sent.strip()
            if not sent or not has_duration_hint(sent):
                continue
            if (_DURATION_LIMIT.search(sent) or _ROUTE_CONTEXT.search(sent)
                    or any(w in sent for w in (*_COMMUTE_WORDS, "来回", "往返", "路程"))):
                continue
            for name, norm, ptype in note_mentions:
                if not name or name not in sent:
                    continue
                idx = sent.find(name)
                window = sent[max(0, idx - _WINDOW):idx + len(name) + _WINDOW]
                if any(o and o != name and o in window for o, _n, _p in note_mentions):
                    continue
                minutes = normalize_visit_duration(window, place_name=name, place_type=ptype)
                if minutes is None or (norm, minutes) in seen:
                    continue
                seen.add((norm, minutes))
                results.append((norm, minutes, f"{name} = {minutes}分  ←  「{window}」"))
    return results


async def main() -> None:
    ap = argparse.ArgumentParser(description="从笔记正文/图片文字抽游览时长，聚合写入 canonical_place")
    ap.add_argument("--city", default=None, help="只处理该城市（默认全库）")
    ap.add_argument("--dry-run", action="store_true", help="只看结果不写库")
    args = ap.parse_args()
    city = args.city
    if not city:
        print("[警告] 未指定 --city，将处理全部城市")

    async with SessionFactory() as session:
        cities = [city] if city else list((await session.scalars(
            select(CanonicalPlace.city).distinct().order_by(CanonicalPlace.city))).all())
    for selected_city in cities:
        await build_city(selected_city, args.dry_run)


async def build_city(city: str, dry_run: bool = False) -> None:
    """每城独立聚合；受控实体不采用全笔记或按泛名传播的事实。"""
    async with SessionFactory() as s:
        note_cond = [(RawNote.desc.is_not(None)) | (RawNote.img_analysis.is_not(None))]
        if city:
            note_cond.append(RawNote.city == city)
        notes = (await s.execute(select(RawNote.id, RawNote.desc, RawNote.img_analysis).where(*note_cond))).all()
        mention_stmt = select(
            PlaceMention.raw_note_id,
            PlaceMention.name,
            PlaceMention.normalized_name,
            PlaceMention.place_type,
        ).join(RawNote, RawNote.id == PlaceMention.raw_note_id)
        if city:
            mention_stmt = mention_stmt.where(RawNote.city == city)
        mentions = (await s.execute(mention_stmt)).all()
        place_stmt = select(
            CanonicalPlace.id, CanonicalPlace.name, CanonicalPlace.normalized_name, CanonicalPlace.place_type
        )
        if city:
            place_stmt = place_stmt.where(CanonicalPlace.city == city)
        places = (await s.execute(place_stmt)).all()

    by_note: dict[int, list[tuple[str, str, str]]] = defaultdict(list)
    for nid, name, norm, ptype in mentions:
        by_note[nid].append((name, norm, ptype))

    facts: dict[str, list[int]] = defaultdict(list)
    samples: list[str] = []

    for nid, desc, img_analysis in notes:
        note_mentions = by_note.get(nid) or []
        if not note_mentions:
            continue
        for norm, minutes, sample in extract_note_durations(desc, img_analysis, note_mentions):
            facts[norm].append(minutes)
            if len(samples) < 15:
                samples.append(sample)

    print(f"命中地点 {len(facts)} 个，事实 {sum(len(v) for v in facts.values())} 条\n")
    print("样例:")
    for s in samples:
        print(f"  {s}")

    # 聚合
    ptype_by_norm = {norm: ptype for _pid, _name, norm, ptype in places}
    name_by_norm = {norm: name for _pid, name, norm, _ptype in places}
    results: dict[str, tuple[int, int]] = {}
    for norm, minutes_list in facts.items():
        agg = aggregate_minutes(
            minutes_list,
            place_name=name_by_norm.get(norm, ""),
            place_type=ptype_by_norm.get(norm),
        )
        if agg:
            results[norm] = agg

    print(f"\n可写入 canonical 的地点: {len(results)} 个")
    for norm, (minutes, count) in sorted(results.items(), key=lambda x: -x[1][1])[:20]:
        print(f"  {name_by_norm.get(norm, norm)}: {minutes} 分（{count} 条事实）")

    if dry_run:
        print("\n[dry-run] 未写库")
        return

    written = 0
    async with SessionFactory() as s:
        await lock_city(s, city)
        catalog = await load_mention_catalog(s, city)
        managed = catalog.managed_entity_ids()
        for norm, (minutes, _count) in results.items():
            cond = [CanonicalPlace.normalized_name == norm]
            if city:
                cond.append(CanonicalPlace.city == city)
            place = await s.scalar(select(CanonicalPlace).where(*cond))
            if place is None:
                continue
            entity = catalog.catalog.resolve(place_id=place.id)
            if entity and (entity['entity_id'] in managed or entity['primary_place_id'] != place.id):
                continue  # 受控时长由sync按已分配提及提供，不能重新挖整篇笔记。
            place.typical_visit_minutes = minutes
            place.typical_visit_source = "xhs_median"
            written += 1
        await s.commit()
    print(f"\n已写入 {written} 个地点的 typical_visit_minutes（source=xhs_median）")


if __name__ == "__main__":
    asyncio.run(main())
