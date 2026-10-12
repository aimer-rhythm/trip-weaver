"""冻结泉城广场33提及：30归本体，3条住宿语境或错路线隔离；原源不改。"""
from pathlib import Path
import asyncio
import hashlib
import json
import sys
from datetime import datetime, timezone
sys.dont_write_bytecode = True
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, 'D:/Project/xhs-travel-pipeline')
from sqlalchemy import select, text
from app.db import engine, SessionFactory
from app.models import CanonicalPlace, PlaceSummary
from app.aggregate.mention_identity import load_mention_catalog, load_mention_rows, source_input, source_keys
from app.aggregate.image_identity import load_image_rows
from app.clean.mention_identity import mention_fingerprint, source_fingerprint, scope_matches

root = Path(__file__).resolve().parent
source_file = 'priority-cities/济南/run-1791385235272324900/sources.json'
source_hash = '9aa559e894e1cfbcdf74db2214c8eeb6614739064a96967780c6b32af59a889b'
baseline_hash = 'ccb420ee4035a3fd380d4ad60cd7f69b30c123fe0e62198fb98d2e5796921e8a'
entity_id = '8cc25e536e67519c958ee54248ead04f'
pending = {
    11420: ('泉城广场附近：步行就可以到达趵突泉、黑虎泉景点', '住宿推荐区域被提取为hotel；不是广场游览或具体酒店，不猜门店。'),
    12580: ('有济南地标性建筑，性价比高，周边小吃较多', '虽同篇路线有广场，但本条reason/evidence取自住宿建议的泉城广场附近段，性价比评价不属于公共广场；整条隔离防传播。'),
    12913: ('不去的从东门出，马路对面就是泉城广场', '地点可辨，但reason误写从五龙潭东门出；原文承接去趵突泉及老舍故居的路线，不能把错出发点作为广场访问事实。原文不改，待字段归属澄清。'),
}

def write_new(file, value):
    with (root / file).open('x', encoding='utf-8', newline='\n') as handle:
        handle.write(json.dumps(value, ensure_ascii=False, indent=2) + '\n')

async def main():
    pointer = json.loads((root/'cleaning-scope/current.json').read_text(encoding='utf-8'))
    assert '济南' not in pointer['policy']['excludedCities']
    assert pointer['latestAppliedEntityBatch'] == 34
    assert hashlib.sha256((root/source_file).read_bytes()).hexdigest() == source_hash
    baseline_file = root/'all-cities/batch-35-baseline.json'
    assert hashlib.sha256(baseline_file.read_bytes()).hexdigest() == baseline_hash
    frozen = json.loads((root/source_file).read_text(encoding='utf-8'))
    baseline = json.loads(baseline_file.read_text(encoding='utf-8'))
    prior = json.loads((root/'priority-cities/济南/landmark-source-review-01.json').read_text(encoding='utf-8'))
    prior_group = next(g for g in prior['groups'] if g['entityId'] == entity_id)
    ledger_file = 'priority-cities/济南/square-source-review-02.json'
    files = ['all-cities/batch-35-source.json', 'all-cities/batch-35-decisions.json',
        'all-cities/batch-35-scope-decisions.json', 'all-cities/batch-35-export-expectations.json', ledger_file]
    assert all(not (root/f).exists() for f in files)
    try:
        async with SessionFactory() as session:
            await session.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            catalog = await load_mention_catalog(session, '济南')
            all_sources = (await session.scalars(select(CanonicalPlace).where(CanonicalPlace.city=='济南'))).all()
            keys = {'泉城广场'}
            sources = [s for s in all_sources if keys & source_keys(s)]
            assert [s.id for s in sources] == [5354]
            source = sources[0]
            entity = catalog.catalog.resolve(place_id=5354)
            assert entity == {k:v for k,v in next(e for e in baseline['entities'] if e['entity_id']==entity_id).items() if k!='places'}
            assert entity['entity_id'] == entity_id and entity['revision'] == 1 and entity['status'] == 'ACTIVE'
            assert catalog.scope_for_source(5354) is None
            rows = [m for m in await load_mention_rows(session, '济南') if scope_matches({'city':'济南','name_keys':keys}, m)]
            rows.sort(key=lambda r:r['id'])
            assert len(rows)==33 and {r['id'] for r in rows}=={r['mentionId'] for r in prior_group['mentions']}
            original_source = next(s for s in frozen['sources'] if s['id']==5354)
            fields = ['id','city','name','normalized_name','address','latitude','longitude','place_type','geo_status','amap_poi_id','is_active','quality_score']
            actual_source = {k:getattr(source,k) for k in fields}
            assert actual_source == {k:original_source[k] for k in fields}
            assert source_fingerprint(source_input(source)) == original_source['sourceHash']
            note_ids = {r['raw_note_id'] for r in rows}
            notes = [n for n in frozen['notes'] if n['id'] in note_ids]
            assert len(notes)==len(note_ids)
            images = await load_image_rows(session, '济南')
            assert not [im for im in images if im['source_place_id']==5354 or im['raw_note_id'] in note_ids]
            ledger_rows = []
            for row in rows:
                original = next(m for m in frozen['mentions'] if m['id']==row['id'])
                assert mention_fingerprint(row)==original['inputHash']
                note = next(n for n in notes if n['id']==row['raw_note_id'])
                assert row['note_desc']==note['note_desc'] and row['note_title']==note['note_title']
                previous = next(r for r in prior_group['mentions'] if r['mentionId']==row['id'])
                quote, reason = pending.get(row['id'], ('', previous['explanation']))
                if row['id'] in pending:
                    assert quote in note['note_desc']
                ledger_rows.append({'mentionId':row['id'],'noteId':row['raw_note_id'],'inputHash':original['inputHash'],
                    'entityId':None if row['id'] in pending else entity_id,'originalName':row['name'],
                    'sourceType':row['place_type'],'originalReason':row['reason'],'evidenceText':row['evidence_text'],
                    'quote':quote,'reason':reason,'status':'needs_scope_or_fact_clarification' if row['id'] in pending else 'reviewed_square'})
            summary = await session.scalar(select(PlaceSummary).where(PlaceSummary.canonical_place_id==5354))
            group = {'entity':entity,'source':actual_source,'sourceHash':original_source['sourceHash'],
                'summary':{k:getattr(summary,k) for k in ['canonical_place_id','mention_count_30d','recommend_score']},
                'mentions':[{**r,'inputHash':mention_fingerprint(r)} for r in rows]}
        ledger = {'city':'济南','batch':'batch-35','sourceFile':source_file,'sourceSha256':source_hash,
            'previousReview':'priority-cities/济南/landmark-source-review-01.json','sourcePlaceIds':[5354],
            'summary':{'mentions':33,'fullNotes':len(notes),'confirmedSquare':30,'pending':3,'upstreamImages':0},
            'correction':'此前只识别11420。逐条复核原提取reason/fact后，12580混入住宿评价、12913错写五龙潭出发点，两条均追加隔离。技术解析成功不证明事实归属正确。',
            'rows':ledger_rows,'appliedAtFreeze':False}
        write_new(ledger_file, ledger)
        evidence = {'kind':'reviewed_square_complete_source','file':ledger_file,
            'sha256':hashlib.sha256((root/ledger_file).read_bytes()).hexdigest(),
            'conclusion':'30提及归广场，3条因住宿语境/错路线保留null待审；保留广场稳定ID、无新酒店或摄影点。'}
        scope = {'key':'all-cities-20261008-batch-35-square-5354','city':'济南','sourcePlaceId':5354,
            'expectedSourceHash':group['sourceHash'],'expectedScopeRevision':0,'expectedRevisions':{entity_id:1},
            'assignments':[{k:r[k] for k in ['mentionId','inputHash','entityId']} for r in ledger_rows],'evidence':[evidence]}
        decision = {'key':'all-cities-20261008-batch-35-square-category','city':'济南','entityId':entity_id,
            'mergeEntityIds':[],'canonicalName':'泉城广场','expectedRevisions':{entity_id:2},'overrides':{'category':'娱乐'},
            'evidence':[evidence,{'kind':'reviewed_public_square_category','conclusion':'原类别娱乐与已确认的喷泉、休闲及夜景打卡一致。scope清旧themes后显式保留，防止默认退为文化或继承住宿类型；不是音乐喷泉本身与广场判等。',
                'file':'priority-cities/济南/geo-06.json','sha256':hashlib.sha256((root/'priority-cities/济南/geo-06.json').read_bytes()).hexdigest()}]}
        payload = {'readOnly':True,'city':'济南','capturedAt':datetime.now(timezone.utc).isoformat(),
            'originalSourceFile':source_file,'originalSourceSha256':source_hash,'baselineSha256':baseline_hash,
            'groups':[group],'notes':notes,'images':[],'reviews':[]}
        expectations = [{'city':'济南','id':entity_id,'name':'泉城广场','revision':3,'verified':True,
            'mentionIds':sorted(r['mentionId'] for r in ledger_rows if r['entityId'])}]
        for f, value in zip(files[:4], [payload,[decision],[scope],expectations]): write_new(f, value)
        print(json.dumps({'batch':'batch-35','mentions':33,'notes':len(notes),'confirmed':30,'pending':3,
            'sourceSha256':hashlib.sha256((root/files[0]).read_bytes()).hexdigest()},ensure_ascii=False))
    finally:
        await engine.dispose()

asyncio.run(main())
