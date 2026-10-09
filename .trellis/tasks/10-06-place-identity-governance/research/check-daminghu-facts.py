"""只读检查正式消费投影，并追溯两条关系证据降级原因；不查看图片。"""
from pathlib import Path
import asyncio
import json
import sys
from collections import Counter
sys.dont_write_bytecode=True
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0,'D:/Project/xhs-travel-pipeline')
from sqlalchemy import select,text
from app.db import SessionFactory,engine
from app.models import CanonicalPlace
from app.aggregate.mention_identity import load_mention_catalog,load_mention_rows
from app.clean.mention_identity import effective_mention,mention_fingerprint
from app.clean.mention_relations import mine_mention_relations

root=Path(__file__).resolve().parent
def read(p):return json.loads((root/p).read_text(encoding='utf-8'))
async def main():
    source=read('all-cities/batch-42-source.json')
    expected=read('all-cities/batch-42-scope-decisions.json')[0]
    folder='all-cities/batch-42/sync-01/'
    before=read(folder+'preview-济南/library-before.json')['tables']['place_relation_snapshots'][0]['relations']
    delta=read(folder+'preview-济南/relation-delta.json')
    try:
        async with SessionFactory() as s:
            await s.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            cat=await load_mention_catalog(s,'济南')
            rows=await load_mention_rows(s,'济南');by_id={m['id']:m for m in rows}
            durations=[];pending=[]
            for a in expected['assignments']:
                row=by_id[a['mentionId']];resolution=cat.resolve(row)
                assert mention_fingerprint(row)==a['inputHash']
                effective=effective_mention(row,resolution)
                if a['entityId']:
                    assert resolution['status']=='resolved'
                    assert effective['reason']==row['reason'] and effective['evidence_text']==row['evidence_text']
                    if row['id']==12700:
                        assert row['fact_value']['minutes']==30 and 'minutes' not in effective['fact_value']
                        assert '船' in str(effective['reason'])+str(effective['evidence_text'])
                    elif 'minutes' in effective['fact_value']:
                        durations.append({'mentionId':row['id'],'noteId':row['raw_note_id'],'minutes':effective['fact_value']['minutes']})
                else:
                    assert resolution['status']=='review'
                    assert effective['reason'] is None and effective['evidence_text'] is None and effective['fact_value']=={}
                    pending.append(row['id'])
            assert len(pending)==17
            assert any(d['minutes']==120 for d in durations) and any(d['minutes']==60 for d in durations)
            assert all(d['minutes']!=30 for d in durations)
            surfaces=(await s.execute(select(CanonicalPlace.name,CanonicalPlace.normalized_name).where(CanonicalPlace.city=='济南'))).all()
            mined=mine_mention_relations(cat,rows,extra_surfaces=[n for pair in surfaces for n in pair])
            relations=[]
            for changed in delta['changed']:
                key={changed['fromEntityId'],changed['toEntityId']}
                old=next(r for r in before if {r['fromEntityId'],r['toEntityId']}==key)
                current=next(r for r in mined['relations'] if {r['fromEntityId'],r['toEntityId']}==key)
                assert current==changed
                lost=sorted({e['noteId'] for e in old['evidence']}-{e['noteId'] for e in current['evidence']})
                details=[]
                for note_id in lost:
                    unbound=[r for r in mined['unresolved'] if r['noteId']==note_id and r.get('surface') in source['entity']['aliases']]
                    assert unbound
                    reasons=sorted({reason for r in unbound for reason in r.get('reasons',[])})
                    assert set(reasons)<= {'ambiguous_text_occurrence','unassigned_target','no_mention_binding'}, (note_id,unbound)
                    old_endpoint=next(e for e in old['evidence'] if e['noteId']==note_id)
                    old_endpoint=next(old_endpoint[k] for k in ['from','to'] if old_endpoint[k]['entityId']==source['entity']['entity_id'])
                    matching=[r for r in unbound if (r['start'],r['end'])==(old_endpoint['start'],old_endpoint['end'])]
                    assert matching and all(r['reasons'] for r in matching)
                    details.append({'noteId':note_id,'reasons':reasons,'formerEndpointReasons':matching[0]['reasons']})
                relations.append({'from':changed['from'],'to':changed['to'],'beforeStrength':old['strength'],
                    'afterStrength':changed['strength'],'retainedNoteIds':[e['noteId'] for e in current['evidence']],
                    'lostEvidence':details})
        report={'batch':42,'readOnly':True,'confirmed':48,'pendingProjectionEmpty':pending,'boatMinutesExcluded':30,
            'boatDescriptionRetained':True,'validDurationRows':durations,'relationDowngrades':relations,
            'reasonMeaning':'多次同名出现且旧提及引用无法定位具体正文位置、目标待审或该名称表层无提及绑定，均不能认领关系端点；身份resolved不等于任一同名位置已确认。',
            'imageComparison':'deferred_by_user','failures':[]}
        with (root/'priority-cities/济南/daminghu-fact-projection-check-01.json').open('x',encoding='utf-8') as out:
            json.dump(report,out,ensure_ascii=False,indent=2)
        print(json.dumps(report,ensure_ascii=False))
    finally:await engine.dispose()
asyncio.run(main())
