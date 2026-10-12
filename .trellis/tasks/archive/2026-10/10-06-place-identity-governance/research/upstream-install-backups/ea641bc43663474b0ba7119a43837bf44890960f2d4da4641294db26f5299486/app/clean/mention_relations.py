"""从原文位置生成无向实体关系；不通过名字为受控提及补身份。"""
from __future__ import annotations

from collections import defaultdict
import re

from app.clean.alias import _ALIAS_MAP
from app.clean.identity import name_key
from app.clean.mention_identity import NOTE_FIELDS, MentionIdentityCatalog, digest, mention_fingerprint
from app.clean.relation_text import MAX_GAP, _find_mentions, _is_related, _pair_key

# 仅识别原文中的设施限定作为障碍，不创建实体或把它认作母项别名。
_FACILITY = r'(?:[东西南北]{1,2}门|正门|侧门|门口|出入口|入口|出口|游客中心|停车场|售票处)'
_FACILITY_SUFFIX = re.compile(r'[ \t]*(?:[（(]' + _FACILITY + r'[）)]|' + _FACILITY + r')')


def _text_hits(text: str, vocab: list[tuple[str, str]]) -> list[tuple[int, int, str]]:
    hits = _find_mentions(text, vocab)
    barriers = set()
    for start, end, _ in hits:
        suffix = _FACILITY_SUFFIX.match(text, end)
        if suffix:
            barriers.add(text[start:suffix.end()])
    if not barriers:
        return hits
    combined = sorted([*vocab, *((name, name) for name in barriers)], key=lambda item: (-len(item[0]), item[0]))
    return _find_mentions(text, combined)


def relation_surfaces(catalog: MentionIdentityCatalog, rows: list[dict], extra_surfaces=()) -> list[str]:
    """未确认、低频及未导出名称也占位置；固定别名表只补障碍，不授予身份。"""
    names = set(extra_surfaces)
    for entity in catalog.catalog.entities.values():
        names.update([entity['canonical_name'], *entity.get('aliases', [])])
    for row in rows:
        names.update([row.get('name'), row.get('normalized_name')])
    names.update(_ALIAS_MAP.get(catalog.catalog.city, {}))
    return sorted((name for name in names if isinstance(name, str) and name.strip()), key=lambda x: (-len(x), x))


def _occurrences(text: str, surface: str) -> list[tuple[int, int]]:
    hits = []
    start = 0
    while surface and (pos := text.find(surface, start)) >= 0:
        hits.append((pos, pos + len(surface)))
        start = pos + 1
    return hits


def _quote_positions(text: str, row: dict, positions: list[int], hits: list[tuple]) -> list[int]:
    quote = (row.get('evidence_text') or '').strip()
    spans = _occurrences(text, quote)
    if len(spans) != 1:
        return []
    start, end = spans[0]
    matched = [i for i in positions if start <= hits[i][0] and hits[i][1] <= end]
    return matched if len(matched) == 1 else []


def mine_mention_relations(catalog: MentionIdentityCatalog, rows: list[dict], *,
                           eligible_entity_ids: set[str] | None = None,
                           extra_surfaces=(), min_mentions: int = 2) -> dict:
    """返回逐篇双端点证据和显式未确认项，不写库、不修改输入。

    min_mentions 只控制端点资格，不能从位置序列删掉低频地点。
    noteId 使用 RawNote.id（与 mentionSources 相同），不是外站 note_id。
    """
    if min_mentions < 1:
        raise ValueError('提及数下限必须至少为1')
    if len({row['id'] for row in rows}) != len(rows):
        raise ValueError('关系输入含重复提及ID')
    by_note = defaultdict(list)
    resolutions = {}
    counts = defaultdict(set)
    for row in rows:
        by_note[row['raw_note_id']].append(row)
        result = catalog.resolve(row)
        resolutions[row['id']] = result
        if result['status'] == 'resolved':
            counts[result['entity']['entity_id']].add(row['id'])
    vocab = [(name, name) for name in relation_surfaces(catalog, rows, extra_surfaces)]
    managed = catalog.managed_entity_ids()
    edges = defaultdict(dict)
    unresolved = []
    for note_id, note_rows in sorted(by_note.items()):
        note_rows.sort(key=lambda r: r['id'])
        first = note_rows[0]
        if any(any(r.get(key) != first.get(key) for key in NOTE_FIELDS) for r in note_rows):
            raise ValueError('同篇笔记出现不一致的来源快照')
        text = f"{first.get('note_title') or ''}\n{first.get('note_desc') or ''}"
        text_hash = digest(['relation_text', text])
        hits = _text_hits(text, vocab)
        claims = defaultdict(list)
        for row in note_rows:
            result = resolutions[row['id']]
            entity = result.get('entity')
            raw_key = name_key(row.get('name') or '')
            positions = []
            for i, hit in enumerate(hits):
                surface_key = name_key(hit[2])
                if surface_key == raw_key:
                    positions.append(i)
                elif result['status'] == 'resolved' and raw_key and raw_key in surface_key:
                    # 已确认提及可定位到完整别名/分店表层，但长名自身必须明确属于同一实体。
                    # 子串仅用于定位已有分配，不能据此推断父子或品牌身份。
                    named = catalog.catalog.resolve(hit[2])
                    if named and named['entity_id'] == entity['entity_id']:
                        positions.append(i)
            if not positions:
                unresolved.append({'noteId': note_id, 'mentionId': row['id'], 'reason': 'no_text_occurrence'})
                continue
            reason = None if result['status'] == 'resolved' else result['reason']
            controlled = bool(result['scopePlaceIds']) or bool(entity and entity['entity_id'] in managed)
            if len(positions) > 1:
                located = _quote_positions(text, row, positions, hits)
                if located:
                    positions = located
                elif controlled:
                    # 无法定位的分配不能默默忽略，否则另一分配会独占所有同名位置。
                    reason = 'ambiguous_text_occurrence'
            if not reason and eligible_entity_ids is not None and entity['entity_id'] not in eligible_entity_ids:
                reason = 'not_exported'
            if not reason and len(counts[entity['entity_id']]) < min_mentions:
                reason = 'below_mention_threshold'
            for i in positions:
                claims[i].append((row, entity, reason))
        endpoints = []
        for i, (start, end, surface) in enumerate(hits):
            candidates = claims[i]
            reasons = sorted({reason for _, _, reason in candidates if reason})
            owners = {(e['entity_id'], e['revision']) for _, e, reason in candidates if not reason}
            if not candidates:
                reasons = ['no_mention_binding']
            elif len(owners) > 1:
                reasons.append('conflicting_position_owners')
            if reasons or len(owners) != 1:
                unresolved.append({'noteId': note_id, 'start': start, 'end': end, 'surface': surface,
                    'mentionIds': sorted(r['id'] for r, _, _ in candidates), 'reasons': reasons})
                endpoints.append(None)
                continue
            entity_id, revision = next(iter(owners))
            endpoints.append({'entityId': entity_id, 'revision': revision, 'start': start, 'end': end,
                'surface': surface, 'mentions': [{'mentionId': r['id'], 'inputHash': mention_fingerprint(r)}
                    for r, _, _ in candidates]})
        for i in range(len(hits) - 1):
            a, b = endpoints[i:i + 2]
            if not a or not b or a['entityId'] == b['entityId']:
                continue
            gap = text[a['end']:b['start']]
            if len(gap) > MAX_GAP or not _is_related(gap):
                continue
            key = _pair_key(a['entityId'], b['entityId'])
            if note_id in edges[key]:
                continue
            edges[key][note_id] = {'noteId': note_id, 'textHash': text_hash,
                'from': a if a['entityId'] == key[0] else b, 'to': b if b['entityId'] == key[1] else a,
                'quote': text[a['start']:b['end']]}
    relations = []
    for (a, b), notes in sorted(edges.items()):
        evidence = [notes[note_id] for note_id in sorted(notes)]
        relations.append({'from': catalog.catalog.entities[a]['canonical_name'],
            'to': catalog.catalog.entities[b]['canonical_name'], 'fromEntityId': a, 'toEntityId': b,
            'fromRevision': catalog.catalog.entities[a]['revision'], 'toRevision': catalog.catalog.entities[b]['revision'],
            'strength': 'direct' if len(notes) >= 2 else 'weak', 'noteCount': len(notes), 'evidence': evidence})
    return {'relations': relations, 'unresolved': unresolved}
