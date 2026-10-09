"""导出重庆地点库为 tripweaver 导入中间格式（供 apps/server/scripts/seed-xhs-places.ts 消费）。

目标：写入 tripweaver PostgreSQL 的两张 RAG 地基表
  canonical_places  ← 地点（source='xhs', verified=true, id=sha256(city+name)[:32] 与金集同算法）
  research_evidence ← 社区语料（推荐理由/避坑/价格/预约，kind 区分）

用法:
  python scripts/export_to_tripweaver.py                     # 默认输出 tripweaver/import/
  python scripts/export_to_tripweaver.py --min-score 8
"""

import argparse
import asyncio
import hashlib
import json
import sys
from collections import defaultdict
from datetime import date, datetime, timezone
from pathlib import Path

sys.path.insert(0, ".")
sys.path.insert(0, "vendor/spider_xhs")

from sqlalchemy import and_, or_, select, text

from app.clean.alias import aliases_for, resolve_alias, canonical_display_name
from app.clean.place_content import build_place_content, legacy_highlights, reservation_policy, intro_rejection
from app.clean.place_export import consolidate_places
from app.aggregate.place_identity import load_catalog
from app.clean.hours import HoursEvidence, mine_open_hours
from app.vision.eligibility import export_conditions
from app.config import settings
from app.db import SessionFactory
from app.models import CanonicalPlace, PlaceMention, PlaceSummary, RawNote
from app.qa.ask import _collect_image_facts, _match_image_facts

DEFAULT_OUT = Path(r"D:\Project\tripweaver\import\xhs-places.json")

# 我们的主题 → tripweaver ACTIVITY_CATEGORIES（['美食','文化','自然','购物','住宿','交通','娱乐','其他']）
_THEME_TO_ACTIVITY = {
    "自然风光": "自然",
    "历史人文": "文化",
    "名胜古迹": "文化",
    "夜景": "娱乐",
    "都市地标": "文化",
    "美食": "美食",
    "购物": "购物",
    "住宿": "住宿",
    "文艺": "文化",
    "亲子": "娱乐",
}
# 兜底：place_type → ACTIVITY_CATEGORIES
_TYPE_TO_ACTIVITY = {
    "food": "美食",
    "cafe": "美食",
    "hotel": "住宿",
    "market": "购物",
    "business_area": "购物",
    "park": "自然",
    "scenic_area": "自然",
    "museum": "文化",
    "photo_spot": "文化",
    "attraction": "文化",
    "other": "其他",
}

MAX_EVIDENCE_PER_KIND = 3


def _place_id(city: str, name: str) -> str:
    """与 tripweaver seed-canonical-places.ts 同算法：sha256(city+name)[:32]。"""
    return hashlib.sha256(f"{city}{name}".encode()).hexdigest()[:32]


def _clip(text: str, limit: int) -> str:
    return (text or "").strip()[:limit]


def place_export_query(city, min_score, catalog):
    """已确认身份可携带未知坐标；原始未治理记录仍需原有坐标与聚合资格。"""
    governed_ids = [pid for pid, eid in catalog.members.items()
        if (entity := catalog.root(eid)) and entity['status'] == 'ACTIVE' and entity['revision'] > 1]
    approved_ids = [pid for pid, eid in catalog.members.items()
        if (entity := catalog.root(eid)) and entity['status'] == 'ACTIVE'
        and entity.get('overrides', {}).get('exportApproved') is True]
    return (select(
        CanonicalPlace.name, CanonicalPlace.normalized_name, CanonicalPlace.place_type,
        CanonicalPlace.address, CanonicalPlace.longitude, CanonicalPlace.latitude,
        CanonicalPlace.adcode, CanonicalPlace.theme_tags, CanonicalPlace.typical_visit_minutes,
        CanonicalPlace.quality_score, PlaceSummary.mention_count_30d, PlaceSummary.recommend_score,
        PlaceSummary.top_reasons, CanonicalPlace.content_profile, CanonicalPlace.id,
    ).outerjoin(PlaceSummary, PlaceSummary.canonical_place_id == CanonicalPlace.id)
     .where(or_(
        and_(*export_conditions(city, min_score), PlaceSummary.canonical_place_id.is_not(None)),
        and_(CanonicalPlace.city == city, CanonicalPlace.quality_score >= min_score,
             or_(CanonicalPlace.id.in_(approved_ids),
                 and_(CanonicalPlace.is_active.is_(True), CanonicalPlace.id.in_(governed_ids)))),
     )).order_by(PlaceSummary.recommend_score.desc().nulls_last(), CanonicalPlace.id))


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--city", default=settings.city)
    ap.add_argument("--out", default=str(DEFAULT_OUT))
    ap.add_argument("--min-score", type=float, default=0.0, help="quality_score 阈值")
    args = ap.parse_args()

    city = args.city
    async with SessionFactory() as s:
        await s.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
        identity_catalog = await load_catalog(s, city)
        rows = (await s.execute(place_export_query(city, args.min_score, identity_catalog))).all()

        image_rows = (
            (
                await s.execute(
                    select(RawNote.img_analysis, RawNote.source_url).where(
                        RawNote.city == city, RawNote.img_analysis.is_not(None)
                    )
                )
            )
            .all()
        )
        image_pool = _collect_image_facts([row[0] for row in image_rows])
        # 营业证据独立保留原值和出处，不能用展示用的裁剪片段推断主语。
        hours_images = [(str((item.get('key_info') or {}).get(field) or ''), url or '')
            for analysis, url in image_rows for item in (analysis or []) if item.get('has_text')
            for field in ('hours', 'tips', 'reservation', 'price')]
        known_names = list(dict.fromkeys(alias for row in rows
            for alias in [row[0], row[1], canonical_display_name(row[0], city), *aliases_for(city, row[0])]))

        mentions = (
            await s.execute(
                select(
                    PlaceMention.name,
                    PlaceMention.mention_type,
                    PlaceMention.reason,
                    PlaceMention.evidence_text,
                    PlaceMention.confidence,
                    RawNote.source_url,
                    PlaceMention.fact_value,
                    RawNote.created_at,
                )
                .join(RawNote, RawNote.id == PlaceMention.raw_note_id)
                .where(RawNote.city == city)
                .order_by(PlaceMention.confidence.desc())
            )
        ).all()

    # 按地点归集语料（推荐理由 / 避坑）+ 原文摘录池（供 hours 挖掘）
    reasons: dict[str, list[tuple[str, str]]] = defaultdict(list)  # norm -> [(reason, url)]
    warnings: dict[str, list[tuple[str, str]]] = defaultdict(list)
    texts_pool: dict[str, list[HoursEvidence]] = defaultdict(list)
    dropped_garbage = 0
    content_pool: dict[str, list[dict]] = defaultdict(list)
    observed_at = datetime.now(timezone.utc).isoformat()
    for norm, mtype, reason, evidence_text, _conf, url, fact_value, collected_at in mentions:
        norm = resolve_alias(norm, city)
        content = (fact_value or {}).get('placeContent', {})
        if isinstance(content, dict) and content.get('version') == 1:
            for item in content.get('highlights', []):
                content_pool[norm].append({**item, 'sourceUrl': url or '',
                    'observedAt': collected_at.isoformat() if collected_at else observed_at})
        elif mtype == 'recommend' and reason:
            content_pool[norm].extend(legacy_highlights(reason, url or ''))
        # hours 挖掘素材先入池：垃圾过滤只影响展示语料，短文本可能是「周一闭馆」的唯一出处
        if reason:
            texts_pool[norm].append(HoursEvidence(norm, reason, url or '', source_kind='reason'))
        if evidence_text:
            texts_pool[norm].append(HoursEvidence(norm, evidence_text, url or '', source_kind='evidence'))
        if not reason:
            continue
        # P3：垃圾行过滤——只有地名或极短内容的语料无情报价值
        if len(reason.strip()) < 10 or reason.strip() == norm:
            dropped_garbage += 1
            continue
        bucket = warnings if mtype == "warning" else reasons
        if len(bucket[norm]) < MAX_EVIDENCE_PER_KIND:
            bucket[norm].append((reason, url or ""))
    if dropped_garbage:
        print(f"已过滤垃圾语料 {dropped_garbage} 条（内容过短或仅地名）")

    places = []
    for (
        name,
        norm,
        ptype,
        address,
        lng,
        lat,
        adcode,
        themes,
        visit_min,
        _quality,
        mention_count,
        score,
        top_reasons,
        content_profile,
        source_place_id,
    ) in rows:
        original_name = name
        norm = resolve_alias(norm, city)
        name = canonical_display_name(name, city)
        fact_names = list(dict.fromkeys([original_name, name, *aliases_for(city, name)]))
        facts = list(dict.fromkeys(f for alias in fact_names for f in _match_image_facts(image_pool, alias)))
        # 别名可匹配，但原始库中的明确子项不能借父名包含关系污染主地点。
        child_names = [r[0] for r in rows if r[0] not in fact_names and any(r[0].startswith(alias) for alias in fact_names)]
        facts = [fact for fact in facts if not any(child in fact for child in child_names)]
        # P3：图片事实值剥掉地名后为空 = 垃圾（如「预约:五道营胡同」）
        def _fact_value(fact: str) -> str:
            return fact.split(":", 1)[1].replace(name, "").replace(norm, "").strip(" ：:，,")

        price = next((f.split(":", 1)[1].strip() for f in facts if f.startswith("价格:") and _fact_value(f)), "")
        reservation_facts = [f.split(':', 1)[1].strip() for f in facts if f.startswith('预约:') and _fact_value(f)]
        reservation_fact = '；'.join(reservation_facts)
        tips = [
            f.split(":", 1)[1].strip()
            for f in facts
            if f.startswith("提示:") and f.split(":", 1)[1].strip()
        ]

        theme_list = themes or []
        category = "其他"
        # 主体类型优先；景点的美食/住宿主题不能把它变成餐厅或酒店。
        category = _TYPE_TO_ACTIVITY.get(ptype, '其他')
        if ptype in ('attraction', 'photo_spot', 'other'):
            category = next((_THEME_TO_ACTIVITY[t] for t in theme_list
                if _THEME_TO_ACTIVITY.get(t) in ('自然', '文化', '娱乐')), category)

        summary_reasons = [
            r.get("reason") if isinstance(r, dict) else str(r) for r in (top_reasons or [])
        ]
        summary_reasons = [r for r in summary_reasons if r]

        pid = _place_id(city, name)
        payload = {
            "xhsPlaceType": ptype,
            "themes": theme_list,
            "address": _clip(address or "", 100),
            "adcode": adcode or "",
            "mentionCount": mention_count or 0,
            "recommendScore": round(score or 0.0, 2),
            "topReasons": [r for r in summary_reasons if not intro_rejection(r)][:3],
            'content': content_profile if isinstance(content_profile, dict) and content_profile.get('profileVersion') == 1 and content_profile.get('qualityVersion') == 2 and not intro_rejection(content_profile.get('intro', ''))
                else build_place_content(content_pool[norm], observed_at),
            'originalName': original_name,
        }
        if visit_min and visit_min >= 15:  # 下限过滤：防"排队两小时体验五分钟"被当游览时长
            payload["typicalVisitMinutes"] = visit_min
        if price:
            payload["price"] = _clip(price, 120)
        hour_records = [*texts_pool.get(norm, []), *(HoursEvidence(name, text, url, source_kind='image')
            for text, url in hours_images if any(alias in text for alias in fact_names))]
        open_hours = mine_open_hours(hour_records, target=name,
            aliases=list(dict.fromkeys([norm, *fact_names])), known_names=known_names)
        # 即使无营业信号也明确记录未知，避免消费端回到旧的无主体 evidence 正则。
        payload["openHours"] = open_hours or {"version": 2, "subject": name, "scope": "place", "status": "unknown",
            "text": "", "openTime": None, "closeTime": None, "closedWeekdays": [], "note": "", "evidence": [],
            "attributions": [], "review": []}
        # P1：别名数组（消费端展开用）
        alias_list = aliases_for(city, name)
        if alias_list:
            payload["aliases"] = alias_list
        payload.update(reservation_policy(reservation_facts))
        if tips:
            payload["tips"] = [_clip(t, 60) for t in tips[:2]]

        evidence: list[dict] = []
        for reason, url in reasons.get(norm, []):
            evidence.append({"kind": "xhs_reason", "content": _clip(reason, 200), "sourceUrl": url})
        for reason, url in warnings.get(norm, []):
            evidence.append({"kind": "xhs_warning", "content": _clip(reason, 200), "sourceUrl": url})
        if price:
            evidence.append({"kind": "xhs_price", "content": _clip(price, 200), "sourceUrl": ""})
        if reservation_fact:
            evidence.append(
                {"kind": "xhs_reservation", "content": _clip(reservation_fact, 200), "sourceUrl": ""}
            )

        places.append(
            {
                "id": pid,
                "sourcePlaceId": source_place_id,
                "name": name,
                "category": category,
                "lng": round(lng, 6) if lng is not None else None,
                "lat": round(lat, 6) if lat is not None else None,
                "source": "xhs",
                "verified": True,
                "payload": payload,
                "evidence": evidence,
            }
        )

    places = consolidate_places(places, city, observed_at, identity_catalog)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    data = {
        "_comment": (
            f"{city}社区验证地点库（xhs-travel-pipeline 离线提取，{date.today().isoformat()}）。"
            "导入 tripweaver 的 canonical_places + research_evidence；"
            "id 来自持久实体注册表；改名保留旧 id 与成员重定向。"
        ),
        "city": city,
        "generatedAt": date.today().isoformat(),
        "count": len(places),
        "places": places,
    }
    out.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")

    n_ev = sum(len(p["evidence"]) for p in places)
    print(f"已导出 {len(places)} 个地点 / {n_ev} 条语料 → {out}（{out.stat().st_size / 1024:.0f} KB）")
    print(f"  含预约 {sum(1 for p in places if p['payload'].get('reservation'))} | "
          f"含价格 {sum(1 for p in places if p['payload'].get('price'))} | "
          f"含明确主体营业信息 {sum(1 for p in places if p['payload'].get('openHours', {}).get('status') == 'attributed')} | "
          f"含别名 {sum(1 for p in places if p['payload'].get('aliases'))}")
    cats = defaultdict(int)
    for p in places:
        cats[p["category"]] += 1
    print(f"  分类分布: {dict(cats)}")


if __name__ == "__main__":
    asyncio.run(main())
