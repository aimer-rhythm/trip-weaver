"""关系来源声明：普通新提及推进关系快照，不要求人工提升实体版本。"""
from __future__ import annotations

from app.clean.mention_identity import MentionIdentityCatalog, digest, mention_fingerprint
from app.clean.mention_relations import mine_mention_relations, relation_surfaces


def build_relation_snapshot(catalog: MentionIdentityCatalog, rows: list[dict], *,
                            extra_surfaces=(), min_mentions: int = 2) -> dict:
    """同一份内存输入同时生成来源和图；不包含会滚动的导出日期、签名URL。"""
    mined = mine_mention_relations(catalog, rows, extra_surfaces=extra_surfaces, min_mentions=min_mentions)
    managed = catalog.managed_entity_ids()
    sources = []
    for row in sorted(rows, key=lambda r: r['id']):
        result = catalog.resolve(row)
        entity = result.get('entity')
        text = f"{row.get('note_title') or ''}\n{row.get('note_desc') or ''}"
        sources.append({'mentionId': row['id'], 'noteId': row['raw_note_id'], 'inputHash': mention_fingerprint(row),
            'textHash': digest(['relation_text', text]), 'textLength': len(text),
            'entityId': entity['entity_id'] if entity else None, 'revision': entity['revision'] if entity else None,
            'status': result['status'], 'reason': result['reason']})
    state = {'city': catalog.catalog.city, 'algorithmVersion': 3, 'minMentions': min_mentions,
        'surfaces': relation_surfaces(catalog, rows, extra_surfaces), 'mentions': sources,
        'entities': [{'entityId': e['entity_id'], 'revision': e['revision'], 'canonicalName': e['canonical_name'],
            'aliases': sorted(set(e.get('aliases', []))), 'status': e['status'], 'redirectTo': e.get('redirect_to'),
            'managed': e['entity_id'] in managed}
            for _, e in sorted(catalog.catalog.entities.items())]}
    supplemental = catalog.supplemental_sources()
    if supplemental:
        state['supplementalSources'] = supplemental
    return {'version': 1, 'sourceHash': digest(state), 'relationHash': digest(mined['relations']),
        'sourceState': state, **mined}
