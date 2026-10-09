"""执行用户明确审核：天安门与天安门广场按行程地点合并；默认事务预演。"""
import argparse
import asyncio
import hashlib
import json
import sys
from pathlib import Path
sys.dont_write_bytecode=True
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0,'D:/Project/xhs-travel-pipeline')
from dotenv import dotenv_values
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine,async_sessionmaker
from app.aggregate.place_identity import apply_decision,rollback_decision,load_catalog
from app.aggregate.mention_identity import load_mention_catalog,load_mention_rows
from app.clean.mention_identity import mention_fingerprint
from app.clean.recommendation import recommendation_metrics
ROOT=Path(__file__).resolve().parent
BATCH=ROOT.parents[1]/'10-06-place-identity-governance/research/all-cities'
TARGET='21152db5b05aff609cffa2bee47f16b4'
OLD='298e600416cbc4f85119932e8a3c966c'

async def main():
    parser=argparse.ArgumentParser();parser.add_argument('--apply',action='store_true');args=parser.parse_args()
    frozen_path=ROOT/'snapshot-20261009T111626632432Z/input.json'
    frozen=json.loads(frozen_path.read_bytes())['cities'][0]
    frozen_entities={e['entity_id']:e for e in frozen['entities']}
    selected=[m for m in frozen['mentions'] if m['entityId'] in [TARGET,OLD]]
    scores=recommendation_metrics(selected)
    decision={'key':'top30-20261009-batch-75-user-tiananmen-square','city':'北京','entityId':TARGET,
        'mergeEntityIds':[OLD],'canonicalName':'天安门广场','aliases':['天安门','天安门广场'],
        'expectedRevisions':{TARGET:2,OLD:2},'overrides':{'recommendationPolicy':'resolved_attraction_mentions_v1'},
        'evidence':[{'kind':'explicit_user_identity_review','date':'2026-10-09','quote':'天安门与天安门广场合并为一个地点',
            'conclusion':'依用户明确审核按行程地点合并两条现行根，主名天安门广场，天安门为检索别名；不是地理上宣称城楼建筑等于广场。仅合并指定两根，城楼、升降旗、金水桥、安检口、地下通道与地铁口不并入。'},
            {'kind':'frozen_live_state','snapshotSha256':hashlib.sha256(frozen_path.read_bytes()).hexdigest(),
             'sourcePlaceIds':[690,1163],'mentionIds':[m['id'] for m in selected],
             'conclusion':'原始来源、提及与历史引用保留，重算唯一提及与笔记分数，不相加两个旧分数；原主源1163的坐标及网页介绍继续优先。'}]}
    expectation={'city':'北京','id':TARGET,'name':'天安门广场','revision':3,'verified':True,
        'aliases':['天安门'],'recommendScore':scores['recommendScore'],'mentionCount':scores['mentionCount']}
    out=BATCH/('batch-75-applied.json' if args.apply else 'batch-75-preview.json')
    assert not out.exists()
    for filename,value in [('batch-75-decisions.json',[decision]),('batch-75-export-expectations.json',[expectation])]:
        file=BATCH/filename
        if args.apply:assert json.loads(file.read_bytes())==value
        else:
            with file.open('x',encoding='utf-8') as f:json.dump(value,f,ensure_ascii=False,indent=2)
    if args.apply:
        preview=json.loads((BATCH/'batch-75-preview.json').read_bytes())
        assert preview['checks']['idempotency'] and preview['checks']['reverseRollback']
    engine=create_async_engine(dotenv_values('D:/Project/xhs-travel-pipeline/.env')['DATABASE_URL'])
    report={'apply':args.apply,'cities':[{'city':'北京'}],'changes':[],'checks':{},'metrics':scores}
    try:
        async with async_sessionmaker(engine)() as session:
            await session.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ'))
            before=await load_catalog(session,'北京')
            for eid in [TARGET,OLD]:assert before.entities[eid]==frozen_entities[eid]
            mentions=await load_mention_rows(session,'北京')
            assert {m['id']:mention_fingerprint(m) for m in mentions}=={m['id']:m['inputHash'] for m in frozen['mentions']}
            raw_before=(await session.execute(text('SELECT row_to_json(p) FROM canonical_place p WHERE city=\'北京\' ORDER BY id'))).scalars().all()
            changed=await apply_decision(session,decision);report['changes'].append(changed)
            catalog=await load_mention_catalog(session,'北京')
            assigned=[m for m in mentions if (catalog.resolve(m).get('entity') or {}).get('entity_id')==TARGET]
            assert {m['id'] for m in assigned}=={m['id'] for m in selected}
            assert recommendation_metrics(assigned)==scores
            assert catalog.catalog.entities[OLD]['redirect_to']==TARGET
            assert catalog.catalog.entities[TARGET]['primary_place_id']==1163
            assert {k:v for k,v in catalog.catalog.entities.items() if k not in [TARGET,OLD]}=={k:v for k,v in before.entities.items() if k not in [TARGET,OLD]}
            assert (await session.execute(text('SELECT row_to_json(p) FROM canonical_place p WHERE city=\'北京\' ORDER BY id'))).scalars().all()==raw_before
            report['checks'].update(onlyTwoEntitiesChanged=True,allOriginalSourcesPreserved=True,
                exactUnionOfCurrentMentions=True,primarySourcePreserved=True,otherTiananmenEntitiesIndependent=True)
            if args.apply:
                assert changed==preview['changes'][0];await session.commit()
            else:
                assert await apply_decision(session,decision)==changed
                await rollback_decision(session,decision['key'])
                restored=await load_catalog(session,'北京')
                assert restored.entities==before.entities and restored.members==before.members
                report['checks'].update(idempotency=True,reverseRollback=True)
                await session.rollback()
        with out.open('x',encoding='utf-8') as f:json.dump(report,f,ensure_ascii=False,indent=2)
        print(json.dumps({'batch':75,'apply':args.apply,'metrics':scores,'checks':report['checks']},ensure_ascii=False))
    finally:await engine.dispose()

if __name__=='__main__':asyncio.run(main())
