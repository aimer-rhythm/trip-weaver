"""隔离重建实城冻结原文；幂等、撤回导出、待审和倒序回滚，不触碰实库。"""
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
from app.aggregate.place_identity import ENTITY_FIELDS, apply_review_decision, load_catalog, rollback_decision, review_state
from app.aggregate.mention_identity import apply_scope_decision, load_mention_rows, load_mention_catalog
from app.clean.mention_identity import MENTION_FIELDS, mention_fingerprint
from scripts import export_to_tripweaver as exporter

root = Path(__file__).resolve().parent
read = lambda file: json.loads((root/file).read_text(encoding='utf-8'))
snapshot = read('joint-coffee-source-1791338728505852300.json')
scopes = read('all-cities/batch-25-scope-decisions.json')
reviews = read('all-cities/batch-25-review-decisions.json')


async def main():
    url = os.environ['IDENTITY_TEST_DATABASE_URL']
    assert '127.0.0.1:18798/place_identity_test_' in url
    engine = create_async_engine(url)
    factory = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)
    folder = root/'all-cities'/'batch-25'/f'joint-preview-{time.time_ns()}'
    folder.mkdir(parents=True, exist_ok=False)
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        async with factory() as session:
            for g in snapshot['groups']:
                for s in g['sources']:
                    await session.execute(insert(CanonicalPlace).values(**{k: s[k] for k in [
                        'id', 'city', 'name', 'normalized_name', 'is_active', 'geo_status', 'longitude', 'latitude', 'address', 'place_type']}))
                    await session.execute(insert(PlaceEntity).values(**{k: s['entity'][k] for k in ENTITY_FIELDS}))
                    await session.execute(insert(PlaceEntityMember).values(place_id=s['id'], entity_id=s['entity']['entity_id']))
                    session.add(PlaceSummary(canonical_place_id=s['id'], mention_count_30d=1, recommend_score=1))
                for m in g['mentions']:
                    session.add(RawNote(id=m['raw_note_id'], note_id=f'frozen-{m["raw_note_id"]}', city=g['city'], keyword='实城冻结',
                        title=m['note_title'], desc=m['note_desc'], img_analysis=m['note_images'], status='EXTRACTED'))
                await session.flush()
                for m in g['mentions']:
                    session.add(PlaceMention(**{k: m[k] for k in MENTION_FIELDS}))
                session.add(PlaceEntityReview(city=g['city'], **g['review']))
            await session.commit()
        async with factory() as session:
            originals = {g['city']: copy.deepcopy(await load_mention_rows(session, g['city'])) for g in snapshot['groups']}
            for g in snapshot['groups']:
                assert [mention_fingerprint(m) for m in originals[g['city']]] == [m['inputHash'] for m in g['mentions']]
            before = {g['city']: await load_catalog(session, g['city']) for g in snapshot['groups']}
            original_reviews = [review_state(r) for r in (await session.scalars(select(PlaceEntityReview).order_by(PlaceEntityReview.id))).all()]
            for d in scopes:
                after = await apply_scope_decision(session, d)
                assert after == await apply_scope_decision(session, d)
            for d in reviews:
                after = await apply_review_decision(session, d)
                assert after == await apply_review_decision(session, d)
            for g in snapshot['groups']:
                catalog = await load_mention_catalog(session, g['city'])
                assert all(catalog.resolve(m)['status'] == 'review' for m in originals[g['city']])
                assert originals[g['city']] == await load_mention_rows(session, g['city'])
            pending = (await session.scalars(select(PlaceEntityReview).where(PlaceEntityReview.status == 'PENDING'))).all()
            assert len(pending) == 6 and sum(r.detail['reason'] == 'mention_scope' for r in pending) == 4
            await session.commit()
        exporter.SessionFactory = factory
        files = []
        for g in snapshot['groups']:
            file = folder/f'xhs-places-{g["city"]}.json'
            sys.argv = ['export_to_tripweaver.py', '--city', g['city'], '--out', str(file)]
            await exporter.main()
            data = json.loads(file.read_text(encoding='utf-8'))
            assert len(data['places']) == 2
            for p in data['places']:
                assert p['verified'] is False and p['payload']['identity']['revision'] == 2
                assert p['payload']['mentionSources'] == p['payload']['imageIdentity']['approved'] == []
                assert p['payload']['identityWithdrawal']['candidateIds'] == []
            files.append({'city': g['city'], 'file': file.name, 'sha256': hashlib.sha256(file.read_bytes()).hexdigest()})
        async with factory() as session:
            for d in reversed([*scopes, *reviews]):
                await rollback_decision(session, d['key'])
            for g in snapshot['groups']:
                after = await load_catalog(session, g['city'])
                assert before[g['city']].entities == after.entities and before[g['city']].members == after.members
                assert originals[g['city']] == await load_mention_rows(session, g['city'])
            assert original_reviews == [review_state(r) for r in (await session.scalars(select(PlaceEntityReview).order_by(PlaceEntityReview.id))).all()]
            await session.rollback()
        report = {'isolated': True, 'synthetic': False, 'partialCityReconstruction': True, 'batch': 'batch-25', 'scopes': 2,
            'withdrawals': 4, 'pendingMentions': 4, 'pendingEntityPairs': 2, 'idempotent': True, 'reverseRollback': True,
            'originalMentionsUnchanged': True, 'files': files}
        with (folder/'report.json').open('x', encoding='utf-8') as stream:
            json.dump(report, stream, ensure_ascii=False, indent=2)
        print(json.dumps({'folder': str(folder.relative_to(root)), **report}, ensure_ascii=False))
    finally:
        await engine.dispose()


asyncio.run(main())
