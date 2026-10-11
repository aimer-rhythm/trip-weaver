"""119曾厝垵：只隔离两条纯住宿来源，保留游览、图片文字补证及原负评。"""
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

EID,SID='10b9c8b67abe7586342c2f769661d7d5',2559
runner.CITY,runner.BATCH='厦门','batch-119'
runner.SNAPSHOT=ROOT/'snapshot-20261010T012326125575Z/input.json'
runner.EXTRAS=ROOT/'xiamen-operations-06-extras.json'
runner.BASELINE=ROOT/'xiamen-operations-06-baseline.json'
runner.TARGETS,runner.UNASSIGNED={EID},{5632,6390}
runner.FORBIDDEN_PHRASES=['性价比住宿选择，离岛交通方便','离海近，适合喜欢散步看海的人住','海边民宿集中，学生党性价比高']
runner.PRESERVED_TARGET_PAYLOAD_FIELDS=[*helper.FIELDS,'typicalVisitMinutes','images','coverImage','imageGallery','amapPhoto']

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
    reviewed=next(r for r in record['reviews'] if r['entityId']==EID)
    previous=next(c for c in json.loads((ROOT/record['snapshotFile']).read_bytes())['cities'] if c['city']=='厦门')
    assert rows==[m for m in previous['mentions'] if m['entityId']==EID]
    for n in reviewed['noteEvidence']:
        nid=str(n['noteId'])
        assert previous['notes'][nid]==frozen['notes'][nid]
        assert hashlib.sha256(frozen['notes'][nid]['note_desc'].encode()).hexdigest()==n['noteDescSha256']
    raw_notes={n['id']:n for n in frozen['governanceState']['rawNotes']}
    old_notes={n['id']:n for n in previous['governanceState']['rawNotes']}
    for nid in [1298,1324,1544,1456]: assert raw_notes[nid]==old_notes[nid]
    assert '曾厝垵是美食街不用逛太久挑重点吃' in raw_notes[1298]['img_analysis'][1]['key_info']['tips']
    assert not any(value for nid in [1324,1544]
        for item in raw_notes[nid].get('img_analysis') or [] if item.get('has_text')
        for value in (item.get('key_info') or {}).values())
    desc=frozen['notes']['1432']['note_desc']
    start=desc.index('必去景点挑6个不踩雷：')
    end=desc.index('学生党性价比选曾厝垵。')+len('学生党性价比选曾厝垵。')
    fact_quote=desc[start:end]
    assert len(fact_quote)<2048
    quotes=[(1324,'性价比党直接住厦门本岛（中山路/曾厝垵）'),
      (1544,'▪️曾厝垵附近：离海近，喜欢散步、看海可以住这里'),(1432,fact_quote),
      (1432,'Day3 植物园+曾厝垵+返程'),(1298,'避坑：别住曾厝垵里面!晚上超吵，而且离核心景点远，性价比低~')]
    for nid,quote in quotes: assert quote in frozen['notes'][str(nid)]['note_desc']
    conclusion=('22条/22篇正文已读，逐字段复用完整笔记，并补核相关原图片文字。5632和6390只有住宿片区参照、无独立游览文字，隔离待审；不新建酒店。'
      '6203同篇明确Day3植物园→曾厝垵路线，保留身份，只排除住宿reason/evidence_text，其他19条全部有效字段与立场保持。'
      '5546正文的住宿负评保留，note1298图片索引1有曾厝垵逛吃及行程时段，不能按仅住宿误隔离；相关旧时段不升级为本轮确认的营业规则。'
      '5732/5769/6078/6849对商业化、拥挤、小吃普通与不推荐专程的负评完整保持，5360/6100/6795村落逛吃身份不因food/market标签删除。'
      '5897仅海边步道、6708黄厝别墅文中的喧闹比较，确切边界继续待核，保持旧归属和原字段，本批不声称全来源已清；曾厝垵站点继续独立，不补坐标或更改类型配额。')
    evidence=[{'kind':'reviewed_attraction_source_scope','snapshotSha256':hashlib.sha256(raw).hexdigest(),
      'file':str(Path(__file__).relative_to(ROOT.parents[3])),'reviewedNotes':reviewed['noteEvidence'],
      'existingImageTextEvidence':reviewed['additionalImageTextEvidence'],
      'noteQuotes':[{'noteId':n,'quote':q} for n,q in quotes],'conclusion':conclusion}]
    source=next(s for s in frozen['sources'] if s['id']==SID)
    assignments=[{'mentionId':m['id'],'inputHash':m['inputHash'],'entityId':None if m['id'] in runner.UNASSIGNED else EID} for m in rows]
    next(a for a in assignments if a['mentionId']==6203)['factExclusions']={field:{'reason':'subject_mismatch','quote':fact_quote} for field in ['reason','evidence_text']}
    preservation=helper.operational_request(frozen,EID,json.loads(runner.BASELINE.read_bytes()))
    preservation['evidence'][0].update(file=str(Path(__file__).relative_to(ROOT.parents[3])),
      conclusion='已追溯9个既有图片文字匹配输入，严格保持原营业/预约投影及unknown，不新增票价。note1298的17:00–19:00实为原行程语境，保全旧输出不表示确认营业时间；不恢复纯住宿错配。')
    assert len(preservation['sources'])==9
    hashes=json.loads((ROOT/'operational-install-ready-01.json').read_bytes())['implementationFiles']
    assert all(hashlib.sha256((Path('D:/Project/xhs-travel-pipeline')/name).read_bytes()).hexdigest()==h for name,h in hashes.items())
    evidence.append({'kind':'legacy_operational_preservation_implementation','files':hashes,'conclusion':'沿用112-v2固定哈希的旧运营投影；不等于现行事实审核。'})
    scope={'key':'top30-20261010-batch-119-scope-2559','city':'厦门','sourcePlaceId':SID,
      'expectedSourceHash':source_fingerprint(source),'expectedScopeRevision':0,'expectedRevisions':{EID:1},
      'assignments':assignments,'evidence':evidence,'preserveOperationalFacts':[preservation]}
    own=[m for m in rows if m['id'] not in runner.UNASSIGNED]
    expected={'city':'厦门','id':EID,'name':entity['canonical_name'],'revision':2,'verified':True,
      'mentionIds':[m['id'] for m in own],**recommendation_metrics(own)}
    assert expected['mentionCount']==20
    return frozen,[scope],[expected]

original_apply=runner.apply_checked
async def apply_checked(session,frozen,scopes,expected):
    report=await original_apply(session,frozen,scopes,expected)
    catalog=await load_mention_catalog(session,'厦门')
    for m in await load_mention_rows(session,'厦门'):
        if m['id'] not in expected[0]['mentionIds']: continue
        expected_row={**m,'fact_value':m['fact_value'] or {}}
        if m['id']==6203: expected_row.update(reason=None,evidence_text=None)
        assert effective_mention(m,catalog.resolve(m))==expected_row
    assert {5546,5732,5769,5897,6078,6203,6708,6849}<=set(expected[0]['mentionIds'])
    assert catalog.catalog.entities[EID]['overrides']==next(e['overrides'] for e in frozen['entities'] if e['entity_id']==EID)
    report['checks'].update(imageTextSupportedVisitAndAllNegativeOpinionsPreserved=True,otherAssignedFactsPreserved=True)
    return report
runner.inputs,runner.apply_checked=inputs,apply_checked
if __name__=='__main__':
    try: asyncio.run(runner.main())
    except Exception as error:
        known_errors={'旧运营投影已经变化，不能按新值伪造保全','来源隔离改变了运营投影，不能恢复被排除的事实',
          '运营保全须完整保持当前匹配来源及顺序，不能漏选、调换或伪造输入','运营保全投影已变化，不能静默恢复旧值或采用新值',
          '当前提及没有可审核的描述文本','事实排除摘录未对应当前提及主体','事实排除摘录须来自当前可用原文'}
        print(json.dumps({'failed':True,'errorType':type(error).__name__,'frames':[
            {'file':Path(f.filename).name,'line':f.lineno,'function':f.name}
            for f in traceback.extract_tb(error.__traceback__)],
            'domainError':str(error) if str(error) in known_errors else None},ensure_ascii=False))
        sys.exit(1)
