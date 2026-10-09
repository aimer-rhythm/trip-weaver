"""只读评估同篇时长去重对现有受控导出的影响，不刷新原始缓存。"""
from pathlib import Path
import asyncio,json,sys
from collections import defaultdict
sys.dont_write_bytecode=True
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0,'D:/Project/xhs-travel-pipeline')
from sqlalchemy import text
from app.db import SessionFactory,engine
from app.aggregate.mention_identity import load_mention_catalog,load_mention_rows
from app.clean.mention_identity import effective_fact_value
root=Path(__file__).resolve().parent
async def main():
    result=[]
    try:
        async with SessionFactory() as s:
            await s.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            cat=await load_mention_catalog(s,'济南');rows=await load_mention_rows(s,'济南');groups=defaultdict(list)
            for row in rows:
                resolution=cat.resolve(row)
                if resolution['status']!='resolved':continue
                eid=resolution['entity']['entity_id']
                if eid not in cat.managed_entity_ids():continue
                facts=effective_fact_value(row,resolution);minutes=facts.get('minutes')
                if row['fact_type']=='visit_duration' and type(minutes) in (int,float) and minutes>=15 and (row['confidence'] or 0)>=.85:
                    groups[eid].append((row['raw_note_id'],int(minutes)))
            for eid,samples in groups.items():
                old=sorted(n for _,n in samples);new=sorted(n for _,n in set(samples))
                result.append({'entityId':eid,'name':cat.catalog.entities[eid]['canonical_name'],
                    'samples':len(old),'independentSamples':len(new),'beforeMedian':old[len(old)//2],'afterMedian':new[len(new)//2]})
        report={'readOnly':True,'entityBatch':42,'city':'济南','rows':result,
            'affectedExistingScopes':[r for r in result if r['beforeMedian']!=r['afterMedian']], 'rawCachesChanged':False}
        with (root/'priority-cities/济南/scoped-duration-sample-audit-01.json').open('x',encoding='utf-8') as f:json.dump(report,f,ensure_ascii=False,indent=2)
        print(json.dumps(report,ensure_ascii=False))
    finally:await engine.dispose()
asyncio.run(main())
