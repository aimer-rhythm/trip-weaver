"""正式应用后只读核验原始证据未变、两scope和三分配生效、错名未复活。"""
from pathlib import Path
import asyncio
import json
import sys
sys.dont_write_bytecode = True
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, 'D:/Project/xhs-travel-pipeline')
from sqlalchemy import select, text
from app.db import SessionFactory, engine
from app.aggregate.mention_identity import load_mention_catalog, load_mention_rows
from app.clean.mention_identity import mention_fingerprint, source_fingerprint
from app.models import CanonicalPlace, PlaceEntityReview

root = Path(__file__).resolve().parent
snapshot = json.loads((root/'scope-source-459-1791335308979279800.json').read_text(encoding='utf-8'))

async def main():
    async with SessionFactory() as session:
        await session.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
        catalog = await load_mention_catalog(session, '重庆')
        primary = '2f6c627fdf341bf54b049f3c0ae84d74'
        old = '79afbf6edf8899c29d2eb71edf8c3c81'
        assert catalog.catalog.root(old)['entity_id'] == primary
        assert catalog.catalog.entities[primary]['revision'] == 5
        assert catalog.catalog.entities[old]['revision'] == 3
        assert catalog.catalog.resolve('呼归石公交站') is None
        assert catalog.catalog.entities[primary]['overrides']['identityExcludedNames'] == ['呼归石公交站']
        assert set(catalog.scopes) == {176, 215} and len(catalog.assignments) == 3
        rows = {row['id']: row for row in await load_mention_rows(session, '重庆', [534, 1119, 1615])}
        for original in snapshot['mentions']:
            row = rows[original['id']]
            assert mention_fingerprint(row) == original['inputHash']
            assert catalog.resolve(row)['entity']['entity_id'] == primary
        for original in snapshot['sources']:
            source = await session.get(CanonicalPlace, original['id'])
            assert source_fingerprint({k: getattr(source, k) for k in ['id', 'city', 'name', 'normalized_name']}) == original['sourceHash']
        assert (await session.get(PlaceEntityReview, 459)).status == 'RESOLVED'
        report = {'readOnly': True, 'scopes': 2, 'assignments': 3, 'originalMentionHashesUnchanged': True,
            'sourceNamesUnchanged': True, 'excludedNameUnresolved': True, 'oldIdRoot': primary, 'review459': 'RESOLVED'}
        with (root/'all-cities'/'batch-24'/'scope-applied-verification.json').open('x', encoding='utf-8') as stream:
            json.dump(report, stream, ensure_ascii=False, indent=2)
        print(json.dumps(report, ensure_ascii=False))
    await engine.dispose()

asyncio.run(main())
