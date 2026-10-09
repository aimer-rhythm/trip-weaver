"""只读冻结成都错城笔记的完整同名来源/提及/图片，禁止改原文或跨城认领。"""
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
from app.models import CanonicalPlace, PlaceEntityReview
from app.aggregate.mention_identity import load_mention_catalog, load_mention_rows, source_input, source_keys
from app.aggregate.image_identity import load_image_rows
from app.clean.mention_identity import MENTION_FIELDS, NOTE_FIELDS, mention_fingerprint, source_fingerprint, scope_matches
from app.clean.image_identity import image_fingerprint

root=Path(__file__).resolve().parent
folder=root/'cleaning-scope/run-1791371057197'

async def main():
    target=folder/'wrongcity-scope-source-01.json'
    assert not target.exists(), '禁止覆盖冻结'
    reviewed=json.loads((folder/'priority-evidence-01.json').read_text(encoding='utf-8'))
    requested={int(s['id']) for s in reviewed['relatedSources']}
    assert len(requested)==37
    try:
        async with SessionFactory() as session:
            await session.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            await session.execute(text("SET LOCAL statement_timeout='30s'"))
            city='成都'
            catalog=await load_mention_catalog(session,city)
            all_sources=(await session.scalars(select(CanonicalPlace).where(CanonicalPlace.city==city).order_by(CanonicalPlace.id))).all()
            all_rows=await load_mention_rows(session,city)
            all_images=await load_image_rows(session,city)
            reviews=(await session.scalars(select(PlaceEntityReview).where(PlaceEntityReview.city==city))).all()
            groups=[]
            seen=set()
            for source_id in sorted(requested):
                if source_id in seen:
                    continue
                anchor=next(p for p in all_sources if p.id==source_id)
                keys=source_keys(anchor)
                sources=[p for p in all_sources if keys & source_keys(p)]
                source_ids={p.id for p in sources}
                assert not seen & source_ids
                seen |= source_ids
                rows=[r for r in all_rows if scope_matches({'city':city,'name_keys':keys},r)]
                note_ids={r['raw_note_id'] for r in rows}
                images=[r for r in all_images if r['source_place_id'] in source_ids or r['raw_note_id'] in note_ids]
                entity_ids={catalog.catalog.resolve(place_id=p.id)['entity_id'] for p in sources}
                groups.append({'city':city,'sources':[{**source_input(p),'sourceHash':source_fingerprint(source_input(p)),
                    'entity':catalog.catalog.resolve(place_id=p.id),'address':p.address,'latitude':p.latitude,'longitude':p.longitude,
                    'place_type':p.place_type,'geo_status':p.geo_status,'is_active':p.is_active} for p in sources],
                    'mentions':[{**{k:r.get(k) for k in (*MENTION_FIELDS,*NOTE_FIELDS)},'inputHash':mention_fingerprint(r)} for r in rows],
                    'images':[{**r,'inputHash':image_fingerprint(r)} for r in images],
                    'existingScopes':[s for s in catalog.scopes.values() if entity_ids & set(s['entity_ids'])],
                    'reviews':[{k:getattr(r,k) for k in ['id','fingerprint','status','detail']} for r in reviews
                        if entity_ids & set(r.detail.get('entityIds',[]))]})
            data=json.dumps({'readOnly':True,'capturedAt':datetime.now(timezone.utc).isoformat(),'groups':groups},ensure_ascii=False,indent=2)+'\n'
            target.write_text(data,encoding='utf-8')
            print(json.dumps({'file':str(target.relative_to(root)),'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),
                'groups':[{'sourceIds':[s['id'] for s in g['sources']],'names':[s['name'] for s in g['sources']],
                    'noteIds':sorted({m['raw_note_id'] for m in g['mentions']}),'mentions':len(g['mentions']),
                    'images':len(g['images']),'scopes':len(g['existingScopes']),'reviews':len(g['reviews'])} for g in groups]},ensure_ascii=False))
    finally:
        await engine.dispose()

asyncio.run(main())
