"""只读重现旧时长抽取来源；读取既有文字分析，不查看图片。"""
from pathlib import Path
import asyncio,hashlib,json,sys
from collections import defaultdict
sys.dont_write_bytecode=True
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0,'D:/Project/xhs-travel-pipeline')
from sqlalchemy import select,text
from app.db import SessionFactory,engine
from app.models import RawNote,PlaceMention
from scripts.build_visit_duration import extract_note_durations
from app.clean.duration import aggregate_minutes
root=Path(__file__).resolve().parent
async def main():
    output=root/'priority-cities/济南/shared-routes-duration-provenance-01.json'
    assert not output.exists()
    try:
        async with SessionFactory() as s:
            await s.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            mentions=(await s.execute(select(PlaceMention.raw_note_id,PlaceMention.name,PlaceMention.normalized_name,PlaceMention.place_type).join(RawNote,RawNote.id==PlaceMention.raw_note_id).where(RawNote.city=='济南'))).all()
            notes=(await s.scalars(select(RawNote).where(RawNote.city=='济南'))).all()
            by_note=defaultdict(list)
            for nid,name,norm,typ in mentions:by_note[nid].append((name,norm,typ))
            results=[]
            for n in notes:
                entries=extract_note_durations(n.desc,n.img_analysis,by_note[n.id])
                for norm,minutes,sample in entries:
                    if norm not in ['解放阁','曲水亭街','曲水亭','百花洲']:continue
                    origins=[]
                    for label,desc,imgs in [('desc',n.desc,None)]+[(f'img_analysis[{i}]',None,[item]) for i,item in enumerate(n.img_analysis or [])]:
                        if any(a==norm and b==minutes for a,b,_ in extract_note_durations(desc,imgs,by_note[n.id])):
                            origins.append({'field':label,'text':desc if desc is not None else imgs[0]})
                    results.append({'noteId':n.id,'title':n.title,'nameKey':norm,'minutes':minutes,'sample':sample,'origins':origins})
            data={'readOnly':True,'businessMutations':False,'imageComparison':'deferred_by_user','method':'仅重现当前纯抽取函数；旧写库执行日志未提供，重现不宣称已证明历史写入链。','results':results,
                'aggregates':{key:aggregate_minutes([r['minutes'] for r in results if r['nameKey']==key],place_name=key,place_type='attraction') for key in ['解放阁','曲水亭街','百花洲']}}
            with output.open('x',encoding='utf-8') as f:json.dump(data,f,ensure_ascii=False,indent=2)
            print(json.dumps(data,ensure_ascii=False))
    finally:await engine.dispose()
asyncio.run(main())
