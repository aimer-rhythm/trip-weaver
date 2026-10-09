"""加载两类图片原始证据、逐图版本化分配及保守回滚；调用方提交事务。"""
from __future__ import annotations

import hashlib
from pathlib import Path

from sqlalchemy import delete, select, update
from sqlalchemy.dialects.postgresql import insert

from app.aggregate.mention_identity import load_mention_catalog, load_mention_rows, scope_snapshot
from app.aggregate.place_identity import enqueue_review, lock_city, review_state, snapshot
from app.clean.image_identity import ImageIdentityCatalog, image_fingerprint
from app.clean.mention_identity import digest
from app.models import CanonicalPlace, NoteImage, PlaceEntity, PlaceEntityChange, PlaceEntityReview, PlaceImageAssignment, RawNote
from app.photography.store import PhotoStore

IMAGE_ASSIGNMENT_FIELDS = ('city', 'image_key', 'source_place_id', 'entity_id', 'input_hash',
                           'revision', 'change_key', 'evidence')
SOURCE_ROOT = Path(__file__).resolve().parents[2]
PHOTOGRAPHY_ROOT = SOURCE_ROOT / 'data' / 'photography'


def file_hash(root: Path, path: str) -> str | None:
    target = (root / path).resolve()
    if not target.is_relative_to(root.resolve()):
        return None
    try:
        return hashlib.sha256(target.read_bytes()).hexdigest()
    except OSError:
        return None


async def load_image_rows(session, city: str, *, source_root: Path = SOURCE_ROOT,
                          photography_root: Path = PHOTOGRAPHY_ROOT) -> list[dict]:
    source_root, photography_root = source_root.resolve(), photography_root.resolve()
    places = (await session.scalars(select(CanonicalPlace).where(CanonicalPlace.city == city))).all()
    sources = {p.id: {k: getattr(p, k) for k in ('id', 'city', 'name', 'normalized_name')} for p in places}
    images = (await session.execute(select(NoteImage, RawNote).join(RawNote, RawNote.id == NoteImage.raw_note_id)
        .where(NoteImage.city == city, RawNote.city == city).order_by(NoteImage.id))).all()
    rows = []
    for photo, note in images:
        rows.append({'image_key': f'note_image:{photo.id}', 'city': city, 'source_place_id': photo.canonical_place_id,
            'raw_note_id': note.id, 'note_id': note.note_id, 'image_index': photo.img_index,
            'source_sha256': file_hash(source_root, photo.file_path), 'source_identity': sources.get(photo.canonical_place_id),
            'file_path': photo.file_path, 'review': {'img_type': photo.img_type, 'assignment': photo.assignment},
            'note_text': [note.title, note.desc, note.img_analysis],
            'unavailable': note.status in ('DELETED', 'PRIVATE') or photo.img_type != 'scenery'})
    store = PhotoStore(photography_root, city)
    if not store.path('selected.json').exists():
        return rows
    with store.locked():
        selected = store.read('selected.json')
        if selected.get('city') != city:
            raise ValueError('摄影清单城市不一致')
        curated = {}
        for group in selected['places'].values():
            place = group['place']
            for item in group['images']:
                key = f"photography:{item['note_id']}:{item['image_index']}"
                content_hash = file_hash(photography_root, str(store.path(item['file'])))
                row = {'image_key': key, 'city': city, 'source_place_id': item['place_id'],
                    'raw_note_id': None, 'note_id': item['note_id'], 'image_index': item['image_index'],
                    'source_sha256': content_hash, 'source_identity': sources.get(item['place_id']),
                    'file_path': str(store.path(item['file'])), 'review': item['review'], 'note_text': None,
                    'unavailable': (not content_hash or content_hash != item['sha256']
                        or item['place_id'] != place['id'] or item['review'].get('status') != 'eligible'
                        or item['review'].get('identity') != 'match' or item['review_method'] != 'model')}
                if key in curated and image_fingerprint(curated[key]) != image_fingerprint(row):
                    raise ValueError('同一原笔记图片在精选库有冲突主体，须先复核')
                curated[key] = row
        rows.extend(curated.values())
    return sorted(rows, key=lambda row: row['image_key'])


async def load_image_catalog(session, city: str, mentions=None) -> ImageIdentityCatalog:
    mentions = mentions or await load_mention_catalog(session, city)
    assignments = (await session.scalars(select(PlaceImageAssignment).where(PlaceImageAssignment.city == city))).all()
    controlled_notes = {row['raw_note_id'] for row in await load_mention_rows(session, city)
        if row['id'] in mentions.assignments or mentions.matching_scopes(row)}
    return ImageIdentityCatalog(mentions, [{k: getattr(a, k) for k in IMAGE_ASSIGNMENT_FIELDS} for a in assignments],
                                controlled_notes)


async def image_snapshot(session, city: str, keys: list[str], ids: list[str], rows: list[dict]) -> dict:
    state = await snapshot(session, city, ids)
    assignments = (await session.scalars(select(PlaceImageAssignment).where(PlaceImageAssignment.city == city,
        PlaceImageAssignment.image_key.in_(keys)).order_by(PlaceImageAssignment.image_key))).all()
    state['imageAssignments'] = [{k: getattr(a, k) for k in IMAGE_ASSIGNMENT_FIELDS} for a in assignments]
    state['imageInputs'] = [{'imageKey': row['image_key'], 'inputHash': image_fingerprint(row)}
                           for row in rows if row['image_key'] in keys]
    reviews = (await session.scalars(select(PlaceEntityReview).where(PlaceEntityReview.city == city,
        PlaceEntityReview.detail['reason'].astext == 'image_scope').order_by(PlaceEntityReview.id))).all()
    state['imageReviews'] = [review_state(review) for review in reviews]
    mentions = await load_mention_catalog(session, city)
    state['relatedScopes'] = [await scope_snapshot(session, city, pid, scope['name_keys'], scope['entity_ids'])
        for pid, scope in sorted(mentions.scopes.items())
        if any((mentions.catalog.root(eid) or {}).get('entity_id') in ids for eid in scope['entity_ids'])]
    return state


async def refresh_image_reviews(session, city: str, *, source_root: Path = SOURCE_ROOT,
                                photography_root: Path = PHOTOGRAPHY_ROOT) -> dict:
    """已有scope才扫描图库；审核清单稳定入队，来源变化和缺失文件保留待核。"""
    await lock_city(session, city)
    catalog = await load_image_catalog(session, city)
    if not catalog.mentions.managed_entity_ids():
        return {'controlled': 0, 'pending': 0}
    rows = await load_image_rows(session, city, source_root=source_root, photography_root=photography_root)
    pending = set()
    controlled = 0
    for row in rows:
        if not catalog.controlled(row):
            continue
        controlled += 1
        result = catalog.resolve(row)
        if result['status'] == 'resolved':
            continue
        fingerprint = image_fingerprint(row)
        pending.add((row['image_key'], fingerprint))
        await enqueue_review(session, city, {'reason': 'image_scope', 'imageKey': row['image_key'],
            'inputHash': fingerprint, 'statusReason': result['reason']})
    present = {row['image_key'] for row in rows}
    for key, assignment in catalog.assignments.items():
        if key in present:
            continue
        fingerprint = digest(['missing_image', key, assignment['input_hash']])
        pending.add((key, fingerprint))
        await enqueue_review(session, city, {'reason': 'image_scope', 'imageKey': key,
            'inputHash': fingerprint, 'statusReason': 'missing_image'})
    existing = (await session.scalars(select(PlaceEntityReview).where(PlaceEntityReview.city == city,
        PlaceEntityReview.detail['reason'].astext == 'image_scope'))).all()
    for review in existing:
        review.status = 'PENDING' if (review.detail['imageKey'], review.detail['inputHash']) in pending else 'RESOLVED'
    await session.flush()
    return {'controlled': controlled, 'pending': len(pending)}


async def apply_image_decision(session, decision: dict, *, source_root: Path = SOURCE_ROOT,
                               photography_root: Path = PHOTOGRAPHY_ROOT) -> dict:
    city = decision['city']
    supplied = decision.get('images')
    if (not decision.get('evidence') or not isinstance(supplied, list) or not supplied
        or any(not isinstance(a, dict) or not isinstance(a.get('imageKey'), str) or 'entityId' not in a
               or type(a.get('expectedRevision')) is not int for a in supplied)):
        raise ValueError('图片治理须逐图提供来源、目标或null、旧版本与证据')
    keys = [a['imageKey'] for a in supplied]
    if len(keys) != len(set(keys)):
        raise ValueError('同一张图不能分配两次')
    await lock_city(session, city)
    previous = await session.scalar(select(PlaceEntityChange).where(PlaceEntityChange.change_key == decision['key']))
    if previous:
        if previous.request != decision or previous.rolled_back:
            raise ValueError('图片治理key已使用或已回滚')
        return previous.after
    catalog = await load_image_catalog(session, city)
    rows = await load_image_rows(session, city, source_root=source_root, photography_root=photography_root)
    by_key = {row['image_key']: row for row in rows}
    ids = set()
    for item in supplied:
        row = by_key.get(item['imageKey'])
        if not row or row['unavailable'] or not row['source_sha256'] or item.get('inputHash') != image_fingerprint(row):
            raise ValueError('图片不存在、不可用或原文件/来源已变化')
        if not catalog.controlled(row):
            raise ValueError('图片来源未纳入逐提及治理范围')
        previous = catalog.assignments.get(item['imageKey'])
        if item['expectedRevision'] != (previous['revision'] if previous else 0):
            raise ValueError('图片分配版本已变化')
        target_id = item['entityId']
        if target_id is not None:
            if not isinstance(target_id, str) or target_id not in catalog.mentions.managed_entity_ids():
                raise ValueError('图片目标必须是本城已纳入治理的现行实体')
            entity = catalog.mentions.catalog.entities[target_id]
            if entity['status'] != 'ACTIVE' or entity.get('redirect_to'):
                raise ValueError('图片目标不是有效现行实体')
            ids.add(target_id)
        if row.get('source_place_id'):
            source = catalog.mentions.catalog.resolve(place_id=row['source_place_id'])
            if source:
                ids.add(source['entity_id'])
        if previous and previous['entity_id']:
            ids.add(catalog.mentions.catalog.root(previous['entity_id'])['entity_id'])
    revisions = decision.get('expectedRevisions', {})
    if not ids or set(revisions) != ids or any(revisions[eid] != catalog.mentions.catalog.entities[eid]['revision'] for eid in ids):
        raise ValueError('图片治理缺少受影响实体版本或版本过期')
    projected = {**catalog.assignments, **{item['imageKey']: {
        'entity_id': item['entityId'], 'input_hash': item['inputHash']} for item in supplied}}
    owners = {}
    for row in rows:
        assignment = projected.get(row['image_key'])
        if not assignment or not assignment['entity_id'] or assignment['input_hash'] != image_fingerprint(row):
            continue
        entity = catalog.mentions.catalog.root(assignment['entity_id'])
        if not entity:
            continue
        for photo in [('note', row['note_id'], row['image_index']), ('bytes', row['source_sha256'])]:
            if photo in owners and owners[photo] != entity['entity_id']:
                raise ValueError('同一原笔记图片或相同文件不能分配给两个实体')
            owners[photo] = entity['entity_id']
    ids = sorted(ids)
    before = await image_snapshot(session, city, keys, ids, rows)
    for item in supplied:
        previous = catalog.assignments.get(item['imageKey'])
        values = dict(city=city, image_key=item['imageKey'], source_place_id=by_key[item['imageKey']]['source_place_id'],
            entity_id=item['entityId'], input_hash=item['inputHash'], revision=(previous['revision'] + 1) if previous else 1,
            change_key=decision['key'], evidence=decision['evidence'])
        await session.execute(insert(PlaceImageAssignment).values(**values).on_conflict_do_update(
            constraint='uq_place_image_assignment_key', set_=values))
    await session.execute(update(PlaceEntity).where(PlaceEntity.entity_id.in_(ids)).values(revision=PlaceEntity.revision + 1))
    await session.flush()
    await refresh_image_reviews(session, city, source_root=source_root, photography_root=photography_root)
    after = await image_snapshot(session, city, keys, ids, rows)
    session.add(PlaceEntityChange(change_key=decision['key'], city=city, before=before, after=after,
        evidence=decision['evidence'], request=decision))
    await session.flush()
    return after


async def rollback_image_decision(session, change, *, source_root: Path = SOURCE_ROOT,
                                  photography_root: Path = PHOTOGRAPHY_ROOT) -> dict:
    keys = [a['imageKey'] for a in change.request['images']]
    ids = [e['entity_id'] for e in change.after['entities']]
    rows = await load_image_rows(session, change.city, source_root=source_root, photography_root=photography_root)
    if await image_snapshot(session, change.city, keys, ids, rows) != change.after:
        raise ValueError('图片、文件或关联实体已有后续修改，拒绝过期回滚')
    await session.execute(delete(PlaceImageAssignment).where(PlaceImageAssignment.city == change.city,
        PlaceImageAssignment.image_key.in_(keys)))
    for assignment in change.before['imageAssignments']:
        await session.execute(insert(PlaceImageAssignment).values(**assignment))
    for entity in change.before['entities']:
        await session.execute(update(PlaceEntity).where(PlaceEntity.entity_id == entity['entity_id']).values(**entity))
    old_reviews = {row['id']: row for row in change.before['imageReviews']}
    for row in change.after['imageReviews']:
        if row['id'] not in old_reviews:
            await session.execute(delete(PlaceEntityReview).where(PlaceEntityReview.id == row['id']))
    for row in old_reviews.values():
        await session.execute(update(PlaceEntityReview).where(PlaceEntityReview.id == row['id'])
            .values(status=row['status'], detail=row['detail']))
    change.rolled_back = True
    await session.flush()
    return change.before
