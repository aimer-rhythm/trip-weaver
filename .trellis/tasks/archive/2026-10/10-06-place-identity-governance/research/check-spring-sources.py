"""第36批后五泉完整来源及普通图片事实补查；只读、不改原始资料。"""
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
from app.clean.mention_identity import MENTION_FIELDS, NOTE_FIELDS, mention_fingerprint, source_fingerprint, scope_matches

root = Path(__file__).resolve().parent
folder = root / 'priority-cities/济南'
target = folder / 'spring-upstream-check-01.json'
original_path = folder / 'run-1791385235272324900/sources.json'
assert hashlib.sha256(original_path.read_bytes()).hexdigest() == '9aa559e894e1cfbcdf74db2214c8eeb6614739064a96967780c6b32af59a889b'
frozen = json.loads(original_path.read_bytes())
old_packet = json.loads((folder / 'spring-source-packet-01.json').read_bytes())
names = {g['entity']['canonical_name'] for g in old_packet['groups']}
expected_revisions = {g['entity']['entity_id']: (1 if g['entity']['canonical_name'] == '玛瑙泉' else 2) for g in old_packet['groups']}

async def main():
    assert not target.exists()
    try:
        async with SessionFactory() as session:
            await session.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            await session.execute(text("SET LOCAL statement_timeout='30s'"))
            sources = (await session.scalars(select(CanonicalPlace).where(CanonicalPlace.city == '济南'))).all()
            by_source = {p.id:p for p in sources}
            mentions = await load_mention_rows(session, '济南')
            by_mention = {m['id']:m for m in mentions}
            for original in frozen['sources']:
                p = by_source[original['id']]
                assert source_fingerprint(source_input(p)) == original['sourceHash']
                for key in ['name','normalized_name','city','address','latitude','longitude','place_type','geo_status','amap_poi_id','is_active','quality_score']:
                    assert getattr(p,key) == original[key], (p.id,key)
            for original in frozen['mentions']:
                assert mention_fingerprint(by_mention[original['id']]) == original['inputHash']
            catalog = await load_mention_catalog(session, '济南')
            image_rows = await load_image_rows(session, '济南')
            groups, selected = [], {}
            for original in old_packet['groups']:
                eid = original['entity']['entity_id']
                entity = catalog.catalog.root(eid)
                assert entity['entity_id'] == eid and entity['canonical_name'] in names
                assert entity['revision'] == expected_revisions[eid] and entity['status'] == 'ACTIVE'
                assert entity['overrides'] == original['entity']['overrides']
                members = [p for p in sources if catalog.catalog.members.get(p.id) == eid]
                assert sorted(p.id for p in members) == sorted(original['sourceIds'])
                keys = {name_key(n) for n in [entity['canonical_name'], *entity['aliases']]}
                keys.update(k for p in members for k in source_keys(p))
                assert sorted(p.id for p in sources if source_keys(p) & keys) == sorted(original['relatedSourceIds'])
                matching = [m for m in mentions if scope_matches({'city':'济南','name_keys':keys},m)]
                assert sorted(m['id'] for m in matching) == sorted(original['mentionIds'])
                for m in matching:
                    resolution = catalog.resolve(m)
                    assert resolution['status'] == ('review' if m['id'] == 12692 else 'resolved')
                    if resolution['status'] == 'resolved': assert resolution['entity']['entity_id'] == eid
                    if m['id'] in {12941,12942,12943,12944}:
                        assert resolution['factExclusions']['visit_duration']['reason'] == 'group_duration'
                        assert m['fact_value'] == {'minutes':30}
                    selected[m['id']] = {**{k:m.get(k) for k in MENTION_FIELDS},'inputHash':mention_fingerprint(m),
                        'resolutionStatus':resolution['status'],'resolutionReason':resolution['reason'],
                        'entityId':resolution.get('entity',{}).get('entity_id'),'factExclusions':resolution.get('factExclusions')}
                ids = {m['raw_note_id'] for m in matching}
                images = [r for r in image_rows if r['source_place_id'] in original['sourceIds'] or r['raw_note_id'] in ids]
                groups.append({'entity':entity,'sourceIds':original['sourceIds'],'mentionIds':sorted(m['id'] for m in matching),
                    'noteIds':sorted(ids),'upstreamManagedImageKeys':[r['image_key'] for r in images],
                    'sources':[{'id':p.id,'name':p.name,'placeType':p.place_type,'themes':p.theme_tags,
                        'lat':p.latitude,'lng':p.longitude,'address':p.address} for p in members]})
            notes = (await session.scalars(select(RawNote).where(RawNote.city == '济南'))).all()
            note_ids = {m['raw_note_id'] for m in selected.values()}
            supplemental = []
            for note in notes:
                matched = sorted(name for name in names if name in json.dumps(note.img_analysis,ensure_ascii=False))
                if not matched: continue
                record = {'id':note.id,'city':note.city,'title':note.title,'desc':note.desc,
                    'img_analysis':note.img_analysis,'status':note.status,'source_url':note.source_url}
                supplemental.append({'matchedNames':matched,'note':record,'inputHash':hashlib.sha256(json.dumps(record,
                    ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()})
            report = {'readOnly':True,'capturedAt':datetime.now(timezone.utc).isoformat(),'city':'济南','entityBatch':36,
                'rawSourcesUnchanged':107,'originalMentionsUnchanged':662,'originalNotesCovered':82,
                'groups':groups,'mentions':list(selected.values()),'notes':[n for n in frozen['notes'] if n['id'] in note_ids],
                'supplementalImageFactNotes':supplemental,'fullReviewPassed':False,'failures':[]}
            with target.open('x',encoding='utf-8') as out: json.dump(report,out,ensure_ascii=False,indent=2)
            print(json.dumps({'file':str(target.relative_to(root)),'groups':len(groups),'mentions':len(selected),
                'notes':len(note_ids),'supplementalImageNotes':len(supplemental),'upstreamImages':sum(len(g['upstreamManagedImageKeys']) for g in groups)},ensure_ascii=False))
    finally:
        await engine.dispose()

asyncio.run(main())
