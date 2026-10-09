"""补齐普通来源导出实际使用的旧摘要字段，冻结只读，不修改已冻源包。"""
from pathlib import Path
import asyncio,json,sys
sys.dont_write_bytecode=True
sys.path.insert(0,'D:/Project/xhs-travel-pipeline')
from sqlalchemy import select,text
from app.db import SessionFactory,engine
from app.models import CanonicalPlace,PlaceSummary
root=Path(__file__).resolve().parent
async def main():
    p=json.loads((root/'cleaning-scope/current.json').read_text(encoding='utf-8'));assert p['latestAppliedEntityBatch']==54
    try:
        async with SessionFactory() as s:
            await s.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            rows=[]
            for sid in [5498,5957]:
                summary=await s.scalar(select(PlaceSummary).where(PlaceSummary.canonical_place_id==sid));source=await s.get(CanonicalPlace,sid)
                rows.append({'sourceId':sid,'adcode':source.adcode,'top_reasons':summary.top_reasons})
            with (root/'priority-cities/济南/laoshe-summary-supplement-01.json').open('x',encoding='utf-8') as f:
                json.dump({'readOnly':True,'beforeEntityBatch':55,'reason':'普通来源仍使用PlaceSummary.top_reasons；原隔离夹具仅冻结计数分数，遗漏该字段导致空topReasons。','rows':rows},f,ensure_ascii=False,indent=2)
    finally:await engine.dispose()
asyncio.run(main())
