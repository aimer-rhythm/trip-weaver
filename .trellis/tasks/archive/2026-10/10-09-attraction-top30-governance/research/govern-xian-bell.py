"""钟楼同体归一与错配隔离；整城重建预演、原资料保全和逆序回滚。"""
import argparse
import asyncio
import hashlib
import importlib.util
import json
import sys
import time
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('merges', ROOT / 'govern-city-merges.py')
merges = importlib.util.module_from_spec(spec)
spec.loader.exec_module(merges)
from sqlalchemy import text, insert
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from dotenv import dotenv_values
from app.models import Base, CanonicalPlaceSource, PlaceRelation
from app.aggregate.place_identity import apply_decision, rollback_decision
from app.aggregate.mention_identity import apply_scope_decision, load_mention_catalog, load_mention_rows
from app.clean.mention_identity import mention_fingerprint, source_fingerprint
from app.clean.recommendation import recommendation_metrics
from freeze import governance_state
extras_spec = importlib.util.spec_from_file_location('scope_extras', ROOT / 'freeze-xian-scope-extras.py')
extras_module = importlib.util.module_from_spec(extras_spec)
extras_spec.loader.exec_module(extras_module)

TARGET = '4e4defe90dcdd9dc78c1ef92cc904def'
OLD = 'e2cc5c5e29cf02b2814374835e5c5a2f'
BATCH = 'batch-86'
PARENT = merges.PARENT
SNAPSHOT = ROOT / 'snapshot-20261009T165057648136Z/input.json'
UNASSIGNED = {11999, 12132, 12488}
EXTRAS_FILE = ROOT / 'xian-scope-extras-01.json'


async def extra_state(session):
    return {key: (await session.execute(text(query))).scalars().all() for key, query in extras_module.QUERIES.items()}


def normalized_extras(value):
    value = merges.copy.deepcopy(value)
    for row in value['relations']:
        row['created_at'] = merges.datetime.fromisoformat(row['created_at']).astimezone(merges.timezone.utc).isoformat()
    return value


def inputs():
    raw = SNAPSHOT.read_bytes()
    frozen = json.loads(raw)['cities'][0]
    assert frozen['city'] == '西安' and not frozen['scopes']
    rows = [m for m in frozen['mentions'] if m['entityId'] in {TARGET, OLD}]
    assert len(rows) == 27 and UNASSIGNED.issubset({m['id'] for m in rows})
    quotes = [
        (2694, '简直了！不愧是做了10天攻略选出的民宿'),
        (2732, 'P3-5 钟楼饭店门前广场'),
        (2654, '钟楼周围最热闹，美食也多，但是价格偏贵。'),
        (2739, '先登钟楼，站在西安城市中轴线上，俯瞰四条大街全景，拍夜景。'),
        (2646, '德福巷→西安钟楼→西安鼓楼'),
    ]
    for nid, quote in quotes:
        assert quote in frozen['notes'][str(nid)]['note_desc']
    evidence = [{'kind': 'reviewed_attraction_identity_and_sources', 'file': str(Path(__file__).relative_to(ROOT.parents[3])),
        'snapshotSha256': hashlib.sha256(raw).hexdigest(), 'mentionIds': [m['id'] for m in rows],
        'noteQuotes': [{'noteId': nid, 'quote': quote} for nid, quote in quotes],
        'conclusion': '全名与简称均指西安城市中轴线的钟楼。11999仅推荐住宿片区，12132是未具名民宿，12488是饭店前广场/茶店机位，三条保持null待审，不建立域外主体。12075身份可指钟楼，但免费登高描述属于开元观景台，排除reason，保留所见塔体原看点。鼓楼、饭店、商场、茶店与广场均不合并；位置继承5558但未新验证。'}]
    decision = {'key': 'top30-20261010-batch-86-xian-bell-merge', 'city': '西安', 'entityId': TARGET,
        'mergeEntityIds': [OLD], 'canonicalName': '西安钟楼', 'aliases': ['西安钟楼', '钟楼'],
        'expectedRevisions': {TARGET: 1, OLD: 1}, 'overrides': {'category': '娱乐'}, 'evidence': evidence}
    sources = {s['id']: s for s in frozen['sources']}
    assignments = [{'mentionId': m['id'], 'inputHash': m['inputHash'], 'entityId': None if m['id'] in UNASSIGNED else TARGET}
                   for m in rows]
    spot_quote = '钟楼·云端剧场\n定位：开元商场楼顶观景台'
    assert spot_quote in frozen['notes']['2701']['note_desc']
    next(a for a in assignments if a['mentionId'] == 12075)['factExclusions'] = {
        'reason': {'reason': 'subject_mismatch', 'quote': spot_quote}}
    scope = {'key': 'top30-20261010-batch-86-xian-bell-scope', 'city': '西安', 'sourcePlaceId': 5558,
        'expectedSourceHash': source_fingerprint(sources[5558]), 'expectedScopeRevision': 0,
        'sources': [{'sourcePlaceId': sid, 'sourceHash': source_fingerprint(sources[sid])} for sid in [5507, 5558]],
        'expectedRevisions': {TARGET: 2}, 'assignments': assignments, 'evidence': evidence}
    own = [m for m in rows if m['id'] not in UNASSIGNED]
    expected = {'city': '西安', 'id': TARGET, 'name': '西安钟楼', 'revision': 3,
        'verified': True, 'mentionIds': [m['id'] for m in own], **recommendation_metrics(own)}
    return frozen, decision, scope, expected


async def apply_checked(session, frozen, decision, scope, expected):
    before = await load_mention_catalog(session, '西安')
    assert before.catalog.entities == {e['entity_id']: e for e in frozen['entities']}
    original = await load_mention_rows(session, '西安')
    assert {m['id']: mention_fingerprint(m) for m in original} == {m['id']: m['inputHash'] for m in frozen['mentions']}
    full_before = merges.normalized_governance(await governance_state(session, '西安'))
    assert full_before == merges.normalized_governance(frozen['governanceState'])
    async def raw_state():
        return [(await session.execute(text(query))).scalars().all() for query in [
            "SELECT row_to_json(p) FROM canonical_place p WHERE city='西安' ORDER BY id",
            "SELECT row_to_json(s) FROM place_summary s JOIN canonical_place p ON p.id=s.canonical_place_id WHERE p.city='西安' ORDER BY p.id"]]
    raw_before = await raw_state()
    extras = json.loads(EXTRAS_FILE.read_bytes())
    assert extras.pop('snapshotSha256') == hashlib.sha256(SNAPSHOT.read_bytes()).hexdigest()
    extras_before = await extra_state(session)
    assert normalized_extras(extras_before) == normalized_extras(extras)
    def normalized_rows(rows, model):
        dates = {c.name for c in model.__table__.c if isinstance(c.type, merges.DateTime)}
        return [{k: merges.datetime.fromisoformat(v).astimezone(merges.timezone.utc).isoformat()
                 if k in dates and v else v for k, v in row.items()} for row in rows]
    for actual, frozen_key, model in zip(raw_before, ['sources', 'summaries'], [merges.CanonicalPlace, merges.PlaceSummary]):
        assert normalized_rows(actual, model) == normalized_rows(frozen[frozen_key], model)
    change = await apply_decision(session, decision)
    assert await apply_decision(session, decision) == change
    scope_change = await apply_scope_decision(session, scope)
    assert await apply_scope_decision(session, scope) == scope_change
    after = await load_mention_catalog(session, '西安')
    own = []
    for m in original:
        resolved = after.resolve(m)
        eid = (resolved.get('entity') or {}).get('entity_id')
        previous = next(row for row in frozen['mentions'] if row['id'] == m['id'])['entityId']
        desired = None if m['id'] in UNASSIGNED else TARGET if previous in {OLD, TARGET} else previous
        assert eid == desired
        if m['id'] in UNASSIGNED:
            assert resolved['status'] == 'review'
        if eid == TARGET:
            own.append(m)
    assert recommendation_metrics(own) == {k: expected[k] for k in ['recommendScore', 'mentionCount']}
    assert sorted(m['id'] for m in own) == sorted(expected['mentionIds'])
    assert after.catalog.entities[TARGET]['revision'] == 3
    assert after.catalog.entities[TARGET]['primary_place_id'] == 5558
    assert {k: v for k, v in before.catalog.entities.items() if k not in {OLD, TARGET}} == {
        k: v for k, v in after.catalog.entities.items() if k not in {OLD, TARGET}}
    assert await load_mention_rows(session, '西安') == original
    assert await raw_state() == raw_before
    assert await extra_state(session) == extras_before
    future = dict(next(m for m in original if m['id'] == 11781))
    future['id'] = 99999999
    assert after.resolve(future)['status'] == 'review'
    changed_input = dict(next(m for m in original if m['id'] == 11781))
    changed_input['note_desc'] += '\n新增正文'
    assert after.resolve(changed_input)['status'] == 'review'
    full_after = merges.normalized_governance(await governance_state(session, '西安'))
    for key in full_before:
        if key not in {'rawScopes', 'scopeSources', 'rawAssignments'}:
            assert full_after[key] == full_before[key]
    assert after.assignments[12075]['fact_exclusions']['reason']['reason'] == 'subject_mismatch'
    return {'changes': [change], 'scopeChanges': [scope_change], 'checks': {
        'idempotency': True, 'exactMentionAssignments': True, 'unassignedRemainReview': True,
        'scoresRecomputed': True, 'otherEntitiesPreserved': True, 'originalMentionsNotesMediaPreserved': True,
        'rawSourcesAndSummariesPreserved': True, 'newAndChangedMentionsStayReview': True,
        'originalProvenanceAndRelationsPreserved': True}}


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--attempt', default='preview-01')
    args = parser.parse_args()
    assert merges.re.fullmatch(r'preview-\d{2}', args.attempt)
    frozen, decision, scope, expected = inputs()
    fingerprint = hashlib.sha256(json.dumps([decision, scope, expected,
        hashlib.sha256(EXTRAS_FILE.read_bytes()).hexdigest()], ensure_ascii=False, sort_keys=True).encode()).hexdigest()
    folder = PARENT / BATCH / args.attempt
    for suffix, value in [('decisions', [decision]), ('scope-decisions', [scope]), ('export-expectations', [expected])]:
        path = PARENT / f'{BATCH}-{suffix}.json'
        if path.exists(): assert json.loads(path.read_bytes()) == value
        else:
            assert not args.apply
            merges.write_new(path, value)
    if args.apply:
        preview = json.loads((folder / 'report.json').read_bytes())
        assert preview['passed'] and preview['temporaryDatabaseRemoved'] and preview['planSha256'] == fingerprint
        out = PARENT / f'{BATCH}-applied.json'
        assert not out.exists()
        engine = create_async_engine(dotenv_values('D:/Project/xhs-travel-pipeline/.env')['DATABASE_URL'])
        try:
            async with async_sessionmaker(engine, expire_on_commit=False, autoflush=False)() as session:
                await session.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ'))
                report = await apply_checked(session, frozen, decision, scope, expected)
                assert report['changes'] == preview['changes']
                def comparable_scopes(changes):
                    value = merges.copy.deepcopy(changes)
                    # 新建待审行的数据库序列ID不是治理身份；指纹、提及、状态和全部其他字段仍精确比较。
                    for change in value:
                        for review in change['scopeReviews']:
                            review.pop('id')
                    return value
                actual, planned = comparable_scopes(report['scopeChanges']), comparable_scopes(preview['scopeChanges'])
                if actual != planned:
                    def diffs(a, b, path=''):
                        if a == b: return []
                        if isinstance(a, dict) and isinstance(b, dict):
                            return [p for k in a.keys() | b.keys() for p in diffs(a.get(k), b.get(k), path + '/' + str(k))]
                        if isinstance(a, list) and isinstance(b, list) and len(a) == len(b):
                            return [p for i, (x, y) in enumerate(zip(a, b)) for p in diffs(x, y, path + '/' + str(i))]
                        return [path]
                    print(json.dumps({'scopeMismatchPaths': diffs(actual, planned)}))
                assert actual == planned
                await session.commit()
            merges.write_new(out, {**report, 'apply': True, 'planSha256': fingerprint, 'cities': [{'city': '西安'}]})
        finally: await engine.dispose()
        print(json.dumps({'apply': True, 'batch': BATCH, 'checks': report['checks']}))
        return
    folder.mkdir(parents=True, exist_ok=False)
    database = f'place_identity_test_{time.time_ns()}'
    admin = create_async_engine('postgresql+asyncpg://postgres@127.0.0.1:18798/postgres', isolation_level='AUTOCOMMIT')
    engine = create_async_engine(f'postgresql+asyncpg://postgres@127.0.0.1:18798/{database}',
        connect_args={'server_settings': {'synchronize_seqscans': 'off', 'enable_indexscan': 'off', 'enable_bitmapscan': 'off'}})
    report = {'isolated': True, 'apply': False, 'planSha256': fingerprint}
    try:
        async with admin.connect() as connection: await connection.execute(text(f'CREATE DATABASE "{database}"'))
        async with engine.begin() as connection: await connection.run_sync(Base.metadata.create_all)
        factory = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)
        async with factory() as session:
            await merges.seed(session, frozen)
            extra_rows = json.loads(EXTRAS_FILE.read_bytes())
            for key, model in [('provenance', CanonicalPlaceSource), ('relations', PlaceRelation)]:
                for row in extra_rows[key]:
                    values = {k: merges.datetime.fromisoformat(v) if isinstance(model.__table__.c[k].type, merges.DateTime) and v else v for k, v in row.items()}
                    await session.execute(insert(model).values(**values))
            await session.commit()
        merges.exporter.SessionFactory = factory
        async def export(name):
            path = folder / name
            sys.argv = ['export', '--city', '西安', '--out', str(path)]
            await merges.exporter.main()
            return json.loads(path.read_bytes())
        def places(data): return {p['id']: merges.stable(p) for p in data['places']}
        before = await export('before.json')
        assert places(before) == places(json.loads((ROOT / 'xian-baseline-02.json').read_bytes()))
        async with factory() as session:
            report.update(await apply_checked(session, frozen, decision, scope, expected))
            await session.commit()
        after = await export('xhs-places-西安.json')
        b, a = places(before), places(after)
        assert {k: v for k, v in b.items() if k not in {OLD, TARGET}} == {k: v for k, v in a.items() if k not in {OLD, TARGET}}
        target, previous = a[TARGET], b[TARGET]
        assert OLD not in a and OLD in target['payload']['identity']['memberIds']
        assert all(target[k] == previous[k] for k in ['lat', 'lng', 'category'])
        assert target['payload']['address'] == previous['payload']['address']
        assert sorted(m['mentionId'] for m in target['payload']['mentionSources']) == sorted(expected['mentionIds'])
        assert all(target['payload'][k] == expected[k] for k in ['recommendScore', 'mentionCount'])
        for old in [b[TARGET], b[OLD]]:
            assert not old['payload'].get('images') and not old.get('imageUrl')
        assert target['payload']['imageIdentity']['approved'] == []
        serialized = json.dumps(target['payload'], ensure_ascii=False)
        assert not any(bad in serialized for bad in ['民宿位于钟楼旁', '钟楼饭店门前广场', '夜景壮观且免费', '住宿推荐区域'])
        assert '夜景' in target['payload']['content']['intro']
        report['checks'].update(baselineExportMatched=True, otherExportsPreserved=True, primaryPositionAndCategoryPreserved=True,
            legacyIdsPreserved=True, wrongSubjectDescriptionsAbsent=True, existingMediaFieldsEmpty=True)
        async with factory() as session:
            await rollback_decision(session, scope['key'])
            await rollback_decision(session, decision['key'])
            restored = await load_mention_catalog(session, '西安')
            assert restored.catalog.entities == {e['entity_id']: e for e in frozen['entities']}
            assert not restored.scopes and not restored.assignments
            await session.commit()
        assert places(await export('restored.json')) == b
        report['checks']['reverseRollback'] = True
        report['passed'] = all(report['checks'].values())
    except BaseException as error:
        report.update(passed=False, errorType=type(error).__name__)
        raise
    finally:
        await engine.dispose()
        async with admin.connect() as connection: await connection.execute(text(f'DROP DATABASE IF EXISTS "{database}" WITH (FORCE)'))
        await admin.dispose()
        report['temporaryDatabaseRemoved'] = True
        merges.write_new(folder / 'report.json', report)
    print(json.dumps({'passed': report['passed'], 'checks': report['checks'], 'expected': expected}, ensure_ascii=False))


if __name__ == '__main__':
    try: asyncio.run(main())
    except Exception as error:
        print(json.dumps({'failed': True, 'errorType': type(error).__name__, 'frames': [
            {'file': Path(f.filename).name, 'line': f.lineno, 'function': f.name}
            for f in traceback.extract_tb(error.__traceback__) if str(ROOT) in f.filename]}, ensure_ascii=False))
        sys.exit(1)
