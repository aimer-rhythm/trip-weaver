"""POI 关联对挖掘（规则法，非 LLM）：从笔记原文挖「常在同天/相邻」的地点对，物化 place_relation 表。

用法:
  python scripts/mine_place_relations.py --city 北京            # 挖掘并写库
  python scripts/mine_place_relations.py --city 北京 --export    # 同时导出 tripweaver JSON

产出无向关联对：同一对地点只存一行（from_name < to_name），不表达先后——
顺序（「先去 A 再去 B」）由消费端用坐标/营业时间/种子表等确定性规则决定。

挖掘信号（相邻地点提及之间的连接词，任一命中即算关联）：
  顺序类   「出来就是 / 分钟到 / 紧挨 / 出门就是」
  视线类   「俯瞰 / 正对 / 眺望 / 隔岸看」
  路线类   箭头「→ ➡ ➜ ⇒」与「顺路 / 再去 / 下一站 / 步行可达」
strength：≥2 篇笔记支持 → direct，单篇 → weak。
"""
from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

sys.path.insert(0, ".")

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.clean.alias import _ALIAS_MAP
from app.db import SessionFactory
from app.models import CanonicalPlace, PlaceRelation, PlaceSummary, RawNote

MAX_GAP = 40  # 相邻提及间最大间隔字符数
_SENT_BREAK = re.compile(r"[。！？；;!?\n\r]")  # 句末标点：两地点不同句
# 日程标记：gap 跨天说明两地点不在同一天行程，不算相邻关联
# 「D2」需排除地铁出口编号（「站D2口出」）
_DAY_BREAK = re.compile(
    r"day\s*\d|第\s*[0-9一二三四五六七八九十]+\s*天|(?<![A-Za-z0-9])d\s*\d(?!\s*[口出号])",
    re.IGNORECASE,
)
_CLAUSE_BREAK = re.compile(r"[，,、]")          # 分句标点
# gap 边界的标点属于前一个地点所在句/分句的末尾（如「神武门出，出门就是」的「，」）
_EDGE_TRIM = " \t\r\n。！？；;!?，,、：:"
_TAIL_WINDOW = 10  # 尾部多少字符内出现连接词才认为它紧邻后一个地点

# 顺序约束信号：祼「步行/走路」不算——它只说明可达，不代表先后（「步行可达」「步行街」误报来源）
_MUST_BEFORE = re.compile(r"出来就是|出门就是|出口就是|出园就是|出馆就是|出来对面|紧挨|挨着|分钟到|分钟至|即达|直达")
_VIEWPOINT = re.compile(r"俯瞰|眺望|正对|远观|隔.{0,4}(看|望)")
# 路线箭头：攻略里「A→B→C」表达游览顺序（单篇可能只是排版，故初始 weak，多篇共现升 direct）
_ARROW = re.compile(r"→|->|➡|➜|⇒|⇨|⏩|▶|⟶")
_COMBO = re.compile(r"顺路|再去|然后去|接着去|下一站|步行可达|连在一起")


def _build_vocab(city: str, canonical_names: list[str]) -> list[tuple[str, str]]:
    """(表层写法, 规范名) 列表：规范名自身 + 别名，长名优先（防「故宫」吃掉「故宫博物院」）。"""
    pairs: list[tuple[str, str]] = []
    alias_map = _ALIAS_MAP.get(city, {})
    for name in canonical_names:
        pairs.append((name, name))
    for alias, canonical in alias_map.items():
        if canonical in canonical_names:
            pairs.append((alias, canonical))
    # 长表层优先匹配；同长任意
    pairs.sort(key=lambda p: -len(p[0]))
    return pairs


def _find_mentions(text: str, vocab: list[tuple[str, str]]) -> list[tuple[int, int, str]]:
    """返回 [(start, end, canonical_name)]，位置有序、不重叠（先到先得，长名优先已排序）。"""
    hits: list[tuple[int, int, str]] = []
    occupied = [False] * (len(text) + 1)
    for surface, canonical in vocab:
        start = 0
        while True:
            idx = text.find(surface, start)
            if idx < 0:
                break
            end = idx + len(surface)
            if not any(occupied[idx:end]):
                hits.append((idx, end, canonical))
                for i in range(idx, end):
                    occupied[i] = True
            start = idx + 1
    hits.sort()
    return hits


def _tail_signal(core: str) -> bool:
    """连接词是否紧邻后一个地点（出现在 gap 尾部）。"""
    tail = core.rstrip(_EDGE_TRIM)[-_TAIL_WINDOW:]
    return bool(_MUST_BEFORE.search(tail) or _VIEWPOINT.search(tail))


def _is_related(gap: str) -> bool:
    """相邻两地点之间是否存在关联信号（不区分关系类型，统一为无向关联对）。

    gap 边界的标点属于前一句末尾，先剥掉（「神武门出，出门就是」不应因逗号判失败）。
    跨句末标点 → 两地点不在同一句，不算关联；跨日程标记（Day2/第3天）同理，两地点不同天。
    跨分句标点 → 仅当连接词紧邻后一个地点，或出现路线/共现词时才成立；否则连接词的
    宾语可能是 gap 里没点名的地物（「步行几分钟到珠市口地铁站，…去故宫」的「到」指地铁站）。
    """
    core = gap.lstrip(_EDGE_TRIM)
    if _SENT_BREAK.search(core) or _DAY_BREAK.search(core):
        return False
    if _CLAUSE_BREAK.search(core) and not _tail_signal(core):
        return bool(_ARROW.search(core) or _COMBO.search(core))
    return bool(
        _VIEWPOINT.search(core) or _MUST_BEFORE.search(core) or _ARROW.search(core) or _COMBO.search(core)
    )


def _pair_key(a: str, b: str) -> tuple[str, str]:
    """无向关联对的标准键（与出现顺序无关）。"""
    return (a, b) if a < b else (b, a)


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--city", required=True)
    ap.add_argument("--export", action="store_true", help="同时导出 tripweaver JSON")
    ap.add_argument("--min-mentions", type=int, default=2, help="词表门槛：提及数下限")
    ap.add_argument("--prune", action="store_true", help="删除本次未再生成的关系边（笔记删除/地名改名后的残留）")
    args = ap.parse_args()
    city = args.city

    async with SessionFactory() as s:
        names = (
            await s.execute(
                select(CanonicalPlace.normalized_name)
                .join(PlaceSummary, PlaceSummary.canonical_place_id == CanonicalPlace.id)
                .where(
                    CanonicalPlace.city == city,
                    CanonicalPlace.is_active.is_(True),
                    PlaceSummary.mention_count_30d >= args.min_mentions,
                )
            )
        ).scalars().all()
        notes = (
            await s.execute(
                select(RawNote.note_id, RawNote.title, RawNote.desc, RawNote.source_url).where(
                    RawNote.city == city, RawNote.status == "EXTRACTED"
                )
            )
        ).all()

    vocab = _build_vocab(city, list(names))
    print(f"[{city}] 词表 {len(names)} 个规范名（含别名 {len(vocab) - len(names)} 个表层），笔记 {len(notes)} 条")

    # 无向关联对：(from < to) -> {"notes": set, "evidence": ..., "url": ...}
    edges: dict[tuple[str, str], dict] = defaultdict(lambda: {"notes": set(), "evidence": "", "url": ""})
    for note_id, title, desc, url in notes:
        text = f"{title or ''}\n{desc or ''}"
        hits = _find_mentions(text, vocab)
        for (s1, e1, a), (s2, e2, b) in zip(hits, hits[1:]):
            if a == b:
                continue
            gap = text[e1:s2]
            if len(gap) > MAX_GAP or not _is_related(gap):
                continue
            key = _pair_key(a, b)
            e = edges[key]
            e["notes"].add(note_id)
            if not e["evidence"]:
                e["evidence"] = text[max(0, s1 - 10): e2 + 10].replace("\n", " ")[:120]
                e["url"] = url or ""

    rows = []
    for (a, b), e in edges.items():
        n = len(e["notes"])
        rows.append(
            {
                "city": city,
                "from_name": a,
                "to_name": b,
                "rel_type": "combo",
                "strength": "direct" if n >= 2 else "weak",
                "note_count": n,
                "evidence": e["evidence"],
                "source_url": e["url"],
            }
        )
    rows.sort(key=lambda r: -r["note_count"])

    async with SessionFactory() as s:
        for row in rows:
            stmt = pg_insert(PlaceRelation).values(**row).on_conflict_do_update(
                constraint="uq_relation_edge",
                set_={
                    "strength": row["strength"],
                    "note_count": row["note_count"],
                    "evidence": row["evidence"],
                    "source_url": row["source_url"],
                },
            )
            await s.execute(stmt)
        if args.prune:
            keep = {(r["from_name"], r["to_name"], r["rel_type"]) for r in rows}
            existing = (
                await s.execute(
                    select(
                        PlaceRelation.id,
                        PlaceRelation.from_name,
                        PlaceRelation.to_name,
                        PlaceRelation.rel_type,
                    ).where(PlaceRelation.city == city)
                )
            ).all()
            stale = [e.id for e in existing if (e.from_name, e.to_name, e.rel_type) not in keep]
            if stale:
                await s.execute(delete(PlaceRelation).where(PlaceRelation.id.in_(stale)))
            print(f"[{city}] prune 删除过期边 {len(stale)} 条")
        await s.commit()

    n_direct = sum(1 for r in rows if r["strength"] == "direct")
    # Windows GBK 控制台无法打印 emoji，输出前降级
    try:
        sys.stdout.reconfigure(errors="replace")
    except Exception:
        pass
    print(f"[{city}] 挖掘关联对 {len(rows)} 条（强 {n_direct} / 弱 {len(rows) - n_direct}）")
    for r in rows[:15]:
        print(f"  {r['from_name']} ↔ {r['to_name']}  ({r['strength']}, {r['note_count']}篇)  {r['evidence'][:50]}")

    if args.export:
        out = Path(rf"D:\Project\tripweaver\import\xhs-place-relations-{city}.json")
        out.write_text(
            json.dumps(
                {
                    "_comment": f"{city} POI 关联对（xhs-travel-pipeline 规则挖掘，{date.today().isoformat()}）；无向，顺序由消费端决定",
                    "city": city,
                    "count": len(rows),
                    "relations": [
                        {
                            "from": r["from_name"],
                            "to": r["to_name"],
                            "strength": r["strength"],
                            "noteCount": r["note_count"],
                            "evidence": r["evidence"],
                            "sourceUrl": r["source_url"],
                        }
                        for r in rows
                    ],
                },
                ensure_ascii=False,
                indent=1,
            ),
            encoding="utf-8",
        )
        print(f"已导出 → {out}")


if __name__ == "__main__":
    asyncio.run(main())
