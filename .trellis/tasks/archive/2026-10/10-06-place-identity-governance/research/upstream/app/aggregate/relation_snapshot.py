"""城市锁内发布完整关系快照；修订号只增，治理回滚也不能复用旧发布号。"""
from __future__ import annotations

import copy
from datetime import date
from pathlib import Path

from sqlalchemy import select, text

from app.aggregate.mention_identity import load_mention_catalog, load_mention_rows
from app.aggregate.place_identity import lock_city
from app.clean.relation_snapshot import build_relation_snapshot
from app.models import CanonicalPlace, PlaceRelationSnapshot


async def publish_relation_snapshot(session, city: str, *, min_mentions: int | None = None) -> dict:
    """调用者开启 REPEATABLE READ 事务并负责提交；导出失败只能留下未消费的新版本。

    places 与 relations 使用同一个发布器；当前来源没变时复用同一个版本。
    未提供门槛时沿用已发布门槛，首次为2。修改门槛也推进版本。
    """
    isolation = (await session.execute(text('SHOW transaction_isolation'))).scalar_one()
    if isolation not in ('repeatable read', 'serializable'):
        raise ValueError('关系发布必须使用 REPEATABLE READ 或 SERIALIZABLE 事务')
    await lock_city(session, city)
    previous = await session.scalar(select(PlaceRelationSnapshot).where(PlaceRelationSnapshot.city == city)
        .with_for_update().execution_options(populate_existing=True))
    catalog = await load_mention_catalog(session, city)
    rows = await load_mention_rows(session, city)
    sources = (await session.execute(select(CanonicalPlace.name, CanonicalPlace.normalized_name)
        .where(CanonicalPlace.city == city))).all()
    threshold = min_mentions if min_mentions is not None else (
        previous.payload['sourceState']['minMentions'] if previous else 2)
    snapshot = build_relation_snapshot(catalog, rows,
        extra_surfaces=[name for source in sources for name in source], min_mentions=threshold)
    unchanged = previous and all(previous.payload[key] == snapshot[key] for key in ('sourceHash', 'relationHash'))
    revision = previous.revision if unchanged else previous.revision + 1 if previous else 1
    snapshot['revision'] = revision
    if not unchanged:
        if previous:
            previous.revision = revision
            previous.payload = snapshot
        else:
            session.add(PlaceRelationSnapshot(city=city, revision=revision, payload=snapshot))
        await session.flush()
    return copy.deepcopy(snapshot)


def relation_manifest(snapshot: dict) -> dict:
    return {key: copy.deepcopy(snapshot[key]) for key in
            ('version', 'revision', 'sourceHash', 'relationHash', 'sourceState')}


def relation_export_path(places_path: Path) -> Path:
    name = places_path.name
    return places_path.with_name(name.replace('xhs-places', 'xhs-place-relations', 1)
        if name.startswith('xhs-places') else f'xhs-place-relations-{name}')


def relation_document(snapshot: dict) -> dict:
    return {'city': snapshot['sourceState']['city'], 'generatedAt': date.today().isoformat(),
        'count': len(snapshot['relations']), 'relationIdentity': relation_manifest(snapshot),
        'relations': copy.deepcopy(snapshot['relations'])}
