"""生成真实新建实体的导出序列；只在一次性数据库使用合成原文。"""
from pathlib import Path
import asyncio
import copy
import hashlib
import json
import os
import sys
import time

sys.dont_write_bytecode = True
sys.stdout.reconfigure(encoding='utf-8')
root = Path(__file__).resolve().parent
stage = root / 'upstream'
sys.path.insert(0, 'D:/Project/xhs-travel-pipeline')
sys.path.insert(0, str(stage / 'tests'))
import app
app.__path__.insert(0, str(stage / 'app'))
for name in ['clean', 'aggregate', 'photography', 'resolve', 'extract', 'qa']:
    package = __import__(f'app.{name}', fromlist=['_'])
    package.__path__.insert(0, str(stage / 'app' / name))
import scripts
scripts.__path__ = [str(stage / 'scripts'), *scripts.__path__]

from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from app.models import Base
from app.aggregate.mention_identity import apply_scope_decision, load_mention_rows
from app.aggregate.place_identity import load_catalog, rollback_decision
from scripts import export_to_tripweaver as exporter
from test_entity_creation_db import seed


async def main():
    url = os.environ['IDENTITY_TEST_DATABASE_URL']
    assert '127.0.0.1:18798/place_identity_test_' in url
    engine = create_async_engine(url)
    factory = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)
    folder = root / 'all-cities' / 'entity-creation' / f'run-{time.time_ns()}'
    folder.mkdir(parents=True, exist_ok=False)
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        async with factory() as session:
            source, _, originals, old, first = await seed(session)
            city = source.city
            old_ids = [old['entity_id']]
            targets = [e['entityId'] for e in first['newEntities']]
            before = (await load_catalog(session, city)).entities
            await session.commit()
        exporter.SessionFactory = factory
        files, requests = {}, []
        for label in ['before', 'assigned', 'empty', 'restored']:
            if label != 'before':
                async with factory() as session:
                    decision = copy.deepcopy(first)
                    if label != 'assigned':
                        decision.pop('newEntities')
                        decision.update(key=f'{first["key"]}-{label}', expectedScopeRevision=1 if label == 'empty' else 2,
                            expectedRevisions={eid: e['revision'] for eid, e in (await load_catalog(session, city)).entities.items()})
                    if label == 'empty':
                        for assignment in decision['assignments']:
                            assignment['entityId'] = None
                    after = await apply_scope_decision(session, decision)
                    assert after == await apply_scope_decision(session, decision)
                    requests.append(decision)
                    await session.commit()
            output = folder / f'xhs-places-{label}.json'
            sys.argv = ['export_to_tripweaver.py', '--city', city, '--out', str(output)]
            await exporter.main()
            raw = output.read_bytes()
            data = json.loads(raw)
            active = {p['id'] for p in data['places'] if p['verified']}
            assert active == (set(old_ids) if label == 'before' else set() if label == 'empty' else set(targets))
            assert {p['id'] for p in data['places']} == (set(old_ids) if label == 'before' else set([*old_ids, *targets]))
            files[label] = {'file': output.name, 'sha256': hashlib.sha256(raw).hexdigest(), 'active': sorted(active)}
        async with factory() as session:
            for decision in reversed(requests):
                await rollback_decision(session, decision['key'])
            assert (await load_catalog(session, city)).entities == before
            assert await load_mention_rows(session, city) == originals
            await session.rollback()
        report = {'isolated': True, 'synthetic': True, 'createdEntities': True, 'city': city,
            'oldIds': old_ids, 'targetIds': targets, 'files': files,
            'idempotency': True, 'reverseRollback': True, 'sourceTextUnchanged': True}
        (folder / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        print(json.dumps({'folder': folder.relative_to(root).as_posix(), **report}, ensure_ascii=False))
    finally:
        await engine.dispose()


asyncio.run(main())
