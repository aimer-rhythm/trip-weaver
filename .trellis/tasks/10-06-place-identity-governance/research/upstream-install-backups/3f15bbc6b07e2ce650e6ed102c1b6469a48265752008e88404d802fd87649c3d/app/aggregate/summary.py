"""canonical 地点库沉淀 + 聚合（对齐 Yuntu §5 入库流程 + refresh.py）。

流程：place_mention 按 (city, normalized_name) 聚合
  → canonical_place upsert（pending）→ 坐标解析 → resolved/unresolvable
  → 只对 resolved 地点刷新 place_summary（防止 NULL 坐标污染）
  → 维护 canonical_place_source 来源回溯（只存短摘要 + URL，不转存正文）
"""
from __future__ import annotations

import logging
from collections import defaultdict
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from app.db import SessionFactory
from app.clean.alias import resolve_alias
from app.clean.mention_identity import effective_fact_value
from app.aggregate.place_identity import load_catalog, lock_city, register_place
from app.aggregate.mention_identity import load_mention_catalog, load_mention_rows, refresh_mention_reviews
from app.models import (
    CanonicalPlace,
    CanonicalPlaceSource,
    PlaceMention,
    PlaceSummary,
    RawNote,
)
from app.resolve.amap import resolve_coordinates

logger = logging.getLogger(__name__)

# 游玩时长事实的置信度下限（对齐 Yuntu route_feasibility.py）
VISIT_DURATION_CONFIDENCE_MIN = 0.85


def mention_groups(city: str, catalog, rows: list[dict]) -> dict[str, dict]:
    """已确认提及按实体ID聚合，受控来源不退回规范化名。"""
    groups: dict[str, dict] = defaultdict(
        lambda: {"name": "", "mentions": 0, "positive": 0, "sources": set(), "reasons": [],
                 "durations": [], "types": {}, "mentionIds": []}
    )
    for row in rows:
        result = catalog.resolve(row)
        if result['status'] == 'review' or row['note_unavailable']:
            continue
        entity = result.get('entity')
        name = row['name']
        norm = resolve_alias(entity['canonical_name'] if entity else name, city)
        key = f"entity:{entity['entity_id']}" if entity else f'name:{norm}'
        g = groups[key]
        g['entityId'] = entity['entity_id'] if entity else None
        g['normalizedName'] = norm
        g['mentionIds'].append(row['id'])
        g["name"] = entity['canonical_name'] if entity else name.strip()
        g["mentions"] += 1
        if row['mention_type'] == "recommend":
            g["positive"] += 1
        place_type = row['place_type']
        g["types"][str(place_type)] = g["types"].get(str(place_type), 0) + 1
        note_id, reason, evidence = row['raw_note_id'], row['reason'], row['evidence_text']
        if note_id:
            g["sources"].add(note_id)
        if reason:
            g["reasons"].append({"reason": reason, "evidence": evidence or "", 'mentionId': row['id'],
                                 'noteId': note_id, 'sourceUrl': row['source_url']})
        fact_type, fact_value, conf = row['fact_type'], effective_fact_value(row, result), row['confidence']
        if fact_type == "visit_duration" and fact_value and conf is not None and conf >= VISIT_DURATION_CONFIDENCE_MIN:
            minutes = (fact_value or {}).get("minutes")
            if type(minutes) in (int, float):
                g["durations"].append(int(minutes))
    return groups


async def _mention_groups(city: str) -> dict[str, dict]:
    async with SessionFactory() as session:
        return mention_groups(city, await load_mention_catalog(session, city), await load_mention_rows(session, city))


async def sync_canonical(city: str) -> dict[str, int]:
    """合并提及 → canonical_place（解析坐标）。返回 {created, resolved, unresolvable}。"""
    groups = await _mention_groups(city)

    created = resolved = unresolvable = 0
    async with SessionFactory() as session:
        await refresh_mention_reviews(session, city)
        await session.commit()
    for previous in groups.values():
        async with SessionFactory() as session:
            await lock_city(session, city)
            mentions = await load_mention_catalog(session, city)
            # 规划分组与写库间可能完成一次人工分配；在持锁后按当前原文重算。
            refreshed = mention_groups(city, mentions, await load_mention_rows(session, city, previous['mentionIds']))
            if len(refreshed) != 1:
                continue  # 已拆到多实体或全部待审，下轮按新分组处理，不能写到旧主体。
            g = next(iter(refreshed.values()))
            norm = g['normalizedName']
            catalog = mentions.catalog
            entity = catalog.root(g['entityId']) if g['entityId'] else catalog.resolve(g['name'])
            place = await session.get(CanonicalPlace, entity['primary_place_id']) if entity and entity['primary_place_id'] else None
            if place is None:
                place = await session.scalar(select(CanonicalPlace).where(
                    CanonicalPlace.city == city, CanonicalPlace.normalized_name == norm))
                if place and mentions.scope_for_source(place.id):
                    continue  # 不允许新名称沿旧源记录绕回已治理的泛名主体。
            if place is None:
                # 用提及中最常见的类型作为 canonical 类型（避免全部默认 attraction）
                top_type = max(g["types"], key=g["types"].get) if g["types"] else None
                place = CanonicalPlace(
                    name=g["name"],
                    normalized_name=norm,
                    city=city,
                    place_type=top_type or "attraction",
                    geo_status="pending",
                )
                session.add(place)
                await session.flush()
                created += 1

            registered = await register_place(session, city, place)
            if registered['status'] != 'ACTIVE':
                await session.commit()
                continue

            if place.geo_status != "resolved":
                coord = await resolve_coordinates(city, g["name"])
                if coord:
                    place.longitude = coord.get("longitude")
                    place.latitude = coord.get("latitude")
                    place.adcode = str(coord.get("adcode") or "")
                    place.amap_poi_id = str(coord.get("poi_id") or "")
                    place.address = str(coord.get("address") or coord.get("formatted_address") or "")
                    place.geo_status = "resolved"
                    resolved += 1
                else:
                    place.geo_status = "unresolvable"
                    unresolvable += 1

            # 游玩时长：xhs_median（有置信度达标的 mention 时）
            if g["durations"]:
                median = sorted(g["durations"])[len(g["durations"]) // 2]
                place.typical_visit_minutes = median
                place.typical_visit_source = "xhs_median"
            elif registered['entity_id'] in mentions.managed_entity_ids() and place.typical_visit_source == 'xhs_median':
                place.typical_visit_minutes = None
                place.typical_visit_source = None
            # 来源回溯与当前身份检查处于同一事务，不跨治理版本写入。
            place_id = place.id
            if place_id:
                for reason in g["reasons"][:3]:
                    exists = await session.scalar(
                        select(CanonicalPlaceSource.id).where(
                            CanonicalPlaceSource.canonical_place_id == place_id,
                            CanonicalPlaceSource.evidence_summary == reason["reason"],
                        )
                    )
                    if exists is None:
                        session.add(
                            CanonicalPlaceSource(
                                canonical_place_id=place_id,
                                source_type="xhs",
                                source_name=f"提及 {norm} / mention:{reason['mentionId']}",
                                source_note_id=str(reason['noteId']), source_url=reason['sourceUrl'],
                                evidence_summary=reason["reason"][:200],
                            )
                        )
            await session.commit()

    logger.info(
        "canonical 同步 city=%s 候选 %d（新建 %d / 解析 %d / 未解析 %d）",
        city, len(groups), created, resolved, unresolvable,
    )
    return {"created": created, "resolved": resolved, "unresolvable": unresolvable}


async def refresh_summary(city: str) -> int:
    """只对 resolved 地点刷新聚合。返回更新的地点数。"""
    places: list[CanonicalPlace]
    async with SessionFactory() as session:
        await lock_city(session, city)
        mentions_catalog = await load_mention_catalog(session, city)
        catalog = mentions_catalog.catalog
        all_mentions = await load_mention_rows(session, city)
        mentions_by_place = defaultdict(list)
        for mention in all_mentions:
            entity = mentions_catalog.resolve(mention).get('entity')
            if entity and entity['primary_place_id']:
                mentions_by_place[entity['primary_place_id']].append(mention)
        places = (
            (
                await session.execute(
                    select(CanonicalPlace).where(
                        CanonicalPlace.city == city, CanonicalPlace.geo_status == "resolved"
                    )
                )
            )
            .scalars()
            .all()
        )

        updated = 0
        for place in places:
            entity = catalog.resolve(place_id=place.id)
            if not entity or entity['primary_place_id'] != place.id or entity['status'] != 'ACTIVE':
                continue
            mentions = mentions_by_place[place.id]

            total = len(mentions)
            positive = sum(1 for m in mentions if m['mention_type'] == "recommend")
            sources = {m['raw_note_id'] for m in mentions}
            reasons = [{"reason": m['reason'], "evidence": m['evidence_text'], 'mentionId': m['id'],
                        'noteId': m['raw_note_id']} for m in mentions if m['reason']][:5]
            positive_ratio = positive / total if total else 0.0
            # 公式：提及数权重最高，正向比次之，来源广度兜底（对齐 Yuntu recommend_score 思路）
            score = round(total * 2.0 + positive_ratio * 5.0 + len(sources) * 0.5, 2)

            await session.execute(
                insert(PlaceSummary)
                .values(
                    canonical_place_id=place.id,
                    mention_count_30d=total,
                    positive_count_30d=positive,
                    source_count=len(sources),
                    top_reasons=reasons,
                    recommend_score=score,
                )
                .on_conflict_do_update(
                    index_elements=[PlaceSummary.canonical_place_id],
                    set_={
                        "mention_count_30d": total,
                        "positive_count_30d": positive,
                        "source_count": len(sources),
                        "top_reasons": reasons,
                        "recommend_score": score,
                        "updated_at": datetime.now(timezone.utc),
                    },
                )
            )
            updated += 1
        await session.commit()  # 整个聚合快照在同一城市锁内写入，不能跨身份治理版本。

    logger.info("summary 刷新 city=%s 更新 %d 个地点", city, updated)
    return updated
