"""导出行程主实体；别名合并与景区组成关系分开，政策不跨子项传播。"""
from __future__ import annotations

import copy
import hashlib
from collections import defaultdict

from app.clean.alias import aliases_for, planning_members, planning_name, canonical_display_name
from app.clean.place_content import build_place_content, reservation_policy


def place_id(city: str, name: str) -> str:
    return hashlib.sha256(f'{city}{name}'.encode()).hexdigest()[:32]


def consolidate_places(places: list[dict], city: str, observed_at: str, catalog=None) -> list[dict]:
    groups: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for place in places:
        if catalog is not None:
            place = copy.deepcopy(place)
            source_id = place.pop('sourcePlaceId')
            entity = catalog.resolve(place_id=source_id)
            if not entity:
                raise ValueError('地点尚未注册稳定身份，请先运行 govern_place_identity.py --bootstrap')
            if entity['status'] != 'ACTIVE':
                continue
            place['id'] = entity['entity_id']
            place['_identityPrimary'] = source_id == entity['primary_place_id']
            place['name'] = entity['canonical_name']
            place['payload']['identity'] = catalog.contract(entity)
            place['payload']['aliases'] = entity['aliases']
            for key, value in entity['overrides'].items():
                if key == 'exportApproved':
                    continue  # 运营资格不是地点事实，不写进用户消费的 payload。
                if key in ('category', 'lat', 'lng'):
                    place[key] = value
                else:
                    place['payload'][key] = copy.deepcopy(value)
        parent = planning_name(place['name'], city)
        group_id = parent
        if catalog is not None:
            # v2 只按已审核的实体归并；行程组合不能吞掉独立登记的子项。
            parent = entity['canonical_name']
            group_id = entity['entity_id']
        groups[(group_id, parent)].append(place)
    result = []
    for (group_id, parent), members in groups.items():
        is_complex = planning_name(parent, city) == parent and len(planning_members(parent, city)) > 1
        if catalog is not None and is_complex:
            members = [*members, *(p for (_, name), children in groups.items()
                if name != parent and planning_name(name, city) == parent for p in children)]
        members = sorted(members, key=lambda p: (p['name'] != parent, not p.get('_identityPrimary', True),
            canonical_display_name(p['name'], city) != parent, p['name']))
        base = copy.deepcopy(members[0])
        base.pop('_identityPrimary', None)
        base.update(id=place_id(city, parent), name=parent)
        payload = base.setdefault('payload', {})
        names = list(dict.fromkeys([parent, *planning_members(parent, city),
            *(p['name'] for p in members), *(p['payload'].get('originalName', p['name']) for p in members), *aliases_for(city, parent)]))
        payload['identity'] = {'version': 1, 'canonicalName': parent, 'memberNames': names,
                               'kind': 'complex' if is_complex else 'same_entity'}
        # aliases只表达同义词；景区子项不写进这个字段，避免下游事实无条件合并。
        payload['aliases'] = aliases_for(city, parent)
        if catalog is not None:
            entity = catalog.root(group_id)
            if not entity:
                raise ValueError(f'主实体有歧义或未注册：{parent}')
            base['id'] = entity['entity_id']
            payload['aliases'] = entity['aliases']
            payload['identity'] = catalog.contract(entity)
            if is_complex:
                payload['identity']['kind'] = 'complex'
                payload['identity']['memberNames'] = list(dict.fromkeys([*payload['identity']['memberNames'], *names]))
        components, root_members = [], []
        for p in members:
            if (p['id'] == group_id if catalog is not None else canonical_display_name(p['name'], city) == parent):
                root_members.append(p)
            else:
                components.append({'name': p['name'], 'canonicalPlaceId': p['id'], 'lat': p.get('lat'), 'lng': p.get('lng'),
                    'reservation': p['payload'].get('reservation', 'unknown'),
                    'reservationNote': p['payload'].get('reservationNote'),
                    'openHours': p['payload'].get('openHours'), 'evidence': p.get('evidence', [])})
        payload['components'] = components
        if is_complex:
            # 主项即使存在也可能已被旧模糊匹配污染；不把城楼周一闭馆套到天安门全域。
            for key in ('openHours', 'hours', 'price', 'reservation', 'reservationNote', 'reservationEvidence'):
                payload.pop(key, None)
            payload.update(reservation='unknown', reservationNote='景区及各分项的预约要求请通过对应官方渠道分别确认。')
        else:
            payload.update(reservation_policy([n for p in root_members
                for n in p['payload'].get('reservationEvidence', [])]))
        content_items = [item for p in members for item in p['payload'].get('content', {}).get('highlights', [])]
        profiles = [p['payload'].get('content', {}) for p in root_members
                    if p['payload'].get('content', {}).get('profileVersion') == 1]
        payload['content'] = copy.deepcopy(profiles[0]) if profiles else build_place_content(content_items, observed_at)
        payload['topReasons'] = list(dict.fromkeys(r for p in members for r in p['payload'].get('topReasons', [])))[:4]
        payload['mentionCount'] = max((p['payload'].get('mentionCount') or 0) for p in members)
        payload['recommendScore'] = max((p['payload'].get('recommendScore') or 0) for p in members)
        base['evidence'] = []
        seen = set()
        for p in root_members:
            for evidence in p.get('evidence', []):
                key = (evidence.get('kind'), evidence.get('content'), evidence.get('sourceUrl'))
                if key not in seen:
                    seen.add(key)
                    base['evidence'].append(copy.deepcopy(evidence))
        # 子项看点可写进content，政策仅存在components；不能当作主地点通用事实。
        result.append(base)
    return result
