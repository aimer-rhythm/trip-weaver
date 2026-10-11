"""118集美学村：区分活动、站点及大社/列车描述，保留未闭合范围与旧运营。"""
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

EID,SID='766f37a1bb5763653dd7b28d76c9d498',2560
runner.CITY,runner.BATCH='厦门','batch-118'
runner.SNAPSHOT=ROOT/'snapshot-20261010T005813495192Z/input.json'
runner.EXTRAS=ROOT/'xiamen-operations-05-extras.json'
runner.BASELINE=ROOT/'xiamen-operations-05-baseline.json'
runner.TARGETS,runner.UNASSIGNED={EID},{5669,6179,6243}
runner.FORBIDDEN_PHRASES=['有集福马打卡和瞬时剧场',"春节可骑行打卡'集福马'活动",'上午逛集美大社，打卡楚雨荨家','海上列车景观，坐左边靠窗']
runner.PRESERVED_TARGET_PAYLOAD_FIELDS=[*helper.FIELDS,'typicalVisitMinutes','images','coverImage','imageGallery','amapPhoto']
FACT_QUOTES={5352:'📍集美学村/十里长堤：两个地方很近 如果是到🚄厦门北 地铁30分钟就到这里 上午逛逛集美大社 打卡楚雨荨家 再到十里长堤吹吹海风 很舒服',
    6318:'下午📍集美学村\n返回市区后，去坐地铁1号线。从高崎站到【 集美学村 】站这一段，会穿过海面，是宫崎骏动漫同款的“海上列车”，记得坐左边靠窗！[派对R]'}

def inputs():
    raw=runner.SNAPSHOT.read_bytes()
    frozen=next(c for c in json.loads(raw)['cities'] if c['city']=='厦门')
    entity=next(e for e in frozen['entities'] if e['entity_id']==EID)
    assert entity['revision']==1 and entity['primary_place_id']==SID
    assert sorted(int(k) for k,v in frozen['members'].items() if v==EID)==[SID]
    assert not any(EID in [*s['entity_ids'],*s.get('withdrawal_entity_ids',[])] for s in frozen['scopes'])
    rows=[m for m in frozen['mentions'] if m['entityId']==EID]
    assert len(rows)==len({m['raw_note_id'] for m in rows})==22
    record=json.loads((ROOT/'seven-cities-semantic-readthrough-23.json').read_bytes())
    assert record['snapshotSha256']==hashlib.sha256(raw).hexdigest()
    reviewed=next(r for r in record['reviews'] if r['entityId']==EID)
    assert {m['id'] for m in rows}=={m['mentionId'] for m in reviewed['mentions']}
    for n in reviewed['noteEvidence']:
        assert hashlib.sha256(frozen['notes'][str(n['noteId'])]['note_desc'].encode()).hexdigest()==n['noteDescSha256']
    quotes=[(1285,'🚇 坐1号线直达【集美学村】站'),(1451,'🆕集美学村春节集福马打卡🔥'),
        (1453,'·集美学村“集福马”打卡骑行'),(1272,FACT_QUOTES[5352]),(1514,FACT_QUOTES[6318]),
        (1514,'在【 集美学村 】和【 集美大社 】逛逛'),(1444,'Day3:集美新村→石鼓路→龙舟池→十里长堤')]
    for nid,quote in quotes: assert quote in frozen['notes'][str(nid)]['note_desc']
    text_notes={n['id']:n for n in frozen['governanceState']['rawNotes']}
    for nid in [1285,1444,1451,1453]:
        assert not any(v.get('has_text') for v in text_notes[nid].get('img_analysis') or [])
    conclusion=('22条/22篇正文已读。6179/6243为春节活动，5669只具名地铁站且后文是集美片区及大社/龙舟池路线，原图片文字无另一学村游览证据，三条隔离待审，不建活动或交通实体。'
      '5352和6318同篇各有明确学村路线/游览身份，保留归属，只排除大社楚雨荨家、列车座位景观的reason/evidence_text。其余17条字段、立场与观点完全保持。'
      '5756原文写集美新村，无图片文字补证，本次不扩别名或伪造学村原文，保留原有限路线归属及描述待核；5321、5914、6729、6866的组成范围与混合表述继续列待办，不声称所有边界闭合。'
      '原学村根、地点类型、位置、别名和旧免费资料保持，不并入集美大社、石鼓路、嘉庚公园、纪念馆或站点。既有图片文字仅用于来源绑定，不审核照片或确认当前营业。')
    evidence=[{'kind':'reviewed_attraction_source_scope','snapshotSha256':hashlib.sha256(raw).hexdigest(),
      'file':str(Path(__file__).relative_to(ROOT.parents[3])),'reviewedNotes':reviewed['noteEvidence'],
      'existingImageTextEvidence':reviewed['additionalImageTextEvidence'],
      'noteQuotes':[{'noteId':n,'quote':q} for n,q in quotes],'conclusion':conclusion}]
    source=next(s for s in frozen['sources'] if s['id']==SID)
    assignments=[{'mentionId':m['id'],'inputHash':m['inputHash'],'entityId':None if m['id'] in runner.UNASSIGNED else EID} for m in rows]
    for a in assignments:
        if a['mentionId'] in FACT_QUOTES:
            a['factExclusions']={field:{'reason':'subject_mismatch','quote':FACT_QUOTES[a['mentionId']]} for field in ['reason','evidence_text']}
    preservation=helper.operational_request(frozen,EID,json.loads(runner.BASELINE.read_bytes()))
    preservation['evidence'][0].update(file=str(Path(__file__).relative_to(ROOT.parents[3])),
      conclusion='原免费投影来自note1319图片索引2，另完整绑定1246/4及1329/4匹配文字及原选择顺序；只保全旧运营投影，不恢复被隔离的活动/站点事实或声称现行政策核实。')
    assert len(preservation['sources'])==3
    hashes=json.loads((ROOT/'operational-install-ready-01.json').read_bytes())['implementationFiles']
    assert all(hashlib.sha256((Path('D:/Project/xhs-travel-pipeline')/name).read_bytes()).hexdigest()==h for name,h in hashes.items())
    evidence.append({'kind':'legacy_operational_preservation_implementation','files':hashes,'conclusion':'沿用112-v2已固定哈希的旧运营保全协议。'})
    scope={'key':'top30-20261010-batch-118-scope-2560','city':'厦门','sourcePlaceId':SID,
      'expectedSourceHash':source_fingerprint(source),'expectedScopeRevision':0,'expectedRevisions':{EID:1},
      'assignments':assignments,'evidence':evidence,'preserveOperationalFacts':[preservation]}
    own=[m for m in rows if m['id'] not in runner.UNASSIGNED]
    expected={'city':'厦门','id':EID,'name':entity['canonical_name'],'revision':2,'verified':True,
      'mentionIds':[m['id'] for m in own],**recommendation_metrics(own)}
    assert expected['mentionCount']==19
    return frozen,[scope],[expected]

original_apply=runner.apply_checked
async def apply_checked(session,frozen,scopes,expected):
    report=await original_apply(session,frozen,scopes,expected)
    catalog=await load_mention_catalog(session,'厦门')
    for m in await load_mention_rows(session,'厦门'):
        if m['id'] not in expected[0]['mentionIds']: continue
        projected=effective_mention(m,catalog.resolve(m))
        expected_row={**m,'fact_value':m['fact_value'] or {}}
        if m['id'] in FACT_QUOTES: expected_row.update(reason=None,evidence_text=None)
        assert projected==expected_row
    assert catalog.catalog.entities[EID]['overrides']==next(e['overrides'] for e in frozen['entities'] if e['entity_id']==EID)
    report['checks'].update(routeIdentityRetainedWithWrongSubjectFactsExcluded=True,otherAssignedOpinionsAndFactsPreserved=True)
    return report
runner.inputs,runner.apply_checked=inputs,apply_checked
if __name__=='__main__':
    try: asyncio.run(runner.main())
    except Exception as error:
        print(json.dumps({'failed':True,'errorType':type(error).__name__,'frames':[
            {'file':Path(f.filename).name,'line':f.lineno,'function':f.name}
            for f in traceback.extract_tb(error.__traceback__) if str(ROOT) in f.filename]},ensure_ascii=False))
        sys.exit(1)
