"""加载、版本化分配原始提及并维护待审；调用方负责整个事务提交。"""
from __future__ import annotations

from sqlalchemy import delete, select, update
from sqlalchemy.dialects.postgresql import insert

from app.aggregate.place_identity import (can_claim_id, enqueue_review, load_catalog, lock_city, lock_id_registry, review_state, snapshot)
from app.aggregate.note_text_warnings import load_warning_notes, snapshot_warning_inputs
from app.clean.note_text_warnings import validate_text_warnings, warning_refs
from app.clean.entity_creation import creation_names, validate_creations
from app.clean.identity import name_key
from app.clean.mention_identity import (MENTION_FIELDS, MentionIdentityCatalog, mention_fingerprint,
                                      scope_matches, source_fingerprint, validate_exclusion, validate_fact_exclusions)
from app.models import (CanonicalPlace, CanonicalPlaceSource, PlaceEntity, PlaceEntityChange, PlaceEntityReview,
                        PlaceIdentityScope, PlaceIdentityScopeSource, PlaceImageAssignment, PlaceMention, PlaceMentionAssignment, PlaceRelation, PlaceSummary, RawNote)

SCOPE_FIELDS = ('place_id', 'city', 'name_keys', 'entity_ids', 'source_hash', 'revision', 'change_key', 'evidence')
ASSIGNMENT_FIELDS = ('mention_id', 'scope_place_id', 'entity_id', 'input_hash', 'revision', 'change_key')
SOURCE_FIELDS = ('place_id', 'scope_place_id', 'source_hash')


def scope_state(scope) -> dict:
    state = {k: getattr(scope, k) for k in SCOPE_FIELDS}
    if scope.withdrawal_entity_ids is not None:
        state['withdrawal_entity_ids'] = scope.withdrawal_entity_ids
    if scope.text_warnings is not None:
        state['text_warnings'] = scope.text_warnings
    return state


def assignment_state(assignment) -> dict:
    state = {k: getattr(assignment, k) for k in ASSIGNMENT_FIELDS}
    if assignment.exclusion is not None:
        state['exclusion'] = assignment.exclusion
    if assignment.fact_exclusions is not None:
        state['fact_exclusions'] = assignment.fact_exclusions
    return state


def source_input(source) -> dict:
    return {key: getattr(source, key) for key in ('id', 'city', 'name', 'normalized_name')}


def source_keys(source) -> set[str]:
    return {name_key(source.name), name_key(source.normalized_name)}


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


async def load_mention_catalog(session, city: str, catalog=None, *, allow_source_conflicts=False) -> MentionIdentityCatalog:
    scopes = (await session.scalars(select(PlaceIdentityScope).where(PlaceIdentityScope.city == city))).all()
    assignments = (await session.scalars(select(PlaceMentionAssignment).join(PlaceIdentityScope,
        PlaceIdentityScope.place_id == PlaceMentionAssignment.scope_place_id)
        .where(PlaceIdentityScope.city == city))).all()
    sources = (await session.scalars(select(CanonicalPlace).where(CanonicalPlace.city == city))).all()
    members = (await session.scalars(select(PlaceIdentityScopeSource).join(PlaceIdentityScope,
        PlaceIdentityScope.place_id == PlaceIdentityScopeSource.scope_place_id)
        .where(PlaceIdentityScope.city == city).order_by(PlaceIdentityScopeSource.place_id))).all()
    by_id = {source.id: source for source in sources}
    scope_rows = []
    for scope in scopes:
        if scope.text_warnings is not None and not isinstance(scope.text_warnings, list):
            raise ValueError('持久化补充警告不是有效列表，须重新审核')
        explicit = [{k: getattr(row, k) for k in SOURCE_FIELDS} for row in members if row.scope_place_id == scope.place_id]
        selected = explicit or [dict(place_id=scope.place_id, scope_place_id=scope.place_id, source_hash=scope.source_hash)]
        if explicit and scope.place_id not in {row['place_id'] for row in selected}:
            raise ValueError('联合治理范围缺少锚点来源')
        keys = set(scope.name_keys)
        valid = True
        for row in selected:
            source = by_id.get(row['place_id'])
            valid = valid and bool(source and source_fingerprint(source_input(source)) == row['source_hash'])
            if source:
                keys.update(source_keys(source))
        conflicts = sorted(p.id for p in sources if keys & source_keys(p)
                           and p.id not in {row['place_id'] for row in selected}) if explicit else []
        if conflicts and not allow_source_conflicts:
            raise ValueError('联合治理范围的来源集合已变化，须完整核实后扩展范围')
        scope_rows.append({**scope_state(scope),
            'source_members': selected, 'source_conflicts': conflicts, 'joint': bool(explicit),
            'source_valid': valid and not conflicts, 'name_keys': sorted(keys)})
    refs = warning_refs([v for s in scope_rows for v in (s.get('text_warnings') or [])])
    return MentionIdentityCatalog(catalog or await load_catalog(session, city), scope_rows,
        [assignment_state(row) for row in assignments], warning_notes=await load_warning_notes(session, refs))


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
            scope = mentions.scope_for_source(source.id)
            if not scope or not scope['source_valid']:
                raise ValueError('排除错误旧名之前必须治理其原始来源范围')
    for row in await load_mention_rows(session, catalog.city):
        if not keys & {name_key(row['name']), name_key(row['normalized_name'])}:
            continue
        result = mentions.resolve(row)
        if result['reason'] != 'reviewed_assignment' or result.get('entity', {}).get('entity_id') not in entity_ids:
            raise ValueError('错误旧名仍有未分配、过期或其他实体的提及，禁止整条归并')


async def scope_snapshot(session, city: str, source_id: int, name_keys: list[str], entity_ids: list[str],
                         joint_source_ids: list[int] | None = None, created_entity_ids: list[str] | None = None,
                         text_warning_refs: list[dict] | None = None) -> dict:
    state = await snapshot(session, city, entity_ids)
    scope_sources = (await session.scalars(select(PlaceIdentityScopeSource)
        .where(PlaceIdentityScopeSource.scope_place_id == source_id).order_by(PlaceIdentityScopeSource.place_id))).all()
    if joint_source_ids is None and scope_sources:
        joint_source_ids = [row.place_id for row in scope_sources]
    source_ids = sorted({source_id, *(joint_source_ids or []), *(m['place_id'] for m in state['members'])})
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
    state['scopes'] = [scope_state(scope)] if scope else []
    assignments = (await session.scalars(select(PlaceMentionAssignment)
        .where(PlaceMentionAssignment.scope_place_id == source_id).order_by(PlaceMentionAssignment.mention_id))).all()
    state['assignments'] = [assignment_state(a) for a in assignments]
    source = await session.get(CanonicalPlace, source_id)
    source_input = {k: getattr(source, k) for k in ('id', 'city', 'name', 'normalized_name')} if source else None
    assigned_ids = {a.mention_id for a in assignments}
    matched = [row for row in await load_mention_rows(session, city)
        if row['id'] in assigned_ids or scope_matches({'city': city, 'name_keys': name_keys}, row)]
    state['inputs'] = {'sourceHash': source_fingerprint(source_input) if source_input else None,
        'mentions': [{'mentionId': row['id'], 'inputHash': mention_fingerprint(row)} for row in matched]}
    refs = text_warning_refs if text_warning_refs is not None else (scope.text_warnings or [] if scope else [])
    if refs:
        state['inputs']['textWarnings'] = await snapshot_warning_inputs(session, refs)
    if joint_source_ids is not None:
        state['scopeSources'] = [{k: getattr(row, k) for k in SOURCE_FIELDS} for row in scope_sources]
        all_sources = (await session.scalars(select(CanonicalPlace).where(CanonicalPlace.city == city)
            .order_by(CanonicalPlace.id))).all()
        by_id = {p.id: p for p in all_sources}
        fingerprint = lambda p: source_fingerprint({k: getattr(p, k) for k in ('id', 'city', 'name', 'normalized_name')})
        state['inputs']['sources'] = [{'sourcePlaceId': pid, 'sourceHash': fingerprint(by_id[pid]) if pid in by_id else None}
                                      for pid in sorted(joint_source_ids)]
        state['inputs']['matchingSources'] = [{'sourcePlaceId': p.id, 'sourceHash': fingerprint(p)}
            for p in all_sources if set(name_keys) & source_keys(p)]
    reviews = (await session.scalars(select(PlaceEntityReview).where(PlaceEntityReview.city == city,
        PlaceEntityReview.detail['reason'].astext == 'mention_scope',
        PlaceEntityReview.detail['scopePlaceIds'].contains([source_id])).order_by(PlaceEntityReview.id))).all()
    state['scopeReviews'] = [review_state(row) for row in reviews]
    if created_entity_ids is not None:
        state['createdEntityIds'] = sorted(created_entity_ids)
        reviews = (await session.scalars(select(PlaceEntityReview).where(PlaceEntityReview.city == city)
            .order_by(PlaceEntityReview.id))).all()
        state['createdEntityReviews'] = [review_state(row) for row in reviews
            if set(row.detail.get('entityIds', [])) & set(created_entity_ids)]
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
    creations = decision.get('newEntities', [])
    new_names = creation_names(creations)
    source = await session.get(CanonicalPlace, source_id)
    if not source or source.city != city:
        raise ValueError('源地点不在本城或不存在')
    anchor_input = source_input(source)
    if decision.get('expectedSourceHash') != source_fingerprint(anchor_input):
        raise ValueError('源地点已经变化，须重新核对')
    current = await load_mention_catalog(session, city, allow_source_conflicts=True)
    if source_id in current.source_scopes and current.source_scopes[source_id] != source_id:
        raise ValueError('来源已属于另一治理范围，不能更换锚点或抢占')
    old_scope = current.scopes.get(source_id)
    if decision.get('expectedScopeRevision') != (old_scope['revision'] if old_scope else 0):
        raise ValueError('提及范围版本过期')
    names = decision.get('guardedNames', [])
    if not isinstance(names, list) or any(not isinstance(n, str) or not n.strip() or len(n) > 128 for n in names):
        raise ValueError('受控名称必须是有效名称列表')
    names = [*names, *new_names]
    all_sources = (await session.scalars(select(CanonicalPlace).where(CanonicalPlace.city == city))).all()
    by_id = {p.id: p for p in all_sources}
    selected = decision.get('sources')
    if selected is not None:
        if not isinstance(selected, list) or not selected or any(not isinstance(row, dict)
            or set(row) != {'sourcePlaceId', 'sourceHash'} or type(row['sourcePlaceId']) is not int
            or row['sourcePlaceId'] <= 0 for row in selected):
            raise ValueError('联合来源须逐源提供ID和指纹')
        selected_ids = {row['sourcePlaceId'] for row in selected}
        if len(selected_ids) != len(selected) or source_id not in selected_ids:
            raise ValueError('联合来源重复或缺少锚点')
        if any(row['sourcePlaceId'] not in by_id or row['sourceHash'] != source_fingerprint(source_input(by_id[row['sourcePlaceId']]))
               for row in selected):
            raise ValueError('联合来源不存在、不在本城或指纹已变化')
        if old_scope and not {row['place_id'] for row in old_scope['source_members']}.issubset(selected_ids):
            raise ValueError('联合来源不能移除历史成员')
        if any(pid in current.source_scopes and current.source_scopes[pid] != source_id for pid in selected_ids):
            raise ValueError('联合来源已被另一范围占用')
    else:
        if 'sources' in decision or (old_scope and old_scope['joint']):
            raise ValueError('联合来源必须完整列出，不能退回单源请求')
        selected_ids = {source_id}
    keys = sorted({key for pid in selected_ids for key in source_keys(by_id[pid])}
                  | set(old_scope['name_keys'] if old_scope else []) | {name_key(n) for n in names})
    if any(set(keys) & set(scope['name_keys']) for pid, scope in current.scopes.items() if pid != source_id):
        raise ValueError('受控名称与另一源范围重叠，须先明确边界')
    source_entity = current.catalog.resolve(place_id=source_id)
    if not source_entity:
        raise ValueError('源地点尚未注册稳定身份')
    # 单scope按名称键覆盖提及，但仅对自身来源保存指纹、撤回候选和版本。
    # 另一旧实体若共享该键，会漏掉它的旧事实/图库，不能把单源请求当作联合治理。
    for other in all_sources:
        if other.id in selected_ids or not set(keys) & source_keys(other):
            continue
        if selected is not None:
            raise ValueError('联合来源遗漏同名键的源地点，须完整覆盖')
        owner = current.catalog.resolve(place_id=other.id)
        if not owner or owner['entity_id'] != source_entity['entity_id']:
            raise ValueError('同名键涉及其他实体或未注册来源，须联合治理全部来源')
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
    by_mention_id = {row['id']: row for row in rows}
    exclusions = {a['mentionId']: validate_exclusion(a.get('exclusion'), by_mention_id[a['mentionId']], a['entityId'])
                  for a in supplied}
    fact_exclusions = {a['mentionId']: validate_fact_exclusions(a.get('factExclusions'), by_mention_id[a['mentionId']], a['entityId'])
                       for a in supplied}
    assigned_target_ids = {a['entityId'] for a in supplied if a['entityId']}
    if ('textWarnings' in decision and decision['textWarnings'] is None
        or old_scope and old_scope.get('text_warnings') and 'textWarnings' not in decision):
        raise ValueError('已有补充警告须完整列出，移除时显式提供空列表')
    warning_values = decision.get('textWarnings')
    warning_inputs = warning_refs([*(old_scope.get('text_warnings') or [] if old_scope else []),
                                  *([] if warning_values is None else warning_values)]) if isinstance(warning_values, (list, type(None))) else []
    warnings = validate_text_warnings(warning_values, city=city,
        notes=await load_warning_notes(session, warning_inputs), entities=current.catalog.entities,
        confirmed_ids=assigned_target_ids)
    new_entities = validate_creations(creations, rows, supplied, current.catalog,
        {key for p in all_sources for key in source_keys(p)})
    new_by_id = {e['entity_id']: e for e in new_entities}
    if new_entities:
        await lock_id_registry(session)
        for eid in new_by_id:
            if not await can_claim_id(session, eid, current.catalog, set()):
                raise ValueError('新实体ID已被现存或历史身份占用')
    target_ids = set(assigned_target_ids)
    source_entity_ids = set()
    for pid in selected_ids:
        owner = current.catalog.resolve(place_id=pid)
        if not owner:
            raise ValueError('联合来源尚未注册稳定身份')
        source_entity_ids.add(owner['entity_id'])
        target_ids.add(owner['entity_id'])
    # 先前目标也进入版本及回滚范围，重新分配不能漏掉失去语料的旧分店。
    target_ids.update((current.catalog.root(a['entity_id']) or {}).get('entity_id', a['entity_id'])
        for a in current.assignments.values() if a['scope_place_id'] == source_id and a['entity_id'])
    target_ids.update((current.catalog.root(eid) or {}).get('entity_id', eid)
        for eid in (old_scope.get('entity_ids', []) if old_scope else []))
    ids = sorted({source_entity['entity_id'], *target_ids})
    for eid in ids:
        target = current.catalog.entities.get(eid) or new_by_id.get(eid)
        pending_source = bool(target and selected is not None and target['status'] == 'REVIEW'
                              and eid in source_entity_ids and eid not in assigned_target_ids)
        if not target or target.get('redirect_to') or (target['status'] != 'ACTIVE' and not pending_source):
            raise ValueError('提及目标必须是本城有效现行实体')
    revisions = decision.get('expectedRevisions', {})
    if set(revisions) != set(ids) or any(revisions[eid] != (0 if eid in new_by_id else current.catalog.entities[eid]['revision']) for eid in ids):
        raise ValueError('提及目标版本过期或缺少受影响实体')
    if any(a['mention_id'] in {r['id'] for r in rows} and a['scope_place_id'] != source_id
           for a in current.assignments.values()):
        raise ValueError('提及已经属于另一受控来源，不能抢占')
    joint_ids = sorted(selected_ids) if selected is not None else None
    created_ids = sorted(new_by_id) if new_entities else None
    before = await scope_snapshot(session, city, source_id, keys, ids, joint_ids, created_ids, warning_inputs)
    if created_ids and before['createdEntityReviews']:
        raise ValueError('新实体ID已被历史审核引用')
    for entity in new_entities:
        await session.execute(insert(PlaceEntity).values(**entity))
    # 目标后来注册真实源，不代表它能继承整个泛名范围的其他候选。
    old_owners = current.withdrawal_owners(source_id) if old_scope else set()
    old_targets = {(current.catalog.root(eid) or {}).get('entity_id', eid)
                   for eid in (old_scope.get('entity_ids', []) if old_scope else [])} - old_owners
    values = dict(place_id=source_id, city=city, name_keys=keys, entity_ids=ids, source_hash=source_fingerprint(anchor_input),
        withdrawal_entity_ids=sorted(old_owners | (source_entity_ids - old_targets)),
        revision=(old_scope['revision'] + 1) if old_scope else 1, change_key=decision['key'], evidence=decision['evidence'],
        text_warnings=warnings)
    await session.execute(insert(PlaceIdentityScope).values(**values).on_conflict_do_update(
        index_elements=[PlaceIdentityScope.place_id], set_={k: v for k, v in values.items() if k != 'place_id'}))
    if selected is not None:
        await session.execute(delete(PlaceIdentityScopeSource).where(PlaceIdentityScopeSource.scope_place_id == source_id))
        for item in selected:
            await session.execute(insert(PlaceIdentityScopeSource).values(place_id=item['sourcePlaceId'],
                scope_place_id=source_id, source_hash=item['sourceHash']))
    await session.execute(delete(PlaceMentionAssignment).where(PlaceMentionAssignment.scope_place_id == source_id))
    for item in supplied:
        old = current.assignments.get(item['mentionId'])
        await session.execute(insert(PlaceMentionAssignment).values(mention_id=item['mentionId'],
            scope_place_id=source_id, entity_id=item['entityId'], input_hash=item['inputHash'],
            exclusion=exclusions[item['mentionId']],
            fact_exclusions=fact_exclusions[item['mentionId']],
            revision=(old['revision'] + 1) if old else 1, change_key=decision['key']))
    await session.execute(update(PlaceEntity).where(PlaceEntity.entity_id.in_(set(ids) - set(new_by_id)))
        .values(revision=PlaceEntity.revision + 1))
    await session.flush()
    await refresh_mention_reviews(session, city)
    if new_entities:
        catalog = await load_catalog(session, city)
        for entity in new_entities:
            for candidate in catalog.candidates(entity['canonical_name']):
                if candidate != entity['entity_id']:
                    pair = sorted([candidate, entity['entity_id']])
                    await enqueue_review(session, city, {'reason': 'similar_name', 'entityIds': pair,
                        'names': [catalog.entities[eid]['canonical_name'] for eid in pair]})
    after = await scope_snapshot(session, city, source_id, keys, ids, joint_ids, created_ids, warning_inputs)
    session.add(PlaceEntityChange(change_key=decision['key'], city=city, before=before, after=after,
        evidence=decision['evidence'], request=decision))
    await session.flush()
    return after


async def rollback_scope_decision(session, change: PlaceEntityChange) -> dict:
    source_id = change.request['sourcePlaceId']
    ids = [e['entity_id'] for e in change.after['entities']]
    keys = change.after['scopes'][0]['name_keys']
    created_ids = change.after.get('createdEntityIds')
    if created_ids:
        await lock_id_registry(session)
    current = await scope_snapshot(session, change.city, source_id, keys, ids, created_entity_ids=created_ids,
        text_warning_refs=change.after['inputs'].get('textWarnings'))
    if current != change.after:
        raise ValueError('提及、来源或实体已有后续修改，拒绝过期回滚')
    await session.execute(delete(PlaceMentionAssignment).where(PlaceMentionAssignment.scope_place_id == source_id))
    await session.execute(delete(PlaceIdentityScopeSource).where(PlaceIdentityScopeSource.scope_place_id == source_id))
    if change.before['scopes']:
        values = {'withdrawal_entity_ids': None, 'text_warnings': None, **change.before['scopes'][0]}
        await session.execute(update(PlaceIdentityScope).where(PlaceIdentityScope.place_id == source_id).values(**values))
    else:
        await session.execute(delete(PlaceIdentityScope).where(PlaceIdentityScope.place_id == source_id))
    for member in change.before.get('scopeSources', []):
        await session.execute(insert(PlaceIdentityScopeSource).values(**member))
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
    if created_ids:
        for row in change.after['createdEntityReviews']:
            await session.execute(delete(PlaceEntityReview).where(PlaceEntityReview.id == row['id']))
        await session.execute(delete(PlaceEntity).where(PlaceEntity.entity_id.in_(created_ids)))
    change.rolled_back = True
    await session.flush()
    return change.before
