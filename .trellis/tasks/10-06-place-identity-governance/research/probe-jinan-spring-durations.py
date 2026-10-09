"""只读冻结五处泉水地点的现行来源；核实四处组合半小时被逐点提取的问题。"""
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
from app.models import CanonicalPlace
from app.aggregate.mention_identity import load_mention_catalog, load_mention_rows, source_input, source_keys
from app.clean.identity import name_key
from app.clean.mention_identity import MENTION_FIELDS, NOTE_FIELDS, mention_fingerprint, source_fingerprint, scope_matches

root = Path(__file__).resolve().parent
folder = root / 'priority-cities/济南'
target = folder / 'spring-source-packet-01.json'
names = {'起凤泉', '腾蛟泉', '刘氏泉', '玛瑙泉', '王府池子'}

async def main():
    assert not target.exists(), '保留旧证据'
    pointer = json.loads((root / 'cleaning-scope/current.json').read_text(encoding='utf-8'))
    assert '济南' not in pointer['policy']['excludedCities']
    source_file = folder / 'run-1791385235272324900/sources.json'
    raw = source_file.read_bytes()
    assert hashlib.sha256(raw).hexdigest() == '9aa559e894e1cfbcdf74db2214c8eeb6614739064a96967780c6b32af59a889b'
    frozen = json.loads(raw)
    expected = [g for g in frozen['groups'] if g['entity']['canonical_name'] in names]
    assert len(expected) == 5
    frozen_mentions = {m['id']: m for m in frozen['mentions']}
    frozen_sources = {s['id']: s for s in frozen['sources']}
    frozen_notes = {n['id']: n for n in frozen['notes']}
    try:
        async with SessionFactory() as session:
            await session.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            await session.execute(text("SET LOCAL statement_timeout='30s'"))
            catalog = await load_mention_catalog(session, '济南')
            sources = (await session.scalars(select(CanonicalPlace).where(CanonicalPlace.city == '济南'))).all()
            all_rows = await load_mention_rows(session, '济南')
            groups, selected, source_records = [], {}, {}
            for original in expected:
                eid = original['entity']['entity_id']
                entity = catalog.catalog.root(eid)
                assert entity == original['entity'], (eid, '现行实体变化')
                members = [p for p in sources if (catalog.catalog.resolve(place_id=p.id) or {}).get('entity_id') == eid]
                assert sorted(p.id for p in members) == sorted(original['sourceIds'])
                keys = {name_key(n) for n in [entity['canonical_name'], *entity['aliases']]}
                keys.update(k for p in members for k in source_keys(p))
                assert sorted(p.id for p in sources if source_keys(p) & keys) == sorted(original['relatedSourceIds'])
                matching = [m for m in all_rows if scope_matches({'city': '济南', 'name_keys': keys}, m)]
                assert sorted(m['id'] for m in matching) == sorted(original['mentionIds'])
                for p in members:
                    assert source_fingerprint(source_input(p)) == frozen_sources[p.id]['sourceHash']
                    source_records[p.id] = {**source_input(p), 'sourceHash': source_fingerprint(source_input(p)),
                        'typicalVisitMinutes': p.typical_visit_minutes, 'typicalVisitSource': p.typical_visit_source,
                        'lat': p.latitude, 'lng': p.longitude, 'themeTags': p.theme_tags}
                for m in matching:
                    assert mention_fingerprint(m) == frozen_mentions[m['id']]['inputHash']
                    for field in NOTE_FIELDS:
                        assert m.get(field) == frozen_notes[m['raw_note_id']].get(field)
                    resolved = catalog.resolve(m)
                    assert resolved['status'] == 'resolved' and resolved['entity']['entity_id'] == eid
                    selected[m['id']] = {**{k: m.get(k) for k in MENTION_FIELDS},
                        'inputHash': mention_fingerprint(m), 'resolvedEntityId': eid, 'resolutionReason': resolved['reason']}
                groups.append(original)
            for mid in [12941, 12942, 12943, 12944]:
                assert selected[mid]['raw_note_id'] == 2837
                assert selected[mid]['fact_type'] == 'visit_duration' and selected[mid]['fact_value'] == {'minutes': 30}
            note = frozen_notes[2837]
            quote = '5️⃣王府池子、腾蛟泉、起凤泉、刘氏泉（p16）\n🕐游玩0.5h 🆓'
            assert quote in note['note_desc']
            note_ids = sorted({m['raw_note_id'] for m in selected.values()})
            report = {'readOnly': True, 'capturedAt': datetime.now(timezone.utc).isoformat(), 'city': '济南',
                'sourceFile': str(source_file.relative_to(root)).replace('\\', '/'), 'sourceSha256': hashlib.sha256(raw).hexdigest(),
                'groups': groups, 'sources': list(source_records.values()), 'mentions': list(selected.values()),
                'notes': [frozen_notes[n] for n in note_ids],
                'confirmedIssue': {'rawNoteId': 2837, 'quote': quote, 'mentionIds': [12941, 12942, 12943, 12944],
                    'scope': 'four_places_together', 'combinedMinutes': 30, 'incorrectIndividualMinutes': 30,
                    'identityConclusion': 'four_independent_places_named_explicitly',
                    'factConclusion': '组合总时长不能赋给每个独立地点，也不能无证据平分为每处7.5分钟。'},
                'fullIdentityReviewPassed': False, 'failures': []}
            with target.open('x', encoding='utf-8', newline='\n') as handle:
                handle.write(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
            print(json.dumps({'file': str(target.relative_to(root)), 'groups': len(groups), 'mentions': len(selected),
                'notes': len(note_ids), 'incorrectDurationMentions': 4, 'failures': []}, ensure_ascii=False))
    finally:
        await engine.dispose()

asyncio.run(main())
