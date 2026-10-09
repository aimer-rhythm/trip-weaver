"""按别名表归一并修复存量数据（extract 归一后的补充）。

场景：app/clean/alias.py 上线前的存量数据仍用旧 normalized_name（"故宫"/"故宫博物院"
分两条）。本脚本把命中别名表的存量行归一：

1. place_mention.normalized_name 命中别名 → 改为规范名
2. canonical_place.normalized_name 命中别名：
   - 规范名 canonical 不存在 → 改名（name + normalized_name）
   - 规范名 canonical 已存在 → 合并（source 转移 + summary 删除 + 删被合并行）
3. 重算 place_summary

用法：
  python scripts/apply_aliases.py --city 北京 --dry-run   # 预览
  python scripts/apply_aliases.py --city 北京             # 写库
"""
from __future__ import annotations

import argparse
import asyncio
import sys

sys.path.insert(0, ".")

from sqlalchemy import delete, select, update

from app.clean.alias import _ALIAS_MAP, resolve_alias
from app.clean.dedup import normalize_name
from app.db import SessionFactory
from app.models import CanonicalPlace, CanonicalPlaceSource, PlaceMention, PlaceSummary, RawNote


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--city", required=True)
    ap.add_argument("--dry-run", action="store_true", help="只预览不写库")
    args = ap.parse_args()

    city = args.city
    alias_map = _ALIAS_MAP.get(city, {})
    if not alias_map:
        print(f"[{city}] 无别名配置，跳过")
        return

    async with SessionFactory() as s:
        # 1) mentions 重定向
        mentions = (
            await s.execute(
                select(PlaceMention).where(
                    PlaceMention.normalized_name.in_(alias_map.keys()),
                    PlaceMention.raw_note_id.in_(
                        select(RawNote.id).where(RawNote.city == city)
                    ),
                )
            )
        ).scalars().all()
        print(f"[{city}] 命中别名的 place_mention: {len(mentions)} 条")

        # 2) canonical 归一/合并
        canonicals = (
            await s.execute(
                select(CanonicalPlace).where(
                    CanonicalPlace.city == city,
                    CanonicalPlace.normalized_name.in_(alias_map.keys()),
                )
            )
        ).scalars().all()
        print(f"[{city}] 命中别名的 canonical: {len(canonicals)} 条")

        if args.dry_run:
            for m in mentions[:10]:
                print(f"  mention {m.normalized_name} -> {alias_map[m.normalized_name]}")
            for c in canonicals:
                print(f"  canonical {c.normalized_name} -> {alias_map[c.normalized_name]}")
            return

        # 先重定向 mentions
        for m in mentions:
            target = alias_map[m.normalized_name]
            if m.normalized_name != target:
                m.normalized_name = target
        # canonical 改名/合并
        renamed = merged = 0
        for c in canonicals:
            target = alias_map[c.normalized_name]
            existing = await s.scalar(
                select(CanonicalPlace).where(
                    CanonicalPlace.city == city, CanonicalPlace.normalized_name == target
                )
            )
            if existing is None:
                c.normalized_name = target
                c.name = target
                renamed += 1
            else:
                # 转移 source 到保留者
                await s.execute(
                    update(CanonicalPlaceSource)
                    .where(CanonicalPlaceSource.canonical_place_id == c.id)
                    .values(canonical_place_id=existing.id)
                )
                # 删除被合并行的 summary
                await s.execute(
                    delete(PlaceSummary).where(PlaceSummary.canonical_place_id == c.id)
                )
                await s.delete(c)
                merged += 1
        await s.commit()
        print(f"[{city}] 完成：canonical 改名 {renamed} / 合并 {merged}，mentions 重定向 {len(mentions)}")
        print("下一步：python -m app.cli summary 刷新评分")


if __name__ == "__main__":
    asyncio.run(main())
