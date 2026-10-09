"""加载、版本化分配原始提及并维护待审；调用方负责整个事务提交。"""
from __future__ import annotations

from sqlalchemy import delete, select, update
from sqlalchemy.dialects.postgresql import insert

from app.aggregate.place_identity import (enqueue_review, load_catalog, lock_city, review_state, snapshot)
from app.clean.identity import name_key
from app.clean.mention_identity import (MENTION_FIELDS, MentionIdentityCatalog, mention_fingerprint,
                                      scope_matches, source_fingerprint)
from app.models import (CanonicalPlace, CanonicalPlaceSource, PlaceEntity, PlaceEntityChange, PlaceEntityReview,
                        PlaceIdentityScope, PlaceImageAssignment, PlaceMention, PlaceMentionAssignment, PlaceRelation, PlaceSummary, RawNote)

SCOPE_FIELDS = ('place_id', 'city', 'name_keys', 'entity_ids', 'source_hash', 'revision', 'change_key', 'evidence')
ASSIGNMENT_FIELDS = ('mention_id', 'scope_place_id', 'entity_id', 'input_hash', 'revision', 'change_key')


async def load_mention_rows(session, city: str, mention_ids: list[int] | None = None) -> list[dict]:
    query = (select(PlaceMention, RawNote)
        .join(RawNote, RawNote.id == PlaceMention.raw_note_id)
        .where(RawNote.city == city).order_by(PlaceMention.id))
    if mention_ids is not None:
        query = query.where(PlaceMention.id.in_(mention_ids))
    rows = (await session.execute(query)).all()
    return [{**{key: getattr(mention, key) for key in MENTION_FIELDS},
        'note_city': note.city, 'note_title': note.title, 'note_desc': note.desc,
        'note_images': note.img_analysis, 'note_unavailable': note.status in ('DELETED', 'PRIVATE'),
        'source_url': note.source_url or '', 'observed_at': note.created_at.isoformat() if note.created_at else None}
        for mention, note in rows]


async def load_mention_catalog(session, city: str, catalog=None) -> MentionIdentityCatalog:
    scopes = (await session.scalars(select(PlaceIdentityScope).where(PlaceIdentityScope.city == city))).all()
    assignments = (await session.scalars(select(PlaceMentionAssignment).join(PlaceIdentityScope,
        PlaceIdentityScope.place_id == PlaceMentionAssignment.scope_place_id)
        .where(PlaceIdentityScope.city == city))).all()
    sources = (await session.scalars(select(CanonicalPlace).where(CanonicalPlace.id.in_([s.place_id for s in scopes])))).all()
    by_id = {source.id: source for source in sources}
    scope_rows = []
    for scope in scopes:
        source = by_id.get(scope.place_id)
        source_input = {k: getattr(source, k) for k in ('id', 'city', 'name', 'normalized_name')} if source else None
        scope_rows.append({**{k: getattr(scope, k) for k in SCOPE_FIELDS},
            'source_valid': bool(source_input and source_fingerprint(source_input) == scope.source_hash),
            'name_keys': sorted(set([*scope.name_keys, *([name_key(source.name), name_key(source.normalized_name)] if source else [])]))})
    return MentionIdentityCatalog(catalog or await load_catalog(session, city), scope_rows,
        [{k: getattr(row, k) for k in ASSIGNMENT_FIELDS} for row in assignments])


async def refresh_mention_reviews(session, city: str) -> None:
    """稳定指纹按提及+当前内容；分配后闭环，内容变化后保留旧审核并新建待审。"""
    await lock_city(session, city)
    catalog = await load_mention_catalog(session, city)
    rows = await load_mention_rows(session, city)
    pending = {}
    for row in rows:
        result = catalog.resolve(row)
        if result['status'] == 'review':
            detail = {'reason': 'mention_scope', 'mentionId': row['id'],
                'inputHash': mention_fingerprint(row), 'scopePlaceIds': result['scopePlaceIds']}
            pending[(row['id'], detail['inputHash'])] = detail
    for detail in pending.values():
        await enqueue_review(session, city, detail)
    existing = (await session.scalars(select(PlaceEntityReview).where(PlaceEntityReview.city == city,
        PlaceEntityReview.detail['reason'].astext == 'mention_scope'))).all()
    for review in existing:
        review.status = 'PENDING' if (review.detail['mentionId'], review.detail['inputHash']) in pending else 'RESOLVED'
    await session.flush()


async def validate_name_exclusions(session, catalog, entity_ids: list[str], names: list[str]) -> None:
    """错名只能在来源归属已经逐条核实后移除；混合源不能借移除别名整条归并。"""
    keys = {name_key(n) for n in names}
    mentions = await load_mention_catalog(session, catalog.city, catalog)
    member_ids = [pid for pid, eid in catalog.members.items()
                  if (catalog.root(eid) or {}).get('entity_id') in entity_ids]
    sources = (await session.scalars(select(CanonicalPlace).where(CanonicalPlace.id.in_(member_ids)))).all()
    for source in sources:
        if keys & {name_key(source.name), name_key(source.normalized_name)}:
            scope = mentions.scopes.get(source.id)
            if not scope or not scope['source_valid']:
                raise ValueError('排除错误旧名之前必须治理其原始来源范围')
    for row in await load_mention_rows(session, catalog.city):
        if not keys & {name_key(row['name']), name_key(row['normalized_name'])}:
            continue
        result = mentions.resolve(row)
        if result['reason'] != 'reviewed_assignment' or result.get('entity', {}).get('entity_id') not in entity_ids:
            raise ValueError('错误旧名仍有未分配、过期或其他实体的提及，禁止整条归并')


async def scope_snapshot(session, city: str, source_id: int, name_keys: list[str], entity_ids: list[str]) -> dict:
    state = await snapshot(session, city, entity_ids)
    source_ids = sorted({source_id, *(m['place_id'] for m in state['members'])})
    places = (await session.scalars(select(CanonicalPlace).where(CanonicalPlace.id.in_(source_ids))
        .order_by(CanonicalPlace.id))).all()
    state['derivedPlaces'] = [{k: getattr(p, k) for k in ('id', 'content_profile', 'typical_visit_minutes',
        'typical_visit_source', 'quality_score', 'theme_tags', 'is_active')} for p in places]
    summaries = (await session.scalars(select(PlaceSummary).where(PlaceSummary.canonical_place_id.in_(source_ids))
        .order_by(PlaceSummary.canonical_place_id))).all()
    state['summaries'] = [{k: getattr(row, k) for k in ('canonical_place_id', 'mention_count_30d',
        'positive_count_30d', 'source_count', 'top_reasons', 'recommend_score')} for row in summaries]
    provenance = (await session.scalars(select(CanonicalPlaceSource).where(CanonicalPlaceSource.canonical_place_id.in_(source_ids))
        .order_by(CanonicalPlaceSource.id))).all()
    state['provenance'] = [{k: getattr(row, k) for k in ('id', 'canonical_place_id', 'source_type',
        'source_note_id', 'source_url', 'source_name', 'evidence_summary')} for row in provenance]
    relations = (await session.scalars(select(PlaceRelation).where(PlaceRelation.city == city)
        .order_by(PlaceRelation.id))).all()
    relation_names = set(name_keys) | {name_key(name) for e in state['entities']
        for name in [e['canonical_name'], *e['aliases']]}
    state['relations'] = [{k: getattr(row, k) for k in ('id', 'from_name', 'to_name', 'rel_type',
        'strength', 'note_count', 'evidence', 'source_url')} for row in relations
        if name_key(row.from_name) in relation_names or name_key(row.to_name) in relation_names]
    images = (await session.scalars(select(PlaceImageAssignment).where(PlaceImageAssignment.city == city)
        .order_by(PlaceImageAssignment.image_key))).all()
    state['imageAssignments'] = [{k: getattr(row, k) for k in ('city', 'image_key', 'source_place_id',
        'entity_id', 'input_hash', 'revision', 'change_key', 'evidence')} for row in images
        if row.source_place_id in source_ids or row.entity_id in entity_ids]
    image_reviews = (await session.scalars(select(PlaceEntityReview).where(PlaceEntityReview.city == city,
        PlaceEntityReview.detail['reason'].astext == 'image_scope').order_by(PlaceEntityReview.id))).all()
    state['imageReviews'] = [review_state(row) for row in image_reviews]
    scope = await session.scalar(select(PlaceIdentityScope).where(PlaceIdentityScope.place_id == source_id))
    state['scopes'] = [{k: getattr(scope, k) for k in SCOPE_FIELDS}] if scope else []
    assignments = (await session.scalars(select(PlaceMentionAssignment)
        .where(PlaceMentionAssignment.scope_place_id == source_id).order_by(PlaceMentionAssignment.mention_id))).all()
    state['assignments'] = [{k: getattr(a, k) for k in ASSIGNMENT_FIELDS} for a in assignments]
    source = await session.get(CanonicalPlace, source_id)
    source_input = {k: getattr(source, k) for k in ('id', 'city', 'name', 'normalized_name')} if source else None
    assigned_ids = {a.mention_id for a in assignments}
    matched = [row for row in await load_mention_rows(session, city)
        if row['id'] in assigned_ids or scope_matches({'city': city, 'name_keys': name_keys}, row)]
    state['inputs'] = {'sourceHash': source_fingerprint(source_input) if source_input else None,
        'mentions': [{'mentionId': row['id'], 'inputHash': mention_fingerprint(row)} for row in matched]}
    reviews = (await session.scalars(select(PlaceEntityReview).where(PlaceEntityReview.city == city,
        PlaceEntityReview.detail['reason'].astext == 'mention_scope',
        PlaceEntityReview.detail['scopePlaceIds'].contains([source_id])).order_by(PlaceEntityReview.id))).all()
    state['scopeReviews'] = [review_state(row) for row in reviews]
    return state


async def apply_scope_decision(session, decision: dict) -> dict:
    city, source_id = decision['city'], decision['sourcePlaceId']
    if type(source_id) is not int or source_id <= 0 or not decision.get('evidence'):
        raise ValueError('提及治理须提供源ID和证据')
    await lock_city(session, city)
    previous = await session.scalar(select(PlaceEntityChange).where(PlaceEntityChange.change_key == decision['key']))
    if previous:
        if previous.request != decision or previous.rolled_back:
            raise ValueError('提及治理key已使用或已回滚')
        return previous.after
    source = await session.get(CanonicalPlace, source_id)
    if not source or source.city != city:
        raise ValueError('源地点不在本城或不存在')
    source_input = {k: getattr(source, k) for k in ('id', 'city', 'name', 'normalized_name')}
    if decision.get('expectedSourceHash') != source_fingerprint(source_input):
        raise ValueError('源地点已经变化，须重新核对')
    current = await load_mention_catalog(session, city)
    old_scope = current.scopes.get(source_id)
    if decision.get('expectedScopeRevision') != (old_scope['revision'] if old_scope else 0):
        raise ValueError('提及范围版本过期')
    names = decision.get('guardedNames', [])
    if not isinstance(names, list) or any(not isinstance(n, str) or not n.strip() or len(n) > 128 for n in names):
        raise ValueError('受控名称必须是有效名称列表')
    keys = sorted(set([name_key(source.name), name_key(source.normalized_name),
                       *(old_scope['name_keys'] if old_scope else []), *(name_key(n) for n in names)]))
    if any(set(keys) & set(scope['name_keys']) for pid, scope in current.scopes.items() if pid != source_id):
        raise ValueError('受控名称与另一源范围重叠，须先明确边界')
    old_assigned_ids = {a['mention_id'] for a in current.assignments.values() if a['scope_place_id'] == source_id}
    rows = [row for row in await load_mention_rows(session, city)
            if row['id'] in old_assigned_ids or scope_matches({'city': city, 'name_keys': keys}, row)]
    expected = [{'mentionId': r['id'], 'inputHash': mention_fingerprint(r)} for r in rows]
    supplied = decision.get('assignments')
    if not isinstance(supplied, list) or any(not isinstance(a, dict) or type(a.get('mentionId')) is not int
        or not isinstance(a.get('inputHash'), str) or 'entityId' not in a for a in supplied):
        raise ValueError('必须逐条列出提及快照及明确目标或null')
    if sorted([{'mentionId': a['mentionId'], 'inputHash': a['inputHash']} for a in supplied],
              key=lambda a: a['mentionId']) != expected:
        raise ValueError('提及集合或正文已变化，不能遗漏、重复或沿用过期快照')
    if any(a['entityId'] is not None and (not isinstance(a['entityId'], str) or not a['entityId'].strip()) for a in supplied):
        raise ValueError('提及目标必须是实体ID或null')
    source_entity = current.catalog.resolve(place_id=source_id)
    if not source_entity:
        raise ValueError('源地点尚未注册稳定身份')
    target_ids = {a['entityId'] for a in supplied if a['entityId']}
    # 先前目标也进入版本及回滚范围，重新分配不能漏掉失去语料的旧分店。
    target_ids.update((current.catalog.root(a['entity_id']) or {}).get('entity_id', a['entity_id'])
        for a in current.assignments.values() if a['scope_place_id'] == source_id and a['entity_id'])
    target_ids.update((current.catalog.root(eid) or {}).get('entity_id', eid)
        for eid in (old_scope.get('entity_ids', []) if old_scope else []))
    ids = sorted({source_entity['entity_id'], *target_ids})
    for eid in ids:
        target = current.catalog.entities.get(eid)
        if not target or target.get('redirect_to') or target['status'] != 'ACTIVE':
            raise ValueError('提及目标必须是本城有效现行实体')
    revisions = decision.get('expectedRevisions', {})
    if set(revisions) != set(ids) or any(revisions[eid] != current.catalog.entities[eid]['revision'] for eid in ids):
        raise ValueError('提及目标版本过期或缺少受影响实体')
    if any(a['mention_id'] in {r['id'] for r in rows} and a['scope_place_id'] != source_id
           for a in current.assignments.values()):
        raise ValueError('提及已经属于另一受控来源，不能抢占')
    before = await scope_snapshot(session, city, source_id, keys, ids)
    values = dict(place_id=source_id, city=city, name_keys=keys, entity_ids=ids, source_hash=source_fingerprint(source_input),
        revision=(old_scope['revision'] + 1) if old_scope else 1, change_key=decision['key'], evidence=decision['evidence'])
    await session.execute(insert(PlaceIdentityScope).values(**values).on_conflict_do_update(
        index_elements=[PlaceIdentityScope.place_id], set_={k: v for k, v in values.items() if k != 'place_id'}))
    await session.execute(delete(PlaceMentionAssignment).where(PlaceMentionAssignment.scope_place_id == source_id))
    for item in supplied:
        old = current.assignments.get(item['mentionId'])
        await session.execute(insert(PlaceMentionAssignment).values(mention_id=item['mentionId'],
            scope_place_id=source_id, entity_id=item['entityId'], input_hash=item['inputHash'],
            revision=(old['revision'] + 1) if old else 1, change_key=decision['key']))
    await session.execute(update(PlaceEntity).where(PlaceEntity.entity_id.in_(ids)).values(revision=PlaceEntity.revision + 1))
    await session.flush()
    await refresh_mention_reviews(session, city)
    after = await scope_snapshot(session, city, source_id, keys, ids)
    session.add(PlaceEntityChange(change_key=decision['key'], city=city, before=before, after=after,
        evidence=decision['evidence'], request=decision))
    await session.flush()
    return after


async def rollback_scope_decision(session, change: PlaceEntityChange) -> dict:
    source_id = change.request['sourcePlaceId']
    ids = [e['entity_id'] for e in change.after['entities']]
    keys = change.after['scopes'][0]['name_keys']
    current = await scope_snapshot(session, change.city, source_id, keys, ids)
    if current != change.after:
        raise ValueError('提及、来源或实体已有后续修改，拒绝过期回滚')
    await session.execute(delete(PlaceMentionAssignment).where(PlaceMentionAssignment.scope_place_id == source_id))
    if change.before['scopes']:
        values = change.before['scopes'][0]
        await session.execute(update(PlaceIdentityScope).where(PlaceIdentityScope.place_id == source_id).values(**values))
    else:
        await session.execute(delete(PlaceIdentityScope).where(PlaceIdentityScope.place_id == source_id))
    for assignment in change.before['assignments']:
        await session.execute(insert(PlaceMentionAssignment).values(**assignment))
    for entity in change.before['entities']:
        await session.execute(update(PlaceEntity).where(PlaceEntity.entity_id == entity['entity_id']).values(**entity))
    before_reviews = {r['id']: r for r in change.before['scopeReviews']}
    for row in change.after['scopeReviews']:
        if row['id'] not in before_reviews:
            await session.execute(delete(PlaceEntityReview).where(PlaceEntityReview.id == row['id']))
    for row in before_reviews.values():
        await session.execute(update(PlaceEntityReview).where(PlaceEntityReview.id == row['id'])
                              .values(status=row['status'], detail=row['detail']))
    change.rolled_back = True
    await session.flush()
    return change.before
