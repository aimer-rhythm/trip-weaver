"""逐提及身份解析：原始文字不改写，受控来源的新证据不自动继承旧身份。"""
from __future__ import annotations

import copy
import hashlib
import json
import math

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


def validate_exclusion(value, row: dict, entity_id) -> dict | None:
    """只校验证据绑定，不按菜名词表推断非地点；旧空目标继续待审。"""
    if value is None:
        return None
    if (not isinstance(value, dict) or set(value) != {'reason', 'quote'}
        or value['reason'] != 'not_a_place' or entity_id is not None):
        raise ValueError('非地点排除须为空目标和明确的not_a_place理由及原文摘录')
    quote = value['quote']
    if (row.get('note_unavailable') or not isinstance(quote, str) or not quote.strip() or len(quote) > 2048
        or not any(quote in (row.get(field) or '') for field in ('note_title', 'note_desc'))):
        raise ValueError('非地点排除摘录须来自当前可用原文')
    quoted = name_key(quote)
    if not any(name_key(row.get(field) or '') and name_key(row.get(field) or '') in quoted
               for field in ('name', 'normalized_name')):
        raise ValueError('非地点排除摘录未对应当前提及主体')
    return copy.deepcopy(value)


def validate_fact_exclusions(value, row: dict, entity_id) -> dict | None:
    """字段审核不改变实体身份；首版仅支持排除误归单点的组合时长。"""
    if value is None:
        return None
    if (not isinstance(value, dict) or set(value) != {'visit_duration'}
        or not isinstance(entity_id, str) or not entity_id.strip()):
        raise ValueError('事实排除须提供明确实体目标，且仅支持visit_duration')
    decision = value['visit_duration']
    if (not isinstance(decision, dict) or set(decision) != {'reason', 'quote'}
        or decision['reason'] != 'group_duration'):
        raise ValueError('时长排除须提供group_duration理由和原文摘录')
    facts = row.get('fact_value')
    minutes = facts.get('minutes') if isinstance(facts, dict) else None
    if row.get('fact_type') != 'visit_duration' or type(minutes) not in (int, float) or not math.isfinite(minutes) or minutes <= 0:
        raise ValueError('当前提及没有可审核的游览时长')
    quote = decision['quote']
    if (row.get('note_unavailable') or not isinstance(quote, str) or not quote.strip() or len(quote) > 2048
        or not any(quote in (row.get(field) or '') for field in ('note_title', 'note_desc'))):
        raise ValueError('时长排除摘录须来自当前可用原文')
    quoted = name_key(quote)
    if not any(name_key(row.get(field) or '') and name_key(row.get(field) or '') in quoted
               for field in ('name', 'normalized_name')):
        raise ValueError('时长排除摘录未对应当前提及主体')
    return copy.deepcopy(value)


def effective_fact_value(row: dict, resolution: dict) -> dict:
    """只创建消费投影；原始行及mention_fingerprint始终保持原样。"""
    if resolution.get('status') in ('review', 'excluded'):
        return {}
    facts = copy.deepcopy(row.get('fact_value')) if isinstance(row.get('fact_value'), dict) else {}
    if 'visit_duration' in (resolution.get('factExclusions') or {}):
        facts.pop('minutes', None)
    return facts


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

    def withdrawal_owners(self, scope_id: int) -> set[str]:
        scope = self.scopes[scope_id]
        ids = scope.get('withdrawal_entity_ids')
        if ids is None:
            ids = [self.catalog.members.get(pid) for pid, sid in self.source_scopes.items() if sid == scope_id]
        return {entity['entity_id'] for eid in ids if eid and (entity := self.catalog.root(eid))}

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
            try:
                fact_exclusions = validate_fact_exclusions(assignment.get('fact_exclusions'), row, assignment['entity_id'])
            except ValueError:
                return {'status': 'review', 'reason': 'invalid_fact_exclusions', 'scopePlaceIds': [pid]}
            if assignment.get('exclusion') is not None:
                try:
                    validate_exclusion(assignment['exclusion'], row, assignment['entity_id'])
                except ValueError:
                    return {'status': 'review', 'reason': 'invalid_exclusion', 'scopePlaceIds': [pid]}
                return {'status': 'excluded', 'reason': 'reviewed_non_place', 'scopePlaceIds': [pid]}
            if not entity or entity['status'] != 'ACTIVE':
                return {'status': 'review', 'reason': 'unassigned_target', 'scopePlaceIds': [pid]}
            result = {'status': 'resolved', 'reason': 'reviewed_assignment', 'entity': entity, 'scopePlaceIds': [pid]}
            if fact_exclusions is not None:
                result['factExclusions'] = fact_exclusions
            return result
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
