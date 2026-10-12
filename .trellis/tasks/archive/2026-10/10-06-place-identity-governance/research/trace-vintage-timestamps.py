"""只读追溯第50批148条看点的时间回填，不改生产数据或旧证据。"""
from pathlib import Path
import asyncio, hashlib, json, sys
from collections import Counter, defaultdict
from datetime import datetime, timezone

sys.dont_write_bytecode = True
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, 'D:/Project/xhs-travel-pipeline')
from sqlalchemy import select, text
from app.db import SessionFactory, engine
from app.models import CanonicalPlace
from app.aggregate.mention_identity import load_mention_catalog, load_mention_rows
from app.clean.mention_identity import effective_mention, mention_fingerprint
from app.clean.alias import resolve_alias
from app.clean.place_content import legacy_highlights, build_place_content

ROOT = Path(__file__).resolve().parent
OUT = ROOT / 'priority-cities/济南/vintage-timestamp-provenance-01.json'

def read(path):
    return json.loads((ROOT / path).read_text(encoding='utf-8'))

async def main():
    assert not OUT.exists(), '证据不能覆盖'
    check = read('priority-cities/济南/vintage-downstream-check-01.json')
    old = {p['id']: p for p in read('all-cities/batch-50/sync-01/preview-济南/library-before.json')['tables']['canonical_places']}
    new = {p['id']: p for p in read('all-cities/batch-50/sync-01/xhs-places-济南.json')['places']}
    changes = check['fallbackObservedAtChanges']
    assert len(changes) == 148 and len({r['entityId'] for r in changes}) == 127
    try:
        async with SessionFactory() as session:
            await session.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            cat = await load_mention_catalog(session, '济南')
            managed = cat.managed_entity_ids()
            sources = (await session.scalars(select(CanonicalPlace).where(CanonicalPlace.city == '济南'))).all()
            root_keys = defaultdict(set)
            for source in sources:
                entity = cat.catalog.resolve(place_id=source.id)
                if entity:
                    root_keys[entity['entity_id']].add(resolve_alias(source.normalized_name, '济南'))
            rows = await load_mention_rows(session, '济南')
            legacy = []
            for raw in sorted(rows, key=lambda r: (-(r['confidence'] or 0), r['id'])):
                resolution = cat.resolve(raw)
                if resolution['status'] == 'review' or raw['note_unavailable']:
                    continue
                entity_id = (resolution.get('entity') or {}).get('entity_id')
                scoped = entity_id in managed
                row = effective_mention(raw, resolution) if scoped else raw
                content = (row['fact_value'] or {}).get('placeContent')
                if isinstance(content, dict) and content.get('version') == 1:
                    continue
                if row['mention_type'] != 'recommend' or not row['reason']:
                    continue
                if scoped and 'place_content' in (resolution.get('factExclusions') or {}):
                    continue
                for item in legacy_highlights(row['reason'], row['source_url']):
                    assert 'observedAt' not in item
                    legacy.append((row, item, scoped, entity_id, mention_fingerprint(raw)))
            result = []
            for change in changes:
                eid, index = change['entityId'], change['highlightIndex']
                before, after = old[eid]['payload']['content'], new[eid]['payload']['content']
                bh, ah = before['highlights'][index], after['highlights'][index]
                assert bh['observedAt'] == before['compiledAt'] and ah['observedAt'] == after['compiledAt']
                assert {k:v for k,v in bh.items() if k != 'observedAt'} == {k:v for k,v in ah.items() if k != 'observedAt'}
                matches = []
                for row, item, scoped, owner, fingerprint in legacy:
                    if scoped and owner != eid:
                        continue
                    if not scoped and (eid in managed or resolve_alias(row['name'], '济南') not in root_keys[eid]):
                        continue
                    if any(item[k] != ah[k] for k in ('text', 'quote', 'sourceUrl')):
                        continue
                    assert build_place_content([item], before['compiledAt'])['highlights'] == [bh]
                    assert build_place_content([item], after['compiledAt'])['highlights'] == [ah]
                    matches.append({'mentionId': row['id'], 'noteId': row['raw_note_id'],
                        'name': row['name'], 'inputHash': fingerprint, 'rawNoteCreatedAt': row['observed_at'],
                        'path': 'scoped_legacy_reason' if scoped else 'ordinary_legacy_reason',
                        'legacyItemHasObservedAt': False})
                assert matches, f'未匹配到真实旧reason: {eid}/{index}'
                result.append({**change, 'beforeObservedAt': bh['observedAt'], 'afterObservedAt': ah['observedAt'],
                    'text': ah['text'], 'quote': ah['quote'], 'sourceUrl': ah['sourceUrl'], 'matches': matches})
            matches = [m for r in result for m in r['matches']]
            stats = {'highlights': len(result), 'entities': len({r['entityId'] for r in result}),
                'matchedMentions': len({m['mentionId'] for m in matches}), 'matchedNotes': len({m['noteId'] for m in matches}),
                'highlightsWithSourceDate': sum(all(m['rawNoteCreatedAt'] for m in r['matches']) for r in result),
                'matchesWithoutSourceDate': sum(m['rawNoteCreatedAt'] is None for m in matches),
                'paths': dict(Counter(m['path'] for m in matches))}
            files = ['app/clean/place_content.py', 'app/aggregate/mention_identity.py',
                'app/clean/scoped_place_export.py', 'scripts/export_to_tripweaver.py']
            report = {'batch': 50, 'readOnly': True, 'at': datetime.now(timezone.utc).isoformat(), 'stats': stats,
                'correctsExplanationIn': 'priority-cities/济南/vintage-downstream-check-01.json#/fallbackObservedAtMeaning',
                'cause': '未携带observedAt的旧reason看点以编译时间回填；不能解释为原始来源日期缺失。',
                'dateSemantics': 'load_mention_rows.observed_at读取RawNote.created_at；本次不将其进一步解释为游览时间或发布时间。',
                'reproduction': '按现行目录、原提及、有效字段和普通/受控路径匹配text/quote/sourceUrl，再以两次compiledAt调用原build_place_content逐项重现。不是历史写库日志证明。',
                'productionFixApplied': False, 'separateMetadataFinding': True,
                'sourceCode': [{'path': f, 'sha256': hashlib.sha256((Path('D:/Project/xhs-travel-pipeline') / f).read_bytes()).hexdigest()} for f in files],
                'rows': result, 'imageComparison': 'deferred_by_user', 'failures': []}
            with OUT.open('x', encoding='utf-8') as file:
                json.dump(report, file, ensure_ascii=False, indent=2)
            print(json.dumps({'file': str(OUT.relative_to(ROOT)), 'stats': stats, 'failures': []}, ensure_ascii=False))
    finally:
        await engine.dispose()

asyncio.run(main())
