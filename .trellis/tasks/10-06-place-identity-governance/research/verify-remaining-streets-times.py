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
    out=root/'priority-cities/济南/remaining-streets-times-check-01.json';assert not out.exists()
    source=json.loads((root/'priority-cities/济南/remaining-streets-source-packet-01.json').read_text(encoding='utf-8'))
    try:
        async with SessionFactory() as s:
            await s.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            for t in source['noteTimes']:
                n=await s.get(RawNote,t['noteId']);assert n.publish_time.isoformat()==t['publishTime'] and n.created_at.isoformat()==t['collectedAt']
                assert hashlib.sha256(json.dumps(n.raw_json,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()==t['rawJsonSha256']
                assert int(n.publish_time.timestamp()*1000)==next(v['value'] for v in t['rawTimeFields'] if v['path']=='.note_card.time')
            extra=json.loads((root/'priority-cities/济南/remaining-streets-mixed-tip-source-01.json').read_text(encoding='utf-8'))
            for t in extra['notes']:
                n=await s.get(RawNote,t['noteId']);assert n.publish_time.isoformat()==t['publishTime'] and n.created_at.isoformat()==t['collectedAt']
                assert hashlib.sha256(json.dumps(n.raw_json or {},ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()==t['rawJsonSha256']
                assert hashlib.sha256(json.dumps(n.img_analysis or [],ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()==t['analysisSha256']
        report={'batch':62,'readOnly':True,'notes':len(source['noteTimes']),'supplementalNotes':1,'supplementalAnalysisPreserved':True,'publicationAndCollectionTimesPreserved':True,'rawJsonHashesPreserved':True,'publicationDoesNotProveVisitDate':True,'failures':[]}
        with out.open('x',encoding='utf-8') as f:json.dump(report,f,ensure_ascii=False,indent=2)
        print(json.dumps(report,ensure_ascii=False))
    finally:await engine.dispose()
asyncio.run(main())
