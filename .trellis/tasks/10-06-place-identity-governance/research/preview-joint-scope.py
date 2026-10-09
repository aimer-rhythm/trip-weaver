"""加载暂存模块，生成联合治理真实导出序列供下游隔离验证；仅使用合成数据。"""
from pathlib import Path
import asyncio
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
from test_joint_mention_identity_db import seed_joint, request_joint, entity_ids


async def main():
    url = os.environ['IDENTITY_TEST_DATABASE_URL']
    assert '127.0.0.1:18798/place_identity_test_' in url
    engine = create_async_engine(url)
    factory = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)
    folder = root / 'all-cities' / 'joint-scope' / f'run-{time.time_ns()}'
    folder.mkdir(parents=True, exist_ok=False)
    city = '联合来源链路测试'
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        async with factory() as session:
            sources, branches, _ = await seed_joint(session, city=city)
            # 合成初态须具备普通导出资格，才能验证已存在旧目录的撤回。
            for index, place in enumerate([*sources, *branches]):
                place.latitude, place.longitude = 36.6 + index / 1000, 117 + index / 1000
                place.place_type = 'cafe'
            await session.flush()
            old_ids = await entity_ids(session, sources)
            targets = await entity_ids(session, branches)
            originals = await load_mention_rows(session, city)
            before = (await load_catalog(session, city)).entities
            await session.commit()
        exporter.SessionFactory = factory
        files, requests = {}, []
        for label, assignments in [('before', None), ('assigned', targets), ('empty', [None, None]), ('restored', targets)]:
            if assignments is not None:
                async with factory() as session:
                    decision = await request_joint(session, sources, assignments, key=f'joint-preview-{label}')
                    after = await apply_scope_decision(session, decision)
                    assert after == await apply_scope_decision(session, decision)
                    requests.append(decision)
                    await session.commit()
            output = folder / f'xhs-places-{label}.json'
            sys.argv = ['export_to_tripweaver.py', '--city', city, '--out', str(output)]
            await exporter.main()
            raw = output.read_bytes()
            data = json.loads(raw)
            assert len(data['places']) == 4
            active = {p['id'] for p in data['places'] if p['verified']}
            assert active == (set([*old_ids, *targets]) if label == 'before' else set() if label == 'empty' else set(targets))
            files[label] = {'file': output.name, 'sha256': hashlib.sha256(raw).hexdigest(), 'active': sorted(active)}
        async with factory() as session:
            for decision in reversed(requests):
                await rollback_decision(session, decision['key'])
            assert (await load_catalog(session, city)).entities == before
            assert await load_mention_rows(session, city) == originals
            await session.rollback()
        report = {'isolated': True, 'synthetic': True, 'city': city, 'oldIds': old_ids, 'targetIds': targets,
            'files': files, 'idempotency': True, 'reverseRollback': True, 'sourceTextUnchanged': True}
        (folder / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        print(json.dumps({'folder': folder.relative_to(root).as_posix(), **report}, ensure_ascii=False))
    finally:
        await engine.dispose()


asyncio.run(main())
