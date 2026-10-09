"""受控图片只能沿逐图分配解析；不覆盖原有模型审核，也不按整本相册推断。"""
from __future__ import annotations

import copy

from app.clean.mention_identity import digest


def image_fingerprint(row: dict) -> str:
    return digest({key: row.get(key) for key in ('image_key', 'city', 'source_place_id', 'note_id',
        'raw_note_id', 'image_index', 'source_sha256', 'source_identity', 'review', 'note_text', 'unavailable')})


class ImageIdentityCatalog:
    def __init__(self, mentions, assignments: list[dict], controlled_note_ids: set[int]):
        self.mentions = mentions
        self.assignments = {a['image_key']: copy.deepcopy(a) for a in assignments}
        self.controlled_note_ids = controlled_note_ids

    def controlled(self, row: dict) -> bool:
        source = self.mentions.catalog.resolve(place_id=row['source_place_id']) if row.get('source_place_id') else None
        return (row['image_key'] in self.assignments or row.get('raw_note_id') in self.controlled_note_ids
                or bool(source and source['entity_id'] in self.mentions.managed_entity_ids()))

    def resolve(self, row: dict) -> dict:
        if row['city'] != self.mentions.catalog.city or row.get('unavailable') or not row.get('source_sha256'):
            return {'status': 'unresolved', 'reason': 'unavailable_image'}
        assignment = self.assignments.get(row['image_key'])
        if assignment:
            if assignment['input_hash'] != image_fingerprint(row):
                return {'status': 'review', 'reason': 'changed_image'}
            entity = self.mentions.catalog.root(assignment['entity_id']) if assignment['entity_id'] else None
            if not entity or entity['status'] != 'ACTIVE':
                return {'status': 'review', 'reason': 'unassigned_image'}
            return {'status': 'resolved', 'entity': entity, 'binding': {
                'imageKey': row['image_key'], 'inputHash': assignment['input_hash'],
                'sourceSha256': row['source_sha256'],
                'assignmentRevision': assignment['revision'], 'entityId': entity['entity_id']}}
        if self.controlled(row):
            return {'status': 'review', 'reason': 'unreviewed_image'}
        entity = self.mentions.catalog.resolve(place_id=row['source_place_id']) if row.get('source_place_id') else None
        if not entity or entity['status'] != 'ACTIVE':
            return {'status': 'unresolved', 'reason': 'unregistered_source'}
        return {'status': 'resolved', 'entity': entity}

    def policies(self, rows: list[dict]) -> dict[str, dict]:
        policies = {eid: {'version': 1, 'mode': 'reviewed', 'entityId': eid,
            'revision': self.mentions.catalog.entities[eid]['revision'], 'approved': []}
            for eid in self.mentions.managed_entity_ids()}
        for row in rows:
            result = self.resolve(row)
            if result.get('binding') and result['entity']['entity_id'] in policies:
                policies[result['entity']['entity_id']]['approved'].append(result['binding'])
        for policy in policies.values():
            policy['approved'].sort(key=lambda item: item['imageKey'])
        return policies
