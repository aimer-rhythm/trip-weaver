"""临时库重建459冻结证据，验证逐提及纠错、导出、新增真实公交站和倒序回滚。"""
from pathlib import Path
import asyncio
import copy
import json
import os
import sys
import time
sys.dont_write_bytecode = True
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, 'D:/Project/xhs-travel-pipeline')
if '--staged' in sys.argv:
    stage = Path(__file__).resolve().parent / 'upstream'
    import app
    app.__path__.insert(0, str(stage / 'app'))
    for name in ['clean', 'aggregate', 'photography', 'resolve', 'extract', 'qa']:
        package = __import__(f'app.{name}', fromlist=['_'])
        package.__path__.insert(0, str(stage / 'app' / name))
    import scripts
    scripts.__path__ = [str(stage / 'scripts'), *scripts.__path__]
from sqlalchemy import insert, select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from app.models import Base, CanonicalPlace, PlaceEntity, PlaceEntityMember, PlaceEntityReview, PlaceMention, PlaceSummary, RawNote
from app.aggregate.place_identity import ENTITY_FIELDS, apply_decision, load_catalog, rollback_decision, review_state
from app.aggregate.mention_identity import apply_scope_decision, load_mention_catalog, load_mention_rows, scope_snapshot
from app.clean.mention_identity import MENTION_FIELDS
from scripts import export_to_tripweaver as exporter

root = Path(__file__).resolve().parent
read = lambda name: json.loads((root/name).read_text(encoding='utf-8'))
snapshot = read('scope-source-459-1791335308979279800.json')
scopes = read('all-cities/batch-24-scope-decisions.json')
decisions = read('all-cities/batch-24-decisions.json')

async def main():
    url = os.environ['IDENTITY_TEST_DATABASE_URL']
    assert '127.0.0.1:18798/place_identity_test_' in url
    engine = create_async_engine(url)
    factory = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)
    primary = decisions[0]['entityId']
    old = decisions[0]['mergeEntityIds'][0]
    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with factory() as session:
            for source in snapshot['sources']:
                await session.execute(insert(CanonicalPlace).values(**{key: source[key] for key in [
                    'id', 'city', 'name', 'normalized_name', 'is_active', 'geo_status', 'longitude', 'latitude', 'address', 'place_type']}))
                await session.execute(insert(PlaceEntity).values(**{key: source['entity'][key] for key in ENTITY_FIELDS}))
                await session.execute(insert(PlaceEntityMember).values(place_id=source['id'], entity_id=source['entity']['entity_id']))
                session.add(PlaceSummary(canonical_place_id=source['id'], mention_count_30d=999, recommend_score=999))
            note = snapshot['mentions'][0]
            session.add(RawNote(id=7, city='重庆', note_id='69de3dc0000000001a034428', keyword='机位', title=note['note_title'],
                desc=note['note_desc'], img_analysis=note['note_images'], status='EXTRACTED'))
            await session.flush()
            for row in snapshot['mentions']:
                session.add(PlaceMention(**{key: row[key] for key in MENTION_FIELDS}))
            session.add(PlaceEntityReview(city='重庆', **snapshot['review']))
            await session.commit()
        async with factory() as session:
            before = await load_catalog(session, '重庆')
            reviews = [review_state(row) for row in (await session.scalars(select(PlaceEntityReview))).all()]
            originals = copy.deepcopy(await load_mention_rows(session, '重庆'))
            for decision in scopes:
                after = await apply_scope_decision(session, decision)
                assert after == await apply_scope_decision(session, decision)
            for decision in decisions:
                after = await apply_decision(session, decision)
                assert after == await apply_decision(session, decision)
            catalog = await load_mention_catalog(session, '重庆')
            assert all(catalog.resolve(row)['entity']['entity_id'] == primary for row in originals)
            assert catalog.catalog.resolve('呼归石公交站') is None
            assert catalog.catalog.root(old)['entity_id'] == primary
            assert (await session.get(PlaceEntityReview, 459)).status == 'RESOLVED'
            assert await load_mention_rows(session, '重庆') == originals
            await session.commit()
        folder = root/'all-cities'/'batch-24'/f'scope-preview-{time.time_ns()}'
        folder.mkdir(parents=True, exist_ok=False)
        output = folder/'xhs-places-重庆.json'
        assert not output.exists(), '不覆盖已有导出'
        exporter.SessionFactory = factory
        sys.argv = ['export_to_tripweaver.py', '--city', '重庆', '--out', str(output)]
        await exporter.main()
        data = json.loads(output.read_text(encoding='utf-8'))
        assert len(data['places']) == 1
        place = data['places'][0]
        assert place['id'] == primary and place['payload']['identity']['revision'] == 5
        assert place['payload']['identity']['memberIds'] == sorted([primary, old])
        assert place['payload']['aliases'] == ['呼归石公交站对面']
        assert place['payload']['mentionCount'] == 3 and len(place['payload']['mentionSources']) == 3
        assert place['lat'] is None and place['lng'] is None
        assert place['payload']['imageIdentity']['approved'] == []
        async with factory() as session:
            # 新真实公交站证据不能沿旧名称重新吸入机位，也必须阻止覆盖式回滚。
            new = PlaceMention(id=20000, raw_note_id=7, name='呼归石公交站', normalized_name='呼归石公交站',
                reason='在车站等候公交车', evidence_text='呼归石公交站发车', confidence=.95)
            session.add(new)
            await session.flush()
            catalog = await load_mention_catalog(session, '重庆')
            row = (await load_mention_rows(session, '重庆', [20000]))[0]
            assert catalog.resolve(row)['status'] == 'review'
            # 先移除本测试的新增提及，再倒序恢复全部治理决策。
            await session.delete(new)
            await session.flush()
            for decision in reversed([*scopes, *decisions]):
                await rollback_decision(session, decision['key'])
            after = await load_catalog(session, '重庆')
            assert before.entities == after.entities and before.members == after.members
            assert reviews == [review_state(row) for row in (await session.scalars(select(PlaceEntityReview))).all()]
            assert originals == await load_mention_rows(session, '重庆')
            await session.rollback()
        report = {'isolated': True, 'folder': str(folder.relative_to(root)),
            'scopes': 2, 'mentions': 3, 'corrections': 1, 'idempotencyVerified': True,
            'rollbackVerified': True, 'newBusMentionRequiresReview': True, 'exported': 1, 'exportRevision': 5}
        with (folder/'report.json').open('x', encoding='utf-8') as stream:
            json.dump(report, stream, ensure_ascii=False, indent=2)
        print(json.dumps(report, ensure_ascii=False))
    finally:
        await engine.dispose()

asyncio.run(main())
