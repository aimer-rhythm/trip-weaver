"""只读冻结黑虎泉、千佛山的现行身份和全部原文；不查看图片。"""
from pathlib import Path
import asyncio
import hashlib
import json
import sys
from datetime import datetime,timezone
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
target=root/'priority-cities/济南/main-sights-source-packet-01.json'
ids=['136719df189e0dd70cd34be75f6faef4','290bf0287b4fc3936cb552acd37abca4']
async def main():
    assert not target.exists()
    assert hashlib.sha256(original.read_bytes()).hexdigest()=='9aa559e894e1cfbcdf74db2214c8eeb6614739064a96967780c6b32af59a889b'
    frozen=json.loads(original.read_text(encoding='utf-8'))
    pointer=json.loads((root/'cleaning-scope/current.json').read_text(encoding='utf-8'))
    assert pointer['latestAppliedEntityBatch']==42 and pointer['imageComparisonPolicy']['status']=='deferred_by_user'
    try:
        async with SessionFactory() as s:
            await s.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            cat=await load_mention_catalog(s,'济南')
            sources=(await s.scalars(select(CanonicalPlace).where(CanonicalPlace.city=='济南'))).all()
            rows=await load_mention_rows(s,'济南');groups=[];selected={}
            for eid in ids:
                old=next(g for g in frozen['groups'] if g['entity']['entity_id']==eid)
                keys=set(old['nameKeys'])
                current=[m for m in rows if scope_matches({'city':'济南','name_keys':keys},m)]
                assert {m['id'] for m in current}==set(old['mentionIds'])
                for m in current:
                    assert mention_fingerprint(m)==next(v for v in frozen['mentions'] if v['id']==m['id'])['inputHash']
                    selected[m['id']]=m
                members=[]
                for source in [v for v in sources if keys&source_keys(v)]:
                    raw=next(v for v in frozen['sources'] if v['id']==source.id)
                    assert source_fingerprint(source_input(source))==raw['sourceHash']
                    entity=cat.catalog.resolve(place_id=source.id)
                    assert entity['entity_id']==eid and cat.scope_for_source(source.id) is None
                    summary=await s.scalar(select(PlaceSummary).where(PlaceSummary.canonical_place_id==source.id))
                    fields=['id','city','name','normalized_name','address','latitude','longitude','place_type','geo_status','amap_poi_id','is_active','quality_score']
                    data={k:getattr(source,k) for k in fields};assert data=={k:raw[k] for k in fields}
                    members.append({'source':data,'sourceHash':raw['sourceHash'],
                        'derivedBefore':{k:getattr(source,k) for k in ['typical_visit_minutes','typical_visit_source','theme_tags','content_profile']},
                        'summary':{k:getattr(summary,k) for k in ['canonical_place_id','mention_count_30d','recommend_score']}})
                groups.append({'entity':entity,'sources':members,'nameKeys':sorted(keys),'mentionIds':[m['id'] for m in current]})
            notes=[]
            for nid in sorted({m['raw_note_id'] for m in selected.values()}):
                m=next(m for m in selected.values() if m['raw_note_id']==nid)
                notes.append({'id':nid,'city':m['note_city'],'title':m['note_title'],'desc':m['note_desc'],
                    'unavailable':m['note_unavailable'],'mentionIds':[m['id'] for m in selected.values() if m['raw_note_id']==nid]})
            payload={'readOnly':True,'capturedAt':datetime.now(timezone.utc).isoformat(),'city':'济南','groups':groups,
                'originalSourceFile':str(original.relative_to(root)),'originalSourceSha256':hashlib.sha256(original.read_bytes()).hexdigest(),
                'mentions':[{k:v for k,v in m.items() if k not in ['note_images','note_desc','note_title','source_url']}|{'inputHash':mention_fingerprint(m)} for m in selected.values()],
                'notes':notes,'imageComparison':'deferred_by_user','businessMutations':False}
            with target.open('x',encoding='utf-8') as out:json.dump(payload,out,ensure_ascii=False,indent=2)
            print(json.dumps({'file':str(target.relative_to(root)),'groups':[(g['entity']['canonical_name'],len(g['mentionIds'])) for g in groups],
                'notes':len(notes),'sha256':hashlib.sha256(target.read_bytes()).hexdigest()},ensure_ascii=False))
    finally:await engine.dispose()
asyncio.run(main())
