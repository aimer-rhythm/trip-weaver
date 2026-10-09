"""本轮首个明确景点别名：使用现有版本化审计 API，预演包含幂等与逆向回滚。"""
import argparse
import asyncio
import json
import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, 'D:/Project/xhs-travel-pipeline')
from dotenv import dotenv_values
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from app.aggregate.place_identity import apply_decision, rollback_decision, load_catalog
from app.aggregate.mention_identity import load_mention_catalog, load_mention_rows
from app.clean.mention_identity import mention_fingerprint

ROOT = Path(__file__).resolve().parent
BATCH_ROOT = ROOT.parents[1] / '10-06-place-identity-governance/research/all-cities'
SNAPSHOT = ROOT / 'snapshot-20261009T081112091980Z/input.json'
EID = 'c5250326550bc954a0a07f41679bf87f'


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    frozen = json.loads(SNAPSHOT.read_text(encoding='utf-8'))['cities'][0]
    target = next(e for e in frozen['entities'] if e['entity_id'] == EID)
    row = next(m for m in frozen['mentions'] if m['id'] == 2034)
    note = frozen['notes'][str(row['raw_note_id'])]
    assert '6. 恭王府博物馆' in note['note_desc'] and row['name'] == '恭王府博物馆'
    assert row['normalized_name'] == target['canonical_name'] and target['revision'] == 1
    decision = {'key': 'top30-20261009-batch-72-gongwangfu-alias', 'city': '北京', 'entityId': EID,
        'expectedRevisions': {EID: 1}, 'mergeEntityIds': [], 'canonicalName': '恭王府',
        'aliases': ['恭王府', '恭王府博物馆'], 'overrides': {},
        'evidence': [{'kind': 'reviewed_attraction_alias',
            'file': '.trellis/tasks/10-09-attraction-top30-governance/research/snapshot-20261009T081112091980Z/input.json',
            'noteId': 408, 'mentionId': 2034, 'inputHash': row['inputHash'], 'quote': '6. 恭王府博物馆',
            'conclusion': '原文明确博物馆全名，现行源1299为北京前海西街恭王府；补充同一景点的机构全名，不把府内建筑或花园单点并为别名。全城目录无另一同名实体。'}]}
    request_file = BATCH_ROOT / 'batch-72-decisions.json'
    result_file = BATCH_ROOT / ('batch-72-applied.json' if args.apply else 'batch-72-preview.json')
    assert not result_file.exists(), '不覆盖或重放已经保存的批次'
    if args.apply:
        preview = json.loads((BATCH_ROOT / 'batch-72-preview.json').read_text(encoding='utf-8'))
        assert preview['checks']['idempotency'] and preview['checks']['reverseRollback'] and not preview['apply']
        assert json.loads(request_file.read_text(encoding='utf-8')) == [decision]
    else:
        assert not request_file.exists()
        request_file.write_text(json.dumps([decision], ensure_ascii=False, indent=2), encoding='utf-8')
    engine = create_async_engine(dotenv_values('D:/Project/xhs-travel-pipeline/.env')['DATABASE_URL'])
    report = {'apply': args.apply, 'cities': [{'city': '北京'}], 'changes': [], 'checks': {}}
    try:
        async with async_sessionmaker(engine)() as session:
            await session.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ'))
            await session.execute(text("SET LOCAL statement_timeout='30s'"))
            before = await load_catalog(session, '北京')
            assert before.entities[EID] == target
            assert not before.resolve('恭王府博物馆')
            mentions = await load_mention_rows(session, '北京')
            current = next(m for m in mentions if m['id'] == 2034)
            assert mention_fingerprint(current) == row['inputHash']
            raw_before = (await session.execute(text('SELECT md5(string_agg(row_to_json(p)::text,\'\' ORDER BY id)) FROM canonical_place p WHERE city=:city'), {'city': '北京'})).scalar_one()
            after = await apply_decision(session, decision)
            report['changes'].append(after)
            catalog = await load_mention_catalog(session, '北京')
            assert catalog.resolve(current)['entity']['entity_id'] == EID
            assert catalog.catalog.entities[EID]['revision'] == 2
            assert {eid: e for eid, e in catalog.catalog.entities.items() if eid != EID} == {eid: e for eid, e in before.entities.items() if eid != EID}
            raw_after = (await session.execute(text('SELECT md5(string_agg(row_to_json(p)::text,\'\' ORDER BY id)) FROM canonical_place p WHERE city=:city'), {'city': '北京'})).scalar_one()
            assert raw_before == raw_after
            report['checks'].update({'onlyTargetEntityChanged': True, 'allRawSourcesPreserved': True, 'newAliasResolvesExistingMention': True})
            if args.apply:
                assert after == preview['changes'][0]
                await session.commit()
            else:
                assert await apply_decision(session, decision) == after
                report['checks']['idempotency'] = True
                await rollback_decision(session, decision['key'])
                rolled = await load_catalog(session, '北京')
                assert rolled.entities == before.entities and rolled.members == before.members
                report['checks']['reverseRollback'] = True
                await session.rollback()
        with result_file.open('x', encoding='utf-8') as out:
            json.dump(report, out, ensure_ascii=False, indent=2)
        print(json.dumps({'batch': 72, 'apply': args.apply, 'checks': report['checks']}, ensure_ascii=False))
    finally:
        await engine.dispose()


if __name__ == '__main__':
    asyncio.run(main())
