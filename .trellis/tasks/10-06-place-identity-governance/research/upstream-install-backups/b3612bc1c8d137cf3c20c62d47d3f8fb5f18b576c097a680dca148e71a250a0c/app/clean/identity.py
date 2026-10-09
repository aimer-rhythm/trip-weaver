"""无损名称键与实体目录；相似度仅产生待审候选，不代表实体相等。"""
from __future__ import annotations

import copy
import hashlib
import re
import unicodedata
from collections import defaultdict
from difflib import SequenceMatcher


def name_key(name: str) -> str:
    return re.sub(r'\s+', '', unicodedata.normalize('NFKC', name)).lower()


def legacy_id(city: str, name: str) -> str:
    return hashlib.sha256(f'{city}{name}'.encode()).hexdigest()[:32]


class IdentityCatalog:
    def __init__(self, city: str, entities: list[dict], members: list[dict], reviews: list[dict] | None = None):
        self.city = city
        self.entities = {e['entity_id']: copy.deepcopy(e) for e in entities if e['city'] == city}
        self.members = {int(m['place_id']): m['entity_id'] for m in members if m['entity_id'] in self.entities}
        self.names: dict[str, set[str]] = defaultdict(set)
        for entity in self.entities.values():
            if entity.get('redirect_to'):
                continue
            for name in [entity['canonical_name'], *entity.get('aliases', [])]:
                self.names[name_key(name)].add(entity['entity_id'])
        self.distinct_pairs = set()
        for review in reviews or []:
            assessment = review.get('assessment', {})
            if assessment.get('verdict') not in ('distinct', 'part_of'):
                continue
            roots = [self.root(eid) for eid in review.get('entityIds', [])]
            if len(roots) == 2 and all(roots):
                self.distinct_pairs.add(frozenset(e['entity_id'] for e in roots))

    def root(self, entity_id: str) -> dict | None:
        seen = set()
        while entity_id in self.entities:
            if entity_id in seen:
                return None
            seen.add(entity_id)
            entity = self.entities[entity_id]
            if not entity.get('redirect_to'):
                return entity
            entity_id = entity['redirect_to']
        return None

    def resolve(self, name: str = '', *, place_id: int | None = None, entity_id: str | None = None) -> dict | None:
        if place_id is not None:
            entity_id = self.members.get(int(place_id))
            return self.root(entity_id) if entity_id else None
        if entity_id is not None:
            return self.root(entity_id)
        candidates = self.names.get(name_key(name), set())
        return self.root(next(iter(candidates))) if len(candidates) == 1 else None

    def candidates(self, name: str) -> list[str]:
        key = name_key(name)
        # 去后缀只用于召回审核对象；括号和子项不会被这个键判成同一实体。
        stem = re.sub(r'(风景名胜区|旅游景区|博物馆|博物院|风景区|景区|公园)$', '', key)
        found = set(self.names.get(key, set()))
        for candidate, ids in self.names.items():
            other = re.sub(r'(风景名胜区|旅游景区|博物馆|博物院|风景区|景区|公园)$', '', candidate)
            if (len(stem) >= 2 and stem == other) or (min(len(key), len(candidate)) >= 3
                    and SequenceMatcher(None, key, candidate).ratio() >= .78):
                found.update(ids)
        return sorted(found)

    def contract(self, entity: dict) -> dict:
        return {'version': 2, 'entityId': entity['entity_id'], 'canonicalName': entity['canonical_name'],
            'revision': entity['revision'], 'kind': 'same_entity',
            'memberNames': list(dict.fromkeys([entity['canonical_name'], *entity['aliases']])),
            'memberIds': list(dict.fromkeys([entity['entity_id'], *entity['legacy_ids']]))}
