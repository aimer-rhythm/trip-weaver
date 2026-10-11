"""明确景点同义归一：完整同城冻结、一次性库导出/幂等/回滚后才允许正式应用。

有scope城市须提供完整治理表及正式基线导出，且仅允许合并不受既有scope管理的目标。
"""
import argparse
import asyncio
import copy
import hashlib
import json
import re
import sys
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path

sys.dont_write_bytecode = True
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, 'D:/Project/xhs-travel-pipeline')
from dotenv import dotenv_values
from sqlalchemy import DateTime, JSON, insert, text, update, null
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from app.models import (Base, CanonicalPlace, PlaceEntity, PlaceEntityMember, PlaceEntityReview, PlaceMention,
    PlaceSummary, RawNote, PlaceIdentityScope, PlaceIdentityScopeSource, PlaceMentionAssignment,
    PlaceImageAssignment, NoteImage, CrawlTask, ExtractLog)
from app.aggregate.place_identity import apply_decision, rollback_decision
from app.aggregate.mention_identity import load_mention_catalog, load_mention_rows
from app.clean.mention_identity import MENTION_FIELDS, mention_fingerprint
from app.clean.recommendation import recommendation_metrics
from app.clean.identity import name_key
from scripts import export_to_tripweaver as exporter
from freeze import governance_state

ROOT = Path(__file__).resolve().parent
PARENT = ROOT.parents[1] / '10-06-place-identity-governance/research/all-cities'


def write_new(path, value):
    with path.open('x', encoding='utf-8') as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)


def stable(place):
    value = copy.deepcopy(place)
    value.get('payload', {}).get('content', {}).pop('compiledAt', None)
    return value


def normalized_governance(value):
    value = copy.deepcopy(value)
    # 新可空保全列的SQL NULL只代表旧scope未启用；真实保全内容仍逐字段比较。
    for row in value['rawScopes']:
        if row.get('operational_facts') is None:
            row.pop('operational_facts', None)
    for key, model in [('crawlTasks', CrawlTask), ('extractLogs', ExtractLog), ('rawNotes', RawNote),
                       ('rawScopes', PlaceIdentityScope), ('noteImages', NoteImage)]:
        date_fields = {c.name for c in model.__table__.c if isinstance(c.type, DateTime)}
        for row in value[key]:
            for field in date_fields:
                if row.get(field):
                    row[field] = datetime.fromisoformat(row[field]).astimezone(timezone.utc).isoformat()
    return value


def prepare(plan, path):
    raw = (ROOT / plan['snapshot']).read_bytes()
    assert hashlib.sha256(raw).hexdigest() == plan['snapshotSha256']
    frozen = next(c for c in json.loads(raw)['cities'] if c['city'] == plan['city'])
    if frozen['scopes'] or frozen['assignments']:
        assert frozen.get('governanceState') and plan.get('baselineExport'), '有scope城市必须完整重建并与正式导出逐地点核对'
    roots = {e['canonical_name']: e for e in frozen['entities'] if not e['redirect_to']}
    decisions, expectations = [], []
    touched = set()
    for group in plan['merges']:
        members = [roots[n] for n in [group['primaryName'], *group['mergeNames']]]
        ids = [e['entity_id'] for e in members]
        assert not touched.intersection(ids)
        touched.update(ids)
        assert not any(set(ids).intersection([*s['entity_ids'], *(s.get('withdrawal_entity_ids') or [])]) for s in frozen['scopes']), '目标涉及既有scope，须专用范围合并决策'
        own = [m for m in frozen['mentions'] if m['entityId'] in ids]
        admitted = group.get('admitMentions', [])
        assert len({a['mentionId'] for a in admitted}) == len(admitted), '重复追加提及'
        by_mid = {m['id']: m for m in frozen['mentions']}
        for admission in admitted:
            mention = by_mid[admission['mentionId']]
            assert mention['entityId'] is None and mention['resolution']['status'] == 'unresolved', '只能纳入未注册别名，不得抢占现有归属或scope'
            assert not mention['resolution'].get('scopePlaceIds') and admission['inputHash'] == mention['inputHash']
            assert name_key(mention['name']) in {name_key(n) for n in group['aliases']}, '实际提及名须为已审核精确别名'
            assert admission['noteId'] == mention['raw_note_id']
            assert admission['quote'] in frozen['notes'][str(admission['noteId'])]['note_desc']
            assert mention['name'] in admission['quote'], '追加别名须有完整原名原文引述'
            own.append(mention)
        assert set(group['evidenceMentions']).issubset({m['id'] for m in own})
        for quote in group['noteQuotes']:
            assert quote['quote'] in frozen['notes'][str(quote['noteId'])]['note_desc']
        evidence = {'kind': 'reviewed_attraction_alias', 'file': str(path),
            'snapshotSha256': plan['snapshotSha256'], 'mentionIds': [m['id'] for m in own],
            'sourcePlaceIds': [e['primary_place_id'] for e in members],
            'evidenceMentions': group['evidenceMentions'], 'noteQuotes': group['noteQuotes'],
            'conclusion': group['conclusion'], **({'admitMentions': admitted} if admitted else {})}
        decisions.append({'key': f"top30-20261009-{plan['batch']}-merge-{ids[0]}",
            'city': plan['city'], 'entityId': ids[0], 'mergeEntityIds': ids[1:],
            'canonicalName': group['primaryName'], 'aliases': group['aliases'],
            'expectedRevisions': {e['entity_id']: e['revision'] for e in members},
            'overrides': {'recommendationPolicy': 'resolved_attraction_mentions_v1'}, 'evidence': [evidence]})
        expectations.append({'city': plan['city'], 'id': ids[0], 'name': group['primaryName'],
            'revision': members[0]['revision'] + 1, 'verified': True, **recommendation_metrics(own)})
    return frozen, decisions, expectations


async def seed(session, frozen):
    def values(model, row):
        return {k: datetime.fromisoformat(v) if isinstance(model.__table__.c[k].type, DateTime) and v else
                null() if isinstance(model.__table__.c[k].type, JSON) and v is None else v
                for k, v in row.items() if k in model.__table__.c}
    full = frozen.get('governanceState')
    if full:
        # 只在一次性库延后循环外键校验，避免临时UPDATE改变旧无序图片分析扫描的消费顺序。
        await session.execute(text('ALTER TABLE raw_note ALTER CONSTRAINT raw_note_extract_log_id_fkey DEFERRABLE INITIALLY DEFERRED'))
        for row in full['crawlTasks']:
            await session.execute(insert(CrawlTask).values(**values(CrawlTask, row)))
        notes = {row['id']: row for row in full['rawNotes']}
        order = [row['id'] for row in full['imageNoteOrder']]
        order += [nid for nid in notes if nid not in set(order)]
        for nid in order:
            await session.execute(insert(RawNote).values(**values(RawNote, notes[nid])))
        for row in full['extractLogs']:
            await session.execute(insert(ExtractLog).values(**values(ExtractLog, row)))
    else:
        assert not frozen['scopes'] and not frozen['assignments']
        for nid, note in frozen['notes'].items():
            session.add(RawNote(id=int(nid), note_id=f'frozen-{nid}', city=frozen['city'], keyword='冻结预演',
                title=note['note_title'], desc=note['note_desc'], img_analysis=note['note_images'],
                status='PRIVATE' if note['note_unavailable'] else 'EXTRACTED', source_url=note['source_url'],
                created_at=datetime.fromisoformat(note['observed_at']) if note['observed_at'] else None))
    await session.flush()
    for model, key in [(CanonicalPlace, 'sources'), (PlaceSummary, 'summaries')]:
        for row in frozen[key]:
            await session.execute(insert(model).values(**values(model, row)))
    for e in frozen['entities']:
        await session.execute(insert(PlaceEntity).values(**{**e, 'redirect_to': None}))
    for e in frozen['entities']:
        if e['redirect_to']:
            await session.execute(update(PlaceEntity).where(PlaceEntity.entity_id == e['entity_id']).values(redirect_to=e['redirect_to']))
    for pid, eid in frozen['members'].items():
        await session.execute(insert(PlaceEntityMember).values(place_id=int(pid), entity_id=eid))
    for m in frozen['mentions']:
        await session.execute(insert(PlaceMention).values(**{k: m[k] for k in MENTION_FIELDS}))
    for r in frozen['reviews']:
        await session.execute(insert(PlaceEntityReview).values(**values(PlaceEntityReview, r)))
    if full:
        for model, key in [(PlaceIdentityScope, 'rawScopes'), (PlaceIdentityScopeSource, 'scopeSources'),
                           (PlaceMentionAssignment, 'rawAssignments'), (NoteImage, 'noteImages'),
                           (PlaceImageAssignment, 'imageAssignments')]:
            for row in full[key]:
                await session.execute(insert(model).values(**values(model, row)))
        # 普通INSERT可回填较早页的空闲槽，写入顺序不保证物理扫描顺序。
        # 一次性库按已冻结顺序重排堆表，再移除临时列；业务库从不执行此步骤。
        await session.execute(text('SET CONSTRAINTS ALL IMMEDIATE'))
        await session.execute(text('ALTER TABLE raw_note ADD COLUMN _top30_order bigint'))
        await session.execute(text('UPDATE raw_note SET _top30_order=input.n FROM unnest(CAST(:ids AS bigint[])) WITH ORDINALITY AS input(id,n) WHERE raw_note.id=input.id'), {'ids': order})
        await session.execute(text('CREATE INDEX top30_frozen_note_order ON raw_note (_top30_order)'))
        await session.execute(text('CLUSTER raw_note USING top30_frozen_note_order'))
        await session.execute(text('ALTER TABLE raw_note DROP COLUMN _top30_order'))
    await session.commit()


async def apply_checked(session, frozen, decisions, expectations):
    city = frozen['city']
    before = await load_mention_catalog(session, city)
    assert before.catalog.entities == {e['entity_id']: e for e in frozen['entities']}
    for actual, rows, key in [(before.scopes, frozen['scopes'], 'place_id'),
                              (before.assignments, frozen['assignments'], 'mention_id')]:
        expected_rows = {row[key]: row for row in rows}
        assert len(expected_rows) == len(rows) and actual == expected_rows
    full = frozen.get('governanceState')
    if full:
        full = normalized_governance(full)
        current_full = normalized_governance(await governance_state(session, city))
        if current_full != full:
            print(json.dumps({'governanceMismatch': {key: {
                'expectedRows': len(full[key]), 'actualRows': len(current_full[key]),
                'differentFields': sorted({field for a, b in zip(full[key], current_full[key]) for field in a.keys() | b.keys() if a.get(field) != b.get(field)})}
                for key in full if current_full[key] != full[key]}}, ensure_ascii=False))
            raise AssertionError('完整治理表重建不一致')
    original = await load_mention_rows(session, city)
    assert {m['id']: mention_fingerprint(m) for m in original} == {m['id']: m['inputHash'] for m in frozen['mentions']}
    async def raw_state():
        return [(await session.execute(text(query), {'city': city})).scalars().all() for query in [
            'SELECT row_to_json(p) FROM canonical_place p WHERE city=:city ORDER BY id',
            'SELECT row_to_json(s) FROM place_summary s JOIN canonical_place p ON p.id=s.canonical_place_id WHERE p.city=:city ORDER BY p.id']]
    raw_before = await raw_state()
    changes = []
    remap = {}
    changed = set()
    for d in decisions:
        result = await apply_decision(session, d)
        assert await apply_decision(session, d) == result
        changes.append(result)
        changed.update(d['expectedRevisions'])
        remap.update({old: d['entityId'] for old in d['mergeEntityIds']})
    current = await load_mention_catalog(session, city)
    assert current.scopes == before.scopes and current.assignments == before.assignments
    assert current.managed_entity_ids() == before.managed_entity_ids()
    expected_owners = {m['id']: remap.get(m['entityId'], m['entityId']) for m in frozen['mentions']}
    for d in decisions:
        for admission in d['evidence'][0].get('admitMentions', []):
            expected_owners[admission['mentionId']] = d['entityId']
    assert all((current.resolve(m).get('entity') or {}).get('entity_id') == expected_owners[m['id']] for m in original)
    for d, expected in zip(decisions, expectations):
        root = current.catalog.entities[d['entityId']]
        assert root['primary_place_id'] == before.catalog.entities[d['entityId']]['primary_place_id']
        assert root['revision'] == expected['revision']
        for name in [d['canonicalName'], *d['aliases'], *(before.catalog.entities[e]['canonical_name'] for e in d['mergeEntityIds'])]:
            assert current.catalog.resolve(name)['entity_id'] == d['entityId']
        own = [m for m in original if expected_owners[m['id']] == d['entityId']]
        assert recommendation_metrics(own) == {k: expected[k] for k in ['recommendScore', 'mentionCount']}
    assert {k: v for k, v in current.catalog.entities.items() if k not in changed} == {k: v for k, v in before.catalog.entities.items() if k not in changed}
    assert await raw_state() == raw_before
    assert await load_mention_rows(session, city) == original
    if full:
        assert normalized_governance(await governance_state(session, city)) == full
    return {'changes': changes, 'checks': {'idempotency': True, 'exactMentionUnion': True,
        'rawSourcesSummariesMentionsPreserved': True, 'otherEntitiesPreserved': True,
        'primarySourcesPreserved': True, 'aliasesResolve': True, 'scoresRecomputed': True,
        'existingScopesAssignmentsPreserved': True}}


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('plan', type=Path)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--attempt', default='preview-01')
    args = parser.parse_args()
    plan_bytes = args.plan.read_bytes()
    plan = json.loads(plan_bytes)
    assert re.fullmatch(r'batch-\d{2}(?:-v\d+)?', plan['batch'])
    assert re.fullmatch(r'preview-\d{2}', args.attempt)
    frozen, decisions, expectations = prepare(plan, args.plan)
    folder = PARENT / plan['batch'] / args.attempt
    fingerprint = hashlib.sha256(plan_bytes).hexdigest()
    for suffix, value in [('decisions', decisions), ('export-expectations', expectations)]:
        path = PARENT / f"{plan['batch']}-{suffix}.json"
        if path.exists():
            assert json.loads(path.read_bytes()) == value
        else:
            assert not args.apply
            write_new(path, value)
    if args.apply:
        preview = json.loads((folder / 'report.json').read_bytes())
        assert preview['passed'] and preview['planSha256'] == fingerprint and preview['temporaryDatabaseRemoved']
        out = PARENT / f"{plan['batch']}-applied.json"
        assert not out.exists()
        engine = create_async_engine(dotenv_values('D:/Project/xhs-travel-pipeline/.env')['DATABASE_URL'])
        try:
            async with async_sessionmaker(engine, expire_on_commit=False, autoflush=False)() as session:
                await session.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ'))
                await session.execute(text("SET LOCAL statement_timeout='30s'"))
                report = await apply_checked(session, frozen, decisions, expectations)
                assert report['changes'] == preview['changes']
                await session.commit()
            write_new(out, {**report, 'apply': True, 'planSha256': fingerprint, 'cities': [{'city': plan['city']}]})
        finally:
            await engine.dispose()
        print(json.dumps({'apply': True, 'batch': plan['batch'], 'checks': report['checks']}, ensure_ascii=False))
        return
    folder.mkdir(parents=True, exist_ok=False)
    database = f'place_identity_test_{time.time_ns()}'
    admin = create_async_engine('postgresql+asyncpg://postgres@127.0.0.1:18798/postgres', isolation_level='AUTOCOMMIT')
    engine = create_async_engine(f'postgresql+asyncpg://postgres@127.0.0.1:18798/{database}',
        connect_args={'server_settings': {'synchronize_seqscans': 'off', 'enable_indexscan': 'off', 'enable_bitmapscan': 'off'}})
    report = {'isolated': True, 'apply': False, 'planSha256': fingerprint, 'snapshotSha256': plan['snapshotSha256']}
    try:
        async with admin.connect() as connection:
            await connection.execute(text(f'CREATE DATABASE "{database}"'))
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        factory = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)
        async with factory() as session:
            await seed(session, frozen)
        if frozen.get('governanceState'):
            async with factory() as session:
                current_full = normalized_governance(await governance_state(session, plan['city']))
                expected_full = normalized_governance(frozen['governanceState'])
                if current_full != expected_full:
                    report['reconstructionMismatch'] = {key: {'expectedRows': len(expected_full[key]),
                        'actualRows': len(current_full[key]), 'differentFields': sorted({field
                        for a, b in zip(expected_full[key], current_full[key]) for field in a.keys() | b.keys()
                        if a.get(field) != b.get(field)})} for key in expected_full if current_full[key] != expected_full[key]}
                    print(json.dumps(report['reconstructionMismatch'], ensure_ascii=False))
                    if current_full['imageNoteOrder'] != expected_full['imageNoteOrder']:
                        print(json.dumps({'imageOrderPositions': [[i, a['id'], b['id']] for i, (a, b)
                            in enumerate(zip(expected_full['imageNoteOrder'], current_full['imageNoteOrder'])) if a != b][:12]}))
                    raise AssertionError('完整治理表重建不一致')
        exporter.SessionFactory = factory
        async def export(name):
            path = folder / name
            sys.argv = ['export', '--city', plan['city'], '--out', str(path)]
            await exporter.main()
            return json.loads(path.read_bytes())
        before = await export('before.json')
        if plan.get('baselineExport'):
            baseline_bytes = (PARENT / plan['baselineExport']).read_bytes()
            assert hashlib.sha256(baseline_bytes).hexdigest() == plan['baselineExportSha256']
            baseline = json.loads(baseline_bytes)
            assert {p['id']: stable(p) for p in baseline['places']} == {p['id']: stable(p) for p in before['places']}, '完整重建与当前正式导出不同'
            report['baselineExportMatched'] = True
        async with factory() as session:
            report.update(await apply_checked(session, frozen, decisions, expectations))
            await session.commit()
        after = await export(f"xhs-places-{plan['city']}.json")
        changed = {eid for d in decisions for eid in d['expectedRevisions']}
        assert {p['id']: stable(p) for p in before['places'] if p['id'] not in changed} == {p['id']: stable(p) for p in after['places'] if p['id'] not in changed}
        by_id = {p['id']: p for p in after['places']}
        for d, expected in zip(decisions, expectations):
            p = by_id[d['entityId']]
            old = next(p for p in before['places'] if p['id'] == d['entityId'])
            assert all(p[k] == old[k] for k in ['lat', 'lng'])
            assert p['payload']['address'] == old['payload']['address']
            assert not {'imageIdentity', 'mentionSources'}.intersection(p['payload'])
            assert p['payload']['identity']['revision'] == expected['revision']
            assert all(p['payload'][k] == expected[k] for k in ['recommendScore', 'mentionCount'])
            assert all(eid not in by_id and eid in p['payload']['identity']['memberIds'] for eid in d['mergeEntityIds'])
        report['checks'].update(otherExportsPreserved=True, primaryPositionsPreserved=True, legacyIdsPreserved=True, noMediaScopeAdded=True)
        async with factory() as session:
            for d in reversed(decisions):
                await rollback_decision(session, d['key'])
            restored = await load_mention_catalog(session, plan['city'])
            assert restored.catalog.entities == {e['entity_id']: e for e in frozen['entities']}
            assert restored.catalog.members == {int(k): v for k, v in frozen['members'].items()}
            assert list(restored.scopes.values()) == frozen['scopes']
            assert list(restored.assignments.values()) == frozen['assignments']
            await session.commit()
        restored = await export('restored.json')
        assert {p['id']: stable(p) for p in before['places']} == {p['id']: stable(p) for p in restored['places']}
        report['reverseRollback'] = True
        report['checks']['reverseRollback'] = True
        report['passed'] = all(report['checks'].values())
        report['placesBefore'] = len(before['places'])
        report['placesAfter'] = len(after['places'])
    except BaseException as error:
        # 只记录类型，避免SQL异常携带原文/带令牌链接。
        report.update(passed=False, errorType=type(error).__name__)
        raise
    finally:
        await engine.dispose()
        async with admin.connect() as connection:
            await connection.execute(text(f'DROP DATABASE IF EXISTS "{database}" WITH (FORCE)'))
        await admin.dispose()
        report['temporaryDatabaseRemoved'] = True
        write_new(folder / 'report.json', report)
    print(json.dumps({k: report[k] for k in ['passed', 'checks', 'placesBefore', 'placesAfter', 'temporaryDatabaseRemoved']}, ensure_ascii=False))


if __name__ == '__main__':
    try:
        asyncio.run(main())
    except Exception as error:
        # SQL异常可能带完整原始行；只输出类型和代码位置，不输出异常文本/参数/笔记链接。
        print(json.dumps({'failed': True, 'errorType': type(error).__name__,
            'frames': [{'file': Path(f.filename).name, 'line': f.lineno, 'function': f.name}
                       for f in traceback.extract_tb(error.__traceback__) if str(ROOT) in f.filename]}, ensure_ascii=False))
        sys.exit(1)
