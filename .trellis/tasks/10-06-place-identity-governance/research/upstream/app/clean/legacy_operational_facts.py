"""复用旧导出的运营投影；显式保全原输入，不把历史资料当成本轮核实。"""
from __future__ import annotations

import copy
import re

from app.clean.alias import aliases_for, canonical_display_name, resolve_alias
from app.clean.hours import HoursEvidence, mine_open_hours
from app.clean.mention_identity import digest
from app.clean.place_content import reservation_policy

POLICY = 'legacy_operational_preservation_v1'
FIELDS = ('price', 'openHours', 'reservation', 'reservationNote', 'reservationEvidence', 'reservationConflict')
IMAGE_FIELDS = ('hours', 'tips', 'reservation', 'price')


def operational_image_input(note_id: int, image_index: int, note: dict | None) -> dict:
    images = note.get('images') if note else None
    image = images[image_index] if isinstance(images, list) and 0 <= image_index < len(images) else None
    state = {key: note.get(key) if note else None for key in
             ('city', 'title', 'desc', 'unavailable', 'sourceUrl', 'observedAt', 'publishedAt')}
    return {'noteId': note_id, 'imageIndex': image_index,
            'inputHash': digest([POLICY, note_id, image_index, state, image])}


def image_refs(values: list[dict]) -> list[dict]:
    if not isinstance(values, list) or any(not isinstance(v, dict)
        or type(v.get('noteId')) is not int or v['noteId'] <= 0
        or type(v.get('imageIndex')) is not int or v['imageIndex'] < 0 for v in values):
        raise ValueError('运营保全须逐一引用已有笔记及图片文字索引')
    return [{'noteId': nid, 'imageIndex': index} for nid, index in
            sorted({(v['noteId'], v['imageIndex']) for v in values})]


def fact_names(original_name: str, city: str) -> list[str]:
    name = canonical_display_name(original_name, city)
    return list(dict.fromkeys([original_name, name, *aliases_for(city, name)]))


def relevant_images(notes_in_order: list[tuple[int, dict]], names: list[str]) -> list[dict]:
    refs = []
    for nid, note in notes_in_order:
        for index, item in enumerate(note.get('images') or []):
            if not isinstance(item, dict) or not item.get('has_text'):
                continue
            info = item.get('key_info') or {}
            if any(name in str(info.get(field) or '') for name in names for field in IMAGE_FIELDS):
                refs.append(operational_image_input(nid, index, note))
    return refs


def checked_images(refs: list[dict], notes: dict[int, dict], city: str) -> list[tuple[dict, str]]:
    if len(image_refs(refs)) != len(refs):
        raise ValueError('运营保全图片文字引用不能重复')
    result = []
    for ref in refs:
        if (set(ref) != {'noteId', 'imageIndex', 'inputHash'}
                or not isinstance(ref['inputHash'], str) or not re.fullmatch(r'[a-f0-9]{64}', ref['inputHash'])):
            raise ValueError('运营保全图片文字引用缺少完整输入指纹')
        note = notes.get(ref['noteId'])
        if (not note or note['city'] != city or note['unavailable']
                or operational_image_input(ref['noteId'], ref['imageIndex'], note) != ref):
            raise ValueError('运营资料原文、图片文字、日期或来源已经变化，须重新核对')
        images = note.get('images')
        if (not isinstance(images, list) or ref['imageIndex'] >= len(images)
                or not isinstance(images[ref['imageIndex']], dict) or not images[ref['imageIndex']].get('has_text')):
            raise ValueError('运营资料必须来自已有可用图片文字分析')
        result.append((images[ref['imageIndex']], note['sourceUrl']))
    return result


def legacy_material(original_name: str, city: str, source_names: list[str], rows: list[dict],
                    images: list[tuple[dict, str]]) -> tuple[list[str], list[HoursEvidence]]:
    # 与旧普通导出共用匹配器，不能为保全另造价格或预约截取规则。
    from app.qa.ask import _collect_image_facts, _match_image_facts
    names = fact_names(original_name, city)
    name, norm = canonical_display_name(original_name, city), resolve_alias(original_name, city)
    pool = _collect_image_facts([[item] for item, _ in images])
    facts = list(dict.fromkeys(f for alias in names for f in _match_image_facts(pool, alias)))
    children = [n for n in source_names if n not in names and any(n.startswith(alias) for alias in names)]
    facts = [f for f in facts if not any(child in f for child in children)]
    hours = []
    for row in sorted(rows, key=lambda r: (-(r['confidence'] or 0), r['id'])):
        if resolve_alias(row['name'], city) != norm:
            continue
        for field, kind in [('reason', 'reason'), ('evidence_text', 'evidence')]:
            if row[field]:
                hours.append(HoursEvidence(norm, row[field], row['source_url'] or '', source_kind=kind))
    for item, url in images:
        if item.get('has_text'):
            for field in IMAGE_FIELDS:
                value = str((item.get('key_info') or {}).get(field) or '')
                if any(alias in value for alias in names):
                    hours.append(HoursEvidence(name, value, url or '', source_kind='image'))
    return facts, hours


def legacy_operational_payload(name: str, norm: str, names: list[str], known_names: list[str],
                               facts: list[str], hours: list[HoursEvidence]) -> tuple[dict, list[dict]]:
    def value(fact):
        return fact.split(':', 1)[1].replace(name, '').replace(norm, '').strip(' ：:，,')
    price = next((f.split(':', 1)[1].strip() for f in facts if f.startswith('价格:') and value(f)), '')
    reservations = [f.split(':', 1)[1].strip() for f in facts if f.startswith('预约:') and value(f)]
    payload = {'openHours': mine_open_hours(hours, target=name,
        aliases=list(dict.fromkeys([norm, *names])), known_names=known_names) or
        {'version': 2, 'subject': name, 'scope': 'place', 'status': 'unknown', 'text': '',
         'openTime': None, 'closeTime': None, 'closedWeekdays': [], 'note': '', 'evidence': [],
         'attributions': [], 'review': []}, **reservation_policy(reservations)}
    evidence = []
    if price:
        payload['price'] = price[:120]
        evidence.append({'kind': 'xhs_price', 'content': price[:200], 'sourceUrl': ''})
    if reservations:
        evidence.append({'kind': 'xhs_reservation', 'content': '；'.join(reservations)[:200], 'sourceUrl': ''})
    return payload, evidence


def project_operational(original_name: str, city: str, source_names: list[str], known_names: list[str],
                        rows: list[dict], images: list[tuple[dict, str]]) -> tuple[dict, list[dict]]:
    facts, hours = legacy_material(original_name, city, source_names, rows, images)
    return legacy_operational_payload(canonical_display_name(original_name, city), resolve_alias(original_name, city),
        fact_names(original_name, city), known_names, facts, hours)


def preservation_refs(values: list[dict]) -> list[dict]:
    if not isinstance(values, list) or any(not isinstance(v, dict) or not isinstance(v.get('sources'), list) for v in values):
        raise ValueError('运营资料保全必须是完整列表')
    return image_refs([ref for v in values for ref in v['sources']])


def preserved_operational(value: dict, entity: dict, rows: list[dict], notes: dict[int, dict],
                          binding: dict) -> tuple[dict, list[dict]]:
    if (value.get('policy') != POLICY or value.get('binding') != binding
            or value.get('entityId') != entity['entity_id'] or entity.get('redirect_to')
            or entity['primary_place_id'] != value.get('sourcePlaceId')):
        raise ValueError('运营保全主体或提及版本已经变化，须显式重新核对')
    images = checked_images(value['sources'], notes, entity['city'])
    payload, evidence = project_operational(value['originalName'], entity['city'], value['sourceNames'],
        value['knownNames'], rows, images)
    if digest(payload) != value['payloadHash']:
        raise ValueError('运营保全投影已变化，不能静默恢复旧值或采用新值')
    payload = copy.deepcopy(payload)
    payload['operationalIdentity'] = {'version': 1, 'policy': POLICY, 'entityId': entity['entity_id'],
        'revision': entity['revision'], 'sourceCount': len(value['sources']), 'payloadHash': value['payloadHash'],
        'sourceReview': 'subject_only', 'currentFactsReviewed': False}
    return payload, evidence
