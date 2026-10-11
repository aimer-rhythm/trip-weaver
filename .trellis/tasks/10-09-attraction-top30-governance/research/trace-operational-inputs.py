"""追溯四个待治理景点旧运营字段的既有图片文字出处；不读图、不写业务库。"""
import argparse
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')
ROOT=Path(__file__).resolve().parent
sys.path.insert(0,'D:/Project/xhs-travel-pipeline')
from app.clean.alias import aliases_for,canonical_display_name
from app.qa.ask import _collect_image_facts,_match_image_facts

spec=importlib.util.spec_from_file_location('inspection',ROOT/'inspect-seven-cities.py')
inspection=importlib.util.module_from_spec(spec)
spec.loader.exec_module(inspection)
parser=argparse.ArgumentParser()
parser.add_argument('--snapshot',default='snapshot-20261009T234942074836Z/input.json')
parser.add_argument('--out',default='operational-source-trace-01.json')
parser.add_argument('--entities',nargs='+')
args=parser.parse_args()
source=args.snapshot
raw=(ROOT/source).read_bytes()
city=next(c for c in json.loads(raw)['cities'] if c['city']=='厦门')
notes={n['id']:n for n in city['governanceState']['rawNotes']}
order=[n['id'] for n in city['governanceState']['imageNoteOrder']]
entities={e['entity_id']:e for e in city['entities']}
sources={s['id']:s for s in city['sources']}
targets=args.entities or ['d0e0f1dff1caee95784a31c71d9ac46f','cbe09e6c7cf0420523c91d5361069f6a',
    '410da5dd0d2e2802ead6a313bf030a19','b5aafe8228f99dca3ab61421b4452cf4']
results=[]
for eid in targets:
    entity=entities[eid]
    original=sources[entity['primary_place_id']]['name']
    name=canonical_display_name(original,'厦门')
    names=list(dict.fromkeys([original,name,*aliases_for('厦门',name)]))
    refs=[]
    for nid in order:
        note=notes[nid]
        for index,item in enumerate(note.get('img_analysis') or []):
            if not item.get('has_text'):
                continue
            fields={f:str((item.get('key_info') or {}).get(f) or '') for f in ['hours','tips','reservation','price']}
            matching={f:v for f,v in fields.items() if v and any(alias in v for alias in names)}
            if not matching:
                continue
            facts=list(dict.fromkeys(f for alias in names for f in _match_image_facts(_collect_image_facts([[item]]),alias)))
            refs.append({'noteId':nid,'imageIndex':index,'noteTitle':note['title'],
                'imageInputSha256':hashlib.sha256(json.dumps([note['city'],note['title'],note['desc'],note['status'],
                    note['source_url'],note['created_at'],note['publish_time'],item],ensure_ascii=False,sort_keys=True).encode()).hexdigest(),
                'matchingRawFields':matching,'matchedLegacyFacts':facts,'sourceUrl':note['source_url'],
                'unavailable':note['status'] in ['DELETED','PRIVATE']})
    old=next(p['payload'] for p in city['downstream'] if p['id']==eid)
    result={'entityId':eid,'name':entity['canonical_name'],'sourcePlaceId':entity['primary_place_id'],
        'revision':entity['revision'],'factNames':names,'oldFields':{k:old.get(k) for k in
            ['price','openHours','reservation','reservationNote','reservationEvidence','reservationConflict']},
        'sourceCandidates':refs,'limits':'来源候选逐原图片文字定位；没有进行图片语义或当前运营真实性审核，也不表示已经获得保全协议。'}
    results.append(result)
    inspection.emit({'name':result['name'],'oldPrice':old.get('price'),'sourceCount':len(refs),
        'sources':[{k:v for k,v in ref.items() if k not in ['sourceUrl','imageInputSha256']} for ref in refs]})
path=ROOT/args.out
with path.open('x',encoding='utf-8') as file:
    json.dump({'readOnly':True,'sourceSnapshot':source,'snapshotSha256':hashlib.sha256(raw).hexdigest(),
        'targets':results,'businessMutation':False},file,ensure_ascii=False,indent=2)
