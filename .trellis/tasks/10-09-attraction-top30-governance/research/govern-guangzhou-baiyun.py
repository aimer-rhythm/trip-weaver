"""白云山全简称归一；明确独立机位及节庆活动不进入景区主体资料。"""
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
spec = importlib.util.spec_from_file_location('baseline', ROOT / 'freeze-scope-baseline.py')
baseline = importlib.util.module_from_spec(spec)
spec.loader.exec_module(baseline)
merges = baseline.merges
from sqlalchemy import text, insert
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from dotenv import dotenv_values
from app.models import Base, CanonicalPlaceSource, PlaceRelation
from app.aggregate.place_identity import apply_decision, rollback_decision
from app.aggregate.mention_identity import apply_scope_decision, load_mention_catalog, load_mention_rows
from app.clean.mention_identity import mention_fingerprint, source_fingerprint, effective_mention
from app.clean.recommendation import recommendation_metrics
from freeze import governance_state

CITY = '广州'
TARGET = '2495bc375ff6d1a499ff03145ea5cef4'
OLD_IDS = {'72c7931dd2e999ea255a14b7c9320897'}
ALL_IDS = {TARGET, *OLD_IDS}
BATCH = 'batch-91'
SNAPSHOT = ROOT / 'snapshot-20261009T180048218414Z/input.json'
EXTRAS = ROOT / 'guangzhou-scope-01-extras.json'
BASELINE = ROOT / 'guangzhou-scope-01-baseline.json'
UNASSIGNED = {7394, 7659, 8054, 8140}


def inputs():
    raw = SNAPSHOT.read_bytes()
    frozen = next(c for c in json.loads(raw)['cities'] if c['city'] == CITY)
    assert not frozen['scopes'] and not frozen['assignments']
    rows = [m for m in frozen['mentions'] if m['entityId'] in ALL_IDS]
    assert len(rows) == 13 and UNASSIGNED.issubset({m['id'] for m in rows})
    quotes = [
        (1688, '白云山被称为羊城第一秀、南越第一山。登高可俯览全市，遥望珠江'),
        (1820, '上午爬白云山：登顶俯瞰广州全城美景'),
        (1608, '导航白云山风景名胜区濂泉门—往碧箫亭方向走15分钟即可到达'),
        (1822, '9️⃣白云山——洞穴看广州塔\n很少人知道的隐藏机位'),
        (1822, '白云山广州碑林'),
        (1859, '白云山有非遗雅集、森林康养和音乐市集'),
        (1819, '🌙主题活动：白云山I中秋灯月会·非遗古乐夜'),
    ]
    for nid, quote in quotes:
        assert quote in frozen['notes'][str(nid)]['note_desc']
    public_raw = (ROOT / 'baiyun-fetch-01.json').read_bytes()
    public = json.loads(public_raw)
    assert public['ok'] and public['url'] == 'https://wglj.gz.gov.cn/ztmb/gzhyn/ajjq/5a/content/post_8904607.html'
    public_quote = '白云山，是新“羊城八景”之首、国家重点风景名胜区、全国文明风景旅游区和国家AAAAA级景区。'
    assert '白云山风景名胜区' in public['content'] and public_quote in public['content']
    evidence = [{'kind': 'reviewed_attraction_identity_and_sources', 'snapshotSha256': hashlib.sha256(raw).hexdigest(),
        'file': str(Path(__file__).relative_to(ROOT.parents[3])), 'mentionIds': [m['id'] for m in rows],
        'noteQuotes': [{'noteId': n, 'quote': q} for n, q in quotes],
        'publicSources': [{'file': 'baiyun-fetch-01.json', 'sha256': hashlib.sha256(public_raw).hexdigest(),
            'url': public['url'], 'title': '白云山风景名胜区', 'quote': public_quote}],
        'unassignedReasons': {'7394': '广州碑林洞穴拍广州塔的独立机位',
            '7659': '濂泉门往碧箫亭的爱乐之城摄影机位，不能按提纯全称归整个景区',
            '8054': '非遗雅集、森林康养和音乐市集活动汇总',
            '8140': '中秋灯月会和非遗古乐夜主题活动'},
        'conclusion': '广州市文旅局原页题为白云山风景名胜区，正文以白云山介绍同一广园中路景区，明确全简称同体。主根3329、旧ID和旧位置保留，不沿用3634西1门坐标作总景区新定位。全城13条中9条登山/风景/游览提及确认，4条独立机位或节庆活动保持null待审，不创建或写入域外主体。景区内云台花园、摩星岭、碑林、各入口及其它独立地点不并入；官方组成介绍仅作边界对照，本批不新增part_of关系。活动时间与机位事实不成为景区营业/推荐资料，原文与负面观点不改写。'}]
    entities = {e['entity_id']: e for e in frozen['entities']}
    decision = {'key': 'top30-20261010-batch-91-baiyun-merge', 'city': CITY, 'entityId': TARGET,
        'mergeEntityIds': sorted(OLD_IDS), 'canonicalName': '白云山', 'aliases': ['白云山', '白云山风景名胜区'],
        'expectedRevisions': {eid: entities[eid]['revision'] for eid in sorted(ALL_IDS)},
        'overrides': {}, 'evidence': evidence}
    assert set(decision['expectedRevisions'].values()) == {1}
    sources = {s['id']: s for s in frozen['sources']}
    assignments = [{'mentionId': m['id'], 'inputHash': m['inputHash'],
        'entityId': None if m['id'] in UNASSIGNED else TARGET} for m in rows]
    scope = {'key': 'top30-20261010-batch-91-baiyun-scope', 'city': CITY, 'sourcePlaceId': 3329,
        'expectedSourceHash': source_fingerprint(sources[3329]), 'expectedScopeRevision': 0,
        'sources': [{'sourcePlaceId': sid, 'sourceHash': source_fingerprint(sources[sid])} for sid in [3329, 3634]],
        'expectedRevisions': {TARGET: 2}, 'assignments': assignments, 'evidence': evidence}
    own = [m for m in rows if m['id'] not in UNASSIGNED]
    expected = {'city': CITY, 'id': TARGET, 'name': '白云山', 'revision': 3, 'verified': True,
        'mentionIds': [m['id'] for m in own], **recommendation_metrics(own)}
    return frozen, decision, scope, expected


def normalized_extras(value):
    value = merges.copy.deepcopy(value)
    for row in value['relations']:
        row['created_at'] = merges.datetime.fromisoformat(row['created_at']).astimezone(merges.timezone.utc).isoformat()
    return value


async def apply_checked(session, frozen, decision, scope, expected):
    before = await load_mention_catalog(session, CITY)
    assert before.catalog.entities == {e['entity_id']: e for e in frozen['entities']}
    assert list(before.scopes.values()) == frozen['scopes'] and list(before.assignments.values()) == frozen['assignments']
    original = await load_mention_rows(session, CITY)
    assert {m['id']: mention_fingerprint(m) for m in original} == {m['id']: m['inputHash'] for m in frozen['mentions']}
    full_before = merges.normalized_governance(await governance_state(session, CITY))
    assert full_before == merges.normalized_governance(frozen['governanceState'])
    extras = json.loads(EXTRAS.read_bytes())
    assert extras.pop('snapshotSha256') == hashlib.sha256(SNAPSHOT.read_bytes()).hexdigest()
    assert extras.pop('city') == CITY
    extras_before = await baseline.extra_state(session, CITY)
    assert normalized_extras(extras_before) == normalized_extras(extras)
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
    change = await apply_decision(session, decision)
    assert await apply_decision(session, decision) == change
    scope_change = await apply_scope_decision(session, scope)
    assert await apply_scope_decision(session, scope) == scope_change
    after = await load_mention_catalog(session, CITY)
    previous = {m['id']: m['entityId'] for m in frozen['mentions']}
    own = []
    for m in original:
        resolution = after.resolve(m)
        eid = (resolution.get('entity') or {}).get('entity_id')
        assert eid == (None if m['id'] in UNASSIGNED else TARGET if previous[m['id']] in ALL_IDS else previous[m['id']])
        if m['id'] in UNASSIGNED:
            assert resolution['status'] == 'review'
        if eid == TARGET:
            own.append(m)
    assert recommendation_metrics(own) == {k: expected[k] for k in ['recommendScore', 'mentionCount']}
    assert sorted(m['id'] for m in own) == sorted(expected['mentionIds'])
    assert after.catalog.entities[TARGET]['revision'] == 3 and after.catalog.entities[TARGET]['primary_place_id'] == 3329
    assert {k: v for k, v in before.catalog.entities.items() if k not in ALL_IDS} == {
        k: v for k, v in after.catalog.entities.items() if k not in ALL_IDS}
    assert all(after.scopes[k] == v for k, v in before.scopes.items())
    assert all(after.assignments[k] == v for k, v in before.assignments.items())
    assert set(after.scopes) == set(before.scopes) | {3329}
    assert set(after.assignments) == set(before.assignments) | {m['id'] for m in own} | UNASSIGNED
    assert await load_mention_rows(session, CITY) == original and await raw_state() == raw_before
    assert await baseline.extra_state(session, CITY) == extras_before
    future = dict(next(m for m in original if m['id'] == 7056))
    future['id'] = 99999999
    assert after.resolve(future)['status'] == 'review'
    changed = dict(next(m for m in original if m['id'] == 7056))
    changed['note_desc'] += '\n新增正文'
    assert after.resolve(changed)['status'] == 'review'
    for mid in expected['mentionIds']:
        negative = next(m for m in original if m['id'] == mid)
        assert effective_mention(negative, after.resolve(negative)) == {**negative, 'fact_value': negative['fact_value'] or {}}
    full_after = merges.normalized_governance(await governance_state(session, CITY))
    assert all(full_before[k] == full_after[k] for k in full_before if k not in {'rawScopes', 'scopeSources', 'rawAssignments'})
    return {'changes': [change], 'scopeChanges': [scope_change], 'checks': {
        'idempotency': True, 'exactMentionAssignments': True, 'newAndChangedMentionsStayReview': True,
        'originalNotesMediaSourcesSummariesPreserved': True, 'originalProvenanceRelationsPreserved': True,
        'existingScopesAssignmentsPreserved': True, 'otherEntitiesPreserved': True, 'scoresRecomputed': True,
        'photoAndActivitySourcesRemainReview': True, 'assignedMentionFactsPreserved': True}}


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--attempt', default='preview-01')
    args = parser.parse_args()
    assert merges.re.fullmatch(r'preview-\d{2}', args.attempt)
    frozen, decision, scope, expected = inputs()
    fingerprint = hashlib.sha256(json.dumps([decision, scope, expected,
        hashlib.sha256(EXTRAS.read_bytes()).hexdigest(), hashlib.sha256(BASELINE.read_bytes()).hexdigest()],
        ensure_ascii=False, sort_keys=True).encode()).hexdigest()
    folder = merges.PARENT / BATCH / args.attempt
    for suffix, value in [('decisions', [decision]), ('scope-decisions', [scope]), ('export-expectations', [expected])]:
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
                report = await apply_checked(session, frozen, decision, scope, expected)
                assert report['changes'] == preview['changes']
                def comparable(changes):
                    changes = merges.copy.deepcopy(changes)
                    for change in changes:
                        for review in change['scopeReviews']:
                            review.pop('id')
                    return changes
                assert comparable(report['scopeChanges']) == comparable(preview['scopeChanges'])
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
            extra_rows = json.loads(EXTRAS.read_bytes())
            for key, model in [('provenance', CanonicalPlaceSource), ('relations', PlaceRelation)]:
                for row in extra_rows[key]:
                    await session.execute(insert(model).values(**{k: merges.datetime.fromisoformat(v)
                        if isinstance(model.__table__.c[k].type, merges.DateTime) and v else v for k, v in row.items()}))
            # 冻结数据使用显式ID；一次性库序列须从已种入最大ID之后继续。
            # 只在临时库执行，避免新增scope/分配/待审与旧行主键相撞。
            for model in [merges.PlaceIdentityScope, merges.PlaceIdentityScopeSource,
                          merges.PlaceMentionAssignment, merges.PlaceEntityReview]:
                if 'id' in model.__table__.c:
                    table = model.__table__.name
                    await session.execute(text(f"SELECT setval(pg_get_serial_sequence('{table}', 'id'), COALESCE((SELECT MAX(id) FROM {table}), 0) + 1, false)"))
            await session.commit()
        merges.exporter.SessionFactory = factory
        async def export(name):
            path = folder / name
            sys.argv = ['export', '--city', CITY, '--out', str(path)]
            await merges.exporter.main()
            return json.loads(path.read_bytes())
        def places(data):
            return {p['id']: merges.stable(p) for p in data['places']}
        before = places(await export('before.json'))
        assert before == places(json.loads(BASELINE.read_bytes()))
        async with factory() as session:
            report.update(await apply_checked(session, frozen, decision, scope, expected))
            await session.commit()
        after = places(await export('xhs-places-广州.json'))
        assert {k: v for k, v in before.items() if k not in ALL_IDS} == {k: v for k, v in after.items() if k not in ALL_IDS}
        target = after[TARGET]
        assert all(eid not in after and eid in target['payload']['identity']['memberIds'] for eid in OLD_IDS)
        assert all(target[k] == before[TARGET][k] for k in ['lat', 'lng', 'category'])
        assert target['payload']['address'] == before[TARGET]['payload']['address']
        assert sorted(m['mentionId'] for m in target['payload']['mentionSources']) == sorted(expected['mentionIds'])
        assert all(target['payload'][k] == expected[k] for k in ['recommendScore', 'mentionCount'])
        assert all(not before[eid]['payload'].get('images') and not before[eid].get('imageUrl') for eid in ALL_IDS)
        assert target['payload']['imageIdentity']['approved'] == []
        serialized = json.dumps(target['payload'], ensure_ascii=False)
        assert not any(bad in serialized for bad in ['洞穴隐藏机位可俯瞰广州塔', '从濂泉门走向碧箫亭', '举办中秋灯月会与非遗古乐夜'])
        assert target['payload'].get('typicalVisitMinutes') is None
        report['checks'].update(baselineExportMatched=True, otherExportsPreserved=True,
            primaryPositionAndCategoryPreserved=True, legacyIdsPreserved=True, noOldMediaLost=True,
            wrongSubjectDescriptionsAbsent=True)
        async with factory() as session:
            await rollback_decision(session, scope['key'])
            await rollback_decision(session, decision['key'])
            restored = await load_mention_catalog(session, CITY)
            assert restored.catalog.entities == {e['entity_id']: e for e in frozen['entities']}
            assert list(restored.scopes.values()) == frozen['scopes'] and list(restored.assignments.values()) == frozen['assignments']
            assert merges.normalized_governance(await governance_state(session, CITY)) == merges.normalized_governance(frozen['governanceState'])
            await session.commit()
        assert places(await export('restored.json')) == before
        report['checks']['reverseRollback'] = True
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
        print(json.dumps({'failed': True, 'errorType': type(error).__name__,
            'sqlstate': getattr(driver, 'sqlstate', None), 'constraint': getattr(driver, 'constraint_name', None), 'frames': [
            {'file': Path(f.filename).name, 'line': f.lineno, 'function': f.name}
            for f in traceback.extract_tb(error.__traceback__) if str(ROOT) in f.filename]}, ensure_ascii=False))
        sys.exit(1)

