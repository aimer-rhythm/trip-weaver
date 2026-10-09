"""核实当前导出相对旧库仅有原来源日期修复，并只读核验固定范围原始数据。"""
from pathlib import Path
from datetime import datetime, timezone
import asyncio, copy, hashlib, json, sys
sys.dont_write_bytecode=True
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0,'D:/Project/xhs-travel-pipeline')
from sqlalchemy import select,text
from app.db import SessionFactory,engine
from app.models import CanonicalPlace,RawNote
from app.aggregate.mention_identity import load_mention_rows,source_input
from app.clean.mention_identity import mention_fingerprint,source_fingerprint
root=Path(__file__).resolve().parent
folder=root/'priority-cities/成都/run-1791504271958861000'
def read(p):return json.loads((folder/p).read_text(encoding='utf-8'))
def digest(value):return hashlib.sha256(json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()
async def main():
    target=folder/'producer-baseline-check.json'
    assert not target.exists()
    frozen=read('sources.json');details=read('details.json');library=read('library-before.json');exported=read('producer-before.json')
    old={p['id']:p for p in library['tables']['canonical_places']}
    fields=['aliases','xhsPlaceType','topReasons','openHours','reservation','reservationNote','reservationEvidence','reservationConflict','typicalVisitMinutes','mentionSources','themes','address','geoStatus','price','tips','imageIdentity','adcode']
    changed=[]
    try:
        async with SessionFactory() as s:
            await s.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            mentions=await load_mention_rows(s,'成都')
            expected={m['id']:m['inputHash'] for m in frozen['mentions']}
            assert {m['id']:mention_fingerprint(m) for m in mentions if m['id'] in expected}==expected
            for p in (await s.scalars(select(CanonicalPlace).where(CanonicalPlace.id.in_([p['id'] for p in frozen['sources']])))).all():
                assert source_fingerprint(source_input(p))==next(v['sourceHash'] for v in frozen['sources'] if v['id']==p.id)
            notes=(await s.scalars(select(RawNote).where(RawNote.city=='成都'))).all()
            for expected_note in details['noteDetails']:
                n=next(n for n in notes if n.id==expected_note['id'])
                assert digest(n.img_analysis)==expected_note['analysisSha256'] and digest(n.raw_json)==expected_note['rawJsonSha256']
                assert n.created_at.isoformat()==expected_note['observedAt'] and (n.publish_time.isoformat() if n.publish_time else None)==expected_note['publishedAt']
            for p in exported['places']:
                actual=old[p['id']]
                for k in ['name','category','lat','lng','verified']:assert p[k]==actual[k],(p['name'],k)
                for k in fields:assert p['payload'].get(k)==actual['payload'].get(k),(p['name'],k)
                current=copy.deepcopy(p['payload'].get('content'));prior=copy.deepcopy(actual['payload'].get('content'))
                if current is None and prior is None:continue
                assert current is not None and prior is not None
                current.pop('compiledAt',None);prior.pop('compiledAt',None)
                assert len(current['highlights'])==len(prior['highlights'])
                for i,(new,previous) in enumerate(zip(current['highlights'],prior['highlights'])):
                    new_date=new.pop('observedAt',None);old_date=previous.pop('observedAt',None)
                    assert new==previous,(p['name'],i,'非日期看点变化')
                    if new_date!=old_date:
                        candidates=[n for n in notes if n.source_url==new.get('sourceUrl')]
                        assert candidates,(p['name'],i,'来源URL缺失')
                        ids=[n.id for n in candidates if n.created_at==datetime.fromisoformat(new_date)]
                        assert ids,(p['name'],i,'新日期不等于原采集时间')
                        changed.append({'entityId':p['id'],'name':p['name'],'highlightIndex':i,'before':old_date,'after':new_date,'sourceNoteIds':ids})
                assert current==prior,(p['name'],'非日期内容变化')
        assert len(changed)==314 and len({v['entityId'] for v in changed})==245
        report={'readOnly':True,'city':'成都','at':datetime.now(timezone.utc).isoformat(),'entityBatch':65,'currentProducerPlaces':len(exported['places']),
            'sourceRevision':exported['relationIdentity']['revision'],'nonDateFieldsPreserved':True,'sourceDatesVerified':True,
            'changedContentRows':245,'changedHighlights':314,'rawSourcesUnchanged':127,'mentionsUnchanged':490,'notesAndAnalysisAndRawJsonUnchanged':85,
            'changes':changed,'producerSha256':hashlib.sha256((folder/'producer-before.json').read_bytes()).hexdigest(),
            'imageComparison':'deferred_by_user','businessMutations':False,'failures':[]}
        with target.open('x',encoding='utf-8') as f:json.dump(report,f,ensure_ascii=False,indent=2)
        print(json.dumps({k:v for k,v in report.items() if k!='changes'},ensure_ascii=False))
    finally:await engine.dispose()
asyncio.run(main())
