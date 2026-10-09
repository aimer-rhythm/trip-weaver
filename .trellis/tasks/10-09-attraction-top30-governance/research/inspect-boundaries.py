"""从冻结原文生成范围核查材料；不修改任何业务记录。"""
import json
import sys
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8')
root=Path(__file__).resolve().parent
snapshot=json.loads((root/'snapshot-20261009T091028176747Z/input.json').read_bytes())
ranking=json.loads((root/'ranking-04.json').read_bytes())
for city in snapshot['cities']:
    names=set(sys.argv[1:])
    requested_ids={int(n) for n in names if n.isdigit()}
    rows=next(c for c in ranking['cities'] if c['city']==city['city'])['allAttractions']
    chosen=[r for r in rows if r['name'] in names]
    ids={i for r in chosen for i in r['uncertainMentionIds']}|requested_ids
    entities={r['entityId'] for r in chosen}
    for row in chosen:
        e=next(e for e in city['entities'] if e['entity_id']==row['entityId'])
        print(json.dumps({'name':row['name'],'entityId':e['entity_id'],'aliases':e['aliases'],'sources':row['sourceIds']},ensure_ascii=False))
    for m in city['mentions']:
        if m['id'] not in ids and not ('--all' in names and m['entityId'] in entities):continue
        note=city['notes'][str(m['raw_note_id'])]
        print(json.dumps({'mention':m,'text':note.get('note_desc'),'analysis':note.get('note_analysis')},ensure_ascii=False))
