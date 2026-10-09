"""只读冻结城市现行身份与原始字段；默认保留batch28入口，禁止覆盖旧冻结。"""
from pathlib import Path
import argparse
import asyncio
import hashlib
import json
import re
import sys
from datetime import datetime, timezone
sys.dont_write_bytecode = True
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, 'D:/Project/xhs-travel-pipeline')
from sqlalchemy import select, text
from app.db import SessionFactory, engine
from app.models import CanonicalPlace, PlaceEntityReview
from app.aggregate.place_identity import load_catalog

root = Path(__file__).resolve().parent

async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--batch', default='batch-28')
    parser.add_argument('--city', default='重庆')
    args = parser.parse_args()
    assert re.fullmatch(r'batch-\d{2}(?:-v\d+)?', args.batch)
    pointer = json.loads((root/'cleaning-scope/current.json').read_text(encoding='utf-8'))
    assert args.city not in pointer['policy'].get('excludedCities', []), '用户排除城市不处理'
    target = root/'all-cities'/f'{args.batch}-baseline.json'
    assert not target.exists(), '禁止覆盖冻结'
    try:
        async with SessionFactory() as session:
            await session.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            await session.execute(text("SET LOCAL statement_timeout='30s'"))
            catalog = await load_catalog(session, args.city)
            sources = (await session.scalars(select(CanonicalPlace).where(CanonicalPlace.city==args.city).order_by(CanonicalPlace.id))).all()
            fields = ['id','name','normalized_name','city','address','latitude','longitude','place_type','geo_status','amap_poi_id','is_active']
            entities = [{**e, 'places': [{**{k:getattr(p,k) for k in fields},'entity_id':e['entity_id']}
                for p in sources if catalog.members.get(p.id)==e['entity_id']]} for e in catalog.entities.values()]
            reviews = [{k:getattr(r,k) for k in ['id','fingerprint','city','status','detail']} for r in
                (await session.scalars(select(PlaceEntityReview).where(PlaceEntityReview.city==args.city).order_by(PlaceEntityReview.id))).all()]
            value = {'readOnly':True,'city':args.city,'capturedAt':datetime.now(timezone.utc).isoformat(),'entities':entities,'reviews':reviews}
            data = json.dumps(value,ensure_ascii=False,indent=2)+'\n'
            with target.open('x', encoding='utf-8', newline='\n') as handle:
                handle.write(data)
            print(json.dumps({'file':target.name,'entities':len(entities),'sources':len(sources),'reviews':len(reviews),
                'sha256':hashlib.sha256(target.read_bytes()).hexdigest()},ensure_ascii=False))
    finally:
        await engine.dispose()

asyncio.run(main())
