"""植物园裸名同体合并，保留旧运营资料；花展来源范围另行治理。"""
import argparse
import asyncio
import hashlib
import importlib.util
import json
import sys
import time
import traceback
from pathlib import Path

ROOT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('baseline',ROOT/'freeze-scope-baseline.py')
baseline=importlib.util.module_from_spec(spec)
spec.loader.exec_module(baseline)
merges=baseline.merges
from sqlalchemy import text,insert
from sqlalchemy.ext.asyncio import create_async_engine,async_sessionmaker
from dotenv import dotenv_values
from app.models import Base,CanonicalPlaceSource,PlaceRelation
from app.aggregate.place_identity import rollback_decision
from app.aggregate.mention_identity import load_mention_catalog

BATCH,CITY='batch-113','厦门'
TARGET,OLD='410da5dd0d2e2802ead6a313bf030a19','6e83b872db3d9c874ce72af52afef625'
SNAPSHOT=ROOT/'snapshot-20261009T231058589044Z/input.json'
BASELINE=ROOT/'xiamen-botanical-merge-01-baseline.json'
EXTRAS=ROOT/'xiamen-botanical-merge-01-extras.json'


def inputs():
    raw=SNAPSHOT.read_bytes()
    frozen=next(c for c in json.loads(raw)['cities'] if c['city']==CITY)
    entities={e['entity_id']:e for e in frozen['entities']}
    assert entities[TARGET]['revision']==3 and entities[OLD]['revision']==1
    assert entities[TARGET]['primary_place_id']==2699
    rows=[m for m in frozen['mentions'] if m['entityId'] in {TARGET,OLD}]
    assert len(rows)==32 and len({m['raw_note_id'] for m in rows})==31
    record=json.loads((ROOT/'seven-cities-semantic-readthrough-13.json').read_bytes())
    reviewed=next(r for r in record['reviews'] if r['entityId']==TARGET)
    assert record['snapshotSha256']==hashlib.sha256(raw).hexdigest()
    for n in [*reviewed['noteEvidence'],*reviewed['additionalBoundaryMentions']]:
        assert hashlib.sha256(frozen['notes'][str(n['noteId'])]['note_desc'].encode()).hexdigest()==n['noteDescSha256']
    plan={'batch':BATCH,'city':CITY,'snapshot':str(SNAPSHOT.relative_to(ROOT)),
        'snapshotSha256':hashlib.sha256(raw).hexdigest(),'baselineExport':str(BASELINE),
        'merges':[{'primaryName':'厦门园林植物园','mergeNames':['植物园'],
            'aliases':sorted(set(entities[TARGET]['aliases'])|{'植物园'}),'evidenceMentions':[5451,5725,5998],
            'noteQuotes':[{'noteId':1355,'quote':'第3️⃣天 南普陀寺-植物园\n寺庙的话注意穿着就好 植物园要注意防蚊虫'},
                {'noteId':1279,'quote':'✔️一定去：鼓浪屿、厦大、环岛路/黄厝、南普陀、植物园、集美、钟鼓索道（7个）'},
                {'noteId':1289,'quote':'3️⃣植物园：雨林世界定时喷雾，雾气缭绕如同绿野仙境，很容易拍出丁达尔光影'}],
            'conclusion':'植物园三篇裸名分别在厦门南普陀游览、厦门核心景点清单与雨林喷雾/钟鼓索道同游语境，指向现有厦门园林植物园；全城无另一个同名园区来源，仅万石山（植物园）登山主体另列。并入现有主根2699，保留裸名旧ID为重定向和检索名，沿用主源位置与既有四个全称别名，不借旧裸名的市级坐标定位。仅做同体合并，32提及/31笔记按并集重算；所有当前提及及原观点保持，6248花展仍未隔离，不能称全部来源已清。万石山、各园区/入口及钟鼓索道不合并；媒体、开放时间、票价、原提示与内容消费须单独严格比较。'}]}
    actual,decisions,expected=merges.prepare(plan,Path(__file__).relative_to(ROOT.parents[3]))
    assert actual==frozen and expected[0]['mentionCount']==32
    return frozen,decisions,expected


def normalize_extras(value):
    value=merges.copy.deepcopy(value)
    for row in value['relations']:
        row['created_at']=merges.datetime.fromisoformat(row['created_at']).astimezone(merges.timezone.utc).isoformat()
    return value


async def apply_checked(session,frozen,decisions,expected):
    extra=json.loads(EXTRAS.read_bytes())
    assert extra.pop('snapshotSha256')==hashlib.sha256(SNAPSHOT.read_bytes()).hexdigest()
    assert extra.pop('city')==CITY
    before=await baseline.extra_state(session,CITY)
    assert normalize_extras(before)==normalize_extras(extra)
    report=await merges.apply_checked(session,frozen,decisions,expected)
    assert await baseline.extra_state(session,CITY)==before
    now=await load_mention_catalog(session,CITY)
    assert now.catalog.entities[TARGET]['overrides']==next(e['overrides'] for e in frozen['entities'] if e['entity_id']==TARGET)
    report['checks']['provenanceAndOriginalRelationsPreserved']=True
    report['checks']['oldPositionCategoryAndScorePolicyPreserved']=True
    return report


async def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--apply',action='store_true')
    parser.add_argument('--attempt',default='preview-01')
    args=parser.parse_args()
    assert merges.re.fullmatch(r'preview-\d{2}',args.attempt)
    frozen,decisions,expected=inputs()
    fingerprint=hashlib.sha256(json.dumps([decisions,expected,hashlib.sha256(BASELINE.read_bytes()).hexdigest(),
        hashlib.sha256(EXTRAS.read_bytes()).hexdigest()],ensure_ascii=False,sort_keys=True).encode()).hexdigest()
    folder=merges.PARENT/BATCH/args.attempt
    for suffix,value in [('decisions',decisions),('export-expectations',expected)]:
        path=merges.PARENT/f'{BATCH}-{suffix}.json'
        if path.exists():
            assert json.loads(path.read_bytes())==value
        else:
            assert not args.apply
            merges.write_new(path,value)
    if args.apply:
        preview=json.loads((folder/'report.json').read_bytes())
        assert preview['passed'] and preview['temporaryDatabaseRemoved'] and preview['planSha256']==fingerprint
        assert not (merges.PARENT/f'{BATCH}-applied.json').exists()
        engine=create_async_engine(dotenv_values('D:/Project/xhs-travel-pipeline/.env')['DATABASE_URL'])
        try:
            async with async_sessionmaker(engine,expire_on_commit=False,autoflush=False)() as session:
                await session.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ'))
                await session.execute(text("SET LOCAL statement_timeout='30s'"))
                report=await apply_checked(session,frozen,decisions,expected)
                assert report['changes']==preview['changes']
                await session.commit()
            merges.write_new(merges.PARENT/f'{BATCH}-applied.json',{**report,'apply':True,'planSha256':fingerprint,'cities':[{'city':CITY}]})
        finally:
            await engine.dispose()
        print(json.dumps({'applied':BATCH,'checks':report['checks']},ensure_ascii=False))
        return
    folder.mkdir(parents=True,exist_ok=False)
    database=f'place_identity_test_{time.time_ns()}'
    admin=create_async_engine('postgresql+asyncpg://postgres@127.0.0.1:18798/postgres',isolation_level='AUTOCOMMIT')
    engine=create_async_engine(f'postgresql+asyncpg://postgres@127.0.0.1:18798/{database}',
        connect_args={'server_settings':{'synchronize_seqscans':'off','enable_indexscan':'off','enable_bitmapscan':'off'}})
    report={'isolated':True,'apply':False,'planSha256':fingerprint}
    try:
        async with admin.connect() as connection:
            await connection.execute(text(f'CREATE DATABASE "{database}"'))
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        factory=async_sessionmaker(engine,expire_on_commit=False,autoflush=False)
        async with factory() as session:
            await merges.seed(session,frozen)
            extra=json.loads(EXTRAS.read_bytes())
            for key,model in [('provenance',CanonicalPlaceSource),('relations',PlaceRelation)]:
                for row in extra[key]:
                    await session.execute(insert(model).values(**{k:merges.datetime.fromisoformat(v)
                        if isinstance(model.__table__.c[k].type,merges.DateTime) and v else v for k,v in row.items()}))
            await session.commit()
        merges.exporter.SessionFactory=factory
        async def export(name):
            path=folder/name
            sys.argv=['export','--city',CITY,'--out',str(path)]
            await merges.exporter.main()
            return {p['id']:merges.stable(p) for p in json.loads(path.read_bytes())['places']}
        before=await export('before.json')
        assert before=={p['id']:merges.stable(p) for p in json.loads(BASELINE.read_bytes())['places']}
        async with factory() as session:
            report.update(await apply_checked(session,frozen,decisions,expected))
            await session.commit()
        after=await export('xhs-places-厦门.json')
        assert set(after)==set(before)-{OLD}
        assert {k:v for k,v in after.items() if k!=TARGET}=={k:v for k,v in before.items() if k not in {TARGET,OLD}}
        old,new=before[TARGET],after[TARGET]
        assert all(old[k]==new[k] for k in ['name','lat','lng','category'])
        for key in ['address','openHours','price','reservation','reservationNote','reservationEvidence','tips','content',
                    'images','coverImage','imageGallery','amapPhoto','typicalVisitMinutes']:
            assert old['payload'].get(key)==new['payload'].get(key),key
        assert not {'imageIdentity','mentionSources'}.intersection(new['payload'])
        assert OLD in new['payload']['identity']['memberIds']
        assert new['payload']['identity']['revision']==expected[0]['revision']
        assert all(new['payload'][k]==expected[0][k] for k in ['mentionCount','recommendScore'])
        report['checks'].update(allOtherExportsPreserved=True,primaryOperationalFactsAndProfilePreserved=True,
            noMediaScopeAdded=True,oldIdRedirected=True)
        async with factory() as session:
            await rollback_decision(session,decisions[0]['key'])
            restored=await load_mention_catalog(session,CITY)
            assert restored.catalog.entities=={e['entity_id']:e for e in frozen['entities']}
            assert merges.normalized_governance(await merges.governance_state(session,CITY))==merges.normalized_governance(frozen['governanceState'])
            await session.commit()
        assert await export('restored.json')==before
        report['checks']['reverseRollback']=True
        report['passed']=all(report['checks'].values())
    except BaseException as error:
        report.update(passed=False,errorType=type(error).__name__)
        raise
    finally:
        await engine.dispose()
        async with admin.connect() as connection:
            await connection.execute(text(f'DROP DATABASE IF EXISTS "{database}" WITH (FORCE)'))
        await admin.dispose()
        report['temporaryDatabaseRemoved']=True
        merges.write_new(folder/'report.json',report)
    print(json.dumps({'passed':report['passed'],'checks':report['checks'],'expected':expected},ensure_ascii=False))


if __name__=='__main__':
    try:
        asyncio.run(main())
    except Exception as error:
        print(json.dumps({'failed':True,'errorType':type(error).__name__,'frames':[
            {'file':Path(f.filename).name,'line':f.lineno,'function':f.name}
            for f in traceback.extract_tb(error.__traceback__) if str(ROOT) in f.filename]},ensure_ascii=False))
        sys.exit(1)
