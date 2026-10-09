"""正式同步后的只读上游原输入/身份保全，不写笔记、实体或派生缓存。"""
import asyncio, hashlib, json, sys
from pathlib import Path
from datetime import datetime, timezone
sys.dont_write_bytecode = True
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, 'D:/Project/xhs-travel-pipeline')
from sqlalchemy import select, text
from app.db import SessionFactory, engine
from app.models import CanonicalPlace, PlaceRelationSnapshot
from app.aggregate.mention_identity import load_mention_catalog, load_mention_rows
ROOT = Path(__file__).resolve().parent

async def main():
    baseline = json.loads((ROOT / 'metadata/content-dates-01/preview/report.json').read_text(encoding='utf-8'))
    output = ROOT / 'metadata/content-dates-01/upstream-check.json'
    assert not output.exists()
    try:
        async with SessionFactory() as session:
            await session.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            cat = await load_mention_catalog(session, '济南')
            rows = await load_mention_rows(session, '济南')
            sources = (await session.execute(select(CanonicalPlace.name, CanonicalPlace.normalized_name).where(CanonicalPlace.city == '济南'))).all()
            previous = await session.scalar(select(PlaceRelationSnapshot).where(PlaceRelationSnapshot.city == '济南'))
            state = {'rows': rows, 'entities': cat.catalog.entities, 'members': cat.catalog.members,
                'scopes': cat.scopes, 'assignments': cat.assignments}
            digest = hashlib.sha256(json.dumps(state, ensure_ascii=False, sort_keys=True, default=str).encode()).hexdigest()
            observation = {'hash': digest, 'mentions': len(rows), 'sources': len(sources), 'revision': previous.revision}
            assert observation == baseline['sourceObservations'][0]
            report = {'readOnly': True, 'at': datetime.now(timezone.utc).isoformat(), 'metadataRun': 1,
                'observation': observation, 'originalDatesAndMentionsPreserved': True, 'identitiesAndAssignmentsPreserved': True,
                'imageComparison': 'deferred_by_user', 'failures': []}
            with output.open('x', encoding='utf-8') as file:
                json.dump(report, file, ensure_ascii=False, indent=2)
            print(json.dumps(report, ensure_ascii=False))
    finally:
        await engine.dispose()

asyncio.run(main())
