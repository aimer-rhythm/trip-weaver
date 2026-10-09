"""只读冻结灵岩寺完整scope；有效提及保留，旧劝退时长不得继续消费。"""
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
from scripts.build_visit_duration import extract_note_durations

root = Path(__file__).resolve().parent
eid = '29f4a4b260878eb8d9143b15b8fca54f'
source_file = 'priority-cities/济南/run-1791385235272324900/sources.json'
sha = lambda p: hashlib.sha256((root/p).read_bytes()).hexdigest()
read = lambda p: json.loads((root/p).read_text(encoding='utf-8'))

def write_new(path, value):
    with (root/path).open('x', encoding='utf-8', newline='\n') as out:
        out.write(json.dumps(value, ensure_ascii=False, indent=2)+'\n')

async def main():
    pointer = read('cleaning-scope/current.json')
    assert pointer['latestAppliedEntityBatch'] == 38 and '济南' not in pointer['policy']['excludedCities']
    assert sha(source_file) == '9aa559e894e1cfbcdf74db2214c8eeb6614739064a96967780c6b32af59a889b'
    assert sha('all-cities/batch-39-baseline.json') == '5973f6c5fb6f84221ba9471b3c5b5dfa11907802be20538c02b43c15cb9c3798'
    paths = [f'all-cities/batch-39-{part}.json' for part in ['source','decisions','scope-decisions','export-expectations']]
    ledger_file = 'priority-cities/济南/lingyan-duration-review-01.json'
    assert all(not (root/p).exists() for p in [*paths, ledger_file])
    frozen = read(source_file)
    manifest = read('all-cities/jinan-lingyan-images-01/manifest.json')
    original_image = manifest['images'][0]
    assert original_image['ok'] and original_image['noteId']=='2609' and original_image['page']==5
    assert sha('all-cities/jinan-lingyan-images-01/'+original_image['file']) == original_image['sha256']
    note = next(n for n in frozen['notes'] if n['id']==2609)
    quote = '灵岩寺距离市区较远，来回路程长，如果只有半天时间不建议安排，容易太赶'
    assert any(quote in i.get('text_content','') for i in note['note_images'])
    try:
        async with SessionFactory() as session:
            await session.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            catalog = await load_mention_catalog(session, '济南')
            sources = (await session.scalars(select(CanonicalPlace).where(CanonicalPlace.city=='济南'))).all()
            selected = [s for s in sources if {'灵岩寺'} & source_keys(s)]
            assert [s.id for s in selected]==[5475]
            source = selected[0]
            entity = catalog.catalog.resolve(place_id=5475)
            assert entity['entity_id']==eid and entity['revision']==1 and entity['status']=='ACTIVE'
            assert catalog.scope_for_source(5475) is None
            baseline = next(e for e in read('all-cities/batch-39-baseline.json')['entities'] if e['entity_id']==eid)
            assert entity=={k:v for k,v in baseline.items() if k!='places'}
            all_rows = await load_mention_rows(session, '济南')
            rows = [m for m in all_rows if scope_matches({'city':'济南','name_keys':{'灵岩寺'}},m)]
            assert [m['id'] for m in rows]==[11686]
            old = next(m for m in frozen['mentions'] if m['id']==11686)
            assert mention_fingerprint(rows[0])==old['inputHash']=='247cae165600adec5aa136ff162dfe9cb700f611f9833f369c6549ca88884411'
            assert rows[0]['note_desc']==note['note_desc'] and rows[0]['note_images']==note['note_images']
            assert rows[0]['fact_type'] is None and 'minutes' not in (rows[0]['fact_value'] or {})
            facts = extract_note_durations(note['note_desc'], note['note_images'],
                [(m['name'],m['normalized_name'],m['place_type']) for m in all_rows if m['raw_note_id']==2609])
            assert not [f for f in facts if f[0]==source.normalized_name]
            orig = next(s for s in frozen['sources'] if s['id']==5475)
            fields = ['id','city','name','normalized_name','address','latitude','longitude','place_type','geo_status','amap_poi_id','is_active','quality_score']
            actual = {k:getattr(source,k) for k in fields}
            assert actual=={k:orig[k] for k in fields}
            assert source_fingerprint(source_input(source))==orig['sourceHash']=='8bf45454e56655a8c3fa6aac6d8fae7bbb4b009e3ba140aecc098ef12c7d4e27'
            assert source.typical_visit_minutes==180 and source.typical_visit_source=='xhs_median'
            images = await load_image_rows(session,'济南')
            assert not [im for im in images if im['source_place_id']==5475 or im['raw_note_id']==2609]
            summary = await session.scalar(select(PlaceSummary).where(PlaceSummary.canonical_place_id==5475))
            group = {'entity':entity,'source':actual,'sourceHash':orig['sourceHash'],
                'derivedBefore':{k:getattr(source,k) for k in ['typical_visit_minutes','typical_visit_source','theme_tags','content_profile']},
                'summary':{k:getattr(summary,k) for k in ['canonical_place_id','mention_count_30d','recommend_score']},
                'mentions':[{**m,'inputHash':mention_fingerprint(m)} for m in rows]}
        ledger = {'city':'济南','batch':'batch-39','entityId':eid,'sourcePlaceId':5475,'mentionId':11686,
            'quote':quote,'originalPhoto':{'file':'all-cities/jinan-lingyan-images-01/'+original_image['file'],
                'sha256':original_image['sha256'],'page':5,'visuallyReviewed':True},
            'conclusion':'原图明确劝退时间不足者；180不是建议停留。保留寺庙身份、宋代彩塑看点及唯一11686，不伪造字段排除；完整scope重建派生事实。',
            'installedExtractor':{'file':'scripts/build_visit_duration.py','sha256':hashlib.sha256(Path('D:/Project/xhs-travel-pipeline/scripts/build_visit_duration.py').read_bytes()).hexdigest(),
                'actualNoteTempleFacts':[]},'appliedAtFreeze':False,'fullReviewPassed':False}
        write_new(ledger_file,ledger)
        evidence = {'kind':'reviewed_duration_budget_not_visit','file':ledger_file,'sha256':sha(ledger_file),'conclusion':ledger['conclusion']}
        scope = {'key':'all-cities-20261008-batch-39-lingyan-5475','city':'济南','sourcePlaceId':5475,
            'expectedSourceHash':group['sourceHash'],'expectedScopeRevision':0,'expectedRevisions':{eid:1},
            'assignments':[{'mentionId':11686,'inputHash':old['inputHash'],'entityId':eid}],'evidence':[evidence]}
        decision = {'key':'all-cities-20261008-batch-39-lingyan-category','city':'济南','entityId':eid,
            'mergeEntityIds':[],'canonicalName':'灵岩寺','expectedRevisions':{eid:2},'overrides':{'category':'文化'},
            'evidence':[evidence,{'kind':'retain_reviewed_temple_category','conclusion':'寺庙及宋代彩塑看点为文化；scope清除包含住宿/美食的旧主题后显式保留文化类别。'}]}
        payload = {'readOnly':True,'city':'济南','capturedAt':datetime.now(timezone.utc).isoformat(),
            'originalSourceFile':source_file,'originalSourceSha256':sha(source_file),
            'baselineSha256':sha('all-cities/batch-39-baseline.json'),'groups':[group],'notes':[note],'images':[],'reviews':[]}
        expectations = [{'city':'济南','id':eid,'name':'灵岩寺','revision':3,'verified':True,'mentionIds':[11686]}]
        for path,value in zip(paths,[payload,[decision],[scope],expectations]): write_new(path,value)
        print(json.dumps({'batch':'batch-39','scope':1,'mentions':1,'pendingAdded':0,'sourceSha256':sha(paths[0]),'actualNoteBadFactsAfterFix':0},ensure_ascii=False))
    finally:
        await engine.dispose()

asyncio.run(main())
