"""逐提及身份解析：原始文字不改写，受控来源的新证据不自动继承旧身份。"""
from __future__ import annotations

import copy
import hashlib
import json

from app.clean.identity import IdentityCatalog, name_key


MENTION_FIELDS = ('id', 'raw_note_id', 'name', 'normalized_name', 'place_type', 'mention_type',
                  'sentiment', 'reason', 'evidence_text', 'route_order', 'confidence', 'fact_type', 'fact_value')
NOTE_FIELDS = ('note_city', 'note_title', 'note_desc', 'note_images', 'note_unavailable')


def digest(value) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                    separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def mention_fingerprint(row: dict) -> str:
    """哈希原始事实及当时正文/图文；访问URL和互动计数变化不影响证据。"""
    return digest({key: row.get(key) for key in (*MENTION_FIELDS, *NOTE_FIELDS)})


def source_fingerprint(row: dict) -> str:
    return digest({key: row.get(key) for key in ('id', 'city', 'name', 'normalized_name')})


def scope_matches(scope: dict, row: dict) -> bool:
    return row.get('note_city') == scope['city'] and bool(set(scope['name_keys']) & {
        name_key(row.get('name') or ''), name_key(row.get('normalized_name') or '')})


class MentionIdentityCatalog:
    def __init__(self, catalog: IdentityCatalog, scopes: list[dict], assignments: list[dict]):
        self.catalog = catalog
        self.scopes = {int(s['place_id']): copy.deepcopy(s) for s in scopes if s['city'] == catalog.city}
        self.source_scopes = {}
        for pid, scope in self.scopes.items():
            for source in scope.get('source_members', [{'place_id': pid}]):
                source_id = int(source['place_id'])
                if source_id in self.source_scopes and self.source_scopes[source_id] != pid:
                    raise ValueError('源地点被多个治理范围占用')
                self.source_scopes[source_id] = pid
        self.assignments = {int(a['mention_id']): copy.deepcopy(a) for a in assignments
                            if int(a['scope_place_id']) in self.scopes}

    def matching_scopes(self, row: dict) -> list[int]:
        return sorted(pid for pid, scope in self.scopes.items() if scope_matches(scope, row))

    def scope_for_source(self, source_id: int) -> dict | None:
        return self.scopes.get(self.source_scopes.get(source_id))

    def resolve(self, row: dict) -> dict:
        if row.get('note_city') != self.catalog.city or row.get('note_unavailable'):
            return {'status': 'unresolved', 'reason': 'unavailable_source', 'scopePlaceIds': []}
        assignment = self.assignments.get(int(row['id']))
        matches = self.matching_scopes(row)
        if assignment:
            # 明确分配在文字变化后也不能退回名称解析，必须重新审核。
            pid = int(assignment['scope_place_id'])
            entity = self.catalog.root(assignment['entity_id']) if assignment['entity_id'] else None
            if assignment['input_hash'] != mention_fingerprint(row):
                return {'status': 'review', 'reason': 'changed_input', 'scopePlaceIds': sorted(set([pid, *matches]))}
            if not self.scopes[pid].get('source_valid', True):
                return {'status': 'review', 'reason': 'changed_source', 'scopePlaceIds': [pid]}
            if not entity or entity['status'] != 'ACTIVE':
                return {'status': 'review', 'reason': 'unassigned_target', 'scopePlaceIds': [pid]}
            return {'status': 'resolved', 'reason': 'reviewed_assignment', 'entity': entity, 'scopePlaceIds': [pid]}
        if matches:
            return {'status': 'review', 'reason': 'unreviewed_mention', 'scopePlaceIds': matches}
        entity = self.catalog.resolve(row.get('name') or '')
        if entity and entity['status'] == 'ACTIVE':
            return {'status': 'resolved', 'reason': 'confirmed_name', 'entity': entity, 'scopePlaceIds': []}
        return {'status': 'unresolved', 'reason': 'unregistered_or_ambiguous', 'scopePlaceIds': []}

    def managed_entity_ids(self) -> set[str]:
        ids = {self.catalog.members.get(pid) for pid in self.source_scopes}
        ids.update(a['entity_id'] for a in self.assignments.values())
        ids.update(eid for scope in self.scopes.values() for eid in scope.get('entity_ids', []))
        return {entity['entity_id'] for eid in ids if eid and (entity := self.catalog.root(eid))}
