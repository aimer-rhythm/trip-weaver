"""只读核验已逐篇阅读的文化地点；--tower复核batch32超然楼完整来源。"""
from pathlib import Path
import asyncio
import hashlib
import json
import sys
from datetime import datetime, timezone
sys.dont_write_bytecode = True
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, 'D:/Project/xhs-travel-pipeline')
from sqlalchemy import select, text
from app.db import SessionFactory, engine
from app.models import CanonicalPlace, RawNote
from app.aggregate.mention_identity import load_mention_catalog, load_mention_rows, source_input, source_keys
from app.aggregate.image_identity import load_image_rows
from app.clean.identity import name_key
from app.clean.mention_identity import mention_fingerprint, source_fingerprint, scope_matches, NOTE_FIELDS

root = Path(__file__).resolve().parent
folder = root / 'priority-cities/济南'
source_file = folder / 'run-1791385235272324900/sources.json'
assert sys.argv[1:] in ([], ['--tower'], ['--landmarks'], ['--parks']), '仅支持--tower、--landmarks、--parks或默认三组文化地点'
tower_mode = sys.argv[1:] == ['--tower']
landmark_mode = sys.argv[1:] == ['--landmarks']
park_mode = sys.argv[1:] == ['--parks']
prefix = 'park' if park_mode else 'tower' if tower_mode else 'landmark' if landmark_mode else 'cultural'
target = folder / f'{prefix}-upstream-check-01.json'
targets = {
    '6ed737543bd4e4f550f0fd357c9e8c71': ('山东博物馆', [5355, 5370], 15),
    '0f3bfc53c2a77e85d2c1699c7c90fd10': ('山东美术馆', [5356, 5369], 10),
    '2caab5c5038a94f91657ae16110dd56e': ('洪家楼天主教堂', [5379, 5946], 8),
}
if tower_mode:
    targets = {'d4a51a5df56f78c9de0713d86ea8c00c': ('超然楼', [5365, 5368], 24)}
if landmark_mode:
    targets = {
        '15ad3a8280476165635672cb0e43117a': ('解放阁', [5360], 35),
        '8cc25e536e67519c958ee54248ead04f': ('泉城广场', [5354], 33),
        '98265a1a55707d558accb6c2def8ec46': ('济南府学文庙', [5367], 1),
    }
if park_mode:
    targets = {
        '1b4ef2692e22efa0e8d765a93fc5b54c': ('中山公园', [5395], 1),
        '2d23e8cc46a8090235388297dff2279c': ('济南森林公园', [5402], 1),
        '34fec8eb89e06bf897e7ed869a42d6a1': ('泉城公园', [5972], 1),
    }
expected_revision = 1 if landmark_mode or park_mode else 2

async def main():
    assert not target.exists(), '保留已存在证据，不覆盖'
    pointer = json.loads((root / 'cleaning-scope/current.json').read_text(encoding='utf-8'))
    assert '济南' not in pointer['policy']['excludedCities']
    raw = source_file.read_bytes()
    manifest = json.loads(source_file.with_name('manifest.json').read_text(encoding='utf-8'))
    assert hashlib.sha256(raw).hexdigest() == manifest['sha256']
    frozen = json.loads(raw)
    frozen_groups = {g['entity']['entity_id']: g for g in frozen['groups']}
    frozen_mentions = {m['id']: m for m in frozen['mentions']}
    frozen_notes = {n['id']: n for n in frozen['notes']}
    try:
        async with SessionFactory() as session:
            await session.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            await session.execute(text("SET LOCAL statement_timeout='30s'"))
            catalog = await load_mention_catalog(session, '济南')
            sources = (await session.scalars(select(CanonicalPlace).where(CanonicalPlace.city == '济南'))).all()
            sources_by_id = {p.id: p for p in sources}
            all_mentions = await load_mention_rows(session, '济南')
            mentions_by_id = {m['id']: m for m in all_mentions}
            # 同时复核整个冻结资料，防止用已变化原文为新自查背书。
            for original in frozen['sources']:
                actual = sources_by_id[original['id']]
                assert source_fingerprint(source_input(actual)) == original['sourceHash']
                for key in ['name', 'normalized_name', 'city', 'address', 'latitude', 'longitude', 'place_type',
                            'geo_status', 'amap_poi_id', 'is_active', 'quality_score']:
                    assert getattr(actual, key) == original[key], (original['id'], key)
            for original in frozen['mentions']:
                current = mentions_by_id[original['id']]
                assert mention_fingerprint(current) == original['inputHash'], original['id']
                note = frozen_notes[current['raw_note_id']]
                for key in NOTE_FIELDS:
                    assert current.get(key) == note.get(key), (note['id'], key)
            image_rows = await load_image_rows(session, '济南')
            # 普通地点还消费全城图片事实池；只有同名提及的冻结原文并不完整。
            supplemental_notes = []
            if park_mode:
                city_notes = (await session.scalars(select(RawNote).where(RawNote.city == '济南'))).all()
                for note in city_notes:
                    analysis_text = json.dumps(note.img_analysis, ensure_ascii=False)
                    names = [name for name, _, _ in targets.values() if name in analysis_text]
                    if not names:
                        continue
                    record = {'id': note.id, 'note_id': note.note_id, 'city': note.city,
                        'title': note.title, 'desc': note.desc, 'img_analysis': note.img_analysis,
                        'status': note.status, 'source_url': note.source_url}
                    digest = hashlib.sha256(json.dumps(record, ensure_ascii=False, sort_keys=True,
                        separators=(',', ':')).encode()).hexdigest()
                    supplemental_notes.append({'matchedNames': names, 'inputHash': digest, 'note': record})
            groups = []
            for eid, (name, expected_sources, expected_count) in targets.items():
                original = frozen_groups[eid]
                original_ids = set(original['mentionIds'])
                if tower_mode:
                    original_ids.update(frozen_groups['ef9937ce2185cc51d0870a6c8ce9feaa']['mentionIds'])
                entity = catalog.catalog.root(eid)
                assert entity and entity['entity_id'] == eid and entity['canonical_name'] == name
                assert entity['status'] == 'ACTIVE' and entity['revision'] == expected_revision
                assert entity['overrides'] == original['entity']['overrides']
                members = [p for p in sources if (catalog.catalog.resolve(place_id=p.id) or {}).get('entity_id') == eid]
                assert sorted(p.id for p in members) == expected_sources
                keys = {name_key(n) for n in [entity['canonical_name'], *entity['aliases']]}
                keys.update(k for p in members for k in source_keys(p))
                related = sorted(p.id for p in sources if keys & source_keys(p))
                assert related == expected_sources
                matching = [m for m in all_mentions if scope_matches({'city': '济南', 'name_keys': keys}, m)]
                assert sorted(m['id'] for m in matching) == sorted(original_ids)
                assert len(matching) == expected_count
                records = []
                for mention in matching:
                    resolved = catalog.resolve(mention)
                    assert resolved['status'] == 'resolved' and resolved['entity']['entity_id'] == eid
                    assert resolved['entity']['revision'] == expected_revision
                    assert mention_fingerprint(mention) == frozen_mentions[mention['id']]['inputHash']
                    records.append({'mentionId': mention['id'], 'rawNoteId': mention['raw_note_id'],
                        'name': mention['name'], 'inputHash': mention_fingerprint(mention),
                        'entityId': eid, 'resolutionReason': resolved['reason']})
                note_ids = {m['raw_note_id'] for m in matching}
                images = [r for r in image_rows if r['source_place_id'] in expected_sources or r['raw_note_id'] in note_ids]
                reference = {}
                if tower_mode or landmark_mode or park_mode:
                    primary_id = 5368 if tower_mode else expected_sources[0]
                    assert entity['primary_place_id'] == primary_id
                    if tower_mode:
                        assert sorted(entity['aliases']) == sorted(['超然楼', '大明湖超然楼'])
                    primary = sources_by_id[primary_id]
                    reference = {'referencePoint': {'lat': primary.latitude, 'lng': primary.longitude, 'address': primary.address}}
                groups.append({'entityId': eid, 'name': name, 'revision': expected_revision, 'aliases': entity['aliases'], **reference,
                    'overrides': entity['overrides'], 'sourceIds': expected_sources,
                    'completeMatchingMentionIds': sorted(m['id'] for m in matching), 'mentions': records,
                    'noteIds': sorted(note_ids), 'upstreamManagedImageCount': len(images),
                    'upstreamImageKeys': [r['image_key'] for r in images],
                    'identityAssessment': 'source_fields_require_manual_assessment' if park_mode else 'mixed_hotel_region_requires_scope' if name == '泉城广场' else 'full_source_review_same_tower' if tower_mode else 'full_source_review_same_institution',
                    'positionAssessment': 'pending_reference_point_review' if '教堂' in name else 'map_reference_point_matches_current_override'})
            report = {'readOnly': True, 'capturedAt': datetime.now(timezone.utc).isoformat(), 'city': '济南',
                'sourceFile': str(source_file.relative_to(root)).replace('\\', '/'), 'sourceSha256': manifest['sha256'],
                'rawSourcesUnchanged': len(frozen['sources']), 'originalMentionsUnchanged': len(frozen['mentions']),
                'originalNotesUnchanged': len(frozen['notes']), 'groups': groups,
                'scope': '三个公园完整成员、提及及图片事实来源只读核验；技术通过不替代逐项语义判断' if park_mode else '超然楼两源及全部24提及；不重放batch32' if tower_mode else '三处地标69提及来源及当前解析复核；泉城广场11420住宿区域须另行治理，技术通过不代表此组清洗完成' if landmark_mode else '三个主体完整同名及别名来源；教堂位置仍待核，营业时间与预约不在本身份自查结论内',
                'semanticIssues': [{'mentionId': 11420, 'reason': '住宿推荐区域错误归入广场本体；尚未执行scope治理'}] if landmark_mode else [], 'failures': []}
            if park_mode:
                report['supplementalImageFactNotes'] = supplemental_notes
            with target.open('x', encoding='utf-8', newline='\n') as handle:
                handle.write(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
            print(json.dumps({'file': str(target.relative_to(root)), 'entities': len(groups),
                'mentions': sum(len(g['mentions']) for g in groups), 'managedImages': sum(g['upstreamManagedImageCount'] for g in groups),
                'originalSourcesUnchanged': len(frozen['sources']), 'originalMentionsUnchanged': len(frozen['mentions']), 'failures': []}, ensure_ascii=False))
    finally:
        await engine.dispose()

asyncio.run(main())
