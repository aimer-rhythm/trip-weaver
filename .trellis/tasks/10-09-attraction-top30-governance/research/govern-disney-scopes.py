"""上海迪士尼两主体保留独立身份，仅隔离酒店参照和门口机位来源。"""
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
spec = importlib.util.spec_from_file_location('previous', ROOT / 'govern-shanghai-temple.py')
previous = importlib.util.module_from_spec(spec)
spec.loader.exec_module(previous)
merges, baseline = previous.merges, previous.baseline
from sqlalchemy import text, insert
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from dotenv import dotenv_values
from app.models import Base, CanonicalPlaceSource, PlaceRelation
from app.aggregate.place_identity import rollback_decision
from app.aggregate.mention_identity import apply_scope_decision, load_mention_catalog, load_mention_rows
from app.clean.mention_identity import source_fingerprint, mention_fingerprint
from app.clean.recommendation import recommendation_metrics
from freeze import governance_state

CITY, BATCH = '上海', 'batch-92'
SNAPSHOT = ROOT / 'snapshot-20261009T181500597046Z/input.json'
EXTRAS = ROOT / 'shanghai-scope-02-extras.json'
BASELINE = ROOT / 'shanghai-scope-02-baseline.json'
RESORT = '99a25cafcf6c44d21f6b2f6f3075d222'
PARK = '9974c8d245e9bcfcea7b631e4c4624c9'
TARGETS = {RESORT, PARK}
UNASSIGNED = {10337, 10341, 10407}
FORBIDDEN_PHRASES = ['从酒店坐地铁很快', '附近酒店有接驳车', '免费在门口拍照']
ENTITY_DECISIONS = []
PRESERVED_TARGET_PAYLOAD_FIELDS = []


def inputs():
    raw = SNAPSHOT.read_bytes()
    frozen = next(c for c in json.loads(raw)['cities'] if c['city'] == CITY)
    assert not any(TARGETS.intersection([*s['entity_ids'], *s.get('withdrawal_entity_ids', [])]) for s in frozen['scopes'])
    entities = {e['entity_id']: e for e in frozen['entities']}
    sources = {s['id']: s for s in frozen['sources']}
    quotes = [
        (2351, '先来夸夸酒店的位置吧，从酒店出来就是地铁站'),
        (2352, '4️⃣上海迪士尼附近的一家酒店，去迪士尼玩的首选这家，酒店有接驳车200💰/人'),
        (2275, '9️⃣迪士尼门口'),
        (2291, '✅路线：迪士尼一日游'),
        (2292, '小镇吃饭可凭门票当日二次入园'),
        (2289, '以上除了迪士尼要门票其它都是免费的'),
    ]
    for n, q in quotes:
        assert q in frozen['notes'][str(n)]['note_desc']
    evidence = [{'kind': 'reviewed_attraction_source_scope', 'snapshotSha256': hashlib.sha256(raw).hexdigest(),
        'file': str(Path(__file__).relative_to(ROOT.parents[3])),
        'noteQuotes': [{'noteId': n, 'quote': q} for n, q in quotes],
        'conclusion': '保留上海迪士尼度假区与上海迪士尼乐园原独立根、名称、旧ID及位置，不以泛称强行合并。10337、10341是未具名酒店介绍中的交通参照，10407原文明确门口拍照，均null待审，未创建酒店或机位主体。度假区10188仅保留既有一日游归属，证据未细分为园内或小镇，不转给乐园、不把两主体当已完全消除重叠；乐园4条园内游玩/城堡烟花提及保留。小镇用餐和酒店接驳不能成为乐园独立事实。'}]
    scopes, expected = [], []
    for eid, total in [(RESORT, 3), (PARK, 5)]:
        entity = entities[eid]
        assert entity['status'] == 'ACTIVE' and not entity['redirect_to']
        source_id = entity['primary_place_id']
        rows = [m for m in frozen['mentions'] if m['entityId'] == eid]
        assert len(rows) == total
        assignments = [{'mentionId': m['id'], 'inputHash': m['inputHash'],
            'entityId': None if m['id'] in UNASSIGNED else eid} for m in rows]
        scope = {'key': f'top30-20261010-batch-92-scope-{source_id}', 'city': CITY, 'sourcePlaceId': source_id,
            'expectedSourceHash': source_fingerprint(sources[source_id]), 'expectedScopeRevision': 0,
            'expectedRevisions': {eid: entity['revision']}, 'assignments': assignments, 'evidence': evidence}
        own = [m for m in rows if m['id'] not in UNASSIGNED]
        scopes.append(scope)
        expected.append({'city': CITY, 'id': eid, 'name': entity['canonical_name'], 'revision': entity['revision'] + 1,
            'verified': True, 'mentionIds': [m['id'] for m in own], **recommendation_metrics(own)})
    return frozen, scopes, expected


async def apply_checked(session, frozen, scopes, expected):
    before = await load_mention_catalog(session, CITY)
    assert before.catalog.entities == {e['entity_id']: e for e in frozen['entities']}
    # 治理表行序不参与身份语义；键集合及每行全部字段仍精确核对。
    for actual, rows, key in [(before.scopes, frozen['scopes'], 'place_id'),
                              (before.assignments, frozen['assignments'], 'mention_id')]:
        expected_rows = {r[key]: r for r in rows}
        assert len(expected_rows) == len(rows)
        assert actual == expected_rows
    original = await load_mention_rows(session, CITY)
    assert {m['id']: mention_fingerprint(m) for m in original} == {m['id']: m['inputHash'] for m in frozen['mentions']}
    full_before = merges.normalized_governance(await governance_state(session, CITY))
    assert full_before == merges.normalized_governance(frozen['governanceState'])
    extras = json.loads(EXTRAS.read_bytes())
    assert extras.pop('snapshotSha256') == hashlib.sha256(SNAPSHOT.read_bytes()).hexdigest()
    assert extras.pop('city') == CITY
    extra_before = await baseline.extra_state(session, CITY)
    assert previous.normalized_extras(extras) == previous.normalized_extras(extra_before)
    async def raw_state():
        return [(await session.execute(text(query), {'city': CITY})).scalars().all() for query in [
            'SELECT row_to_json(p) FROM canonical_place p WHERE city=:city ORDER BY id',
            'SELECT row_to_json(s) FROM place_summary s JOIN canonical_place p ON p.id=s.canonical_place_id WHERE p.city=:city ORDER BY p.id']]
    raw_before = await raw_state()
    for actual, key, model in zip(raw_before, ['sources', 'summaries'], [merges.CanonicalPlace, merges.PlaceSummary]):
        dates = {c.name for c in model.__table__.c if isinstance(c.type, merges.DateTime)}
        def normalized(rows):
            return [{k: merges.datetime.fromisoformat(v).astimezone(merges.timezone.utc).isoformat()
                if k in dates and v else v for k, v in row.items()} for row in rows]
        assert normalized(actual) == normalized(frozen[key])
    changes = []
    for scope in scopes:
        change = await apply_scope_decision(session, scope)
        assert await apply_scope_decision(session, scope) == change
        changes.append(change)
    after = await load_mention_catalog(session, CITY)
    owners = {m['id']: m['entityId'] for m in frozen['mentions']}
    for m in original:
        resolution = after.resolve(m)
        assert (resolution.get('entity') or {}).get('entity_id') == (None if m['id'] in UNASSIGNED else owners[m['id']])
        if m['id'] in UNASSIGNED:
            assert resolution['status'] == 'review'
    assert after.catalog.members == before.catalog.members
    assert {k: v for k, v in after.catalog.entities.items() if k not in TARGETS} == {
        k: v for k, v in before.catalog.entities.items() if k not in TARGETS}
    for target in expected:
        eid = target['id']
        now, old = after.catalog.entities[eid], before.catalog.entities[eid]
        assert now['revision'] == target['revision']
        assert all(now[k] == old[k] for k in ['canonical_name', 'primary_place_id', 'aliases', 'legacy_ids', 'redirect_to'])
        own = [m for m in original if (after.resolve(m).get('entity') or {}).get('entity_id') == eid]
        assert sorted(m['id'] for m in own) == sorted(target['mentionIds'])
        assert recommendation_metrics(own) == {k: target[k] for k in ['mentionCount', 'recommendScore']}
        future = dict(own[0], id=99999999)
        assert after.resolve(future)['status'] == 'review'
        changed = {**own[0], 'note_desc': own[0]['note_desc'] + '\n新正文'}
        assert after.resolve(changed)['status'] == 'review'
    assert all(after.scopes[k] == v for k, v in before.scopes.items())
    assert all(after.assignments[k] == v for k, v in before.assignments.items())
    assert set(after.scopes) == set(before.scopes) | {s['sourcePlaceId'] for s in scopes}
    assert set(after.assignments) == set(before.assignments) | {a['mentionId'] for s in scopes for a in s['assignments']}
    assert await load_mention_rows(session, CITY) == original and await raw_state() == raw_before
    assert await baseline.extra_state(session, CITY) == extra_before
    full_after = merges.normalized_governance(await governance_state(session, CITY))
    assert all(full_before[k] == full_after[k] for k in full_before if k not in {'rawScopes', 'scopeSources', 'rawAssignments'})
    return {'changes': [], 'scopeChanges': changes, 'checks': {'idempotency': True, 'exactAssignments': True,
        'rootsNamesAliasesLegacyIdsPreserved': True, 'otherEntitiesAndExistingScopesPreserved': True,
        'originalSourcesSummariesNotesMentionsMediaPreserved': True, 'originalProvenanceRelationsPreserved': True,
        'scoresRecomputed': True, 'newAndChangedMentionsStayReview': True}}


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--attempt', default='preview-01')
    args = parser.parse_args()
    assert merges.re.fullmatch(r'preview-\d{2}', args.attempt)
    frozen, scopes, expected = inputs()
    # 图片暂缓：上游没有图片不能证明下游旧封面/图库不存在。
    # 完整scope切换受控媒体合同前须停止，不能伪装图片已审或清空旧消费。
    for place in frozen['downstream']:
        if place['id'] in TARGETS:
            payload = place.get('payload') or {}
            assert not any(payload.get(k) for k in ['coverImage', 'imageGallery', 'amapPhoto']), \
                f"完整scope存在下游旧媒体，须先完成保全方案：{place['id']}"
    fingerprint_input = [scopes, expected, hashlib.sha256(EXTRAS.read_bytes()).hexdigest(),
        hashlib.sha256(BASELINE.read_bytes()).hexdigest()]
    if ENTITY_DECISIONS:
        fingerprint_input.append(ENTITY_DECISIONS)
    if PRESERVED_TARGET_PAYLOAD_FIELDS:
        fingerprint_input.append({'preservedTargetPayloadFields': PRESERVED_TARGET_PAYLOAD_FIELDS})
    fingerprint = hashlib.sha256(json.dumps(fingerprint_input, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
    folder = merges.PARENT / BATCH / args.attempt
    for suffix, value in [('decisions', ENTITY_DECISIONS), ('scope-decisions', scopes), ('export-expectations', expected)]:
        path = merges.PARENT / f'{BATCH}-{suffix}.json'
        if path.exists():
            assert json.loads(path.read_bytes()) == value
        else:
            assert not args.apply
            merges.write_new(path, value)
    if args.apply:
        preview = json.loads((folder / 'report.json').read_bytes())
        assert preview['passed'] and preview['temporaryDatabaseRemoved'] and preview['planSha256'] == fingerprint
        out = merges.PARENT / f'{BATCH}-applied.json'
        assert not out.exists()
        engine = create_async_engine(dotenv_values('D:/Project/xhs-travel-pipeline/.env')['DATABASE_URL'])
        try:
            async with async_sessionmaker(engine, expire_on_commit=False, autoflush=False)() as session:
                await session.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ'))
                await session.execute(text("SET LOCAL statement_timeout='30s'"))
                report = await apply_checked(session, frozen, scopes, expected)
                def comparable(changes):
                    value = merges.copy.deepcopy(changes)
                    for change in value:
                        for review in change['scopeReviews']:
                            review.pop('id')
                    return value
                assert comparable(report['scopeChanges']) == comparable(preview['scopeChanges'])
                assert report.get('changes', []) == preview.get('changes', [])
                await session.commit()
            merges.write_new(out, {**report, 'apply': True, 'planSha256': fingerprint, 'cities': [{'city': CITY}]})
        finally:
            await engine.dispose()
        print(json.dumps({'applied': BATCH, 'checks': report['checks']}, ensure_ascii=False))
        return
    folder.mkdir(parents=True, exist_ok=False)
    database = f'place_identity_test_{time.time_ns()}'
    admin = create_async_engine('postgresql+asyncpg://postgres@127.0.0.1:18798/postgres', isolation_level='AUTOCOMMIT')
    engine = create_async_engine(f'postgresql+asyncpg://postgres@127.0.0.1:18798/{database}',
        connect_args={'server_settings': {'synchronize_seqscans': 'off', 'enable_indexscan': 'off', 'enable_bitmapscan': 'off'}})
    report = {'isolated': True, 'apply': False, 'planSha256': fingerprint}
    try:
        async with admin.connect() as connection:
            await connection.execute(text(f'CREATE DATABASE "{database}"'))
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        factory = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)
        async with factory() as session:
            await merges.seed(session, frozen)
            extras = json.loads(EXTRAS.read_bytes())
            for key, model in [('provenance', CanonicalPlaceSource), ('relations', PlaceRelation)]:
                for row in extras[key]:
                    await session.execute(insert(model).values(**{k: merges.datetime.fromisoformat(v)
                        if isinstance(model.__table__.c[k].type, merges.DateTime) and v else v for k, v in row.items()}))
            for model in [merges.PlaceIdentityScope, merges.PlaceIdentityScopeSource, merges.PlaceMentionAssignment, merges.PlaceEntityReview]:
                if 'id' in model.__table__.c:
                    table = model.__table__.name
                    await session.execute(text(f"SELECT setval(pg_get_serial_sequence('{table}', 'id'), COALESCE((SELECT MAX(id) FROM {table}), 0) + 1, false)"))
            await session.commit()
        merges.exporter.SessionFactory = factory
        async def export(name):
            path = folder / name
            sys.argv = ['export', '--city', CITY, '--out', str(path)]
            await merges.exporter.main()
            return {p['id']: merges.stable(p) for p in json.loads(path.read_bytes())['places']}
        before = await export('before.json')
        assert before == {p['id']: merges.stable(p) for p in json.loads(BASELINE.read_bytes())['places']}
        async with factory() as session:
            report.update(await apply_checked(session, frozen, scopes, expected))
            await session.commit()
        after = await export(f'xhs-places-{CITY}.json')
        assert set(after) == set(before)
        assert {k: v for k, v in before.items() if k not in TARGETS} == {k: v for k, v in after.items() if k not in TARGETS}
        preservation_differences = []
        for target in expected:
            eid = target['id']
            preservation_differences.extend({'entityId': eid, 'field': key}
                for key in PRESERVED_TARGET_PAYLOAD_FIELDS
                if before[eid]['payload'].get(key) != after[eid]['payload'].get(key))
            assert all(after[eid][k] == before[eid][k] for k in ['name', 'lat', 'lng', 'category'])
            assert after[eid]['payload']['address'] == before[eid]['payload']['address']
            assert sorted(m['mentionId'] for m in after[eid]['payload']['mentionSources']) == sorted(target['mentionIds'])
            assert all(after[eid]['payload'][k] == target[k] for k in ['recommendScore', 'mentionCount'])
            assert not before[eid]['payload'].get('images') and not before[eid].get('imageUrl')
            assert after[eid]['payload']['imageIdentity']['approved'] == []
            content = json.dumps({k: after[eid]['payload'].get(k) for k in ['content', 'tips', 'topReasons']}, ensure_ascii=False)
            assert not any(bad in content for bad in FORBIDDEN_PHRASES)
        async with factory() as session:
            for decision in reversed(ENTITY_DECISIONS):
                await rollback_decision(session, decision['key'])
            for scope in reversed(scopes):
                await rollback_decision(session, scope['key'])
            restored = await load_mention_catalog(session, CITY)
            assert restored.catalog.entities == {e['entity_id']: e for e in frozen['entities']}
            assert restored.catalog.members == {int(k): v for k, v in frozen['members'].items()}
            assert merges.normalized_governance(await governance_state(session, CITY)) == merges.normalized_governance(frozen['governanceState'])
            await session.commit()
        assert await export('restored.json') == before
        report['checks'].update(baselineAndOtherExportsPreserved=True, primaryPositionsAndCategoryPreserved=True,
            noOldMediaLost=True, wrongSubjectDescriptionsAbsent=True, reverseRollback=True)
        if PRESERVED_TARGET_PAYLOAD_FIELDS:
            report['preservedTargetPayloadFields'] = PRESERVED_TARGET_PAYLOAD_FIELDS
            report['preservationDifferences'] = preservation_differences
            report['checks']['targetPayloadFieldsPreserved'] = not preservation_differences
            assert not preservation_differences, '目标旧资料保全未通过，禁止正式应用'
        report['passed'] = all(report['checks'].values())
    except BaseException as error:
        report.update(passed=False, errorType=type(error).__name__)
        raise
    finally:
        await engine.dispose()
        async with admin.connect() as connection:
            await connection.execute(text(f'DROP DATABASE IF EXISTS "{database}" WITH (FORCE)'))
        await admin.dispose()
        report['temporaryDatabaseRemoved'] = True
        merges.write_new(folder / 'report.json', report)
    print(json.dumps({'passed': report['passed'], 'checks': report['checks'], 'expected': expected}, ensure_ascii=False))


if __name__ == '__main__':
    try:
        asyncio.run(main())
    except Exception as error:
        driver = getattr(getattr(error, 'orig', None), '__cause__', None)
        print(json.dumps({'failed': True, 'errorType': type(error).__name__, 'sqlstate': getattr(driver, 'sqlstate', None),
            'constraint': getattr(driver, 'constraint_name', None), 'frames': [
                {'file': Path(f.filename).name, 'line': f.lineno, 'function': f.name}
                for f in traceback.extract_tb(error.__traceback__) if str(ROOT) in f.filename]}, ensure_ascii=False))
        sys.exit(1)
