"""回滚已应用的batch-121 scope决定，恢复永庆坊原归属；旧预演保留为失败历史。"""
import asyncio
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')
ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('scope_runner', ROOT / 'govern-disney-scopes.py')
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)
merges = runner.merges
from app.aggregate.place_identity import rollback_decision
from app.aggregate.mention_identity import load_mention_catalog
from freeze import governance_state
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from dotenv import dotenv_values

CITY, BATCH = '广州', 'batch-121'
PARENT = ROOT.parents[1] / '10-06-place-identity-governance'
B = PARENT / 'research/all-cities'


async def main():
    raw = (ROOT / 'snapshot-20261010T031749976332Z/input.json').read_bytes()
    frozen = next(c for c in json.loads(raw)['cities'] if c['city'] == CITY)
    scopes = json.loads((B / f'{BATCH}-scope-decisions.json').read_bytes())
    applied = json.loads((B / f'{BATCH}-applied.json').read_bytes())
    assert applied['apply'] and not (B / f'{BATCH}-rolled-back.json').exists()
    assert not (B / BATCH / 'sync-01' / 'sync-state.json').read_text().count('importedAt'), '下游已导入须先撤回导入'
    engine = create_async_engine(dotenv_values('D:/Project/xhs-travel-pipeline/.env')['DATABASE_URL'])
    try:
        async with async_sessionmaker(engine, expire_on_commit=False, autoflush=False)() as session:
            await session.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ'))
            await session.execute(text("SET LOCAL statement_timeout='30s'"))
            for scope in scopes:
                await rollback_decision(session, scope['key'])
            restored = await load_mention_catalog(session, CITY)
            assert restored.catalog.entities == {e['entity_id']: e for e in frozen['entities']}
            assert restored.catalog.members == {int(k): v for k, v in frozen['members'].items()}
            assert merges.normalized_governance(await governance_state(session, CITY)) == \
                merges.normalized_governance(frozen['governanceState'])
            await session.commit()
    finally:
        await engine.dispose()
    merges.write_new(B / f'{BATCH}-rolled-back.json', {
        'batch': BATCH, 'rolledBack': True, 'passed': True, 'reason': '目标实体无旧媒体，但冻结下游旧运营输出未声明保全，'
            '按第75节协议以batch-121-v2重做；旧预演批次-121保留为失败历史，不再同步或计为当前治理成果。',
        'snapshotSha256': hashlib.sha256(raw).hexdigest(), 'scopesRolledBack': [s['key'] for s in scopes],
        'supersededBy': 'batch-121-v2'})
    print(json.dumps({'rolledBack': BATCH, 'scopes': [s['key'] for s in scopes], 'city': CITY, 'passed': True}, ensure_ascii=False))


if __name__ == '__main__':
    asyncio.run(main())
