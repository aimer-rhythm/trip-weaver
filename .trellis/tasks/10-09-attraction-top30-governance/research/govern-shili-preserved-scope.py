"""116十里长堤：隔离限时活动及婚登点字段，保全旧运营资料和原观点。"""
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

EID,SID='b5aafe8228f99dca3ab61421b4452cf4',2630
runner.CITY,runner.BATCH='厦门','batch-116'
runner.SNAPSHOT=ROOT/'snapshot-20261010T003918938716Z/input.json'
runner.EXTRAS=ROOT/'xiamen-operations-03-extras.json'
runner.BASELINE=ROOT/'xiamen-operations-03-baseline.json'
runner.TARGETS={EID}
runner.UNASSIGNED={6180,6244,6690}
runner.FORBIDDEN_PHRASES=['有草坪音乐会','草坪音乐会，适合看日落','中秋活动地点之一','可拍海边婚登装置']
runner.PRESERVED_TARGET_PAYLOAD_FIELDS=[*helper.FIELDS,'typicalVisitMinutes','images','coverImage','imageGallery','amapPhoto']
QUOTE='💗 集美十里长堤婚登点\n✨ 白天可以拍海边婚登装置，傍晚还能偶遇海上地铁经过海面，搭配橘子海日落，画面感直接拉满。无论是情侣旅行、拍照打卡，还是想留下特别纪念，都很适合来这里停留一会。'

def inputs():
    raw=runner.SNAPSHOT.read_bytes()
    frozen=next(c for c in json.loads(raw)['cities'] if c['city']=='厦门')
    entity=next(e for e in frozen['entities'] if e['entity_id']==EID)
    assert entity['revision']==3 and entity['primary_place_id']==SID
    members=sorted(int(k) for k,v in frozen['members'].items() if v==EID)
    assert members==[2561,2630]
    assert not any(EID in [*s['entity_ids'],*s.get('withdrawal_entity_ids',[])] for s in frozen['scopes'])
    rows=[m for m in frozen['mentions'] if m['entityId']==EID]
    assert len(rows)==len({m['raw_note_id'] for m in rows})==24
    record=json.loads((ROOT/'seven-cities-semantic-readthrough-18.json').read_bytes())
    reviewed=next(r for r in record['reviews'] if r['entityId']==EID)
    old=next(c for c in json.loads((ROOT/record['snapshotFile']).read_bytes())['cities'] if c['city']=='厦门')
    assert rows==[m for m in old['mentions'] if m['entityId']==EID]
    for n in reviewed['noteEvidence']:
        nid=str(n['noteId'])
        assert old['notes'][nid]==frozen['notes'][nid]
        assert hashlib.sha256(frozen['notes'][nid]['note_desc'].encode()).hexdigest()==n['noteDescSha256']
    quotes=[(1451,'🆕十里长堤草坪音乐会🔥'),(1453,'·十里长堤草坪音乐会（看日落版）'),
        (1513,'🆕集美十里长堤、集美大社中秋活动'),(1327,'📍集美学村 → 十里长堤 → 婚登点'),(1327,QUOTE)]
    for nid,quote in quotes: assert quote in frozen['notes'][str(nid)]['note_desc']
    conclusion=('24条/24篇全文已读并与当前完整笔记、提及逐字段核对。6180/6244春节音乐会、6690中秋活动清单无独立长堤游览，隔离待审，不创建活动。'
      '6435在路线中明确单列长堤→婚登点，保留长堤路线身份，仅按原文婚登点标题与连续描述排除reason/evidence_text，不转写或归并婚登点。'
      '其余20条原有效字段保持，6087泥巴多、人多但热闹、6337涨潮风险，6235/6521露营海景停车清单以及6717寄存推广中的真实路线、5977卖车推广中的摄影清单均保持，不抹去作者负评。'
      '原主源及集美十里长堤既有同体、位置/类别/评分策略保持；不并入地铁站、南堤公园、婚登点或集美学村，不核现行露营许可。旧免费运营资料明确保全，图片暂缓，不伪造已审。')
    evidence=[{'kind':'reviewed_attraction_source_scope','snapshotSha256':hashlib.sha256(raw).hexdigest(),
      'file':str(Path(__file__).relative_to(ROOT.parents[3])),'reviewedNotes':reviewed['noteEvidence'],
      'reusedAfterFullNotesAndMentionsComparison':True,'noteQuotes':[{'noteId':n,'quote':q} for n,q in quotes],'conclusion':conclusion}]
    sources={s['id']:s for s in frozen['sources']}
    assignments=[{'mentionId':m['id'],'inputHash':m['inputHash'],'entityId':None if m['id'] in runner.UNASSIGNED else EID} for m in rows]
    next(a for a in assignments if a['mentionId']==6435)['factExclusions']={k:{'reason':'subject_mismatch','quote':QUOTE} for k in ['reason','evidence_text']}
    preservation=helper.operational_request(frozen,EID,json.loads(runner.BASELINE.read_bytes()))
    preservation['evidence'][0].update(file=str(Path(__file__).relative_to(ROOT.parents[3])),
      conclusion='已追溯原主源旧免费资料，逐一绑定完整匹配图片文字输入，保留旧营业/票价/预约投影；本轮仅审主体，不核现行政策，不能恢复限时活动或婚登点事实。')
    hashes=json.loads((ROOT/'operational-install-ready-01.json').read_bytes())['implementationFiles']
    assert all(hashlib.sha256((Path('D:/Project/xhs-travel-pipeline')/name).read_bytes()).hexdigest()==h for name,h in hashes.items())
    evidence.append({'kind':'legacy_operational_preservation_implementation','files':hashes,'conclusion':'与112-v2/114-v2相同受控旧运营投影。'})
    scope={'key':'top30-20261010-batch-116-scope-2630','city':'厦门','sourcePlaceId':SID,
      'expectedSourceHash':source_fingerprint(sources[SID]),'expectedScopeRevision':0,
      'sources':[{'sourcePlaceId':sid,'sourceHash':source_fingerprint(sources[sid])} for sid in members],
      'expectedRevisions':{EID:3},'assignments':assignments,'evidence':evidence,'preserveOperationalFacts':[preservation]}
    own=[m for m in rows if m['id'] not in runner.UNASSIGNED]
    expected={'city':'厦门','id':EID,'name':entity['canonical_name'],'revision':4,'verified':True,
      'mentionIds':[m['id'] for m in own],**recommendation_metrics(own)}
    assert expected['mentionCount']==21
    return frozen,[scope],[expected]

original_apply=runner.apply_checked
async def apply_checked(session,frozen,scopes,expected):
    report=await original_apply(session,frozen,scopes,expected)
    catalog=await load_mention_catalog(session,'厦门')
    for m in await load_mention_rows(session,'厦门'):
        if m['id'] not in expected[0]['mentionIds']: continue
        projected=effective_mention(m,catalog.resolve(m))
        if m['id']==6435:
            assert projected=={**m,'reason':None,'evidence_text':None,'fact_value':m['fact_value'] or {}}
        else: assert projected=={**m,'fact_value':m['fact_value'] or {}}
    assert catalog.catalog.entities[EID]['overrides']==next(e['overrides'] for e in frozen['entities'] if e['entity_id']==EID)
    report['checks'].update(routeIdentityRetainedWithMarriagePointFactsExcluded=True,otherAssignedOpinionsAndFactsPreserved=True)
    return report
runner.inputs,runner.apply_checked=inputs,apply_checked
if __name__=='__main__':
    try: asyncio.run(runner.main())
    except Exception as error:
        print(json.dumps({'failed':True,'errorType':type(error).__name__,'frames':[
            {'file':Path(f.filename).name,'line':f.lineno,'function':f.name}
            for f in traceback.extract_tb(error.__traceback__) if str(ROOT) in f.filename]},ensure_ascii=False))
        sys.exit(1)
