"""只读追溯芙蓉街混合图片文字提示；不读取图片文件或网络图片。"""
from pathlib import Path
from datetime import datetime,timezone
import asyncio,hashlib,json,sys
sys.dont_write_bytecode=True
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0,'D:/Project/xhs-travel-pipeline')
from sqlalchemy import select,text,cast,String
from app.db import SessionFactory,engine
from app.models import RawNote
root=Path(__file__).resolve().parent
target=root/'priority-cities/济南/remaining-streets-mixed-tip-source-01.json'
async def main():
    assert not target.exists()
    try:
        async with SessionFactory() as s:
            await s.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            notes=(await s.scalars(select(RawNote).where(RawNote.city=='济南',cast(RawNote.img_analysis,String).contains('别在芙蓉街')))).all()
            out=[]
            for n in notes:
                matches=[]
                def scan(v,path=''):
                    if isinstance(v,str) and '别在芙蓉街' in v:matches.append({'path':path,'text':v})
                    elif isinstance(v,dict):
                        for k,x in v.items():scan(x,path+'.'+k)
                    elif isinstance(v,list):
                        for i,x in enumerate(v):scan(x,path+'.'+str(i))
                scan(n.img_analysis or [])
                out.append({'noteId':n.id,'title':n.title,'desc':n.desc,'publishTime':n.publish_time.isoformat() if n.publish_time else None,
                    'collectedAt':n.created_at.isoformat(),'rawJsonSha256':hashlib.sha256(json.dumps(n.raw_json or {},ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest(),
                    'analysisSha256':hashlib.sha256(json.dumps(n.img_analysis or [],ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest(),'matchingText':matches})
            report={'capturedAt':datetime.now(timezone.utc).isoformat(),'readOnly':True,'imageComparison':'deferred_by_user','notes':out}
            with target.open('x',encoding='utf-8') as f:json.dump(report,f,ensure_ascii=False,indent=2)
            print(json.dumps(report,ensure_ascii=False))
    finally:await engine.dispose()
asyncio.run(main())
