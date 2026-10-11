"""按既有版本化API逆序恢复107，保留失败/回滚审计；不直接改业务表。"""
import asyncio
import hashlib
import importlib.util
import json
import sys
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.dont_write_bytecode = True
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, 'D:/Project/xhs-travel-pipeline')
spec = importlib.util.spec_from_file_location('gulangyu', ROOT / 'govern-gulangyu-scope.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
runner = module.runner
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from dotenv import dotenv_values
from app.aggregate.place_identity import rollback_decision
from app.aggregate.mention_identity import load_mention_catalog, load_mention_rows
from app.clean.mention_identity import mention_fingerprint
from freeze import governance_state

KEYS = ['top30-20261010-batch-107-score-2540', 'top30-20261010-batch-107-scope-2540']


async def main():
    apply = '--apply' in sys.argv
    frozen, _, _ = module.inputs()
    output = ROOT / f'batch-107-upstream-recovery-{"applied" if apply else "preview"}.json'
    assert not output.exists()
    down = json.loads((ROOT / 'batch-107-downstream-recovery-applied.json').read_bytes())
    assert down['apply'] and down['passed']
    engine = create_async_engine(dotenv_values('D:/Project/xhs-travel-pipeline/.env')['DATABASE_URL'])
    extras = json.loads(runner.EXTRAS.read_bytes())
    extras.pop('city')
    extras.pop('snapshotSha256')
    async def state(session):
        catalog = await load_mention_catalog(session, '厦门')
        return {'entities': catalog.catalog.entities, 'members': catalog.catalog.members,
            'scopes': catalog.scopes, 'assignments': catalog.assignments,
            'governance': runner.merges.normalized_governance(await governance_state(session, '厦门')),
            'mentions': {m['id']: mention_fingerprint(m) for m in await load_mention_rows(session, '厦门')},
            'extras': runner.previous.normalized_extras(await runner.baseline.extra_state(session, '厦门'))}
    expected = {'entities': {e['entity_id']: e for e in frozen['entities']},
        'members': {int(k): v for k, v in frozen['members'].items()},
        'scopes': {s['place_id']: s for s in frozen['scopes']},
        'assignments': {a['mention_id']: a for a in frozen['assignments']},
        'governance': runner.merges.normalized_governance(frozen['governanceState']),
        'mentions': {m['id']: m['inputHash'] for m in frozen['mentions']},
        'extras': runner.previous.normalized_extras(extras)}
    digest = lambda value: hashlib.sha256(json.dumps(value, sort_keys=True, default=str).encode()).hexdigest()
    try:
        async with async_sessionmaker(engine, expire_on_commit=False, autoflush=False)() as session:
            await session.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ'))
            await session.execute(text("SET LOCAL statement_timeout='30s'"))
            statuses = (await session.execute(text('SELECT change_key,rolled_back FROM place_entity_change WHERE change_key=ANY(:keys)'), {'keys': KEYS})).mappings().all()
            assert len(statuses) == 2 and not any(row['rolled_back'] for row in statuses)
            before = await state(session)
            if apply:
                preview = json.loads((ROOT / 'batch-107-upstream-recovery-preview.json').read_bytes())
                assert preview['passed'] and preview['beforeStateHash'] == digest(before)
            for key in KEYS:
                await rollback_decision(session, key)
            restored = await state(session)
            assert restored == expected
            if apply:
                await session.commit()
            else:
                await session.rollback()
            assert await state(session) == (expected if apply else before)
        report = {'batch': 'batch-107', 'apply': apply, 'passed': True, 'keys': KEYS,
            'beforeStateHash': digest(before), 'restoredStateHash': digest(expected),
            'snapshotSha256': hashlib.sha256(runner.SNAPSHOT.read_bytes()).hexdigest(),
            'reverseApiRollback': True, 'entitiesMembersScopesAssignmentsRestored': True,
            'rawNotesMentionsMediaAndOriginalRelationsPreserved': True,
            'previewTransactionRestored': not apply}
        output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print(json.dumps(report, ensure_ascii=False))
    finally:
        await engine.dispose()


if __name__ == '__main__':
    try:
        asyncio.run(main())
    except Exception as error:
        print(json.dumps({'failed': True, 'errorType': type(error).__name__, 'frames': [
            {'file': Path(f.filename).name, 'line': f.lineno, 'function': f.name}
            for f in traceback.extract_tb(error.__traceback__) if str(ROOT) in f.filename]}, ensure_ascii=False))
        sys.exit(1)
