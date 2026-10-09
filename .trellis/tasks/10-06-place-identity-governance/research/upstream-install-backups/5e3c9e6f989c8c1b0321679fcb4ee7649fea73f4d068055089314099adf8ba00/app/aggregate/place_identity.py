"""地点身份注册、增量绑定、存量审计及可逆治理；调用方控制事务提交。"""
from __future__ import annotations

import hashlib
import json
from collections import defaultdict
from uuid import uuid4

from sqlalchemy import or_, select, text, update
from sqlalchemy.dialects.postgresql import insert

from app.clean.alias import aliases_for, canonical_display_name, planning_name
from app.clean.identity import IdentityCatalog, legacy_id, name_key, validate_place_type_override
from app.models import CanonicalPlace, PlaceEntity, PlaceEntityMember, PlaceEntityReview, PlaceEntityChange

ENTITY_FIELDS = ('entity_id', 'city', 'canonical_name', 'primary_place_id', 'aliases', 'legacy_ids',
                 'revision', 'status', 'redirect_to', 'overrides', 'evidence')


async def lock_city(session, city: str) -> None:
    await session.execute(text('SELECT pg_advisory_xact_lock(hashtextextended(:city, 0))'),
                          {'city': f'place-identity:{city}'})


async def lock_id_registry(session) -> None:
    """成员ID是全局命名空间；先城市锁、后注册锁，阻止跨城市并发抢占旧hash。"""
    await session.execute(text("SELECT pg_advisory_xact_lock(hashtextextended('place-identity:id-registry', 0))"))


async def can_claim_id(session, candidate: str, catalog: IdentityCatalog, owners: set[str]) -> bool:
    rows = (await session.scalars(select(PlaceEntity).where(or_(PlaceEntity.entity_id == candidate,
        PlaceEntity.legacy_ids.contains([candidate]))))).all()
    if rows:
        return all(row.city == catalog.city and (catalog.root(row.entity_id) or {}).get('entity_id') in owners
                   for row in rows)
    # 已删除的创建主体也保留ID；普通增量注册/别名认领同样不能复活其历史引用。
    used = await session.scalar(select(PlaceEntityChange.id)
        .where(PlaceEntityChange.request['newEntities'].contains([{'entityId': candidate}])).limit(1))
    return used is None


async def allocate_entity_id(session, preferred: str, catalog: IdentityCatalog) -> str:
    candidate = preferred
    while not await can_claim_id(session, candidate, catalog, set()):
        candidate = uuid4().hex
    return candidate


async def load_catalog(session, city: str) -> IdentityCatalog:
    entities = (await session.scalars(select(PlaceEntity).where(PlaceEntity.city == city))).all()
    members = (await session.execute(select(PlaceEntityMember.place_id, PlaceEntityMember.entity_id)
        .join(PlaceEntity, PlaceEntity.entity_id == PlaceEntityMember.entity_id)
        .where(PlaceEntity.city == city))).all()
    reviews = (await session.scalars(select(PlaceEntityReview.detail).where(PlaceEntityReview.city == city,
        PlaceEntityReview.status == 'REJECTED'))).all()
    return IdentityCatalog(city, [{key: getattr(e, key) for key in ENTITY_FIELDS} for e in entities],
                           [dict(m._mapping) for m in members], reviews)


async def enqueue_review(session, city: str, detail: dict) -> None:
    await lock_city(session, city)
    identity = detail
    if detail.get('reason') == 'similar_name' and len(detail.get('entityIds', [])) == 2:
        catalog = await load_catalog(session, city)

        def current_ids(value):
            return sorted({(catalog.root(eid) or {}).get('entity_id', eid) for eid in value.get('entityIds', [])})

        ids = current_ids(detail)
        if len(ids) != 2:
            return  # 已归为同一实体，不再生成待审。
        # 兼容旧 fingerprint（包含展示名），也复用合并前成员的审核记录。
        # 不改写原记录或其证据，已有版本化审核与回滚仍能定位它。
        existing = (await session.scalars(select(PlaceEntityReview.detail)
            .where(PlaceEntityReview.city == city))).all()
        if any(row.get('reason') == 'similar_name' and current_ids(row) == ids for row in existing):
            return
        identity = {'reason': 'similar_name', 'entityIds': ids}
    fingerprint = hashlib.sha256(json.dumps([city, identity], ensure_ascii=False, sort_keys=True).encode()).hexdigest()
    await session.execute(insert(PlaceEntityReview).values(city=city, fingerprint=fingerprint, detail=detail)
                          .on_conflict_do_nothing(index_elements=[PlaceEntityReview.fingerprint]))


async def refresh_review_statuses(session, city: str) -> None:
    """同义决策解决的候选自动闭环；回滚后按当前实体关系重新进入待审。"""
    catalog = await load_catalog(session, city)
    reviews = (await session.scalars(select(PlaceEntityReview).where(PlaceEntityReview.city == city,
        PlaceEntityReview.status.in_(['PENDING', 'RESOLVED'])))).all()
    for review in reviews:
        ids = review.detail.get('entityIds', [])
        roots = [catalog.root(eid) for eid in ids]
        if len(roots) < 2 or not all(roots):
            continue
        review.status = 'RESOLVED' if len({e['entity_id'] for e in roots}) == 1 else 'PENDING'
    await session.flush()


async def bootstrap(session, city: str) -> int:
    """仅首次为未注册的源记录分配身份；历史稳定 ID 作为初始值保存，后续不再计算。"""
    await lock_city(session, city)
    await lock_id_registry(session)
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
            claims = [legacy_id(city, p.name) for p in rows]
            record.legacy_ids = sorted(set(record.legacy_ids + [value for value in claims
                if await can_claim_id(session, value, catalog, {eid})]))
            record.revision += 1
        else:
            eid = await allocate_entity_id(session, legacy_id(city, name), catalog)
            primary = next((p for p in rows if p.name == name), rows[0])
            claims = sorted(set([eid, *[legacy_id(city, p.name) for p in rows]]))
            claims = [value for value in claims if await can_claim_id(session, value, catalog, set())]
            await session.execute(insert(PlaceEntity).values(entity_id=eid, city=city, canonical_name=name,
                primary_place_id=primary.id, aliases=sorted(set([p.name for p in rows] + aliases_for(city, name))),
                legacy_ids=claims,
                evidence=[{'kind': 'bootstrap', 'source': 'canonical_place + explicit alias configuration'}]))
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
        eid = await allocate_entity_id(session, legacy_id(city, parent), catalog)
        await session.execute(insert(PlaceEntity).values(entity_id=eid, city=city,
            canonical_name=parent, aliases=[], legacy_ids=[eid],
            evidence=[{'kind': 'planning_group', 'source': 'explicit component configuration'}]))
        catalog = await load_catalog(session, city)
    return sum(len(rows) for rows in groups.values())


async def register_place(session, city: str, place: CanonicalPlace) -> dict:
    """新源记录复用精确别名；相似但未确认的记录隔离为 REVIEW，不导出。"""
    await lock_city(session, city)
    await lock_id_registry(session)
    if place.city != city:
        raise ValueError('源地点不在本城')
    catalog = await load_catalog(session, city)
    registered = catalog.resolve(place_id=place.id)
    if registered:
        return registered
    entity = catalog.resolve(place.name)
    if entity:
        record = await session.scalar(select(PlaceEntity).where(PlaceEntity.entity_id == entity['entity_id']))
        claim = legacy_id(city, place.name)
        if await can_claim_id(session, claim, catalog, {entity['entity_id']}):
            record.legacy_ids = sorted(set([*record.legacy_ids, claim]))
        record.revision += 1
        await session.flush()
    if not entity:
        candidates = catalog.candidates(place.name)
        eid = await allocate_entity_id(session, legacy_id(city, place.name), catalog)
        entity = dict(entity_id=eid, city=city, canonical_name=place.name, primary_place_id=place.id,
            aliases=aliases_for(city, place.name), legacy_ids=[eid], revision=1, redirect_to=None,
            status='REVIEW' if candidates else 'ACTIVE', overrides={}, evidence=[])
        await session.execute(insert(PlaceEntity).values(**entity))
        for candidate in candidates:
            ids = sorted([eid, candidate])
            names = {eid: place.name, candidate: catalog.entities[candidate]['canonical_name']}
            # 与存量审计使用相同的两两候选，多个相似主体可以分别审核且不会重复入队。
            await enqueue_review(session, city, {'reason': 'similar_name', 'entityIds': ids,
                'names': [names[item] for item in ids]})
    await session.execute(insert(PlaceEntityMember).values(place_id=place.id, entity_id=entity['entity_id'])
                          .on_conflict_do_nothing(index_elements=[PlaceEntityMember.place_id]))
    await session.flush()
    return (await load_catalog(session, city)).resolve(place_id=place.id)


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
            if frozenset(pair) in catalog.distinct_pairs:
                continue
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
    await lock_id_registry(session)
    previous = await session.scalar(select(PlaceEntityChange).where(PlaceEntityChange.change_key == decision['key']))
    if previous:
        if previous.request != decision:
            raise ValueError('治理 key 已用于不同决策，拒绝覆盖')
        if previous.rolled_back:
            raise ValueError('已回滚的决策需使用新的 key，不能静默重放')
        await refresh_review_statuses(session, city)
        return previous.after
    if not decision.get('evidence'):
        raise ValueError('实体治理必须有证据')
    overrides = decision.get('overrides', {})
    if not isinstance(overrides, dict) or set(overrides) - {'category', 'lat', 'lng', 'address', 'adcode', 'geoStatus', 'exportApproved', 'xhsPlaceType'}:
        raise ValueError('只允许修订有证据的地点类型、地址与坐标')
    validate_place_type_override(overrides)
    if 'exportApproved' in overrides and type(overrides['exportApproved']) is not bool:
        raise ValueError('人工导出批准必须是布尔值')
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
    if any(pair.issubset(ids) for pair in catalog.distinct_pairs):
        raise ValueError('治理组包含已确认的独立或组成地点，拒绝同义归并')
    expected = decision.get('expectedRevisions', {})
    if any(expected.get(e['entity_id']) != e['revision'] for e in entities):
        raise ValueError('治理预览已过期，须重新核对实体版本')
    name = decision.get('canonicalName', entities[0]['canonical_name']).strip()
    if not name or len(name) > 128:
        raise ValueError('主名无效')
    excluded = decision.get('excludeNames', [])
    restored = decision.get('restoreNames', [])
    for value in [excluded, restored]:
        if not isinstance(value, list) or any(not isinstance(n, str) or not n.strip() or len(n) > 128 for n in value):
            raise ValueError('名称排除与恢复必须提供有效名称列表')
    if {name_key(n) for n in excluded} & {name_key(n) for n in restored}:
        raise ValueError('同一名称不能同时排除与恢复')
    previous_excluded = [n for e in entities for n in e['overrides'].get('identityExcludedNames', [])]
    excluded_names = sorted({n for n in [*previous_excluded, *excluded]
                             if name_key(n) not in {name_key(r) for r in restored}})
    excluded_keys = {name_key(n) for n in excluded_names}
    if name_key(name) in excluded_keys:
        raise ValueError('主名不能同时被排除')
    inherited_in_members = {name_key(n) for e in entities[1:] for n in [e['canonical_name'], *e['aliases']]}
    to_validate = list(dict.fromkeys([*excluded, *[n for n in excluded_names if name_key(n) in inherited_in_members]]))
    if to_validate:
        from app.aggregate.mention_identity import validate_name_exclusions
        await validate_name_exclusions(session, catalog, ids, to_validate)
    aliases = sorted(set([name, *decision.get('aliases', []),
        *restored, *(e['canonical_name'] for e in entities), *(a for e in entities for a in e['aliases'])]))
    aliases = [alias for alias in aliases if name_key(alias) not in excluded_keys]
    for alias in aliases:
        if catalog.names.get(name_key(alias), set()) - set(ids):
            raise ValueError(f'别名已有其他实体归属：{alias}')
    before = await snapshot(session, city, ids)
    root = await session.scalar(select(PlaceEntity).where(PlaceEntity.entity_id == ids[0]))
    root.canonical_name = name
    root.aliases = aliases
    claims = [legacy_id(city, alias) for alias in aliases]
    root.legacy_ids = sorted(set([*ids, *(a for e in entities for a in e['legacy_ids']),
                                 *[value for value in claims if await can_claim_id(session, value, catalog, set(ids))]]))
    root.revision += 1
    root.status = 'ACTIVE'
    root.overrides = {**root.overrides, **decision.get('overrides', {})}
    if excluded_names or previous_excluded:
        root.overrides = {**root.overrides, 'identityExcludedNames': excluded_names}
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
    await refresh_review_statuses(session, city)
    return after


async def apply_review_decision(session, decision: dict) -> dict:
    """记录独立/组成/证据不足判断；不靠自动归并清空审核队列。"""
    city = decision['city']
    await lock_city(session, city)
    previous = await session.scalar(select(PlaceEntityChange).where(PlaceEntityChange.change_key == decision['key']))
    if previous:
        if previous.request != decision or previous.rolled_back:
            raise ValueError('审核 key 已使用或已回滚，请使用新的决策 key')
        return previous.after
    verdict = decision.get('verdict')
    if verdict not in ('distinct', 'part_of', 'uncertain') or not decision.get('explanation') or not decision.get('evidence'):
        raise ValueError('审核必须提供合法结论、解释与证据')
    review = await session.scalar(select(PlaceEntityReview).where(PlaceEntityReview.city == city,
        PlaceEntityReview.fingerprint == decision['reviewFingerprint']).with_for_update())
    if not review or review.status != 'PENDING':
        raise ValueError('待审候选不存在或已处理')
    original_ids = review.detail.get('entityIds', [])
    catalog = await load_catalog(session, city)
    roots = [catalog.root(eid) for eid in original_ids]
    ids = sorted({entity['entity_id'] for entity in roots if entity})
    if not all(roots) or len(ids) != 2:
        raise ValueError('审核需要两个仍然独立的现行实体，候选变化后须重新审计')
    if any(decision.get('expectedRevisions', {}).get(eid) != catalog.entities[eid]['revision'] for eid in ids):
        raise ValueError('审核预览已过期，须重新核对实体版本')
    if verdict == 'part_of' and decision.get('childEntityId') not in ids:
        raise ValueError('组成关系必须指定候选中的子地点')
    pending_reviews = (await session.scalars(select(PlaceEntityReview).where(PlaceEntityReview.city == city,
        PlaceEntityReview.status == 'PENDING').order_by(PlaceEntityReview.id).with_for_update())).all()

    def root_ids(detail):
        return sorted({root['entity_id'] for eid in detail.get('entityIds', []) if (root := catalog.root(eid))})

    # 两个旧成员分别与同一子项入队后再合并，会留下多条同一现行实体对。
    # 一次审核须原子闭环这些历史记录，否则遗留 PENDING 会使已确认地点一直隔离。
    related = [row for row in pending_reviews if row.id == review.id
        or (row.detail.get('reason') == review.detail.get('reason') and root_ids(row.detail) == ids)]
    before = await snapshot(session, city, ids)
    before['reviews'] = [review_state(row) for row in related]
    for row in related:
        row.detail = {**row.detail, 'assessment': {key: decision[key] for key in
            ('key', 'verdict', 'explanation', 'evidence', 'childEntityId') if key in decision}}
        row.status = 'PENDING' if verdict == 'uncertain' else 'REJECTED'
    await session.flush()
    if verdict != 'uncertain':
        pending = (await session.scalars(select(PlaceEntityReview.detail).where(PlaceEntityReview.city == city,
            PlaceEntityReview.status == 'PENDING'))).all()
        for eid in ids:
            entity = await session.scalar(select(PlaceEntity).where(PlaceEntity.entity_id == eid))
            if entity.status == 'REVIEW' and not any(eid in root_ids(r) for r in pending):
                entity.status = 'ACTIVE'
                entity.revision += 1
                entity.evidence = [*entity.evidence, {'kind': 'independent_identity_review', 'key': decision['key'],
                    'evidence': decision['evidence']}]
    await session.flush()
    after = await snapshot(session, city, ids)
    after['reviews'] = [review_state(row) for row in related]
    session.add(PlaceEntityChange(change_key=decision['key'], city=city, before=before, after=after,
        evidence=decision['evidence'], request=decision))
    await session.flush()
    return after


def review_state(review: PlaceEntityReview) -> dict:
    return {'id': review.id, 'fingerprint': review.fingerprint, 'status': review.status, 'detail': review.detail}


async def rollback_decision(session, change_key: str, *, image_roots: dict | None = None) -> dict:
    change = await session.scalar(select(PlaceEntityChange).where(PlaceEntityChange.change_key == change_key))
    if not change:
        raise ValueError('治理记录不存在')
    await lock_city(session, change.city)
    if change.rolled_back:
        return change.before
    if 'imageInputs' in change.after:
        from app.aggregate.image_identity import rollback_image_decision
        return await rollback_image_decision(session, change, **(image_roots or {}))
    if 'scopes' in change.after:
        from app.aggregate.mention_identity import rollback_scope_decision
        return await rollback_scope_decision(session, change)
    ids = [e['entity_id'] for e in change.after['entities']]
    current = await snapshot(session, change.city, ids)
    if 'reviews' in change.after:
        current['reviews'] = [review_state(await session.get(PlaceEntityReview, row['id']))
                              for row in change.after['reviews']]
    if current != change.after:
        raise ValueError('实体已有后续修改，拒绝覆盖；先回滚后续决策')
    for entity in change.before['entities']:
        await session.execute(update(PlaceEntity).where(PlaceEntity.entity_id == entity['entity_id']).values(**entity))
    for member in change.before['members']:
        await session.execute(update(PlaceEntityMember).where(PlaceEntityMember.place_id == member['place_id'])
                              .values(entity_id=member['entity_id']))
    for row in change.before.get('reviews', []):
        await session.execute(update(PlaceEntityReview).where(PlaceEntityReview.id == row['id'])
                              .values(status=row['status'], detail=row['detail']))
    change.rolled_back = True
    await session.flush()
    await refresh_review_statuses(session, change.city)
    return change.before
