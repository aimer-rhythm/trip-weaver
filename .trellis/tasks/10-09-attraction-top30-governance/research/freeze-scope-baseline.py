"""只读冻结scope审计补充表和当前正式地点导出；不覆盖历史。"""
import argparse
import asyncio
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('merges', ROOT / 'govern-city-merges.py')
merges = importlib.util.module_from_spec(spec)
spec.loader.exec_module(merges)
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from dotenv import dotenv_values


async def extra_state(session, city):
    queries = {
        'provenance': 'SELECT row_to_json(s) FROM canonical_place_source s JOIN canonical_place p ON p.id=s.canonical_place_id WHERE p.city=:city ORDER BY s.id',
        'relations': 'SELECT row_to_json(r) FROM place_relation r WHERE city=:city ORDER BY id',
    }
    return {key: (await session.execute(text(query), {'city': city})).scalars().all()
            for key, query in queries.items()}


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--city', required=True, choices=['上海', '厦门', '广州', '成都', '杭州', '西安', '重庆'])
    parser.add_argument('--snapshot', required=True)
    parser.add_argument('--prefix', required=True)
    args = parser.parse_args()
    assert merges.re.fullmatch(r'[a-z0-9-]+', args.prefix)
    extras_path, baseline_path = (ROOT / (args.prefix + suffix) for suffix in ['-extras.json', '-baseline.json'])
    assert not extras_path.exists() and not baseline_path.exists()
    raw = (ROOT / args.snapshot).read_bytes()
    assert args.city in {c['city'] for c in json.loads(raw)['cities']}
    engine = create_async_engine(dotenv_values('D:/Project/xhs-travel-pipeline/.env')['DATABASE_URL'])
    try:
        async with engine.connect() as connection:
            await connection.execute(text('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            result = await extra_state(connection, args.city)
        result.update(snapshotSha256=hashlib.sha256(raw).hexdigest(), city=args.city)
        merges.write_new(extras_path, result)
        sys.argv = ['export', '--city', args.city, '--out', str(baseline_path)]
        await merges.exporter.main()
        print(json.dumps({'city': args.city, 'provenance': len(result['provenance']), 'relations': len(result['relations']),
            'baselineSha256': hashlib.sha256(baseline_path.read_bytes()).hexdigest()}, ensure_ascii=False))
    finally:
        await engine.dispose()


if __name__ == '__main__':
    try:
        asyncio.run(main())
    except Exception as error:
        print(json.dumps({'failed': True, 'errorType': type(error).__name__}))
        sys.exit(1)
