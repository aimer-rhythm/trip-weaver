"""新独立主体必须由当前原文和逐提及分配支持；不分配或抢占历史泛名ID。"""
from __future__ import annotations

import re

from app.clean.identity import name_key
from app.clean.mention_identity import mention_fingerprint


def creation_names(value) -> list[str]:
    required = {'entityId', 'canonicalName', 'aliases', 'overrides', 'evidence'}
    if not isinstance(value, list) or any(not isinstance(e, dict) or not required.issubset(e)
        or set(e) - required - {'nameBasis'} for e in value):
        raise ValueError('新实体必须完整提供ID、主名、别名、字段及原文证据')
    names = []
    for item in value:
        if not isinstance(item['entityId'], str) or not re.fullmatch('[a-f0-9]{32}', item['entityId']):
            raise ValueError('新实体ID必须为冻结的32位十六进制值')
        aliases = item['aliases']
        if not isinstance(aliases, list):
            raise ValueError('新实体别名必须为列表')
        local = [item['canonicalName'], *aliases]
        if any(not isinstance(n, str) or not n.strip() or len(n) > 128 for n in local):
            raise ValueError('新实体名称无效')
        basis = item.get('nameBasis')
        if basis is not None:
            if (not isinstance(basis, dict) or set(basis) != {'baseName', 'locationQualifier'}
                or any(not isinstance(v, str) or not v.strip() for v in basis.values())
                or item['canonicalName'] != f"{basis['baseName']}（{basis['locationQualifier']}）"):
                raise ValueError('地址限定名必须明确原名和原文位置，不能伪称官方分店名')
        names.extend(local)
    if len({e['entityId'] for e in value}) != len(value):
        raise ValueError('新实体ID重复')
    keys = set()
    for item in value:
        local = {name_key(n) for n in [item['canonicalName'], *item['aliases']]}
        if keys & local:
            raise ValueError('同批新实体名称重复')
        keys.update(local)
    return names


def validate_creations(value: list[dict], rows: list[dict], assignments: list[dict], catalog, source_names: set[str]) -> list[dict]:
    by_id = {row['id']: row for row in rows}
    result = []
    for item in value:
        eid, name = item['entityId'], item['canonicalName'].strip()
        aliases = sorted(set([name, *(n.strip() for n in item['aliases'])]))
        if any(name_key(n) in catalog.names or name_key(n) in source_names for n in aliases):
            raise ValueError('新实体名称已有主体或来源，必须核实后复用现有身份')
        overrides = item['overrides']
        if not isinstance(overrides, dict) or set(overrides) - {'category', 'lat', 'lng', 'address', 'adcode', 'geoStatus'}:
            raise ValueError('新实体只允许明确的类型、地址和坐标字段')
        if overrides.get('category') not in ('美食', '文化', '自然', '购物', '住宿', '交通', '娱乐', '其他'):
            raise ValueError('新实体须明确合法主体类别')
        if ('lat' in overrides) != ('lng' in overrides):
            raise ValueError('新实体经纬度必须同时提供')
        lat, lng = overrides.get('lat'), overrides.get('lng')
        if not ((lat is None and lng is None) or (type(lat) in (int, float) and type(lng) in (int, float)
                and -90 <= lat <= 90 and -180 <= lng <= 180)):
            raise ValueError('新实体经纬度无效')
        if any(overrides.get(field) is not None and not isinstance(overrides[field], str) for field in ('address', 'adcode')):
            raise ValueError('新实体地址和行政区码须为文本或null')
        geo_status = 'unresolved' if lat is None else 'resolved'
        if 'geoStatus' in overrides and overrides['geoStatus'] != geo_status:
            raise ValueError('新实体地理状态与坐标不一致')
        evidence = item['evidence']
        basis = item.get('nameBasis')
        assigned = {a['mentionId'] for a in assignments if a['entityId'] == eid}
        if not assigned or not isinstance(evidence, list) or not evidence:
            raise ValueError('新实体必须有明确分配的提及和原文证据')
        covered, quotes = set(), []
        for proof in evidence:
            if (not isinstance(proof, dict) or set(proof) != {'mentionId', 'inputHash', 'quote'}
                or type(proof['mentionId']) is not int or not isinstance(proof['inputHash'], str)):
                raise ValueError('创建证据须绑定提及指纹和原文摘录')
            row = by_id.get(proof['mentionId'])
            quote = proof['quote']
            if (not row or proof['mentionId'] not in assigned or row['note_unavailable']
                or proof['inputHash'] != mention_fingerprint(row) or not isinstance(quote, str) or not quote.strip()
                or not any(quote in (row[field] or '') for field in ('note_title', 'note_desc'))):
                raise ValueError('创建证据不支持当前新主体或已过期')
            if basis:
                address = re.fullmatch(re.escape(basis['baseName']) + r'\s*\n地址[：:]\s*([^\r\n]+)', quote)
                if not address or basis['locationQualifier'] not in address[1]:
                    raise ValueError('地址限定名须有紧随店名的原文地址行')
                if overrides.get('address') is not None and overrides['address'] != address[1]:
                    raise ValueError('新主体地址与逐提及原文不一致')
            elif name_key(name) not in name_key(quote):
                raise ValueError('创建证据没有明确新主体全名')
            covered.add(row['id'])
            quotes.append(name_key(quote))
        if covered != assigned or any(not any(name_key(alias) in quote for quote in quotes) for alias in aliases
                                      if not (basis and alias == name)):
            raise ValueError('新实体的提及或别名缺少对应原文支持')
        result.append(dict(entity_id=eid, city=catalog.city, canonical_name=name, primary_place_id=None,
            aliases=aliases, legacy_ids=[eid], revision=1, status='ACTIVE', redirect_to=None,
            overrides={**overrides, 'lat': lat, 'lng': lng},
            evidence=[{'kind': 'reviewed_entity_creation', 'mentions': evidence, **({'nameBasis': basis} if basis else {})}]))
    return result
