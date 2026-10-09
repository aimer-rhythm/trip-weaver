"""实际库只读比对发表、采集时间与完整raw_json散列。"""
from pathlib import Path
import asyncio,hashlib,json,sys
sys.dont_write_bytecode=True
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0,'D:/Project/xhs-travel-pipeline')
from sqlalchemy import text
from app.db import SessionFactory,engine
from app.models import RawNote
root=Path(__file__).resolve().parent
async def main():
    out=root/'priority-cities/济南/night-market-times-check-01.json';assert not out.exists()
    source=json.loads((root/'all-cities/batch-59-source.json').read_text(encoding='utf-8'))
    try:
        async with SessionFactory() as s:
            await s.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            for t in source['noteTimes']:
                n=await s.get(RawNote,t['noteId']);assert n.publish_time.isoformat()==t['publishTime'] and n.created_at.isoformat()==t['collectedAt']
                assert hashlib.sha256(json.dumps(n.raw_json,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()==t['rawJsonSha256']
                assert int(n.publish_time.timestamp()*1000)==next(v['value'] for v in t['rawTimeFields'] if v['path']=='.note_card.time')
        report={'batch':59,'readOnly':True,'notes':4,'publicationAndCollectionTimesPreserved':True,'rawJsonHashesPreserved':True,'publicationDoesNotProveVisitDate':True,'failures':[]}
        with out.open('x',encoding='utf-8') as f:json.dump(report,f,ensure_ascii=False,indent=2)
        print(json.dumps(report,ensure_ascii=False))
    finally:await engine.dispose()
asyncio.run(main())
