"""只读补齐完整scope审计所引用的历史溯源和原关系表。"""
import asyncio
import hashlib
import json
import sys
from pathlib import Path
sys.dont_write_bytecode = True
sys.path.insert(0, 'D:/Project/xhs-travel-pipeline')
from dotenv import dotenv_values
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

ROOT = Path(__file__).resolve().parent
QUERIES = {
    'provenance': "SELECT row_to_json(s) FROM canonical_place_source s JOIN canonical_place p ON p.id=s.canonical_place_id WHERE p.city='西安' ORDER BY s.id",
    'relations': "SELECT row_to_json(r) FROM place_relation r WHERE city='西安' ORDER BY id",
}

async def main():
    engine = create_async_engine(dotenv_values('D:/Project/xhs-travel-pipeline/.env')['DATABASE_URL'])
    try:
        async with engine.connect() as connection:
            await connection.execute(text('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            result = {key: (await connection.execute(text(query))).scalars().all() for key, query in QUERIES.items()}
        result['snapshotSha256'] = hashlib.sha256((ROOT / 'snapshot-20261009T165057648136Z/input.json').read_bytes()).hexdigest()
        with (ROOT / 'xian-scope-extras-01.json').open('x', encoding='utf-8') as handle:
            json.dump(result, handle, ensure_ascii=False, indent=2)
        print(json.dumps({key: len(result[key]) for key in QUERIES}))
    finally: await engine.dispose()

if __name__ == '__main__': asyncio.run(main())
