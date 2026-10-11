"""对已应用的明确非母项来源记录只读边界，再生成新榜单。"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')
ROOT=Path(__file__).resolve().parent
B=ROOT.parents[1]/'10-06-place-identity-governance/research/all-cities'
p=argparse.ArgumentParser()
for key in ['batch','snapshot','previous','boundaries','ranking']:
    p.add_argument('--'+key,required=True)
args=p.parse_args()
subjects={'batch-114-v2':{6545:'hotel',6596:'hotel'},'batch-116':{6180:'activity',6244:'activity',6690:'activity'},
    'batch-117':{6248:'activity'},'batch-118':{5669:'transport',6179:'activity',6243:'activity'},
    'batch-119':{5632:'hotel',6390:'hotel'},'batch-119-v2':{5632:'hotel',6390:'hotel'}}
assert args.batch in subjects,'本入口只处理已逐条审阅的明确边界'
read=lambda p:json.loads(p.read_bytes())
assert read(B/(args.batch+'-applied.json'))['apply']
snapshot=read(ROOT/args.snapshot)
scope,=read(B/(args.batch+'-scope-decisions.json'))
assert {a['mentionId'] for a in scope['assignments'] if a['entityId'] is None}==subjects[args.batch].keys()
assert len(scope['expectedRevisions'])==1
eid=next(iter(scope['expectedRevisions']))
city=next(c for c in snapshot['cities'] if c['city']==scope['city'])
entity=next(e for e in city['entities'] if e['entity_id']==eid)
evidence=scope['evidence'][0]
quote_by_note={q['noteId']:q['quote'] for q in evidence['noteQuotes']}
boundaries=read(ROOT/args.previous)
assert not any(r['entityId']==eid for r in boundaries),'既有母项边界需单独核对续绑'
for assignment in scope['assignments']:
    if assignment['entityId'] is not None: continue
    m=next(m for m in city['mentions'] if m['id']==assignment['mentionId'])
    assert m['entityId'] is None and m['inputHash']==assignment['inputHash'] and m['resolution']['status']=='review'
    nid=m['raw_note_id']
    quote=quote_by_note[nid]
    assert quote in city['notes'][str(nid)]['note_desc']
    subject=subjects[args.batch][m['id']]
    boundaries.append({'city':city['city'],'entityId':eid,'name':entity['canonical_name'],
      'expectedRevision':entity['revision'],'mentionId':m['id'],'inputHash':m['inputHash'],
      'expectedResolution':m['resolution'],'noteId':nid,'quote':quote,'relation':'not_same_entity','subjectType':subject,
      'conclusion':f'{args.batch}已按全文正式隔离；该提及为{subject}语境，不是母景点独立游览推荐。',
      'businessMutation':False,'limit':'只排除母项潜在加分，不创建酒店、活动或机位新主体。'})
with (ROOT/args.boundaries).open('x',encoding='utf-8') as f: json.dump(boundaries,f,ensure_ascii=False,indent=2)
subprocess.run([sys.executable,'-X','utf8',str(ROOT/'rank.py'),str(ROOT/args.snapshot),'--out',str(ROOT/args.ranking),
    '--classifications',str(ROOT/'seven-cities-type-reviews-04.json'),'--geography-reviews',str(ROOT/'seven-cities-geography-reviews-01.json'),
    '--mention-boundaries',str(ROOT/args.boundaries)],check=True)
