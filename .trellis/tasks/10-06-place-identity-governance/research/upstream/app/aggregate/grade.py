"""canonical 地点质量分级（对齐 Yuntu quality gate 精神）。

在 sync_canonical 之后运行，为每个地点计算质量分：
  quality_score = mention_count*2 + source_notes*3 + avg_confidence*10

阈值（合理调参）：
  >= 8  ：高可信（多来源 + 多提及），问答首选
  3-8   ：中可信（单来源高置信 / 少量提及）
  < 3   ：低可信（单次低置信提及，可能是噪音），is_active=False 排除

只对 geo_status='resolved' 的地点打分；无法解析坐标的不参与问答。
"""
from __future__ import annotations

import logging
from collections import defaultdict

from sqlalchemy import select, update

from app.db import SessionFactory
from app.models import CanonicalPlace, PlaceMention, PlaceSummary, RawNote
from app.aggregate.place_identity import lock_city
from app.aggregate.mention_identity import load_mention_catalog, load_mention_rows

logger = logging.getLogger(__name__)

QUALITY_INACTIVE_THRESHOLD = 5.0


async def _mention_stats(session, city: str, catalog) -> dict[str, dict]:
    """按已确认实体聚合；两个分店不能共享泛名提及的数量和置信度。"""
    rows = await load_mention_rows(session, city)
    stats: dict[str, dict] = defaultdict(lambda: {"count": 0, "sources": set(), "conf_sum": 0.0})
    for row in rows:
        entity = catalog.resolve(row).get('entity')
        if not entity:
            continue
        note_id, conf = row['raw_note_id'], row['confidence']
        s = stats[entity['entity_id']]
        s["count"] += 1
        if note_id:
            s["sources"].add(note_id)
        s["conf_sum"] += conf if conf is not None else 0.5
    for s in stats.values():
        s["avg_conf"] = s["conf_sum"] / max(s["count"], 1)
    return stats


async def grade_canonical(city: str) -> dict[str, int]:
    """计算质量分 + 更新 is_active。返回 {高可信, 中可信, 低可信排除}。

    规则：resolved 参与打分；unresolvable/pending（无坐标）直接 is_active=False（问答/规划用不了）。
    """
    high = medium = low = 0

    places: list[CanonicalPlace]
    async with SessionFactory() as session:
        await lock_city(session, city)
        catalog = await load_mention_catalog(session, city)
        stats = await _mention_stats(session, city, catalog)
        places = (
            (
                await session.execute(
                    select(CanonicalPlace).where(CanonicalPlace.city == city)
                )
            )
            .scalars()
            .all()
        )

        for place in places:
            entity = catalog.catalog.resolve(place_id=place.id)
            s = stats.get(entity['entity_id']) if entity and entity['status'] == 'ACTIVE' else None
            if place.geo_status != 'resolved' or not s or s['count'] == 0:
                score = 0.0
            elif s['avg_conf'] < 0.7:
                score = round(s['count'] * 2 + len(s['sources']) * 3 + s['avg_conf'] * 4, 1)
            else:
                score = round(s['count'] * 2 + len(s['sources']) * 3 + s['avg_conf'] * 10, 1)
            active = score >= QUALITY_INACTIVE_THRESHOLD
            await session.execute(
                update(CanonicalPlace)
                .where(CanonicalPlace.id == place.id)
                .values(quality_score=score, is_active=active)
            )
            if score >= 8:
                high += 1
            elif score >= QUALITY_INACTIVE_THRESHOLD:
                medium += 1
            else:
                low += 1
        await session.commit()

    logger.info(
        "质量分级 city=%s 高可信 %d / 中可信 %d / 低可信排除 %d（阈值 %.1f，高可信≥8）",
        city, high, medium, low, QUALITY_INACTIVE_THRESHOLD,
    )
    return {"high": high, "medium": medium, "low_inactive": low}
