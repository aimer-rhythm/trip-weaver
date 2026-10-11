"""117植物园：同体合并后隔离迎春花展，保留旧运营与所有其他原观点。"""
import asyncio
import hashlib
import importlib.util
import json
import sys
import traceback
from pathlib import Path

ROOT=Path(__file__).resolve().parent
def module(name,file):
    spec=importlib.util.spec_from_file_location(name,ROOT/file)
    value=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value
helper=module('operation_support','govern-nanputuo-preserved-scope.py')
runner=module('scope_runner','govern-disney-scopes.py')
from app.clean.mention_identity import source_fingerprint,effective_mention
from app.clean.recommendation import recommendation_metrics
from app.aggregate.mention_identity import load_mention_catalog,load_mention_rows

EID,SID='410da5dd0d2e2802ead6a313bf030a19',2699
runner.CITY,runner.BATCH='厦门','batch-117'
runner.SNAPSHOT=ROOT/'snapshot-20261010T004932152504Z/input.json'
runner.EXTRAS=ROOT/'xiamen-operations-04-extras.json'
runner.BASELINE=ROOT/'xiamen-operations-04-baseline.json'
runner.TARGETS,runner.UNASSIGNED={EID},{6248}
runner.FORBIDDEN_PHRASES=['迎春花展，适合春节赏花']
runner.PRESERVED_TARGET_PAYLOAD_FIELDS=[*helper.FIELDS,'typicalVisitMinutes','images','coverImage','imageGallery','amapPhoto']

def inputs():
    raw=runner.SNAPSHOT.read_bytes()
    frozen=next(c for c in json.loads(raw)['cities'] if c['city']=='厦门')
    entity=next(e for e in frozen['entities'] if e['entity_id']==EID)
    assert entity['revision']==4 and entity['primary_place_id']==SID
    members=sorted(int(k) for k,v in frozen['members'].items() if v==EID)
    assert not any(EID in [*s['entity_ids'],*s.get('withdrawal_entity_ids',[])] for s in frozen['scopes'])
    rows=[m for m in frozen['mentions'] if m['entityId']==EID]
    assert len(rows)==32 and len({m['raw_note_id'] for m in rows})==31
    record=json.loads((ROOT/'seven-cities-semantic-readthrough-19.json').read_bytes())
    reviewed=next(r for r in record['reviews'] if r['entityId']==EID)
    old=next(c for c in json.loads((ROOT/record['snapshotFile']).read_bytes())['cities'] if c['city']=='厦门')
    assert rows==[m for m in old['mentions'] if m['entityId']==EID]
    assert {n['noteId'] for n in reviewed['noteEvidence']}=={m['raw_note_id'] for m in rows}
    for n in reviewed['noteEvidence']:
        nid=str(n['noteId'])
        assert old['notes'][nid]==frozen['notes'][nid]
        assert hashlib.sha256(frozen['notes'][nid]['note_desc'].encode()).hexdigest()==n['noteDescSha256']
    quotes=[(1453,'·植物园迎春花展')]
    assert quotes[0][1] in frozen['notes']['1453']['note_desc']
    conclusion=('32条/31篇全文已读，继承113裸名同体合并后的全部提及并逐字段核对原笔记。6248只列植物园迎春花展，没有独立园区游览，隔离活动来源待审，不建活动。'
      '其余31条有效字段及原正负观点保持，包括5500晴天丁达尔/喷雾摄影、5952湿滑、6567绕路疲累、6678冬日日照弱、6733错过喷雾无聊。'
      '雨林/多肉园区保持有限园内体验，万石山（植物园）、独立入口及钟鼓索道不合并，不因摄影主题剥夺地点身份。'
      '113已确认植物园裸名及旧ID重定向保持，主源2699及其旧位置、类别、别名、评分策略不改；旧约30元资料和营业/预约证据保全，喷雾时段、抢票等社区说法不升级为现行事实。')
    evidence=[{'kind':'reviewed_attraction_source_scope','snapshotSha256':hashlib.sha256(raw).hexdigest(),
      'file':str(Path(__file__).relative_to(ROOT.parents[3])),'reviewedNotes':reviewed['noteEvidence'],
      'reusedAfterFullNotesAndMentionsComparison':True,'noteQuotes':[{'noteId':n,'quote':q} for n,q in quotes],'conclusion':conclusion}]
    sources={s['id']:s for s in frozen['sources']}
    preservation=helper.operational_request(frozen,EID,json.loads(runner.BASELINE.read_bytes()))
    preservation['evidence'][0].update(file=str(Path(__file__).relative_to(ROOT.parents[3])),
      conclusion='已追溯原植物园运营资料及匹配图片文字索引，保留旧约30元等输出及原证据；本轮仅审主体，不核现行运营，不恢复花展错配。')
    hashes=json.loads((ROOT/'operational-install-ready-01.json').read_bytes())['implementationFiles']
    assert all(hashlib.sha256((Path('D:/Project/xhs-travel-pipeline')/name).read_bytes()).hexdigest()==h for name,h in hashes.items())
    evidence.append({'kind':'legacy_operational_preservation_implementation','files':hashes,'conclusion':'沿用112-v2已固定哈希的旧运营保全协议。'})
    scope={'key':'top30-20261010-batch-117-scope-2699','city':'厦门','sourcePlaceId':SID,
      'expectedSourceHash':source_fingerprint(sources[SID]),'expectedScopeRevision':0,
      'sources':[{'sourcePlaceId':sid,'sourceHash':source_fingerprint(sources[sid])} for sid in members],
      'expectedRevisions':{EID:4},'assignments':[{'mentionId':m['id'],'inputHash':m['inputHash'],
        'entityId':None if m['id']==6248 else EID} for m in rows],'evidence':evidence,'preserveOperationalFacts':[preservation]}
    own=[m for m in rows if m['id']!=6248]
    expected={'city':'厦门','id':EID,'name':entity['canonical_name'],'revision':5,'verified':True,
      'mentionIds':[m['id'] for m in own],**recommendation_metrics(own)}
    assert expected['mentionCount']==31
    return frozen,[scope],[expected]

original_apply=runner.apply_checked
async def apply_checked(session,frozen,scopes,expected):
    report=await original_apply(session,frozen,scopes,expected)
    catalog=await load_mention_catalog(session,'厦门')
    for m in await load_mention_rows(session,'厦门'):
        if m['id'] in expected[0]['mentionIds']:
            assert effective_mention(m,catalog.resolve(m))=={**m,'fact_value':m['fact_value'] or {}}
    assert catalog.catalog.entities[EID]['overrides']==next(e['overrides'] for e in frozen['entities'] if e['entity_id']==EID)
    report['checks'].update(allRetainedOpinionsAndFactsPreserved=True)
    return report
runner.inputs,runner.apply_checked=inputs,apply_checked
if __name__=='__main__':
    try: asyncio.run(runner.main())
    except Exception as error:
        print(json.dumps({'failed':True,'errorType':type(error).__name__,'frames':[
            {'file':Path(f.filename).name,'line':f.lineno,'function':f.name}
            for f in traceback.extract_tb(error.__traceback__) if str(ROOT) in f.filename]},ensure_ascii=False))
        sys.exit(1)
