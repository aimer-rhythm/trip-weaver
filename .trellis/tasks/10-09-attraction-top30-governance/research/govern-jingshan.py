"""第78批：默认在一次性库复原全北京预演；--apply才执行已验证的实库决策。"""
import argparse
import asyncio
import copy
import hashlib
import json
import sys
import time
from datetime import datetime
from pathlib import Path

sys.dont_write_bytecode = True
sys.stdout.reconfigure(encoding='utf-8')
ROOT = Path(__file__).resolve().parent
PARENT = ROOT.parents[1] / '10-06-place-identity-governance/research'
SNAPSHOT = ROOT / 'snapshot-20261009T130631744909Z/input.json'
TARGET = '981bfe8125feb36e052dcfee1e0df8b5'
OLD = 'a94865355cdbf6fccfda6fc748b9e9fe'
parser = argparse.ArgumentParser()
parser.add_argument('--apply', action='store_true')
parser.add_argument('--attempt', default='jingshan-preview-01')
args = parser.parse_args()
sys.path.insert(0, 'D:/Project/xhs-travel-pipeline')
if not args.apply:
    import app
    app.__path__.insert(0, str(PARENT / 'upstream/app'))
    for name in ['aggregate', 'clean']:
        package = __import__('app.' + name, fromlist=['_'])
        package.__path__.insert(0, str(PARENT / 'upstream/app' / name))
    import scripts
    scripts.__path__ = [str(PARENT / 'upstream/scripts'), *scripts.__path__]
from dotenv import dotenv_values
from sqlalchemy import DateTime, insert, text, update
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from app.models import Base, CanonicalPlace, PlaceEntity, PlaceEntityMember, PlaceEntityReview, PlaceMention, PlaceSummary, RawNote
from app.aggregate.place_identity import apply_decision, load_catalog, rollback_decision
from app.aggregate.mention_identity import apply_scope_decision, load_mention_catalog, load_mention_rows
from app.clean.mention_identity import MENTION_FIELDS, mention_fingerprint, source_fingerprint
from scripts import export_to_tripweaver as exporter


def write_new(path, value):
    with path.open('x', encoding='utf-8') as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)


def inputs():
    raw = SNAPSHOT.read_bytes()
    frozen = json.loads(raw)['cities'][0]
    row = next(m for m in frozen['mentions'] if m['id'] == 3148)
    source = next(s for s in frozen['sources'] if s['id'] == 1508)
    evidence = [{'kind': 'mention_name_correction', 'file': str(ROOT.parent / '景山误归并原因排查.md'),
        'conclusion': '笔记504原图P1/P2明确景山公园、故宫对面及俯瞰故宫；只确认3148的误写意图。石景山公园不是全局别名，不审改预约、网页或图片事实。',
        'snapshotSha256': hashlib.sha256(raw).hexdigest(), 'mentionId': 3148}]
    scope = dict(key='top30-20261009-batch-78-jingshan-name-scope', city='北京', mode='name_correction',
        sourcePlaceId=1508, expectedSourceHash=source_fingerprint(source), expectedScopeRevision=0,
        expectedRevisions={TARGET: 4}, assignments=[dict(mentionId=3148, inputHash=row['inputHash'], entityId=TARGET)],
        evidence=evidence)
    decision = dict(key='top30-20261009-batch-78-jingshan-exclude-name', city='北京', entityId=TARGET,
        canonicalName='景山公园', mergeEntityIds=[], overrides={}, excludeNames=['石景山公园'],
        expectedRevisions={TARGET: 5}, evidence=evidence)
    expected = dict(city='北京', id=TARGET, name='景山公园', revision=6, verified=True,
        recommendScore=95.36, mentionCount=37, scopeMode='name_correction',
        correctionMentionIds=[3148], excludedNames=['石景山公园'])
    return frozen, scope, decision, expected


async def seed(session, frozen):
    def values(model, row):
        return {k: datetime.fromisoformat(v) if isinstance(model.__table__.c[k].type, DateTime) and v else v
                for k, v in row.items() if k in model.__table__.c}
    for nid, n in frozen['notes'].items():
        session.add(RawNote(id=int(nid), note_id=f'frozen-{nid}', city='北京', keyword='冻结预演',
            title=n['note_title'], desc=n['note_desc'], img_analysis=n['note_images'],
            status='PRIVATE' if n['note_unavailable'] else 'EXTRACTED', source_url=n['source_url'],
            created_at=datetime.fromisoformat(n['observed_at']) if n['observed_at'] else None))
    await session.flush()
    for model, key in [(CanonicalPlace, 'sources'), (PlaceSummary, 'summaries')]:
        for row in frozen[key]:
            await session.execute(insert(model).values(**values(model, row)))
    for entity in frozen['entities']:
        await session.execute(insert(PlaceEntity).values(**{**entity, 'redirect_to': None}))
    for entity in frozen['entities']:
        if entity['redirect_to']:
            await session.execute(update(PlaceEntity).where(PlaceEntity.entity_id == entity['entity_id']).values(redirect_to=entity['redirect_to']))
    for pid, eid in frozen['members'].items():
        await session.execute(insert(PlaceEntityMember).values(place_id=int(pid), entity_id=eid))
    for row in frozen['mentions']:
        await session.execute(insert(PlaceMention).values(**{k: row[k] for k in MENTION_FIELDS}))
    for row in frozen['reviews']:
        await session.execute(insert(PlaceEntityReview).values(**values(PlaceEntityReview, row)))
    assert not frozen['scopes'] and not frozen['assignments']
    await session.commit()


async def apply_and_check(session, frozen, scope, decision):
    before = await load_mention_catalog(session, '北京')
    assert before.catalog.entities == {e['entity_id']: e for e in frozen['entities']}
    original = await load_mention_rows(session, '北京')
    assert {m['id']: mention_fingerprint(m) for m in original} == {m['id']: m['inputHash'] for m in frozen['mentions']}
    source_before = (await session.execute(text("SELECT row_to_json(p) FROM canonical_place p WHERE city='北京' ORDER BY id"))).scalars().all()
    scope_result = await apply_scope_decision(session, scope)
    assert await apply_scope_decision(session, scope) == scope_result
    result = await apply_decision(session, decision)
    assert await apply_decision(session, decision) == result
    current = await load_mention_catalog(session, '北京')
    assert current.managed_entity_ids() == set()
    assert current.catalog.resolve('石景山公园') is None
    assert current.catalog.root(OLD)['entity_id'] == TARGET
    assert current.catalog.entities[TARGET]['revision'] == 6
    assert all((current.resolve(m).get('entity') or {}).get('entity_id') == previous['entityId']
        for m, previous in zip(original, frozen['mentions']))
    typo = next(m for m in original if m['id'] == 3148)
    assert current.resolve(typo)['reason'] == 'reviewed_assignment'
    assert current.resolve({**typo, 'id': 999999})['reason'] == 'unreviewed_mention'
    assert current.resolve({**typo, 'note_desc': '原文变更'})['reason'] == 'changed_input'
    assert source_before == (await session.execute(text("SELECT row_to_json(p) FROM canonical_place p WHERE city='北京' ORDER BY id"))).scalars().all()
    assert original == await load_mention_rows(session, '北京')
    assert {k: v for k, v in current.catalog.entities.items() if k != TARGET} == {k: v for k, v in before.catalog.entities.items() if k != TARGET}
    return {'scopeChanges': [scope_result], 'changes': [result], 'checks': {
        'sameMentionOwners': True, 'onlyJingshanEntityChanged': True, 'rawSourcesAndMentionsUnchanged': True,
        'knownTypoBound': True, 'futureTypoPending': True, 'changedInputPending': True,
        'globalWrongAliasRemoved': True, 'legacyIdPreserved': True, 'noFactOrMediaScope': True, 'idempotency': True}}


def stable(place):
    value = copy.deepcopy(place)
    value['payload'].get('content', {}).pop('compiledAt', None)
    if value['id'] == TARGET:
        value['payload'].pop('identity')
        value['payload'].pop('aliases', None)
        value['payload']['recommendationIdentity'].pop('revision')
    return value


async def main():
    frozen, scope, decision, expected = inputs()
    for suffix, value in [('scope-decisions', [scope]), ('decisions', [decision]), ('export-expectations', [expected])]:
        path = PARENT / f'all-cities/batch-78-{suffix}.json'
        if path.exists():
            assert json.loads(path.read_bytes()) == value
        else:
            assert not args.apply
            write_new(path, value)
    if args.apply:
        preview = json.loads((ROOT / args.attempt / 'report.json').read_bytes())
        assert preview['passed'] and preview['snapshotSha256'] == scope['evidence'][0]['snapshotSha256']
        out = PARENT / 'all-cities/batch-78-applied.json'
        assert not out.exists()
        engine = create_async_engine(dotenv_values('D:/Project/xhs-travel-pipeline/.env')['DATABASE_URL'])
        try:
            async with async_sessionmaker(engine, expire_on_commit=False, autoflush=False)() as session:
                await session.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ'))
                await session.execute(text("SET LOCAL statement_timeout='30s'"))
                report = await apply_and_check(session, frozen, scope, decision)
                await session.commit()
            write_new(out, {**report, 'apply': True, 'cities': [{'city': '北京'}]})
        finally:
            await engine.dispose()
        print(json.dumps({'apply': True, 'checks': report['checks']}, ensure_ascii=False))
        return
    folder = ROOT / args.attempt
    assert folder.parent == ROOT and not folder.exists()
    folder.mkdir()
    database = f'place_identity_test_{time.time_ns()}'
    admin = create_async_engine('postgresql+asyncpg://postgres@127.0.0.1:18798/postgres', isolation_level='AUTOCOMMIT')
    engine = create_async_engine(f'postgresql+asyncpg://postgres@127.0.0.1:18798/{database}')
    report = {'isolated': True, 'apply': False, 'snapshotSha256': scope['evidence'][0]['snapshotSha256']}
    try:
        async with admin.connect() as connection:
            await connection.execute(text(f'CREATE DATABASE "{database}"'))
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        factory = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)
        async with factory() as session:
            await seed(session, frozen)
        exporter.SessionFactory = factory
        async def export(name):
            path = folder / name
            sys.argv = ['export', '--city', '北京', '--out', str(path)]
            await exporter.main()
            return json.loads(path.read_bytes())
        before = await export('before.json')
        async with factory() as session:
            report.update(await apply_and_check(session, frozen, scope, decision))
            await session.commit()
        after = await export('xhs-places-北京.json')
        assert {p['id']: stable(p) for p in before['places']} == {p['id']: stable(p) for p in after['places']}
        target = next(p for p in after['places'] if p['id'] == TARGET)
        old_target = next(p for p in before['places'] if p['id'] == TARGET)
        assert target['payload']['content'] == old_target['payload']['content']
        baseline = next(p for p in frozen['downstream'] if p['id'] == TARGET)
        assert target['payload']['content'] == baseline['payload']['content']
        assert 'mentionSources' not in target['payload'] and 'imageIdentity' not in target['payload']
        assert target['payload']['recommendScore'] == expected['recommendScore']
        assert target['payload']['mentionCount'] == 37
        report['checks'].update(allExportedPlacesPreservedExceptIdentityAndCompiledAt=True,
            originalWebProfilePreserved=True, actualScoreUnchanged=True, noMediaContractAdded=True)
        report['placeCount'] = len(after['places'])
        async with factory() as session:
            await rollback_decision(session, decision['key'])
            await rollback_decision(session, scope['key'])
            restored = await load_mention_catalog(session, '北京')
            assert restored.catalog.entities == {e['entity_id']: e for e in frozen['entities']}
            assert not restored.scopes and not restored.assignments
            await session.commit()
        restored = await export('restored.json')
        assert {p['id']: stable(p) for p in before['places']} == {p['id']: stable(p) for p in restored['places']}
        report['reverseRollback'] = True
        report['passed'] = all(report['checks'].values())
    except BaseException as error:
        report.update(passed=False, error=f'{type(error).__name__}: {error}')
        raise
    finally:
        await engine.dispose()
        async with admin.connect() as connection:
            await connection.execute(text(f'DROP DATABASE IF EXISTS "{database}" WITH (FORCE)'))
        await admin.dispose()
        report['temporaryDatabaseRemoved'] = True
        write_new(folder / 'report.json', report)
    print(json.dumps({k: report[k] for k in ['passed', 'checks', 'placeCount', 'reverseRollback', 'temporaryDatabaseRemoved']}, ensure_ascii=False))


if __name__ == '__main__':
    asyncio.run(main())
