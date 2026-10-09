"""拉取天地图 POI 分类并生成主题标签（写入 canonical_place.amap_type / theme_tags）。

天地图只给整数分类码，map_theme 命不中时按地点名兜底。

用法:
  python scripts/build_theme_tags.py --dry-run
  python scripts/build_theme_tags.py
"""

import asyncio
import sys

sys.path.insert(0, ".")
sys.path.insert(0, "vendor/spider_xhs")

from sqlalchemy import select

from app.clean.theme import map_theme
from app.config import settings
from app.db import SessionFactory
from app.models import CanonicalPlace
from app.resolve.amap import poi_search


async def main() -> None:
    dry = "--dry-run" in sys.argv
    city = settings.city
    async with SessionFactory() as s:
        rows = (
            (
                await s.execute(
                    select(
                        CanonicalPlace.id,
                        CanonicalPlace.name,
                        CanonicalPlace.place_type,
                        CanonicalPlace.amap_type,
                        CanonicalPlace.theme_tags,
                    ).where(CanonicalPlace.city == city)
                )
            )
            .all()
        )
    print(f"待处理 {len(rows)} 个地点")

    updated = 0
    samples: list[str] = []
    for i, (pid, name, ptype, cur_type, _cur_tags) in enumerate(rows, 1):
        amap_type = cur_type or ""
        if not amap_type:
            r = await poi_search(city, name)
            if r:
                amap_type = str(r.get("amap_type") or "")
            await asyncio.sleep(0.15)  # 限流

        tags = map_theme(amap_type, name, ptype)
        if len(samples) < 20 and tags:
            samples.append(f"{name} | {amap_type} → {tags}")

        if dry:
            continue
        async with SessionFactory() as s:
            place = await s.get(CanonicalPlace, pid)
            if place is None:
                continue
            place.amap_type = amap_type or None
            place.theme_tags = tags
            await s.commit()
        updated += 1
        if i % 100 == 0:
            print(f"  ...{i}/{len(rows)}")

    print("\n样例:")
    for s_ in samples:
        print(f"  {s_}")
    print(f"\n{'[dry-run] 未写库' if dry else f'已更新 {updated} 个地点'}")


if __name__ == "__main__":
    asyncio.run(main())
