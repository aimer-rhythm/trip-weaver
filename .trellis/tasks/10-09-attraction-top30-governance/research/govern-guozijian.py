"""第77批：执行用户国子监/国子监街行程身份审核，默认回滚预演。"""
import argparse
import asyncio
import copy
import hashlib
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
from app.clean.place_export import consolidate_places
from app.clean.recommendation import recommendation_metrics

ROOT = Path(__file__).resolve().parent
BATCH_ROOT = ROOT.parents[1] / '10-06-place-identity-governance/research/all-cities'
SNAPSHOT = ROOT / 'snapshot-20261009T124103348992Z/input.json'
TARGET = '0854db5911778c6722637d896e9c2904'
OLD = '1405884c419eb09eb99f8489b7044278'
BATCH = 'batch-77-v2'


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    raw = SNAPSHOT.read_bytes()
    frozen = json.loads(raw)['cities'][0]
    entities = {e['entity_id']: e for e in frozen['entities']}
    selected = [m for m in frozen['mentions'] if m['entityId'] in [TARGET, OLD]]
    scores = recommendation_metrics(selected)
    decision = {
        'key': 'top30-20261009-batch-77-v2-user-guozijian-street', 'city': '北京',
        'entityId': TARGET, 'mergeEntityIds': [OLD], 'canonicalName': '国子监',
        'aliases': ['国子监', '国子监街'], 'expectedRevisions': {TARGET: 2, OLD: 1},
        'supersedeReviewKeys': ['all-cities-20261006-batch-04-review-64'],
        'overrides': {'recommendationPolicy': 'resolved_attraction_mentions_v1'},
        'evidence': [
            {'kind': 'explicit_user_identity_review', 'date': '2026-10-09',
             'quote': '国子监街和国子监应当作同一实体',
             'conclusion': '按用户指定行程粒度将两根统一为国子监，国子监街保留为检索名与旧ID。不是声称街道与建筑地理范围完全相同；孔庙、孔庙和国子监博物馆、沿街商户及组合提及保持原状态。'},
            {'kind': 'frozen_live_state', 'snapshotSha256': hashlib.sha256(raw).hexdigest(),
             'sourcePlaceIds': [663, 764], 'mentionIds': [m['id'] for m in selected],
             'conclusion': '保留原始提及、来源与审计；只合并当前已解析提及集合并重算，不相加旧分数。主源764坐标保持；街道原源663网页简介会按既有导出规则优先成为合并简介，原国子监社区看点保存在来源、提及与快照。营业和票价仍为旧资料，未作为本次事实验收。'}],
    }
    expectation = {'city': '北京', 'id': TARGET, 'name': '国子监', 'revision': 3,
                   'verified': True, 'recommendScore': scores['recommendScore'],
                   'mentionCount': scores['mentionCount']}
    out = BATCH_ROOT / (f'{BATCH}-applied.json' if args.apply else f'{BATCH}-preview.json')
    assert not out.exists(), '不覆盖历史工件'
    for filename, value in [(f'{BATCH}-decisions.json', [decision]),
                            (f'{BATCH}-export-expectations.json', [expectation])]:
        file = BATCH_ROOT / filename
        if args.apply:
            assert json.loads(file.read_bytes()) == value
        else:
            with file.open('x', encoding='utf-8') as handle:
                json.dump(value, handle, ensure_ascii=False, indent=2)
    if args.apply:
        preview = json.loads((BATCH_ROOT / f'{BATCH}-preview.json').read_bytes())
        assert all(preview['checks'].values())
    engine = create_async_engine(dotenv_values('D:/Project/xhs-travel-pipeline/.env')['DATABASE_URL'])
    report = {'apply': args.apply, 'cities': [{'city': '北京'}], 'changes': [], 'checks': {},
              'metrics': {**scores, 'noteCount': len({m['raw_note_id'] for m in selected})},
              'snapshotSha256': hashlib.sha256(raw).hexdigest()}
    try:
        async with async_sessionmaker(engine)() as session:
            await session.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ'))
            await session.execute(text("SET LOCAL statement_timeout='30s'"))
            before = await load_catalog(session, '北京')
            assert before.entities == entities
            mentions = await load_mention_rows(session, '北京')
            assert {m['id']: mention_fingerprint(m) for m in mentions} == {m['id']: m['inputHash'] for m in frozen['mentions']}
            raw_before = (await session.execute(text("SELECT row_to_json(p) FROM canonical_place p WHERE city='北京' ORDER BY id"))).scalars().all()
            changed = await apply_decision(session, decision)
            report['changes'].append(changed)
            catalog = await load_mention_catalog(session, '北京')
            assigned = [m for m in mentions if (catalog.resolve(m).get('entity') or {}).get('entity_id') == TARGET]
            assert {m['id'] for m in assigned} == {m['id'] for m in selected}
            assert recommendation_metrics(assigned) == scores
            assert catalog.catalog.entities[OLD]['redirect_to'] == TARGET
            assert catalog.catalog.entities[TARGET]['primary_place_id'] == 764
            assert {k: v for k, v in catalog.catalog.entities.items() if k not in [TARGET, OLD]} == {k: v for k, v in before.entities.items() if k not in [TARGET, OLD]}
            for row in mentions:
                if row['id'] not in {m['id'] for m in selected}:
                    previous = next(m for m in frozen['mentions'] if m['id'] == row['id'])
                    assert (catalog.resolve(row).get('entity') or {}).get('entity_id') == previous['entityId']
            assert (await session.execute(text("SELECT row_to_json(p) FROM canonical_place p WHERE city='北京' ORDER BY id"))).scalars().all() == raw_before
            old_export = json.loads((BATCH_ROOT / 'batch-76/sync-01/xhs-places-北京.json').read_bytes())
            members = [copy.deepcopy(p) for p in old_export['places'] if p['id'] in [TARGET, OLD]]
            for member in members:
                member['sourcePlaceId'] = 764 if member['id'] == TARGET else 663
            projected = consolidate_places(members, '北京', json.loads(raw)['capturedAt'], catalog.catalog,
                                           recommendation_mentions={TARGET: assigned})
            assert len(projected) == 1
            merged = projected[0]
            primary = next(p for p in members if p['id'] == TARGET)
            street = next(p for p in members if p['id'] == OLD)
            assert merged['payload']['content'] == street['payload']['content']
            assert all(merged[k] == primary[k] for k in ['lat', 'lng'])
            report['exportProjection'] = {'id': merged['id'], 'name': merged['name'],
                'contentSourceId': 663, 'coordinateSourceId': 764,
                'price': merged['payload'].get('price'), 'openHours': merged['payload'].get('openHours'),
                'limits': '旧价格及营业资料继承，不代表本次审核确认其事实准确或适用于整个街区。'}
            report['checks'].update(onlyTwoEntitiesChanged=True, allOriginalSourcesPreserved=True,
                exactUnionOfCurrentMentions=True, primaryCoordinatesPreserved=True,
                otherMentionResolutionsUnchanged=True, webProfilePreservedInProjection=True)
            if args.apply:
                assert changed == preview['changes'][0]
                assert report['exportProjection'] == preview['exportProjection']
                await session.commit()
            else:
                assert await apply_decision(session, decision) == changed
                await rollback_decision(session, decision['key'])
                restored = await load_catalog(session, '北京')
                assert restored.entities == before.entities and restored.members == before.members
                report['checks'].update(idempotency=True, reverseRollback=True)
                await session.rollback()
        with out.open('x', encoding='utf-8') as handle:
            json.dump(report, handle, ensure_ascii=False, indent=2)
        print(json.dumps({'batch': 77, 'apply': args.apply, 'metrics': report['metrics'], 'checks': report['checks']}, ensure_ascii=False))
    finally:
        await engine.dispose()


if __name__ == '__main__':
    asyncio.run(main())
