"""按显式审阅和完整快照保全既有网页介绍；不推断新事实或自动续绑。"""
from __future__ import annotations

import copy
from urllib.parse import urlsplit

from sqlalchemy import select

from app.clean.mention_identity import digest
from app.clean.scoped_place_export import scoped_binding
from app.models import CanonicalPlace


def nonempty(value) -> bool:
    return isinstance(value, str) and bool(value.strip())


def web_reference(value) -> bool:
    if not isinstance(value, dict) or any(not nonempty(value.get(k)) for k in ('quote', 'sourceUrl', 'observedAt')):
        return False
    try:
        url = urlsplit(value['sourceUrl'])
        return url.scheme in ('http', 'https') and bool(url.hostname) and not url.username and not url.password
    except ValueError:
        return False


def preservable_profile(profile) -> bool:
    if (not isinstance(profile, dict) or profile.get('profileVersion') != 1
            or profile.get('qualityVersion') != 2 or not nonempty(profile.get('intro'))):
        return False
    highlights = profile.get('highlights')
    if not isinstance(highlights, list) or not highlights:
        return False
    for item in highlights:
        if (not isinstance(item, dict) or item.get('basis') != 'web'
                or not nonempty(item.get('text')) or not web_reference(item)):
            return False
        citations = item.get('citations', [])
        if not isinstance(citations, list) or any(not web_reference(citation) for citation in citations):
            return False
    return True


async def prepare_profile_preservation(session, values, *, city, catalog, selected_ids, assigned_ids):
    if not isinstance(values, list):
        raise ValueError('网页资料保全必须是显式列表')
    plans, seen = [], set()
    for item in values:
        if (not isinstance(item, dict) or set(item) != {'entityId', 'sourcePlaceId', 'profileHash', 'evidence'}
                or not isinstance(item['entityId'], str) or type(item['sourcePlaceId']) is not int
                or not isinstance(item['profileHash'], str)):
            raise ValueError('网页资料保全须提供实体、主源、完整profile指纹及审阅证据')
        eid, sid = item['entityId'], item['sourcePlaceId']
        entity = catalog.entities.get(eid)
        if (eid in seen or eid not in assigned_ids or sid not in selected_ids or not entity
                or entity['status'] != 'ACTIVE' or entity.get('redirect_to') or entity['primary_place_id'] != sid):
            raise ValueError('网页资料必须属于本次确认实体的原主源，不能重复、跨主体或转给新实体')
        evidence = item['evidence']
        if (not isinstance(evidence, list) or not evidence or any(not isinstance(e, dict)
                or set(e) != {'kind', 'file', 'conclusion'} or e['kind'] != 'subject_only_preservation'
                or not nonempty(e['file']) or not nonempty(e['conclusion']) for e in evidence)):
            raise ValueError('网页资料保全须明确原主体归属审阅，不冒充本轮事实核验')
        row = await session.scalar(select(CanonicalPlace).where(CanonicalPlace.id == sid,
            CanonicalPlace.city == city).with_for_update().execution_options(populate_existing=True))
        if not row or not row.is_active or digest(row.content_profile) != item['profileHash']:
            raise ValueError('网页资料已变化或主源不可用，须重新审阅')
        if not preservable_profile(row.content_profile):
            raise ValueError('只保全有完整网页出处及日期的既有介绍，不绑定混合社区缓存')
        plans.append({'row': row, 'entityId': eid, 'profile': copy.deepcopy(row.content_profile)})
        seen.add(eid)
    return plans


def bind_preserved_profiles(plans, catalog, rows):
    for plan in plans:
        entity = catalog.catalog.entities[plan['entityId']]
        confirmed = [row for row in rows
            if catalog.resolve(row).get('entity', {}).get('entity_id') == plan['entityId']]
        if not confirmed:
            raise ValueError('网页资料保全后没有当前已确认提及')
        profile = copy.deepcopy(plan['profile'])
        profile['identityBinding'] = scoped_binding(entity, confirmed)
        plan['row'].content_profile = profile
