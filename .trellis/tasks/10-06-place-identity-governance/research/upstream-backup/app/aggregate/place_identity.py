"""地点身份注册、增量绑定、存量审计及可逆治理；调用方控制事务提交。"""
from __future__ import annotations

import hashlib
import json
from collections import defaultdict

from sqlalchemy import select, text, update
from sqlalchemy.dialects.postgresql import insert

from app.clean.alias import aliases_for, canonical_display_name, planning_name
from app.clean.identity import IdentityCatalog, legacy_id, name_key
from app.models import CanonicalPlace, PlaceEntity, PlaceEntityMember, PlaceEntityReview, PlaceEntityChange

ENTITY_FIELDS = ('entity_id', 'city', 'canonical_name', 'primary_place_id', 'aliases', 'legacy_ids',
                 'revision', 'status', 'redirect_to', 'overrides', 'evidence')


async def lock_city(session, city: str) -> None:
    await session.execute(text('SELECT pg_advisory_xact_lock(hashtextextended(:city, 0))'),
                          {'city': f'place-identity:{city}'})


async def load_catalog(session, city: str) -> IdentityCatalog:
    entities = (await session.scalars(select(PlaceEntity).where(PlaceEntity.city == city))).all()
    members = (await session.execute(select(PlaceEntityMember.place_id, PlaceEntityMember.entity_id)
        .join(PlaceEntity, PlaceEntity.entity_id == PlaceEntityMember.entity_id)
        .where(PlaceEntity.city == city))).all()
    return IdentityCatalog(city, [{key: getattr(e, key) for key in ENTITY_FIELDS} for e in entities],
                           [dict(m._mapping) for m in members])


async def enqueue_review(session, city: str, detail: dict) -> None:
    fingerprint = hashlib.sha256(json.dumps([city, detail], ensure_ascii=False, sort_keys=True).encode()).hexdigest()
    await session.execute(insert(PlaceEntityReview).values(city=city, fingerprint=fingerprint, detail=detail)
                          .on_conflict_do_nothing(index_elements=[PlaceEntityReview.fingerprint]))


async def bootstrap(session, city: str) -> int:
    """仅首次为未注册的源记录分配身份；历史稳定 ID 作为初始值保存，后续不再计算。"""
    await lock_city(session, city)
    catalog = await load_catalog(session, city)
    places = (await session.scalars(select(CanonicalPlace).where(CanonicalPlace.city == city)
                                   .order_by(CanonicalPlace.id))).all()
    if catalog.entities:
        missing = [place for place in places if place.id not in catalog.members]
        for place in missing:
            await register_place(session, city, place)
        return len(missing)
    groups = defaultdict(list)
    for place in places:
        if place.id not in catalog.members:
            groups[canonical_display_name(place.name, city)].append(place)
    for name, rows in groups.items():
        existing = catalog.resolve(name)
        if existing:
            eid = existing['entity_id']
            record = await session.scalar(select(PlaceEntity).where(PlaceEntity.entity_id == eid))
            record.aliases = sorted(set(record.aliases + [p.name for p in rows]))
            record.legacy_ids = sorted(set(record.legacy_ids + [legacy_id(city, p.name) for p in rows]))
            record.revision += 1
        else:
            eid = legacy_id(city, name)
            primary = next((p for p in rows if p.name == name), rows[0])
            await session.execute(insert(PlaceEntity).values(entity_id=eid, city=city, canonical_name=name,
                primary_place_id=primary.id, aliases=sorted(set([p.name for p in rows] + aliases_for(city, name))),
                legacy_ids=sorted(set([eid, *[legacy_id(city, p.name) for p in rows]])),
                evidence=[{'kind': 'bootstrap', 'source': 'canonical_place + explicit alias configuration'}])
                .on_conflict_do_nothing(index_elements=[PlaceEntity.entity_id]))
        for place in rows:
            await session.execute(insert(PlaceEntityMember).values(place_id=place.id, entity_id=eid)
                .on_conflict_do_nothing(index_elements=[PlaceEntityMember.place_id]))
    await session.flush()
    # 行程组合有独立持久身份；子项仍保留自己的实体与事实。
    catalog = await load_catalog(session, city)
    for entity in list(catalog.entities.values()):
        parent = planning_name(entity['canonical_name'], city)
        if parent == entity['canonical_name'] or catalog.resolve(parent):
            continue
        await session.execute(insert(PlaceEntity).values(entity_id=legacy_id(city, parent), city=city,
            canonical_name=parent, aliases=[], legacy_ids=[legacy_id(city, parent)],
            evidence=[{'kind': 'planning_group', 'source': 'explicit component configuration'}])
            .on_conflict_do_nothing(index_elements=[PlaceEntity.entity_id]))
    return sum(len(rows) for rows in groups.values())


async def register_place(session, city: str, place: CanonicalPlace) -> dict:
    """新源记录复用精确别名；相似但未确认的记录隔离为 REVIEW，不导出。"""
    await lock_city(session, city)
    catalog = await load_catalog(session, city)
    registered = catalog.resolve(place_id=place.id)
    if registered:
        return registered
    entity = catalog.resolve(place.name)
    if entity:
        record = await session.scalar(select(PlaceEntity).where(PlaceEntity.entity_id == entity['entity_id']))
        record.legacy_ids = sorted(set([*record.legacy_ids, legacy_id(city, place.name)]))
        record.revision += 1
        await session.flush()
    if not entity:
        candidates = catalog.candidates(place.name)
        eid = legacy_id(city, place.name)
        entity = dict(entity_id=eid, city=city, canonical_name=place.name, primary_place_id=place.id,
            aliases=aliases_for(city, place.name), legacy_ids=[eid], revision=1, redirect_to=None,
            status='REVIEW' if candidates else 'ACTIVE', overrides={}, evidence=[])
        await session.execute(insert(PlaceEntity).values(**entity).on_conflict_do_nothing(index_elements=[PlaceEntity.entity_id]))
        if candidates:
            await enqueue_review(session, city, {'reason': 'new_similar_name', 'name': place.name,
                'entityIds': sorted([eid, *candidates]), 'placeId': place.id})
    await session.execute(insert(PlaceEntityMember).values(place_id=place.id, entity_id=entity['entity_id'])
                          .on_conflict_do_nothing(index_elements=[PlaceEntityMember.place_id]))
    return entity


def audit_catalog(catalog: IdentityCatalog) -> list[dict]:
    pairs = set()
    report = []
    for eid, entity in catalog.entities.items():
        if entity.get('redirect_to'):
            continue
        for other in catalog.candidates(entity['canonical_name']):
            if other == eid:
                continue
            pair = tuple(sorted([eid, other]))
            if pair in pairs:
                continue
            pairs.add(pair)
            report.append({'reason': 'similar_name', 'entityIds': list(pair),
                'names': [catalog.entities[item]['canonical_name'] for item in pair]})
    return report


async def snapshot(session, city: str, ids: list[str]) -> dict:
    catalog = await load_catalog(session, city)
    return {'entities': sorted([e for eid, e in catalog.entities.items() if eid in ids], key=lambda e: e['entity_id']),
        'members': sorted([{'place_id': pid, 'entity_id': eid} for pid, eid in catalog.members.items() if eid in ids],
                          key=lambda m: m['place_id'])}


async def apply_decision(session, decision: dict) -> dict:
    city = decision['city']
    await lock_city(session, city)
    previous = await session.scalar(select(PlaceEntityChange).where(PlaceEntityChange.change_key == decision['key']))
    if previous:
        if previous.request != decision:
            raise ValueError('治理 key 已用于不同决策，拒绝覆盖')
        if previous.rolled_back:
            raise ValueError('已回滚的决策需使用新的 key，不能静默重放')
        return previous.after
    if not decision.get('evidence'):
        raise ValueError('实体治理必须有证据')
    overrides = decision.get('overrides', {})
    if set(overrides) - {'category', 'lat', 'lng', 'address', 'adcode', 'geoStatus'}:
        raise ValueError('只允许修订有证据的地点类型、地址与坐标')
    if ('lat' in overrides) != ('lng' in overrides):
        raise ValueError('经纬度必须同时修订')
    if 'lat' in overrides and not ((overrides['lat'] is None and overrides['lng'] is None)
            or (type(overrides['lat']) in (int, float) and type(overrides['lng']) in (int, float)
                and -90 <= overrides['lat'] <= 90 and -180 <= overrides['lng'] <= 180)):
        raise ValueError('经纬度不合法')
    catalog = await load_catalog(session, city)
    ids = list(dict.fromkeys([decision['entityId'], *decision.get('mergeEntityIds', [])]))
    entities = [catalog.entities.get(eid) for eid in ids]
    if any(e is None or e.get('redirect_to') for e in entities):
        raise ValueError('实体不在本城、已经重定向或不存在')
    expected = decision.get('expectedRevisions', {})
    if any(expected.get(e['entity_id']) != e['revision'] for e in entities):
        raise ValueError('治理预览已过期，须重新核对实体版本')
    name = decision.get('canonicalName', entities[0]['canonical_name']).strip()
    if not name or len(name) > 128:
        raise ValueError('主名无效')
    aliases = sorted(set([name, *decision.get('aliases', []),
        *(e['canonical_name'] for e in entities), *(a for e in entities for a in e['aliases'])]))
    for alias in aliases:
        if catalog.names.get(name_key(alias), set()) - set(ids):
            raise ValueError(f'别名已有其他实体归属：{alias}')
    before = await snapshot(session, city, ids)
    root = await session.scalar(select(PlaceEntity).where(PlaceEntity.entity_id == ids[0]))
    root.canonical_name = name
    root.aliases = aliases
    root.legacy_ids = sorted(set([*ids, *(a for e in entities for a in e['legacy_ids']),
                                 *(legacy_id(city, alias) for alias in aliases)]))
    root.revision += 1
    root.status = 'ACTIVE'
    root.overrides = {**root.overrides, **decision.get('overrides', {})}
    root.evidence = [*root.evidence, *decision['evidence']]
    for eid in ids[1:]:
        await session.execute(update(PlaceEntity).where(PlaceEntity.entity_id == eid)
            .values(redirect_to=ids[0], revision=PlaceEntity.revision + 1))
        await session.execute(update(PlaceEntityMember).where(PlaceEntityMember.entity_id == eid).values(entity_id=ids[0]))
    await session.flush()
    after = await snapshot(session, city, ids)
    session.add(PlaceEntityChange(change_key=decision['key'], city=city, before=before, after=after,
                                  evidence=decision['evidence'], request=decision))
    await session.flush()
    return after


async def rollback_decision(session, change_key: str) -> dict:
    change = await session.scalar(select(PlaceEntityChange).where(PlaceEntityChange.change_key == change_key))
    if not change:
        raise ValueError('治理记录不存在')
    await lock_city(session, change.city)
    if change.rolled_back:
        return change.before
    ids = [e['entity_id'] for e in change.after['entities']]
    current = await snapshot(session, change.city, ids)
    if current != change.after:
        raise ValueError('实体已有后续修改，拒绝覆盖；先回滚后续决策')
    for entity in change.before['entities']:
        await session.execute(update(PlaceEntity).where(PlaceEntity.entity_id == entity['entity_id']).values(**entity))
    for member in change.before['members']:
        await session.execute(update(PlaceEntityMember).where(PlaceEntityMember.place_id == member['place_id'])
                              .values(entity_id=member['entity_id']))
    change.rolled_back = True
    await session.flush()
    return change.before
