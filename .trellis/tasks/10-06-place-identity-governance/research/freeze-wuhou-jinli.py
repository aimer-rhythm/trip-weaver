"""只读核对武侯祠/锦里全部提及，追溯正在消费的混合tips；不读取图片。"""
from pathlib import Path
from datetime import datetime, timezone
import asyncio, hashlib, json, sys
sys.dont_write_bytecode = True
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, 'D:/Project/xhs-travel-pipeline')
from sqlalchemy import select, text
from app.db import SessionFactory, engine
from app.models import CanonicalPlace, PlaceSummary, RawNote
from app.aggregate.mention_identity import load_mention_catalog, load_mention_rows, source_input
from app.clean.mention_identity import mention_fingerprint, source_fingerprint, scope_matches

root = Path(__file__).resolve().parent
base = root / 'priority-cities/成都/run-1791504271958861000'
target = root / 'priority-cities/成都/wuhou-jinli-source-01.json'
def read(p): return json.loads(p.read_text(encoding='utf-8'))
def digest(v): return hashlib.sha256(json.dumps(v, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
def note_value(n):
    return {'id': n.id, 'city': n.city, 'title': n.title, 'desc': n.desc, 'images': n.img_analysis,
            'status': n.status, 'sourceUrl': n.source_url, 'observedAt': n.created_at.isoformat(),
            'publishedAt': n.publish_time.isoformat() if n.publish_time else None,
            'analysisSha256': digest(n.img_analysis), 'rawJsonSha256': digest(n.raw_json)}

async def main():
    assert not target.exists()
    pointer = read(root/'cleaning-scope/current.json')
    assert pointer['latestAppliedEntityBatch'] == 69 and pointer['pendingVerification'] == []
    assert pointer['imageComparisonPolicy']['status'] == 'deferred_by_user' and pointer['userAcceptance'] is False
    frozen, details = read(base/'sources.json'), read(base/'details.json')
    groups = [g for g in frozen['groups'] if g['entity']['primary_place_id'] in (1688, 1689)]
    mids = {mid for g in groups for mid in g['mentionIds']}
    expected = [m for m in details['mentions'] if m['id'] in mids]
    note_ids = {m['raw_note_id'] for m in expected}
    sources = [s for s in details['sources'] if s['source']['id'] in (1688, 1689)]
    exported = read(root/'all-cities/batch-69/sync-01/xhs-places-成都.json')['places']
    consumed_tips = [tip for p in exported if p['name'] in ('武侯祠', '锦里') for tip in p['payload'].get('tips', [])]
    assert len(expected) == 43 and len(note_ids) == 27 and len(consumed_tips) == 4
    try:
        async with SessionFactory() as session:
            await session.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            catalog = await load_mention_catalog(session, '成都')
            rows = await load_mention_rows(session, '成都')
            for g in groups:
                assert catalog.catalog.entities[g['entity']['entity_id']] == g['entity']
                assert catalog.scope_for_source(g['entity']['primary_place_id']) is None
                actual = [m for m in rows if scope_matches({'city': '成都', 'name_keys': g['nameKeys']}, m)]
                assert {m['id']: mention_fingerprint(m) for m in actual} == {m['id']: m['inputHash'] for m in expected if m['id'] in g['mentionIds']}
            for entry in sources:
                p = await session.get(CanonicalPlace, entry['source']['id'])
                assert source_fingerprint(source_input(p)) == entry['sourceHash']
                for key, value in {**entry['source'], **entry['derivedBefore'], **entry['supplement']}.items(): assert getattr(p, key) == value
                summary = await session.scalar(select(PlaceSummary).where(PlaceSummary.canonical_place_id == p.id))
                for key, value in entry['summary'].items(): assert getattr(summary, key) == value
            notes, tip_sources = [], []
            for n in (await session.scalars(select(RawNote).where(RawNote.city == '成都').order_by(RawNote.id))).all():
                matched = []
                for index, im in enumerate(n.img_analysis or []):
                    if not isinstance(im, dict): continue
                    raw_tips = (im.get('key_info') or {}).get('tips')
                    candidates = raw_tips if isinstance(raw_tips, list) else [raw_tips]
                    for tip in candidates:
                        if isinstance(tip, str) and any(tip.startswith(old) for old in consumed_tips):
                            matched.append({'noteId': n.id, 'imageIndex': index, 'originalTip': tip,
                                            'consumedPrefixes': [old for old in consumed_tips if tip.startswith(old)]})
                if n.id in note_ids or matched:
                    current = note_value(n)
                    if n.id in note_ids:
                        old = next(o for o in details['noteDetails'] if o['id'] == n.id)
                        for key, value in current.items(): assert old[key] == value, (n.id, key)
                    notes.append(current)
                tip_sources.extend(matched)
            assert note_ids <= {n['id'] for n in notes}
            packet = {'readOnly': True, 'capturedAt': datetime.now(timezone.utc).isoformat(), 'city': '成都', 'entityBatch': 69,
                      'originalSourceFile': str((base/'sources.json').relative_to(root)), 'originalSourceSha256': hashlib.sha256((base/'sources.json').read_bytes()).hexdigest(),
                      'originalDetailsFile': str((base/'details.json').relative_to(root)), 'originalDetailsSha256': hashlib.sha256((base/'details.json').read_bytes()).hexdigest(),
                      'groups': groups, 'sources': sources, 'mentions': expected, 'noteDetails': notes,
                      'catalog': {'entities': [g['entity'] for g in groups], 'members': [m for m in details['catalog']['members'] if m['place_id'] in (1688, 1689)],
                                  'reviews': [r for r in details['catalog']['reviews'] if any(g['entity']['entity_id'] in r['detail'].get('entityIds', []) for g in groups)]},
                      'tipSources': tip_sources, 'cityWideAssignments': len(catalog.assignments),
                      'imageComparison': 'deferred_by_user', 'imagesViewed': 0, 'businessMutations': False, 'failures': []}
            with target.open('x', encoding='utf-8') as out: json.dump(packet, out, ensure_ascii=False, indent=2); out.write('\n')
        print(json.dumps({'file': str(target.relative_to(root)), 'sha256': hashlib.sha256(target.read_bytes()).hexdigest(),
                          'sources': len(sources), 'mentions': len(expected), 'directFullNotes': len(note_ids), 'supplementalNotes': sorted({n['id'] for n in notes}-note_ids),
                          'tipSources': [{'noteId': t['noteId'], 'imageIndex': t['imageIndex'], 'matchedPrefixes': len(t['consumedPrefixes'])} for t in tip_sources], 'businessMutations': False}, ensure_ascii=False))
    finally: await engine.dispose()
asyncio.run(main())
