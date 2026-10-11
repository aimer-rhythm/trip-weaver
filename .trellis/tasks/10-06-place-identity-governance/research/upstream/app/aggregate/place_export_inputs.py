"""普通地点导出的查询范围；导出和旧运营保全共用。"""
from __future__ import annotations

from sqlalchemy import and_, or_, select
from app.models import CanonicalPlace, PlaceSummary
from app.vision.eligibility import export_conditions


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

