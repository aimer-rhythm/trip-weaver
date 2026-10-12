"""导出行程主实体；别名合并与景区组成关系分开，政策不跨子项传播。"""
from __future__ import annotations

import copy
import hashlib
from collections import defaultdict

from app.clean.alias import aliases_for, planning_members, planning_name, canonical_display_name
from app.clean.place_content import build_place_content, reservation_policy


def place_id(city: str, name: str) -> str:
    return hashlib.sha256(f'{city}{name}'.encode()).hexdigest()[:32]


def consolidate_places(places: list[dict], city: str, observed_at: str) -> list[dict]:
    groups: dict[str, list[dict]] = defaultdict(list)
    for place in places:
        groups[planning_name(place['name'], city)].append(place)
    result = []
    for parent, members in groups.items():
        members = sorted(members, key=lambda p: (p['name'] != parent, canonical_display_name(p['name'], city) != parent, p['name']))
        base = copy.deepcopy(members[0])
        base.update(id=place_id(city, parent), name=parent)
        payload = base.setdefault('payload', {})
        names = list(dict.fromkeys([parent, *planning_members(parent, city),
            *(p['name'] for p in members), *(p['payload'].get('originalName', p['name']) for p in members), *aliases_for(city, parent)]))
        payload['identity'] = {'version': 1, 'canonicalName': parent, 'memberNames': names,
                               'kind': 'complex' if len(planning_members(parent, city)) > 1 else 'same_entity'}
        # aliases只表达同义词；景区子项不写进这个字段，避免下游事实无条件合并。
        payload['aliases'] = aliases_for(city, parent)
        components, root_members = [], []
        for p in members:
            if canonical_display_name(p['name'], city) == parent:
                root_members.append(p)
            else:
                components.append({'name': p['name'], 'lat': p.get('lat'), 'lng': p.get('lng'),
                    'reservation': p['payload'].get('reservation', 'unknown'),
                    'reservationNote': p['payload'].get('reservationNote'),
                    'openHours': p['payload'].get('openHours'), 'evidence': p.get('evidence', [])})
        payload['components'] = components
        if len(planning_members(parent, city)) > 1:
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
