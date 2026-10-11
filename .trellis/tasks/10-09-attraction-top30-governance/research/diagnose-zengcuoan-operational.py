"""只读比较运营来源；仅输出引用、相等标志与差异字段名。"""
import asyncio
import importlib.util
import json
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, 'D:/Project/xhs-travel-pipeline')
spec = importlib.util.spec_from_file_location('zengcuoan', ROOT / 'govern-zengcuoan-preserved-scope.py')
subject = importlib.util.module_from_spec(spec)
spec.loader.exec_module(subject)
from app.aggregate.operational_preservation import legacy_context
from app.aggregate.mention_identity import load_mention_catalog
from app.clean.legacy_operational_facts import relevant_images, fact_names
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy import text
from dotenv import dotenv_values


async def compare(session, frozen, sources):
    catalog = await load_mention_catalog(session, '厦门')
    _, _, ordered = await legacy_context(session, '厦门', catalog.catalog)
    source = next(s for s in frozen['sources'] if s['id'] == subject.SID)
    expected = relevant_images(ordered, fact_names(source['name'], '厦门'))
    before = {n['id']: n for n in frozen['governanceState']['rawNotes']}
    notes = dict(ordered)
    requested = {(r['noteId'], r['imageIndex']): r for r in sources}
    actual = {(r['noteId'], r['imageIndex']): r for r in expected}
    differences = []
    for nid, index in sorted(requested.keys() | actual.keys()):
        n = before[nid]
        old = {'city': n['city'], 'title': n['title'], 'desc': n['desc'],
            'images': n['img_analysis'], 'unavailable': n['status'] in ['DELETED', 'PRIVATE'],
            'sourceUrl': n['source_url'] or '', 'observedAt': n['created_at'], 'publishedAt': n['publish_time']}
        now = notes[nid]
        differences.append({'noteId': nid, 'imageIndex': index,
            'hashEqual': requested.get((nid, index)) == actual.get((nid, index)),
            'differentFields': [k for k in old if old[k] != now[k]],
            'timestampsRepresentSameValue': all(datetime.fromisoformat(old[k]) == datetime.fromisoformat(now[k])
                for k in ['observedAt', 'publishedAt'] if old[k] and now[k]),
            'datetimeIsoformatMatchesRuntime': all((datetime.fromisoformat(old[k]).isoformat() if old[k] else None) == now[k]
                for k in ['observedAt', 'publishedAt'])})
    return {'requestOrder': [[r['noteId'], r['imageIndex']] for r in sources],
        'actualOrder': [[r['noteId'], r['imageIndex']] for r in expected],
        'sameReferences': requested.keys() == actual.keys(),
        'equal': sources == expected, 'comparisons': differences}


async def main():
    frozen, scopes, _ = subject.inputs()
    engine = create_async_engine(dotenv_values('D:/Project/xhs-travel-pipeline/.env')['DATABASE_URL'])
    try:
        async with async_sessionmaker(engine)() as session:
            await session.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            report = await compare(session, frozen, scopes[0]['preserveOperationalFacts'][0]['sources'])
    finally:
        await engine.dispose()
    path = ROOT / 'batch-119-operational-diagnostic-02.json'
    with path.open('x', encoding='utf-8') as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2)
    print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    asyncio.run(main())
