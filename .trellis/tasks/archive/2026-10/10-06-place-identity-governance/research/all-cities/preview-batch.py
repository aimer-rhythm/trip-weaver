"""用冻结全城证据在一次性 PostgreSQL 预演决策、幂等和倒序回滚。"""
from pathlib import Path
import asyncio
import json
import os
import re
import sys
import time
sys.dont_write_bytecode = True
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, 'D:/Project/xhs-travel-pipeline')
staged = '--staged' in sys.argv
if staged:
    stage = Path(__file__).resolve().parent.parent / 'upstream'
    import app
    app.__path__.insert(0, str(stage / 'app'))
    for name in ['clean', 'aggregate']:
        package = __import__(f'app.{name}', fromlist=['_'])
        package.__path__.insert(0, str(stage / 'app' / name))
from sqlalchemy import insert, select, update
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from app.models import Base, CanonicalPlace, PlaceEntity, PlaceEntityMember, PlaceEntityReview
from app.aggregate.place_identity import load_catalog, apply_decision, apply_review_decision, rollback_decision, review_state, ENTITY_FIELDS

base = Path(__file__).resolve().parent
batch = sys.argv[1] if len(sys.argv) > 1 else 'batch-01'
assert re.fullmatch(r'batch-\d{2}(?:-v\d+)?', batch)

async def main():
    url = os.environ['IDENTITY_TEST_DATABASE_URL']
    assert '127.0.0.1:18798/place_identity_test_' in url
    engine = create_async_engine(url)
    factory = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)
    report = {'isolatedDatabase': True}
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        baseline_path = base/f'{batch}-baseline.json'
        if not baseline_path.exists():
            baseline_path = base/'source-snapshot.json'
        snap = json.loads(baseline_path.read_text(encoding='utf-8'))
        report['baselineFile'] = baseline_path.name
        supplements_path = base/f'{batch}-supplements.json'
        for file in json.loads(supplements_path.read_text(encoding='utf-8')) if supplements_path.exists() else []:
            assert re.fullmatch(r'[a-z0-9-]+\.json', file)
            for entity in json.loads((base/file).read_text(encoding='utf-8'))['entities']:
                assert not any(e['entity_id'] == entity['entity_id'] for e in snap['entities'])
                snap['entities'].append(entity)
            for review in json.loads((base/file).read_text(encoding='utf-8')).get('reviews', []):
                assert not any(str(r['id']) == str(review['id']) for r in snap['reviews'])
                snap['reviews'].append(review)
        decisions = json.loads((base/f'{batch}-decisions.json').read_text(encoding='utf-8'))
        review_path = base/f'{batch}-review-decisions.json'
        review_decisions = json.loads(review_path.read_text(encoding='utf-8')) if review_path.exists() else []
        async with factory() as session:
            for entity in snap['entities']:
                for place in entity['places']:
                    await session.execute(insert(CanonicalPlace).values(**{k: (int(v) if k=='id' else v)
                        for k,v in place.items() if k!='entity_id'}))
            # 现行快照中旧实体的主源可能已转属其他根，须先恢复全部源再恢复实体。
            for entity in snap['entities']:
                values = {k:entity[k] for k in ENTITY_FIELDS}
                if values['primary_place_id'] is not None:
                    values['primary_place_id'] = int(values['primary_place_id'])
                values['redirect_to'] = None
                await session.execute(insert(PlaceEntity).values(**values))
            for entity in snap['entities']:
                if entity['redirect_to']:
                    await session.execute(update(PlaceEntity).where(PlaceEntity.entity_id==entity['entity_id'])
                        .values(redirect_to=entity['redirect_to']))
                for place in entity['places']:
                    await session.execute(insert(PlaceEntityMember).values(place_id=int(place['id']),entity_id=entity['entity_id']))
            for review in snap['reviews']:
                await session.execute(insert(PlaceEntityReview).values(**{**review,'id':int(review['id'])}))
            prerequisites_path = base/f'{batch}-prerequisites.json'
            prerequisites = json.loads(prerequisites_path.read_text(encoding='utf-8')) if prerequisites_path.exists() else []
            prior_seen = set()
            for prior in prerequisites:
                assert re.fullmatch(r'batch-\d{2}(?:-v\d+)?', prior)
                assert prior not in prior_seen, '依赖批次重复'
                indirect_path = base/f'{prior}-prerequisites.json'
                indirect = json.loads(indirect_path.read_text(encoding='utf-8')) if indirect_path.exists() else []
                assert all(name in prior_seen for name in indirect), f'{prior} 的历史依赖须显式列在它前面'
                assert json.loads((base/f'{prior}-applied.json').read_text(encoding='utf-8'))['apply']
                for decision in json.loads((base/f'{prior}-decisions.json').read_text(encoding='utf-8')):
                    await apply_decision(session, decision)
                prior_reviews = base/f'{prior}-review-decisions.json'
                for decision in json.loads(prior_reviews.read_text(encoding='utf-8')) if prior_reviews.exists() else []:
                    await apply_review_decision(session, decision)
                prior_seen.add(prior)
            report['prerequisites'] = prerequisites
            baseline = {city:await load_catalog(session,city) for city in sorted({d['city'] for d in [*decisions,*review_decisions]})}
            baseline_reviews = [review_state(row) for row in (await session.scalars(select(PlaceEntityReview).order_by(PlaceEntityReview.id))).all()]
            for decision in decisions:
                after = await apply_decision(session, decision)
                assert after == await apply_decision(session, decision)
                catalog = await load_catalog(session,decision['city'])
                root = catalog.root(decision['entityId'])
                assert all(catalog.resolve(alias)['entity_id']==root['entity_id'] for alias in root['aliases'])
                assert all(catalog.root(eid)['entity_id']==root['entity_id'] for eid in decision['mergeEntityIds'])
            report['groups'] = len(decisions)
            for decision in review_decisions:
                after = await apply_review_decision(session, decision)
                assert after == await apply_review_decision(session, decision)
            report['reviewDecisions'] = len(review_decisions)
            report['rejectedReviews'] = len((await session.scalars(select(PlaceEntityReview)
                .where(PlaceEntityReview.status=='REJECTED'))).all())
            report['resolvedReviews'] = len((await session.scalars(select(PlaceEntityReview)
                .where(PlaceEntityReview.status=='RESOLVED'))).all())
            for decision in reversed([*decisions, *review_decisions]):
                await rollback_decision(session, decision['key'])
            for city, before in baseline.items():
                after = await load_catalog(session, city)
                assert before.entities == after.entities and before.members == after.members
            assert baseline_reviews == [review_state(row) for row in (await session.scalars(select(PlaceEntityReview).order_by(PlaceEntityReview.id))).all()]
            report.update(idempotencyVerified=True, rollbackVerified=True)
            await session.rollback()
    finally:
        await engine.dispose()
    target = base/f'{batch}-isolated-preview.json'
    if staged:
        report['stagedModules'] = True
        target = base/'scope-regression'/f'{batch}-{time.time_ns()}.json'
        target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False))

asyncio.run(main())
