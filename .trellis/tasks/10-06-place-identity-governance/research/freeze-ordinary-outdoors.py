"""只读冻结六个普通户外主体及图片文字事实来源，不查看原图。"""
from pathlib import Path
from datetime import datetime,timezone
import asyncio,hashlib,json,sys
sys.dont_write_bytecode=True
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0,'D:/Project/xhs-travel-pipeline')
from sqlalchemy import select,text
from app.db import SessionFactory,engine
from app.models import CanonicalPlace,PlaceSummary,RawNote
from app.aggregate.mention_identity import load_mention_catalog,load_mention_rows,source_input,source_keys
from app.aggregate.image_identity import load_image_rows
from app.clean.mention_identity import mention_fingerprint,source_fingerprint,scope_matches,NOTE_FIELDS
root=Path(__file__).resolve().parent
source_path='priority-cities/济南/run-1791385235272324900/sources.json'
target=root/'priority-cities/济南/ordinary-outdoors-source-packet-01.json'
ids=['5e67e8211c98d3e0e94c08114917c628','8618b70ccf17cd1522c5bf27cbe16361','99ddd31eba85db1d2ed58d7e60507f27','cd8dfd49f13c9cbbd9d02c9d4c72defb','4dfda3371793b69de15122bb7e330eac','80a33955c3f8381171f8493ae1ec0c4d']
async def main():
    assert not target.exists()
    raw=(root/source_path).read_bytes();digest=hashlib.sha256(raw).hexdigest();assert digest=='9aa559e894e1cfbcdf74db2214c8eeb6614739064a96967780c6b32af59a889b'
    frozen=json.loads(raw);pointer=json.loads((root/'cleaning-scope/current.json').read_text(encoding='utf-8'))
    assert pointer['latestAppliedEntityBatch']==57 and not pointer['userAcceptance'] and pointer['imageComparisonPolicy']['status']=='deferred_by_user'
    try:
        async with SessionFactory() as s:
            await s.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            cat=await load_mention_catalog(s,'济南');sources=(await s.scalars(select(CanonicalPlace).where(CanonicalPlace.city=='济南'))).all()
            rows=await load_mention_rows(s,'济南');by_id={m['id']:m for m in rows};source_by_id={v.id:v for v in sources};note_by_id={n['id']:n for n in frozen['notes']}
            for v in frozen['sources']:
                actual=source_by_id[v['id']];assert source_fingerprint(source_input(actual))==v['sourceHash']
                for k in ['name','normalized_name','city','address','latitude','longitude','place_type','geo_status','amap_poi_id','is_active','quality_score']:assert getattr(actual,k)==v[k]
            for m in frozen['mentions']:
                actual=by_id[m['id']];assert mention_fingerprint(actual)==m['inputHash']
                for k in NOTE_FIELDS:assert actual.get(k)==note_by_id[actual['raw_note_id']].get(k)
            groups=[];selected={};source_ids=set()
            for eid in ids:
                old=next(g for g in frozen['groups'] if g['entity']['entity_id']==eid);keys=set(old['nameKeys']);entity=cat.catalog.root(eid)
                assert entity==old['entity'] and entity['revision']==1
                current=[m for m in rows if scope_matches({'city':'济南','name_keys':keys},m)]
                assert {m['id'] for m in current}==set(old['mentionIds'])
                for m in current:
                    assert cat.resolve(m)['entity']['entity_id']==eid;selected[m['id']]=m
                members=[]
                for v in [v for v in sources if keys&source_keys(v)]:
                    assert cat.scope_for_source(v.id) is None and cat.catalog.resolve(place_id=v.id)['entity_id']==eid;source_ids.add(v.id)
                    old_source=next(o for o in frozen['sources'] if o['id']==v.id)
                    summary=await s.scalar(select(PlaceSummary).where(PlaceSummary.canonical_place_id==v.id))
                    members.append({'source':{k:getattr(v,k) for k in ['id','city','name','normalized_name','address','latitude','longitude','place_type','geo_status','amap_poi_id','is_active','quality_score']},
                        'sourceHash':old_source['sourceHash'],'derivedBefore':{k:getattr(v,k) for k in ['typical_visit_minutes','typical_visit_source','theme_tags','content_profile']},
                        'supplement':{'adcode':v.adcode},'summary':{k:getattr(summary,k) for k in ['canonical_place_id','mention_count_30d','recommend_score','top_reasons']}})
                assert len(members)==1
                groups.append({'entity':entity,'sources':members,'nameKeys':sorted(keys),'mentionIds':sorted(m['id'] for m in current)})
            names=[g['entity']['canonical_name'] for g in groups];supplemental=[]
            for n in (await s.scalars(select(RawNote).where(RawNote.city=='济南'))).all():
                matched=[name for name in names if name in json.dumps(n.img_analysis,ensure_ascii=False)]
                if not matched:continue
                record={k:getattr(n,k) for k in ['id','note_id','city','title','desc','img_analysis','status','source_url']}
                supplemental.append({'matchedNames':matched,'inputHash':hashlib.sha256(json.dumps(record,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest(),'note':record})
            images=[i for i in await load_image_rows(s,'济南') if i['source_place_id'] in source_ids]
            payload={'readOnly':True,'capturedAt':datetime.now(timezone.utc).isoformat(),'afterEntityBatch':57,'groups':groups,
                'originalSourceFile':source_path,'originalSourceSha256':digest,'sources':[v for g in groups for v in g['sources']],
                'mentions':[{**m,'inputHash':mention_fingerprint(m)} for m in selected.values()],
                'notes':[note_by_id[nid] for nid in sorted({m['raw_note_id'] for m in selected.values()})],
                'images':images,'supplementalImageFactNotes':supplemental,
                'catalog':{'entities':[g['entity'] for g in groups],'members':[{'place_id':pid,'entity_id':eid} for pid,eid in cat.catalog.members.items() if pid in source_ids],'reviews':[]},
                'rawSourcesUnchanged':len(frozen['sources']),'originalMentionsUnchanged':len(frozen['mentions']),'originalNotesUnchanged':len(frozen['notes']),
                'imageComparison':'deferred_by_user','businessMutations':False,'failures':[]}
            with target.open('x',encoding='utf-8') as f:json.dump(payload,f,ensure_ascii=False,indent=2)
            print(json.dumps({'file':str(target.relative_to(root)),'entities':len(groups),'mentions':len(selected),'notes':len(payload['notes']),'images':len(images),
                'supplementalNotes':[(n['note']['id'],n['matchedNames']) for n in supplemental],'sha256':hashlib.sha256(target.read_bytes()).hexdigest()},ensure_ascii=False))
    finally:await engine.dispose()
asyncio.run(main())
