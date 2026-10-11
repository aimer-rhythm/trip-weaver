"""安装前固定既有安装记录、代码与预演证据；不修改上游或业务库。"""
import hashlib
import json
from pathlib import Path

root=Path(__file__).resolve().parent
parent=root.parents[1]/'10-06-place-identity-governance/research'
read=lambda p:json.loads(p.read_bytes())
scope,=read(parent/'all-cities/batch-112-v2-scope-decisions.json')
hashes=next(e['files'] for e in scope['evidence'] if e['kind']=='legacy_operational_preservation_implementation')
assert all(hashlib.sha256((parent/'upstream'/name).read_bytes()).hexdigest()==h for name,h in hashes.items())
report=read(parent/'all-cities/batch-112-v2/preview-01/report.json')
assert report['passed'] and report['temporaryDatabaseRemoved'] and report['checks']['targetPayloadFieldsPreserved']
previews=list((parent/'all-cities/batch-112-v2/preview-01/downstream-02').glob('preview-*.json'))
assert len(previews)==1
down=read(previews[0])
assert down['reverseRollback'] and down['photosPreserved'] and down['photoConsumptionPreserved']
assert down['preservedOperations']==1 and down['failures']==[]
assert '807 passed, 1 deselected' in (parent/'upstream-full-place_identity_test_1791591341448.log').read_text(encoding='utf-8')
assert '18 passed' in (parent/'upstream-stage-place_identity_test_1791591129141.log').read_text(encoding='utf-8')
assert 'pass 39' in (parent/'downstream-place_identity_test_1791591631637.log').read_text(encoding='utf-8')
for name in ['upstream-install.json','upstream-install-preview.json']:
    with (root/('operations-before-'+name)).open('xb') as f:
        f.write((parent/name).read_bytes())
evidence={'stage':'ready_to_install','implementationFiles':hashes,'upstreamTests':{'passed':807,'deselected':1},
  'operationalTests':18,'downstreamTests':39,'typecheck':True,
  'stagedDownstreamPreview':str(previews[0].relative_to(root.parents[3])),
  'migrationPreview':{'missing':[],'missingColumns':['place_identity_scope.operational_facts']},
  'actualBusinessApplied':False,'accepted':False}
with (root/'operational-install-ready-01.json').open('x',encoding='utf-8') as f:
    json.dump(evidence,f,ensure_ascii=False,indent=2)
print(json.dumps({'ready':True,'implementationFiles':len(hashes),'actualBusinessApplied':False}))
