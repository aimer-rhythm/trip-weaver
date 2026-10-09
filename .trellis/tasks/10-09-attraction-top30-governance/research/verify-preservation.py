"""比较本轮首尾冻结输入，精确验证原始数据、范围分配、非目标身份与旧媒体。"""
import hashlib
import copy
import json
import sys
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8')
root=Path(__file__).resolve().parent
before=json.loads((root/'snapshot-20261009T081112091980Z/input.json').read_bytes())
after=json.loads((root/'snapshot-20261009T094259676338Z/input.json').read_bytes())
parent=root.parents[1]/'10-06-place-identity-governance/research/all-cities'
decisions=[d for n in [72,73,74] for d in json.loads((parent/f'batch-{n}-decisions.json').read_bytes())]
date_report=json.loads((root/'content-dates-verification-01.json').read_bytes())
assert date_report['passed'] and not date_report['failures']
date_changes={(r['id'],r['field'],r['before'],r['after']) for r in date_report['rows']}
allowed={d['entityId'] for d in decisions}|{i for d in decisions for i in d['mergeEntityIds']}
def digest(value):return hashlib.sha256(json.dumps(value,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
def mapping(rows,key):return {r[key]:r for r in rows}
report={'passed':True,'comparison':'稳定ID映射逐字段，不依赖数据库行顺序','cities':[]}
for old in before['cities']:
    new=next(c for c in after['cities'] if c['city']==old['city'])
    for field in ['sources','notes','scopes','assignments','summaries']:
        assert new[field]==old[field],(old['city'],field)
    assert {m['id']:m['inputHash'] for m in new['mentions']}=={m['id']:m['inputHash'] for m in old['mentions']}
    oe,ne=mapping(old['entities'],'entity_id'),mapping(new['entities'],'entity_id')
    assert oe.keys()==ne.keys()
    changed=[i for i in oe if oe[i]!=ne[i]]
    assert set(changed)<=allowed
    od,nd=mapping(old['downstream'],'id'),mapping(new['downstream'],'id')
    assert od.keys()<=nd.keys()
    media=0; core_changes=[];payload_changes=[]; compilation_refreshes=0
    for i,row in od.items():
        current=nd[i]
        for key in ['coverImage','imageGallery','amapPhoto']:
            if key in (row['payload'] or {}):
                assert current['payload'].get(key)==row['payload'][key],(i,key)
                media+=1
        for key in ['name','category','source','verified','lat','lng']:
            if row[key]!=current[key]:core_changes.append({'id':i,'name':row['name'],'field':key})
        if i not in allowed:
            assert current['payload'].get('identity')==row['payload'].get('identity')
            assert current['payload'].get('canonicalRedirectTo')==row['payload'].get('canonicalRedirectTo')
        fields=[k for k in set(row['payload'] or {})|set(current['payload'] or {}) if row['payload'].get(k)!=current['payload'].get(k)]
        if 'content' in fields:
            before_content=copy.deepcopy(row['payload'].get('content') or {})
            after_content=copy.deepcopy(current['payload'].get('content') or {})
            before_content.pop('compiledAt',None);after_content.pop('compiledAt',None)
            for ix,h in enumerate(before_content.get('highlights',[])):
                if ix>=len(after_content.get('highlights',[])):continue
                newer=after_content['highlights'][ix].get('observedAt')
                if (i,f'/highlights/{ix}/observedAt',h.get('observedAt'),newer) in date_changes:
                    h['observedAt']=newer
            if before_content==after_content:
                fields.remove('content');compilation_refreshes+=1
        if i not in allowed:assert not fields,(i,row['name'],fields)
        if fields:payload_changes.append({'id':i,'name':row['name'],'fields':sorted(fields)})
    assert not core_changes
    report['cities'].append({'city':old['city'],'changedEntities':[ne[i]['canonical_name'] for i in changed],
        'rawSourcesPreserved':len(old['sources']),'rawNotesPreserved':len(old['notes']),
        'rawMentionHashesPreserved':len(old['mentions']),'existingAssignmentsPreserved':len(old['assignments']),
        'downstreamRowsPreserved':len(od),'oldMediaFieldsPreserved':media,'coreFieldChanges':core_changes,
        'payloadChanges':payload_changes,'contentTimestampRefreshes':compilation_refreshes,
        'verifiedSourceDateCorrections':sum(r['city']==old['city'] for r in date_report['rows']),
        'outsideTargetPayloadPreservedExceptVerifiedDates':True,'rawSourcesSha256':digest(old['sources'])})
assert before['tripsDigest']==after['tripsDigest']
report['tripsPreserved']=after['tripsDigest']
with (root/'preservation-check-03.json').open('x',encoding='utf-8') as f:json.dump(report,f,ensure_ascii=False,indent=2)
print(json.dumps({'passed':True,'changedEntityRecords':sum(len(c['changedEntities']) for c in report['cities']),
    'rows':sum(c['downstreamRowsPreserved'] for c in report['cities']),'mediaFields':sum(c['oldMediaFieldsPreserved'] for c in report['cities']),
    'trips':after['tripsDigest']['count']},ensure_ascii=False))
