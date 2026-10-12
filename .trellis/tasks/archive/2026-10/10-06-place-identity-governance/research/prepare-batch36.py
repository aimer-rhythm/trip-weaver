"""四泉组合时长字段修正；泉体与簪花摄影主体待核提及单独保留null。"""
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
from app.models import CanonicalPlace, PlaceSummary
from app.aggregate.mention_identity import load_mention_catalog, load_mention_rows, source_input, source_keys
from app.aggregate.image_identity import load_image_rows
from app.clean.mention_identity import mention_fingerprint, source_fingerprint, scope_matches, NOTE_FIELDS

root = Path(__file__).resolve().parent
packet_file = 'priority-cities/济南/spring-source-packet-01.json'
review_file = 'priority-cities/济南/spring-source-review-02.json'
baseline_hash = 'f4e8391403aee0d5a3cc1d20b70762bd1eb8961840ba1965ebe9ba1f331c156a'
pending_id = 12692

def read(f): return json.loads((root / f).read_text(encoding='utf-8'))
def write(f, data):
    with (root / f).open('x', encoding='utf-8', newline='\n') as handle:
        handle.write(json.dumps(data, ensure_ascii=False, indent=2) + '\n')

async def main():
    pointer = read('cleaning-scope/current.json')
    assert pointer['latestAppliedEntityBatch'] == 35 and '济南' not in pointer['policy']['excludedCities']
    baseline = root / 'all-cities/batch-36-baseline.json'
    assert hashlib.sha256(baseline.read_bytes()).hexdigest() == baseline_hash
    packet = read(packet_file); assert packet['confirmedIssue']['mentionIds'] == [12941, 12942, 12943, 12944]
    bad_ids = set(packet['confirmedIssue']['mentionIds']); quote = packet['confirmedIssue']['quote']
    expected_groups = [g for g in packet['groups'] if any(i in bad_ids for i in g['mentionIds'])]
    assert len(expected_groups) == 4
    frozen = read(packet['sourceFile'])
    assert hashlib.sha256((root / packet['sourceFile']).read_bytes()).hexdigest() == packet['sourceSha256']
    paths = [f'all-cities/batch-36-{s}.json' for s in ['source', 'decisions', 'scope-decisions', 'export-expectations']] + [review_file]
    assert all(not (root / p).exists() for p in paths)
    groups, review_rows = [], []
    try:
        async with SessionFactory() as session:
            await session.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            catalog = await load_mention_catalog(session, '济南')
            all_sources = (await session.scalars(select(CanonicalPlace).where(CanonicalPlace.city == '济南'))).all()
            all_rows = await load_mention_rows(session, '济南')
            selected_note_ids = set()
            for g in expected_groups:
                assert len(g['sourceIds']) == 1
                pid = g['sourceIds'][0]; source = next(p for p in all_sources if p.id == pid)
                entity = catalog.catalog.resolve(place_id=pid)
                assert entity == g['entity'] and entity['revision'] == 1 and entity['status'] == 'ACTIVE'
                assert catalog.scope_for_source(pid) is None
                keys = source_keys(source)
                assert [p.id for p in all_sources if keys & source_keys(p)] == [pid]
                rows = [r for r in all_rows if scope_matches({'city': '济南', 'name_keys': keys}, r)]
                assert sorted(r['id'] for r in rows) == sorted(g['mentionIds'])
                fields = ['id','city','name','normalized_name','address','latitude','longitude','place_type','geo_status','amap_poi_id','is_active','quality_score']
                actual = {k: getattr(source, k) for k in fields}
                original = next(s for s in frozen['sources'] if s['id'] == pid)
                assert actual == {k: original[k] for k in fields}
                for row in rows:
                    old = next(m for m in packet['mentions'] if m['id'] == row['id'])
                    assert mention_fingerprint(row) == old['inputHash']
                    note = next(n for n in packet['notes'] if n['id'] == row['raw_note_id'])
                    assert all(row.get(k) == note.get(k) for k in NOTE_FIELDS)
                    selected_note_ids.add(row['raw_note_id'])
                    assignment = {'mentionId': row['id'], 'inputHash': old['inputHash'],
                        'entityId': None if row['id'] == pending_id else entity['entity_id']}
                    if row['id'] in bad_ids:
                        assert quote in row['note_desc']
                        assignment['factExclusions'] = {'visit_duration': {'reason': 'group_duration', 'quote': quote}}
                    review_rows.append({**assignment, 'sourceId': pid, 'noteId': row['raw_note_id'], 'name': row['name'],
                        'reason': '泉体与簪花少女摄影主体的范围尚待补证，先阻止描述混用；不判为非地点。' if row['id'] == pending_id
                        else '四处合计半小时，保留独立主体和描述，仅排除单点minutes。' if row['id'] in bad_ids
                        else '完整原文对应本独立泉体；不将街巷、桥、其他泉池或别名语境无限扩张。'})
                summary = await session.scalar(select(PlaceSummary).where(PlaceSummary.canonical_place_id == pid))
                groups.append({'entity': entity, 'source': actual, 'sourceHash': source_fingerprint(source_input(source)),
                    'summary': {k: getattr(summary, k) for k in ['canonical_place_id', 'mention_count_30d', 'recommend_score']},
                    'mentions': [{**r, 'inputHash': mention_fingerprint(r)} for r in rows]})
            images = [i for i in await load_image_rows(session, '济南')
                if i['source_place_id'] in {g['source']['id'] for g in groups} or i['raw_note_id'] in selected_note_ids]
            assert not images
        assert len(review_rows) == 11 and sum(r['entityId'] is not None for r in review_rows) == 10
        ledger = {'city': '济南', 'batch': 'batch-36', 'previousReview': 'priority-cities/济南/spring-source-review-01.json',
            'sourceFile': packet['sourceFile'], 'sourceSha256': packet['sourceSha256'],
            'summary': {'sources': 4, 'mentions': 11, 'fullNotes': len(selected_note_ids), 'resolved': 10,
                'durationFieldExclusions': 4, 'pending': 1, 'upstreamImages': 0}, 'rows': review_rows,
            'note': '四泉稳定ID和坐标保留，起凤泉唯一提及仍resolved；刘氏泉12692主体粒度待补证，不为了保留全部计数而声明归属已核实。'}
        write(review_file, ledger)
        evidence = {'kind': 'reviewed_duration_scope', 'file': review_file,
            'sha256': hashlib.sha256((root / review_file).read_bytes()).hexdigest(),
            'conclusion': '四个组合minutes不适用于各单点；四泉独立保留。12692摄影主体待审。'}
        scopes = []
        expectations = []
        for g in groups:
            pid = g['source']['id']; eid = g['entity']['entity_id']
            assignments = [{k: v for k, v in r.items() if k in ['mentionId','inputHash','entityId','factExclusions']}
                for r in review_rows if r['sourceId'] == pid]
            scopes.append({'key': f'all-cities-20261008-batch-36-duration-{pid}', 'city': '济南', 'sourcePlaceId': pid,
                'expectedSourceHash': g['sourceHash'], 'expectedScopeRevision': 0, 'expectedRevisions': {eid: 1},
                'assignments': assignments, 'evidence': [evidence]})
            expectations.append({'city': '济南', 'id': eid, 'name': g['entity']['canonical_name'], 'revision': 2,
                'verified': True, 'mentionIds': sorted(a['mentionId'] for a in assignments if a['entityId'])})
        data = {'readOnly': True, 'city': '济南', 'capturedAt': datetime.now(timezone.utc).isoformat(),
            'originalSourceFile': packet['sourceFile'], 'originalSourceSha256': packet['sourceSha256'],
            'baselineSha256': baseline_hash, 'groups': groups,
            'notes': [n for n in packet['notes'] if n['id'] in selected_note_ids], 'images': [], 'reviews': []}
        for p, value in zip(paths[:4], [data, [], scopes, expectations]): write(p, value)
        print(json.dumps({'batch': 'batch-36', 'sources': 4, 'mentions': 11, 'resolved': 10, 'durationExclusions': 4,
            'pending': [pending_id], 'sourceSha256': hashlib.sha256((root / paths[0]).read_bytes()).hexdigest()}, ensure_ascii=False))
    finally:
        await engine.dispose()

asyncio.run(main())
