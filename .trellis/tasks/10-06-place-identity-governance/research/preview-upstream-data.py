"""在一次性测试库中预演全部 5870 条源记录及济南治理；不修改应用库。"""
import asyncio
import json
import os
import sys
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8')
sys.dont_write_bytecode = True
root = Path(__file__).resolve().parent
sys.path.insert(0, 'D:/Project/xhs-travel-pipeline')
import app
app.__path__.insert(0, str(root / 'upstream/app'))
for name in ['clean', 'aggregate']:
    package = __import__(f'app.{name}', fromlist=['_'])
    package.__path__.insert(0, str(root / 'upstream/app' / name))
from sqlalchemy import insert
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from app.models import Base, CanonicalPlace
from app.aggregate.place_identity import bootstrap, load_catalog, audit_catalog, apply_decision, rollback_decision

async def main():
    url = os.environ['IDENTITY_TEST_DATABASE_URL']
    assert '127.0.0.1:18798/place_identity_test_' in url
    engine = create_async_engine(url)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)
    records = json.loads((root / 'upstream-evidence.json').read_text(encoding='utf-8'))['places']
    report = {'sourceCount': len(records), 'testDatabase': True, 'cities': [], 'changes': []}
    async with factory() as session:
        for start in range(0, len(records), 300):
            await session.execute(insert(CanonicalPlace), [{**p, 'id': int(p['id'])} for p in records[start:start+300]])
        for city in sorted(set(p['city'] for p in records)):
            count = await bootstrap(session, city)
            assert await bootstrap(session, city) == 0
            catalog = await load_catalog(session, city)
            review = audit_catalog(catalog)
            report['cities'].append({'city': city, 'registeredSources': count, 'entities': len(catalog.entities), 'review': review})
            print(f'{city}: {count} 个来源，{len(review)} 组待审', flush=True)
        catalog = await load_catalog(session, '济南')
        geo = next(p for p in json.loads((root/'shangbu-geo.json').read_text(encoding='utf-8')) if p['name'] == '济南老商埠')
        decisions = []
        groups = [
            ('daminghu', ['大明湖', '大明湖景区', '大明湖公园'], '大明湖', [], {'category': '自然'},
             [{'kind': 'source_mentions', 'ids': [12687,12926,12959,12772], 'conclusion': '同一湖泊景区的游览称呼；超然楼与南门不属于同义词'}]),
            ('shangbu', ['老商埠', '经三路老商埠', '老商埠经三路'], '融汇老商埠', ['老商埠·经三路', '济南老商埠', '融汇济南老商埠'],
             {'category': '文化', 'lat': round(geo['gcj02']['latitude'],6), 'lng': round(geo['gcj02']['longitude'],6),
              'address': geo['address'], 'geoStatus': 'verified_poi'},
             [{'kind': 'source_mentions', 'ids': [12799,12866,12616,12645], 'conclusion': '源记录为夹心胡同、复古洋楼等商业街区游览；历史老商埠片区不并入'},
              {'kind': 'published_source', 'url': 'https://news.iqilu.com/shandong/shandonggedi/20211006/4968896.shtml'},
              {'kind': 'boundary_source', 'url': 'http://sd.xinhuanet.com/20260904/3f7ee94228e04d72af79999d9fce6a15/c.html'},
              {'kind': 'tianditu_poi', 'name': geo['name'], 'address': geo['address'], 'lonlat': geo['lonlat'], 'coordinateSystem': 'CGCS2000'}]),
        ]
        for slug, names, canonical, aliases, overrides, evidence in groups:
            entities = [catalog.resolve(name) for name in names]
            assert all(entities), names
            decisions.append({'key': f'jinan-20261006-{slug}-v2', 'city': '济南', 'entityId': entities[0]['entity_id'],
                'mergeEntityIds': [e['entity_id'] for e in entities[1:]], 'canonicalName': canonical, 'aliases': aliases,
                'expectedRevisions': {e['entity_id']: e['revision'] for e in entities}, 'overrides': overrides, 'evidence': evidence})
        for decision in decisions:
            after = await apply_decision(session, decision)
            assert await apply_decision(session, decision) == after
            current = await load_catalog(session, '济南')
            assert all(current.resolve(alias)['entity_id'] == decision['entityId']
                for alias in current.resolve(entity_id=decision['entityId'])['aliases'])
            assert current.resolve('大明湖超然楼')['entity_id'] != decisions[0]['entityId']
            report['changes'].append(after)
        for decision in reversed(decisions):
            await rollback_decision(session, decision['key'])
        restored = await load_catalog(session, '济南')
        assert restored.resolve('经三路老商埠')['entity_id'] != restored.resolve('老商埠')['entity_id']
        report['rollbackVerified'] = True
        await session.rollback()
    (root/'upstream-preview.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    (root/'jinan-decisions.json').write_text(json.dumps(decisions,ensure_ascii=False,indent=2),encoding='utf-8')
    await engine.dispose()
    print('全城注册、治理重跑、改名及回滚预演通过')

asyncio.run(main())
