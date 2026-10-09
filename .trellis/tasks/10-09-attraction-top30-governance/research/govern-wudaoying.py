"""核实两条五道营来源为同一胡同，归并稳定ID并按合并后的提及重算。"""
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
from app.clean.recommendation import recommendation_metrics

ROOT = Path(__file__).resolve().parent
BATCH_ROOT = ROOT.parents[1] / '10-06-place-identity-governance/research/all-cities'
TARGET = 'fde55b90529621c6f3ba9a237046a7ee'
OLD = 'bd35189ca9afcb8364b760d5c9279247'


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    frozen = json.loads((ROOT / 'snapshot-20261009T083356944724Z/input.json').read_bytes())['cities'][0]
    sources = [s for s in frozen['sources'] if s['id'] in [725, 2448]]
    assert len(sources) == 2 and next(s for s in sources if s['id'] == 725)['place_type'] == 'attraction'
    mentions = [m for m in frozen['mentions'] if {m['name'], m['normalized_name']} & {'五道营', '五道营胡同'}]
    assert len(mentions) == 13 and all(m['fact_value'] is None for m in mentions)
    quotes = {1888:'4️⃣五道营胡同',1937:'五道营文艺小店扎堆',1950:'地坛公园→雍和宫→五道营胡同',
        2102:'再到旁边的五道营胡同逛逛文创喝喝咖啡',2243:'小经厂胡同➡️方家胡同➡️国子监➡️五道营胡同',
        2304:'国子监街 ➡️五道营胡同',2452:'雍和宫➡️五道营胡同➡️国子监街',2558:'孔庙国子监➡️五道营胡同',
        2733:'地坛庙会➡️雍和宫➡️五道营胡同➡️国子监街',2911:'方家胡同-五道营胡同-地坛公园',
        4267:'五道营文艺小店扎堆',5055:'上午：地坛公园→雍和宫→五道营胡同，逛古寺漫步胡同。',5185:'5️⃣五道营'}
    for m in mentions:
        assert quotes[m['id']] in frozen['notes'][str(m['raw_note_id'])]['note_desc']
    evidence = [{'kind':'reviewed_same_hutong_sources','file':str(ROOT/'wudaoying-source-review.json'),
        'sourcePlaceIds':[725,2448], 'conclusion':'十三提及均指雍和宫/国子监周边五道营胡同；1052同篇使用短名和全名，1073的五道营段指整条街内多家店，school另有独立条目，不是把店铺并入胡同。2448旧market是同一胡同的类型误分，本批不处理街内商户或其它购物实体。'}]
    decision = {'key':'top30-20261009-batch-74-wudaoying','city':'北京','entityId':TARGET,
        'expectedRevisions':{TARGET:1,OLD:1},'mergeEntityIds':[OLD],'canonicalName':'五道营胡同',
        'aliases':['五道营胡同','五道营'],'overrides':{'recommendationPolicy':'resolved_attraction_mentions_v1'},'evidence':evidence}
    metrics = recommendation_metrics(mentions)
    assert metrics == {'mentionCount':13,'recommendScore':37.0}
    expectation = {'city':'北京','id':TARGET,'name':'五道营胡同','revision':2,'verified':True,
                   'recommendScore':37.0,'mentionCount':13}
    output = BATCH_ROOT / ('batch-74-applied.json' if args.apply else 'batch-74-preview.json')
    assert not output.exists()
    for filename,value in [('batch-74-decisions.json',[decision]),('batch-74-export-expectations.json',[expectation])]:
        file=BATCH_ROOT/filename
        if args.apply: assert json.loads(file.read_bytes()) == value
        else:
            with file.open('x',encoding='utf-8') as f:json.dump(value,f,ensure_ascii=False,indent=2)
    if not args.apply:
        review={'sourcePlaceIds':[725,2448],'entityId':TARGET,'mergedOldEntityId':OLD,'rawSourcesPreserved':True,
            'sourceTypeCorrection':'2448为同一胡同的短名来源，非新购物商户','notes':len({m['raw_note_id'] for m in mentions}),
            'rows':[{'mentionId':m['id'],'noteId':m['raw_note_id'],'inputHash':m['inputHash'],'quote':quotes[m['id']]} for m in mentions],
            'scope':'仅核查原文主体归属，不声称新核实营业或照片','profilePolicy':'保留原主源725网页介绍、坐标和既有媒体；不使用2448商户门口定位替换街道参考点'}
        with (ROOT/'wudaoying-source-review.json').open('x',encoding='utf-8') as f:json.dump(review,f,ensure_ascii=False,indent=2)
    else:
        preview=json.loads((BATCH_ROOT/'batch-74-preview.json').read_bytes())
        assert preview['checks']['reverseRollback'] and preview['checks']['idempotency']
    engine=create_async_engine(dotenv_values('D:/Project/xhs-travel-pipeline/.env')['DATABASE_URL'])
    report={'apply':args.apply,'cities':[{'city':'北京'}],'changes':[],'checks':{}}
    try:
        async with async_sessionmaker(engine)() as session:
            await session.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ'))
            before=await load_catalog(session,'北京')
            for eid in [TARGET,OLD]:assert before.entities[eid]==next(e for e in frozen['entities'] if e['entity_id']==eid)
            current=[m for m in await load_mention_rows(session,'北京') if {m['name'],m['normalized_name']}&{'五道营','五道营胡同'}]
            assert {m['id']:mention_fingerprint(m) for m in current}=={m['id']:m['inputHash'] for m in mentions}
            raw_before=(await session.execute(text('SELECT row_to_json(p) FROM canonical_place p WHERE id IN (725,2448) ORDER BY id'))).scalars().all()
            after=await apply_decision(session,decision)
            report['changes'].append(after)
            catalog=await load_mention_catalog(session,'北京')
            assert all(catalog.resolve(m)['entity']['entity_id']==TARGET for m in current)
            assert catalog.catalog.entities[OLD]['redirect_to']==TARGET
            assert {eid:e for eid,e in catalog.catalog.entities.items() if eid not in [TARGET,OLD]}=={eid:e for eid,e in before.entities.items() if eid not in [TARGET,OLD]}
            assert (await session.execute(text('SELECT row_to_json(p) FROM canonical_place p WHERE id IN (725,2448) ORDER BY id'))).scalars().all()==raw_before
            report['checks'].update({'onlyTwoSameHutongEntitiesChanged':True,'all13MentionsResolveSameEntity':True,'rawSourcesAndProfilesPreserved':True})
            if args.apply:
                assert after==preview['changes'][0]
                await session.commit()
            else:
                assert await apply_decision(session,decision)==after
                await rollback_decision(session,decision['key'])
                restored=await load_catalog(session,'北京')
                assert restored.entities==before.entities and restored.members==before.members
                report['checks'].update({'idempotency':True,'reverseRollback':True})
                await session.rollback()
        with output.open('x',encoding='utf-8') as f:json.dump(report,f,ensure_ascii=False,indent=2)
        print(json.dumps({'batch':74,'apply':args.apply,'score':37,'checks':report['checks']},ensure_ascii=False))
    finally:await engine.dispose()


if __name__=='__main__':asyncio.run(main())
