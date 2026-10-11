"""版本化scope内保全原主源的旧运营输入；不接受新值或跨主体转移。"""
from __future__ import annotations

import copy
import re

from sqlalchemy import select

from app.aggregate.note_text_warnings import load_warning_notes
from app.aggregate.place_export_inputs import place_export_query
from app.clean.alias import aliases_for, canonical_display_name
from app.clean.legacy_operational_facts import (FIELDS, POLICY, checked_images, fact_names,
    operational_image_input, preservation_refs, project_operational, relevant_images)
from app.clean.mention_identity import digest, effective_mention
from app.clean.scoped_place_export import scoped_binding
from app.models import CanonicalPlace, RawNote


async def snapshot_operational_inputs(session, refs):
    notes = await load_warning_notes(session, refs)
    return [operational_image_input(ref['noteId'], ref['imageIndex'], notes.get(ref['noteId']))
            for ref in preservation_refs([{'sources': refs}])]


async def legacy_context(session, city, catalog):
    rows = (await session.execute(place_export_query(city, 0.0, catalog))).all()
    source_names = [row[0] for row in rows]
    known = list(dict.fromkeys(alias for row in rows
        for alias in [row[0], row[1], canonical_display_name(row[0], city), *aliases_for(city, row[0])]))
    # 与普通导出相同的原扫描顺序决定旧前两条资料；不按ID重新挑选旧价格。
    image_rows = (await session.execute(select(RawNote.img_analysis, RawNote.source_url, RawNote.id)
        .where(RawNote.city == city, RawNote.img_analysis.is_not(None)))).all()
    refs = [{'noteId': row[2], 'imageIndex': index} for row in image_rows for index in range(len(row[0] or []))]
    notes = await load_warning_notes(session, refs)
    return source_names, known, [(row[2], notes[row[2]]) for row in image_rows]


async def prepare_operational_preservation(session, values, *, city, catalog, selected_ids, assigned_ids, rows):
    if not isinstance(values, list):
        raise ValueError('旧运营保全必须是显式完整列表')
    if not values:
        return []
    source_names, known, ordered_notes = await legacy_context(session, city, catalog.catalog)
    notes = dict(ordered_notes)
    plans, seen = [], set()
    for item in values:
        if (not isinstance(item, dict) or set(item) != {'entityId', 'sourcePlaceId', 'sources', 'payloadHash', 'evidence'}
                or not isinstance(item['entityId'], str) or type(item['sourcePlaceId']) is not int
                or not isinstance(item['payloadHash'], str) or not re.fullmatch(r'[a-f0-9]{64}', item['payloadHash'])):
            raise ValueError('运营保全须提供原主源、完整来源指纹、旧投影指纹及主体审阅证据')
        eid, sid = item['entityId'], item['sourcePlaceId']
        entity = catalog.catalog.entities.get(eid)
        if (eid in seen or eid not in assigned_ids or sid not in selected_ids or not entity
                or entity['status'] != 'ACTIVE' or entity.get('redirect_to') or entity['primary_place_id'] != sid):
            raise ValueError('运营保全仅限本次确认实体的原主源，不能重复或转给其它主体')
        evidence = item['evidence']
        if (not isinstance(evidence, list) or not evidence or any(not isinstance(e, dict)
                or set(e) != {'kind', 'file', 'conclusion'} or e['kind'] != 'subject_only_preservation'
                or any(not isinstance(e.get(k), str) or not e[k].strip() for k in ['file', 'conclusion']) for e in evidence)):
            raise ValueError('运营保全须明确只审原主体，不冒充现行事实审核')
        source = await session.scalar(select(CanonicalPlace).where(CanonicalPlace.id == sid,
            CanonicalPlace.city == city).with_for_update().execution_options(populate_existing=True))
        if not source or not source.is_active or source.name not in source_names:
            raise ValueError('运营保全原主源未进入当前正式导出')
        expected_refs = relevant_images(ordered_notes, fact_names(source.name, city))
        if not expected_refs or item['sources'] != expected_refs:
            raise ValueError('运营保全须完整保持当前匹配来源及顺序，不能漏选、调换或伪造输入')
        images = checked_images(item['sources'], notes, city)
        ordinary = [r for r in rows if (resolution := catalog.resolve(r))['status'] == 'resolved'
            and resolution.get('entity', {}).get('entity_id') == eid]
        if eid in catalog.managed_entity_ids():
            existing = catalog.operational_facts_for(eid, ordinary)
            if existing is None:
                raise ValueError('已经受控且未保全的主体不能重新采用旧图片池')
            old_payload = {k: v for k, v in existing[0].items() if k in FIELDS}
            ordinary = [effective_mention(r, catalog.resolve(r)) for r in ordinary]
        else:
            managed = catalog.managed_entity_ids()
            ordinary = [r for r in rows if (resolution := catalog.resolve(r))['status'] != 'review'
                and not r['note_unavailable'] and resolution.get('entity', {}).get('entity_id') not in managed]
            old_payload, _ = project_operational(source.name, city, source_names, known, ordinary, images)
        payload, _ = project_operational(source.name, city, source_names, known, ordinary, images)
        if payload != old_payload or digest(old_payload) != item['payloadHash']:
            raise ValueError('旧运营投影已经变化，不能按新值伪造保全')
        plans.append({'policy': POLICY, 'entityId': eid, 'sourcePlaceId': sid,
            'sources': copy.deepcopy(item['sources']), 'payloadHash': item['payloadHash'],
            'originalName': source.name, 'sourceNames': source_names, 'knownNames': known,
            'evidence': copy.deepcopy(evidence)})
        seen.add(eid)
    return plans


def bind_operational_preservation(plans, catalog, rows):
    for plan in plans:
        eid = plan['entityId']
        confirmed = [r for r in rows if catalog.resolve(r).get('entity', {}).get('entity_id') == eid]
        if not confirmed:
            raise ValueError('运营保全主体在新scope中没有已确认提及')
        effective = [effective_mention(r, catalog.resolve(r)) for r in confirmed]
        images = checked_images(plan['sources'], catalog.operational_notes, catalog.catalog.city)
        actual, _ = project_operational(plan['originalName'], catalog.catalog.city, plan['sourceNames'],
            plan['knownNames'], effective, images)
        if digest(actual) != plan['payloadHash']:
            raise ValueError('来源隔离改变了运营投影，不能恢复被排除的事实')
        plan['binding'] = scoped_binding(catalog.catalog.entities[eid], confirmed)
