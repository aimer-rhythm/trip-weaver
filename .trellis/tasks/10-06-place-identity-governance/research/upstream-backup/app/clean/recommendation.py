"""按当前实体提及计算推荐分；重复提及ID只计一次，笔记来源去重。"""
from __future__ import annotations


def recommendation_metrics(rows: list[dict]) -> dict:
    unique = {row['id']: row for row in rows}
    total = len(unique)
    positive = sum(row['mention_type'] == 'recommend' for row in unique.values())
    notes = len({row['raw_note_id'] for row in unique.values()})
    return {'mentionCount': total,
            'recommendScore': round(total * 2 + positive / max(total, 1) * 5 + notes * .5, 2)}
