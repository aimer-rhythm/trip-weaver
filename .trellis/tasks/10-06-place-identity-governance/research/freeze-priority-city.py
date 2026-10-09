"""按当前重点清单只读冻结一个城市的完整来源；共同笔记只存一次。"""
from pathlib import Path
import argparse
import asyncio
import hashlib
import json
import sys
import time
from datetime import datetime, timezone
sys.dont_write_bytecode=True
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0,'D:/Project/xhs-travel-pipeline')
from sqlalchemy import select,text
from app.db import SessionFactory,engine
from app.models import CanonicalPlace,PlaceEntityReview
from app.aggregate.mention_identity import load_mention_catalog,load_mention_rows,source_input,source_keys
from app.aggregate.image_identity import load_image_rows
from app.clean.identity import name_key
from app.clean.mention_identity import MENTION_FIELDS,NOTE_FIELDS,mention_fingerprint,source_fingerprint,scope_matches
from app.clean.image_identity import image_fingerprint
root=Path(__file__).resolve().parent

async def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--city',required=True)
    args=parser.parse_args()
    pointer=json.loads((root/'cleaning-scope/current.json').read_text(encoding='utf-8'))
    assert args.city not in pointer['policy'].get('excludedCities',[]), '用户排除的城市不处理'
    scope_bytes=(root/'cleaning-scope'/pointer['scopeFile']).read_bytes()
    assert hashlib.sha256(scope_bytes).hexdigest()==pointer['scopeSha256']
    scope=json.loads(scope_bytes)
    primary=[r for r in scope['selected'] if r['place']['city']==args.city]
    deps=[r for r in scope['dependencies'] if r['city']==args.city]
    requested={r['place']['id'] for r in primary}|{r['id'] for r in deps}
    assert primary, '城市不在当前重点清单'
    try:
        async with SessionFactory() as session:
            await session.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            await session.execute(text("SET LOCAL statement_timeout='30s'"))
            catalog=await load_mention_catalog(session,args.city)
            for r in primary:
                e=catalog.catalog.root(r['place']['id'])
                assert e and e['entity_id']==r['place']['id'] and e['revision']==r['place']['revision'], '清单版本过期，先重新冻结范围'
            all_sources=(await session.scalars(select(CanonicalPlace).where(CanonicalPlace.city==args.city).order_by(CanonicalPlace.id))).all()
            all_rows=await load_mention_rows(session,args.city)
            groups=[]
            selected_source_ids=set()
            selected_mention_ids=set()
            for eid in sorted(requested):
                e=catalog.catalog.root(eid)
                assert e and e['entity_id']==eid
                members=[p for p in all_sources if (catalog.catalog.resolve(place_id=p.id) or {}).get('entity_id')==eid]
                keys={name_key(n) for n in [e['canonical_name'],*e['aliases']] if n}
                keys.update(k for p in members for k in source_keys(p))
                related=[p for p in all_sources if keys & source_keys(p)]
                matches=[r for r in all_rows if scope_matches({'city':args.city,'name_keys':keys},r)]
                selected_source_ids.update(p.id for p in related)
                selected_mention_ids.update(r['id'] for r in matches)
                groups.append({'entity':e,'sourceIds':[p.id for p in members],'relatedSourceIds':[p.id for p in related],
                    'nameKeys':sorted(keys),'mentionIds':[r['id'] for r in matches]})
            rows=[r for r in all_rows if r['id'] in selected_mention_ids]
            note_ids={r['raw_note_id'] for r in rows}
            sources=[p for p in all_sources if p.id in selected_source_ids]
            images=[r for r in await load_image_rows(session,args.city)
                if r['source_place_id'] in selected_source_ids or r['raw_note_id'] in note_ids]
            reviews=(await session.scalars(select(PlaceEntityReview).where(PlaceEntityReview.city==args.city).order_by(PlaceEntityReview.id))).all()
            fields=['address','latitude','longitude','place_type','geo_status','amap_poi_id','is_active','quality_score']
            data={'readOnly':True,'capturedAt':datetime.now(timezone.utc).isoformat(),'city':args.city,
                'scopeFile':pointer['scopeFile'],'scopeSha256':pointer['scopeSha256'],'primary':len(primary),'dependencies':len(deps),
                'groups':groups,'sources':[{**source_input(p),**{k:getattr(p,k) for k in fields},
                    'sourceHash':source_fingerprint(source_input(p)),'entity':catalog.catalog.resolve(place_id=p.id)} for p in sources],
                'notes':list({r['raw_note_id']:{'id':r['raw_note_id'],**{k:r.get(k) for k in NOTE_FIELDS}} for r in rows}.values()),
                'mentions':[{**{k:r.get(k) for k in MENTION_FIELDS},'inputHash':mention_fingerprint(r)} for r in rows],
                'images':[{**r,'inputHash':image_fingerprint(r)} for r in images],
                'existingScopes':list(catalog.scopes.values()),'assignments':list(catalog.assignments.values()),
                'reviews':[{k:getattr(r,k) for k in ['id','fingerprint','city','status','detail']} for r in reviews]}
            folder=root/'priority-cities'/args.city/f'run-{time.time_ns()}'
            folder.mkdir(parents=True,exist_ok=False)
            target=folder/'sources.json'
            target.write_bytes((json.dumps(data,ensure_ascii=False,indent=2)+'\n').encode())
            manifest={'file':'sources.json','sha256':hashlib.sha256(target.read_bytes()).hexdigest(),
                'city':args.city,'primary':len(primary),'dependencies':len(deps),'sources':len(sources),
                'mentions':len(rows),'notes':len(note_ids),'images':len(images)}
            (folder/'manifest.json').write_bytes((json.dumps(manifest,ensure_ascii=False,indent=2)+'\n').encode())
            print(json.dumps({'folder':str(folder.relative_to(root)),**manifest},ensure_ascii=False))
    finally:
        await engine.dispose()

asyncio.run(main())
