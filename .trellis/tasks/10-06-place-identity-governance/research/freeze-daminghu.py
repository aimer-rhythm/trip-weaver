"""只读冻结大明湖完整正文与现行身份；不读图片文件，不执行治理。"""
from pathlib import Path
import asyncio
import hashlib
import json
import sys
from datetime import datetime, timezone
sys.dont_write_bytecode=True
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0,'D:/Project/xhs-travel-pipeline')
from sqlalchemy import select,text
from app.db import SessionFactory,engine
from app.models import CanonicalPlace,PlaceSummary
from app.aggregate.mention_identity import load_mention_catalog,load_mention_rows,source_input,source_keys
from app.clean.mention_identity import mention_fingerprint,source_fingerprint,scope_matches

root=Path(__file__).resolve().parent
original=root/'priority-cities/济南/run-1791385235272324900/sources.json'
target=root/'priority-cities/济南/daminghu-source-packet-01.json'
eid='550d6810857b4487aae8ce39c9ee093b'
async def main():
    assert not target.exists()
    assert hashlib.sha256(original.read_bytes()).hexdigest()=='9aa559e894e1cfbcdf74db2214c8eeb6614739064a96967780c6b32af59a889b'
    frozen=json.loads(original.read_text(encoding='utf-8'))
    pointer=json.loads((root/'cleaning-scope/current.json').read_text(encoding='utf-8'))
    assert pointer['latestAppliedEntityBatch']==41 and pointer['imageComparisonPolicy']['status']=='deferred_by_user'
    try:
        async with SessionFactory() as session:
            await session.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            catalog=await load_mention_catalog(session,'济南')
            sources=(await session.scalars(select(CanonicalPlace).where(CanonicalPlace.city=='济南'))).all()
            all_rows=await load_mention_rows(session,'济南')
            old_group=next(g for g in frozen['groups'] if g['entity']['entity_id']==eid)
            keys=set(old_group['nameKeys'])
            selected=[s for s in sources if keys & source_keys(s)]
            assert {s.id for s in selected}=={5348,5953,5968}
            rows=[m for m in all_rows if scope_matches({'city':'济南','name_keys':keys},m)]
            assert {r['id'] for r in rows}==set(old_group['mentionIds'])
            for r in rows:
                assert mention_fingerprint(r)==next(m for m in frozen['mentions'] if m['id']==r['id'])['inputHash']
            groups=[]
            for s in selected:
                old=next(s0 for s0 in frozen['sources'] if s0['id']==s.id)
                assert source_fingerprint(source_input(s))==old['sourceHash']
                entity=catalog.catalog.resolve(place_id=s.id)
                assert entity['entity_id']==eid and entity['revision']==2
                assert catalog.scope_for_source(s.id) is None
                summary=await session.scalar(select(PlaceSummary).where(PlaceSummary.canonical_place_id==s.id))
                fields=['id','city','name','normalized_name','address','latitude','longitude','place_type','geo_status','amap_poi_id','is_active','quality_score']
                source={k:getattr(s,k) for k in fields}; assert source=={k:old[k] for k in fields}
                groups.append({'source':source,'sourceHash':old['sourceHash'],
                    'derivedBefore':{k:getattr(s,k) for k in ['typical_visit_minutes','typical_visit_source','theme_tags','content_profile']},
                    'summary':{k:getattr(summary,k) for k in ['canonical_place_id','mention_count_30d','recommend_score']}})
            notes=[]
            for nid in sorted({m['raw_note_id'] for m in rows}):
                m=next(m for m in rows if m['raw_note_id']==nid)
                notes.append({'id':nid,'city':m['note_city'],'title':m['note_title'],'desc':m['note_desc'],
                    'unavailable':m['note_unavailable'],'mentionIds':[r['id'] for r in rows if r['raw_note_id']==nid]})
            payload={'readOnly':True,'capturedAt':datetime.now(timezone.utc).isoformat(),'city':'济南','entity':entity,
                'originalSourceFile':str(original.relative_to(root)),'originalSourceSha256':hashlib.sha256(original.read_bytes()).hexdigest(),
                'sources':groups,'mentions':[{k:v for k,v in m.items() if k not in ['note_images','note_desc','note_title','source_url']} | {'inputHash':mention_fingerprint(m)} for m in rows],
                'notes':notes,'imageComparison':'deferred_by_user','businessMutations':False}
            with target.open('x',encoding='utf-8') as f: json.dump(payload,f,ensure_ascii=False,indent=2)
            print(json.dumps({'file':str(target.relative_to(root)),'sources':len(groups),'mentions':len(rows),'notes':len(notes),
                'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'nameKeys':sorted(keys)},ensure_ascii=False))
    finally: await engine.dispose()
asyncio.run(main())
