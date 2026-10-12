"""受控实体只从当前已分配提及构建事实；不复用按旧泛名累积的缓存或全城图片池。"""
from __future__ import annotations

import copy

from app.clean.hours import HoursEvidence, mine_open_hours
from app.clean.mention_identity import digest, mention_fingerprint, effective_mention
from app.clean.place_content import build_place_content, intro_rejection, legacy_highlights, reservation_policy


def scoped_binding(entity: dict, rows: list[dict]) -> dict:
    return {'entityId': entity['entity_id'], 'revision': entity['revision'],
        'mentionHash': digest(sorted((row['id'], mention_fingerprint(row)) for row in rows))}


def independent_scoped_place(entity: dict, rows: list[dict], image_policy: dict, observed_at: str, known_names: list[str], *, mention_catalog=None) -> dict:
    """无原始主源的新实体：只用本实体字段和已审核提及，之后仍走统一v2归一。"""
    if entity['primary_place_id'] is not None or not rows:
        raise ValueError('独立提及主体须无原始主源且有已确认提及')
    payload, evidence = scoped_facts(entity, rows, observed_at, known_names, mention_catalog=mention_catalog)
    overrides = entity['overrides']
    payload.update({'imageIdentity': image_policy,
        'geoStatus': 'resolved' if overrides.get('lat') is not None and overrides.get('lng') is not None else 'unresolved'})
    return {'id': entity['entity_id'], 'sourceEntityId': entity['entity_id'], 'name': entity['canonical_name'], 'source': 'xhs', 'verified': True,
        'category': overrides.get('category', '其他'), 'lat': overrides.get('lat'), 'lng': overrides.get('lng'),
        'payload': payload, 'evidence': evidence}


def withdrawn_place(entity: dict, catalog, entity_mentions: dict, image_policy: dict) -> dict:
    """显式撤回无已确认提及的旧主体；候选只用于澄清，不构成旧ID重定向。"""
    eid = entity['entity_id']
    owned_scopes = {scope_id for scope_id in catalog.scopes if eid in catalog.withdrawal_owners(scope_id)}
    targets = {(catalog.catalog.root(assignment['entity_id']) or {}).get('entity_id')
        for assignment in catalog.assignments.values()
        if assignment['scope_place_id'] in owned_scopes and assignment['entity_id']}
    targets = sorted(target for target in targets if target and target != eid and entity_mentions.get(target))
    return {'id': eid, 'name': entity['canonical_name'], 'source': 'xhs', 'verified': False,
        'category': entity.get('overrides', {}).get('category', '其他'), 'lat': None, 'lng': None,
        'payload': {'identity': catalog.catalog.contract(entity), 'aliases': entity['aliases'],
            'identityWithdrawal': {'version': 1, 'revision': entity['revision'],
                'reason': 'split_source' if targets else 'unavailable_source', 'candidateIds': targets},
            'imageIdentity': {**image_policy, 'approved': []}, 'mentionSources': [],
            'themes': [], 'mentionCount': 0, 'recommendScore': 0}, 'evidence': []}


def scoped_facts(entity: dict, rows: list[dict], observed_at: str, known_names: list[str], profile=None, *, mention_catalog=None) -> tuple[dict, list[dict]]:
    name = entity['canonical_name']
    rows = sorted(rows, key=lambda row: (-(row['confidence'] or 0), row['id']))
    names = list(dict.fromkeys([name, *entity['aliases'], *(row['name'] for row in rows)]))
    highlights, evidence, hours, reservations, durations = [], [], [], [], []
    seen = set()
    seen_durations = set()
    effective_rows = []
    for row in rows:
        url = row['source_url']
        resolution = mention_catalog.resolve(row) if mention_catalog is not None else {'status': 'resolved'}
        if mention_catalog is not None and (resolution['status'] != 'resolved'
            or resolution.get('entity', {}).get('entity_id') != entity['entity_id']):
            raise ValueError('受控事实必须来自本实体当前已确认提及')
        row = effective_mention(row, resolution)
        effective_rows.append(row)
        facts = row['fact_value']
        content = facts.get('placeContent')
        if isinstance(content, dict) and content.get('version') == 1:
            highlights.extend({**item, 'sourceUrl': url, 'observedAt': row['observed_at'] or observed_at}
                              for item in content.get('highlights', []))
        elif (row['mention_type'] == 'recommend' and row['reason']
              and 'place_content' not in (resolution.get('factExclusions') or {})):
            highlights.extend({**item, 'observedAt': row['observed_at'] or observed_at}
                              for item in legacy_highlights(row['reason'], url))
        for source_kind, text in [('reason', row['reason']), ('evidence', row['evidence_text'])]:
            if text:
                hours.append(HoursEvidence(row['name'], text, url, source_kind=source_kind))
                if ('reservation' not in (resolution.get('factExclusions') or {})
                    and (row['fact_type'] == 'reservation' or facts.get('reservation'))):
                    reservations.append(text)  # True仅标记涉及预约，实际三态仍由原文解析。
        minutes = facts.get('minutes')
        if row['fact_type'] == 'visit_duration' and type(minutes) in (int, float) and minutes >= 15 and (row['confidence'] or 0) >= .85:
            key = (row['raw_note_id'], int(minutes))
            if key not in seen_durations:
                seen_durations.add(key)
                durations.append(int(minutes))
        if row['reason']:
            kind = 'xhs_warning' if row['mention_type'] == 'warning' else 'xhs_reason'
            key = (kind, row['reason'], url)
            if key not in seen:
                seen.add(key)
                evidence.append({'kind': kind, 'content': row['reason'][:200], 'sourceUrl': url})
    binding = scoped_binding(entity, rows)
    content = build_place_content(highlights, observed_at)
    if (isinstance(profile, dict) and profile.get('identityBinding') == binding
        and profile.get('profileVersion') == 1 and profile.get('qualityVersion') == 2):
        content = copy.deepcopy(profile)
        content.pop('identityBinding', None)
    positive = sum(row['mention_type'] == 'recommend' for row in rows)
    source_count = len({row['raw_note_id'] for row in rows})
    payload = {'content': content, 'themes': [],
        'topReasons': list(dict.fromkeys(row['reason'] for row in effective_rows if row['mention_type'] == 'recommend'
                                      and row['reason'] and not intro_rejection(row['reason'])))[:3],
        'mentionCount': len(rows), 'recommendScore': round(len(rows) * 2 + positive / max(len(rows), 1) * 5 + source_count * .5, 2),
        'openHours': mine_open_hours(hours, target=name, aliases=names, known_names=known_names) or
            {'version': 2, 'subject': name, 'scope': 'place', 'status': 'unknown', 'text': '',
             'openTime': None, 'closeTime': None, 'closedWeekdays': [], 'note': '', 'evidence': [], 'attributions': [], 'review': []},
        'mentionSources': [{'mentionId': row['id'], 'noteId': row['raw_note_id'], 'inputHash': mention_fingerprint(row)} for row in rows],
        **reservation_policy(reservations)}
    if durations:
        payload['typicalVisitMinutes'] = sorted(durations)[len(durations) // 2]
    warnings = mention_catalog.text_warnings_for(entity['entity_id']) if mention_catalog is not None else []
    if warnings:
        payload['tips'] = list(dict.fromkeys(w['quote'] for w in warnings))
        for warning in warnings:
            key = ('xhs_warning', warning['quote'], warning['sourceUrl'])
            if key not in seen:
                seen.add(key)
                evidence.append({'kind': 'xhs_warning', 'content': warning['quote'], 'sourceUrl': warning['sourceUrl']})
    operations = mention_catalog.operational_facts_for(entity['entity_id'], rows) if mention_catalog is not None else None
    if operations is not None:
        retained, retained_evidence = operations
        payload.update(retained)
        evidence.extend(retained_evidence)
    return payload, evidence
