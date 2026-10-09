"""只读加载警告的现有笔记文字和来源元数据。"""
from __future__ import annotations

from sqlalchemy import select

from app.models import RawNote
from app.clean.note_text_warnings import warning_input, warning_refs


async def load_warning_notes(session, refs: list[dict]) -> dict[int, dict]:
    ids = {ref['noteId'] for ref in refs}
    if not ids:
        return {}
    rows = (await session.scalars(select(RawNote).where(RawNote.id.in_(ids)))).all()
    return {n.id: {'city': n.city, 'title': n.title, 'desc': n.desc, 'images': n.img_analysis,
        'unavailable': n.status in ('DELETED', 'PRIVATE'), 'sourceUrl': n.source_url or '',
        'observedAt': n.created_at.isoformat() if n.created_at else None,
        'publishedAt': n.publish_time.isoformat() if n.publish_time else None} for n in rows}


async def snapshot_warning_inputs(session, refs: list[dict]) -> list[dict]:
    notes = await load_warning_notes(session, refs)
    return [warning_input(v['noteId'], v['imageIndex'], notes.get(v['noteId'])) for v in warning_refs(refs)]
