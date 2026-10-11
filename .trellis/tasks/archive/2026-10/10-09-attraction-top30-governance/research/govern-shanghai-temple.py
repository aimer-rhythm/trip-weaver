"""上海城隍庙全简称归一；明确商业街、主街及酒店参照不进入寺观事实。"""
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

CITY = '上海'
TARGET = '19564ce736eb343b014fc746280bcade'
OLD_IDS = {'4a414fb0851e78a75ede167121a35b2f'}
ALL_IDS = {TARGET, *OLD_IDS}
BATCH = 'batch-90'
SNAPSHOT = ROOT / 'snapshot-20261009T180048218414Z/input.json'
EXTRAS = ROOT / 'shanghai-scope-01-extras.json'
BASELINE = ROOT / 'shanghai-scope-01-baseline.json'
UNASSIGNED = {10128, 10145, 10354, 10372, 11000, 11027, 11157, 11262}


def inputs():
    raw = SNAPSHOT.read_bytes()
    frozen = next(c for c in json.loads(raw)['cities'] if c['city'] == CITY)
    assert not frozen['scopes'] and not frozen['assignments']
    rows = [m for m in frozen['mentions'] if m['entityId'] in ALL_IDS]
    assert len(rows) == 24 and UNASSIGNED.issubset({m['id'] for m in rows})
    quotes = [
        (2276, '📍城隍庙：上海道教名观，香火旺盛，周边小吃云集，感受老城厢烟火气'),
        (2277, '📍城隍庙+豫园（紧挨着，步行2分钟）'),
        (2304, '城隍庙、豫园、老街是连成一片的'),
        (2319, '3️⃣城隍庙\n📍松月楼素菜包\n📍宁波汤团店'),
        (2354, '离城隍庙，豫园都很近的'),
        (2276, '城隍庙小吃多，适量品尝，避免肠胃不适'),
        (2509, '城隍庙里面有各式各样的小吃！其中最出名的就是南翔馒头，绿波廊，沈大成'),
        (2511, '2. 城隍庙（10:00–11:00）\n• 免费街区'),
        (2513, '城隍庙小吃别抱太高期望，就是游客价，尝个鲜就行'),
        (2444, '📍城隍庙主街灯笼群：成片红灯笼连成街巷'),
        (2287, '❌ 豫园+城隍庙晚上不开放！别安排夜间行程'),
        (2474, '❌ 豫园+城隍庙晚上不开放！别安排夜间行程'),
    ]
    for nid, quote in quotes:
        assert quote in frozen['notes'][str(nid)]['note_desc']
    image_quote = '豫园门票30元，城隍庙10元'
    assert image_quote in frozen['notes']['2277']['note_images'][4]['text_content']
    exclusions = {
        10128: '城隍庙（豫园）标题与老街组合，点评重点为南翔餐饮，未拆出寺观独立资料',
        10145: '美食清单以城隍庙为片区标题，列六家小吃商户',
        10354: '三家未具名酒店广告中的邻近参照，没有寺观游览推荐',
        10372: '周边小吃的肠胃警示，不是寺观评价',
        11000: '明确小吃商业区，含九曲桥、楼宇灯光秀，不是道观整体',
        11027: '免费街区吃小笼、拍九曲桥的60分钟，不能给寺观时长',
        11157: '小吃游客价格建议，不是寺观评价',
        11262: '明确城隍庙主街灯笼群机位，不等同寺观主体',
    }
    evidence = [{'kind': 'reviewed_attraction_identity_and_sources', 'snapshotSha256': hashlib.sha256(raw).hexdigest(),
        'file': str(Path(__file__).relative_to(ROOT.parents[3])), 'mentionIds': [m['id'] for m in rows],
        'noteQuotes': [{'noteId': n, 'quote': q} for n, q in quotes],
        'imageTextEvidence': {'noteId': 2277, 'imageIndex': 4, 'quote': image_quote,
            'inputHash': next(m['inputHash'] for m in rows if m['id'] == 9962)},
        'unassignedReasons': {str(k): v for k, v in exclusions.items()},
        'conclusion': '原文以城隍庙指上海道教名观，同篇与豫园分别列出，图文另列城隍庙票价；上海城隍庙是地域全称。两个现行根归一，主根4779和旧坐标保持，不把共有坐标当唯一依据。24条中8条明确涉及商业街、小吃、主街机位或酒店参照保持null待审，不新建或写入商业/酒店/机位主体；其余现有直接城隍庙行程指名及两条原闭门警示保留，但不据此核实作者营业时间。豫园园林、九曲桥、老街及5208城隍庙豫园组合名独立不并，review28继续待审。位置和完整资料/图片语义未全面验收。'}]
    entities = {e['entity_id']: e for e in frozen['entities']}
    decision = {'key': 'top30-20261010-batch-90-shanghai-temple-merge', 'city': CITY, 'entityId': TARGET,
        'mergeEntityIds': sorted(OLD_IDS), 'canonicalName': '上海城隍庙', 'aliases': ['上海城隍庙', '城隍庙'],
        'expectedRevisions': {eid: entities[eid]['revision'] for eid in sorted(ALL_IDS)},
        'overrides': {}, 'evidence': evidence}
    assert set(decision['expectedRevisions'].values()) == {2}
    sources = {s['id']: s for s in frozen['sources']}
    assignments = [{'mentionId': m['id'], 'inputHash': m['inputHash'],
        'entityId': None if m['id'] in UNASSIGNED else TARGET} for m in rows]
    scope = {'key': 'top30-20261010-batch-90-shanghai-temple-scope', 'city': CITY, 'sourcePlaceId': 4779,
        'expectedSourceHash': source_fingerprint(sources[4779]), 'expectedScopeRevision': 0,
        'sources': [{'sourcePlaceId': sid, 'sourceHash': source_fingerprint(sources[sid])} for sid in [4661, 4779]],
        'expectedRevisions': {TARGET: 3}, 'assignments': assignments, 'evidence': evidence}
    own = [m for m in rows if m['id'] not in UNASSIGNED]
    expected = {'city': CITY, 'id': TARGET, 'name': '上海城隍庙', 'revision': 4, 'verified': True,
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
    assert after.catalog.entities[TARGET]['revision'] == 4 and after.catalog.entities[TARGET]['primary_place_id'] == 4779
    assert {k: v for k, v in before.catalog.entities.items() if k not in ALL_IDS} == {
        k: v for k, v in after.catalog.entities.items() if k not in ALL_IDS}
    assert all(after.scopes[k] == v for k, v in before.scopes.items())
    assert all(after.assignments[k] == v for k, v in before.assignments.items())
    assert set(after.scopes) == set(before.scopes) | {4779}
    assert set(after.assignments) == set(before.assignments) | {m['id'] for m in own} | UNASSIGNED
    assert await load_mention_rows(session, CITY) == original and await raw_state() == raw_before
    assert await baseline.extra_state(session, CITY) == extras_before
    future = dict(next(m for m in original if m['id'] == 9962))
    future['id'] = 99999999
    assert after.resolve(future)['status'] == 'review'
    changed = dict(next(m for m in original if m['id'] == 9962))
    changed['note_desc'] += '\n新增正文'
    assert after.resolve(changed)['status'] == 'review'
    for mid in [10141, 11233]:
        negative = next(m for m in original if m['id'] == mid)
        assert effective_mention(negative, after.resolve(negative)) == {**negative, 'fact_value': negative['fact_value'] or {}}
    full_after = merges.normalized_governance(await governance_state(session, CITY))
    assert all(full_before[k] == full_after[k] for k in full_before if k not in {'rawScopes', 'scopeSources', 'rawAssignments'})
    return {'changes': [change], 'scopeChanges': [scope_change], 'checks': {
        'idempotency': True, 'exactMentionAssignments': True, 'newAndChangedMentionsStayReview': True,
        'originalNotesMediaSourcesSummariesPreserved': True, 'originalProvenanceRelationsPreserved': True,
        'existingScopesAssignmentsPreserved': True, 'otherEntitiesPreserved': True, 'scoresRecomputed': True,
        'commercialAndHotelSourcesRemainReview': True, 'originalNegativeOpinionsPreserved': True}}


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
        after = places(await export('xhs-places-上海.json'))
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
        assert not any(bad in serialized for bad in ['免费街区吃南翔小笼', '成片红灯笼连成街巷', '素菜包、汤团', '小吃别抱太高期望'])
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

