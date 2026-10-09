"""从固定济南清单选一组待核主体，完整冻结现行来源；不重排清单或写库。"""
from pathlib import Path
import argparse
import asyncio
import hashlib
import json
import sys
from datetime import datetime, timezone
sys.dont_write_bytecode=True
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0,'D:/Project/xhs-travel-pipeline')
from sqlalchemy import select,text
from app.db import SessionFactory,engine
from app.models import CanonicalPlace,RawNote
from app.aggregate.mention_identity import load_mention_catalog,load_mention_rows,source_input,source_keys
from app.aggregate.image_identity import load_image_rows
from app.clean.identity import name_key
from app.clean.mention_identity import MENTION_FIELDS,NOTE_FIELDS,mention_fingerprint,source_fingerprint,scope_matches
root=Path(__file__).resolve().parent
def read(f):return json.loads((root/f).read_bytes())
async def main():
    parser=argparse.ArgumentParser();parser.add_argument('--names',nargs='+',required=True);parser.add_argument('--out',required=True);args=parser.parse_args()
    out=(root/args.out).resolve();assert out.is_relative_to(root) and not out.exists()
    pointer=read('cleaning-scope/current.json');assert '济南' not in pointer['policy']['excludedCities']
    ledger=read('cleaning-scope/'+pointer['cityReviewLedgers']['济南'])
    wanted=[r for r in ledger['rows'] if r['name'] in args.names];assert len(wanted)==len(set(args.names))
    source_file=root/'priority-cities/济南/run-1791385235272324900/sources.json'
    assert hashlib.sha256(source_file.read_bytes()).hexdigest()=='9aa559e894e1cfbcdf74db2214c8eeb6614739064a96967780c6b32af59a889b'
    frozen=json.loads(source_file.read_bytes());frozen_mentions={m['id']:m for m in frozen['mentions']}
    try:
        async with SessionFactory() as session:
            await session.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            await session.execute(text("SET LOCAL statement_timeout='30s'"))
            catalog=await load_mention_catalog(session,'济南')
            sources=(await session.scalars(select(CanonicalPlace).where(CanonicalPlace.city=='济南'))).all()
            by_source={p.id:p for p in sources};mentions=await load_mention_rows(session,'济南');by_mention={m['id']:m for m in mentions}
            for old in frozen['sources']:
                p=by_source[old['id']];assert source_fingerprint(source_input(p))==old['sourceHash']
                for key in ['address','latitude','longitude','place_type','geo_status','amap_poi_id','is_active','quality_score']:
                    assert getattr(p,key)==old[key],(p.id,key)
            for old in frozen['mentions']:assert mention_fingerprint(by_mention[old['id']])==old['inputHash']
            groups=[];selected={};note_ids=set();source_ids=set();matching_names=set()
            for row in wanted:
                eid=row.get('currentEntityId',row['entityId']);entity=catalog.catalog.root(eid)
                assert entity and entity['entity_id']==eid and entity['revision']==row['currentRevision']
                members=[p for p in sources if catalog.catalog.members.get(p.id)==eid]
                keys={name_key(n) for n in [entity['canonical_name'],*entity['aliases']]}
                keys.update(k for p in members for k in source_keys(p))
                related=[p for p in sources if keys & source_keys(p)]
                matches=[m for m in mentions if scope_matches({'city':'济南','name_keys':keys},m)]
                assert all(m['id'] in frozen_mentions for m in matches),'新增提及需要新来源补充记录'
                original=next(g for g in frozen['groups'] if g['entity']['entity_id']==row['entityId'])
                assert sorted(p.id for p in related)==sorted(original['relatedSourceIds'])
                assert sorted(m['id'] for m in matches)==sorted(original['mentionIds'])
                matching_names.update([entity['canonical_name'],*entity['aliases']])
                for m in matches:
                    result=catalog.resolve(m)
                    selected[m['id']]={**{k:m.get(k) for k in MENTION_FIELDS},'inputHash':mention_fingerprint(m),
                        'resolution':{'status':result['status'],'reason':result['reason'],'entityId':(result.get('entity') or {}).get('entity_id'),
                            'factExclusions':result.get('factExclusions')}}
                    note_ids.add(m['raw_note_id'])
                source_ids.update(p.id for p in related)
                groups.append({'entity':entity,'sourceIds':[p.id for p in members],'relatedSourceIds':[p.id for p in related],
                    'mentionIds':[m['id'] for m in matches],'noteIds':sorted({m['raw_note_id'] for m in matches}),
                    'sources':[{'id':p.id,'name':p.name,'placeType':p.place_type,'themes':p.theme_tags,'lat':p.latitude,'lng':p.longitude,
                        'address':p.address} for p in related]})
            image_rows=await load_image_rows(session,'济南')
            images=[r for r in image_rows if r['source_place_id'] in source_ids or r['raw_note_id'] in note_ids]
            supplemental=[]
            for note in (await session.scalars(select(RawNote).where(RawNote.city=='济南'))).all():
                names=sorted(n for n in matching_names if n in json.dumps(note.img_analysis,ensure_ascii=False))
                if not names:continue
                value={'id':note.id,'city':note.city,'title':note.title,'desc':note.desc,'img_analysis':note.img_analysis,'status':note.status,'source_url':note.source_url}
                supplemental.append({'matchedNames':names,'note':value,'inputHash':hashlib.sha256(json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()})
            result={'readOnly':True,'capturedAt':datetime.now(timezone.utc).isoformat(),'city':'济南','entityBatch':pointer['latestAppliedEntityBatch'],
                'ledger':pointer['cityReviewLedgers']['济南'],'groups':groups,'mentions':list(selected.values()),
                'notes':[n for n in frozen['notes'] if n['id'] in note_ids],'images':images,'supplementalImageFactNotes':supplemental,
                'rawSourcesUnchanged':107,'originalMentionsUnchanged':662,'originalNotesCovered':82,'fullReviewPassed':False,'failures':[]}
            with out.open('x',encoding='utf-8') as handle:json.dump(result,handle,ensure_ascii=False,indent=2)
            print(json.dumps({'file':args.out,'groups':[{'name':g['entity']['canonical_name'],'revision':g['entity']['revision'],'mentions':len(g['mentionIds'])} for g in groups],
                'notes':len(note_ids),'upstreamImages':len(images),'supplementalImageNotes':len(supplemental)},ensure_ascii=False))
    finally:await engine.dispose()
asyncio.run(main())
