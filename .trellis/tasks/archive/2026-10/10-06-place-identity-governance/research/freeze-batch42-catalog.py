"""补充冻结同义合并留下的历史实体与成员，隔离预演不重造映射。"""
from pathlib import Path
import asyncio
import json
import hashlib
import sys
sys.dont_write_bytecode=True
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0,'D:/Project/xhs-travel-pipeline')
from sqlalchemy import select,text
from app.db import SessionFactory,engine
from app.models import PlaceEntityReview
from app.aggregate.place_identity import load_catalog
root=Path(__file__).resolve().parent
async def main():
    target=root/'all-cities/batch-42-catalog.json';assert not target.exists()
    source=json.loads((root/'all-cities/batch-42-source.json').read_text(encoding='utf-8'))
    eid=source['entity']['entity_id'];ids=set(source['entity']['legacy_ids'])
    try:
        async with SessionFactory() as session:
            await session.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            cat=await load_catalog(session,'济南');assert cat.entities[eid]==source['entity']
            members=[{'place_id':pid,'entity_id':cat.members[pid]} for pid in [5348,5953,5968]]
            assert all(m['entity_id'] in ids for m in members)
            entities=[cat.entities[i] for i in sorted(ids) if i in cat.entities]
            assert all(cat.root(e['entity_id'])['entity_id']==eid for e in entities)
            reviews=(await session.scalars(select(PlaceEntityReview).where(PlaceEntityReview.city=='济南'))).all()
            selected=[{k:getattr(r,k) for k in ['id','city','fingerprint','status','detail']} for r in reviews if ids & set(r.detail.get('entityIds',[]))]
            with target.open('x',encoding='utf-8') as f:json.dump({'readOnly':True,'entities':entities,'members':members,'reviews':selected},f,ensure_ascii=False,indent=2)
            print(json.dumps({'entities':len(entities),'members':len(members),'reviews':len(selected),
                'sha256':hashlib.sha256(target.read_bytes()).hexdigest()},ensure_ascii=False))
    finally:await engine.dispose()
asyncio.run(main())
