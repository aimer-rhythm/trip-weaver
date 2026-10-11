"""厦大28提及/27篇已读，酒店参照隔离预演须同时保全旧运营资料。"""
import asyncio
import hashlib
import importlib.util
import json
import sys
import traceback
from pathlib import Path

ROOT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('scope_runner',ROOT/'govern-disney-scopes.py')
runner=importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)
from app.clean.mention_identity import source_fingerprint,effective_mention
from app.clean.recommendation import recommendation_metrics
from app.aggregate.mention_identity import load_mention_catalog,load_mention_rows

runner.CITY,runner.BATCH='厦门','batch-114'
runner.SNAPSHOT=ROOT/'snapshot-20261009T233649612752Z/input.json'
runner.EXTRAS=ROOT/'xiamen-scope-08-extras.json'
runner.BASELINE=ROOT/'xiamen-scope-08-baseline.json'
EID,SID='cbe09e6c7cf0420523c91d5361069f6a',2554
runner.TARGETS={EID}
runner.UNASSIGNED={6545,6596}
runner.FORBIDDEN_PHRASES=['从酒店可看到厦大','从酒店可俯瞰厦大校园风光']
runner.PRESERVED_TARGET_PAYLOAD_FIELDS=['openHours','price','reservation','reservationNote',
    'reservationEvidence','typicalVisitMinutes','images','coverImage','imageGallery','amapPhoto']


def inputs():
    raw=runner.SNAPSHOT.read_bytes()
    frozen=next(c for c in json.loads(raw)['cities'] if c['city']=='厦门')
    entity=next(e for e in frozen['entities'] if e['entity_id']==EID)
    assert entity['revision']==1 and entity['primary_place_id']==SID
    assert sorted(int(k) for k,v in frozen['members'].items() if v==EID)==[SID]
    assert not any(EID in [*s['entity_ids'],*s.get('withdrawal_entity_ids',[])] for s in frozen['scopes'])
    rows=[m for m in frozen['mentions'] if m['entityId']==EID]
    note_ids={m['raw_note_id'] for m in rows}
    assert len(rows)==28 and len(note_ids)==27
    record=json.loads((ROOT/'seven-cities-semantic-readthrough-14.json').read_bytes())
    prior=next(c for c in json.loads((ROOT/record['snapshotFile']).read_bytes())['cities'] if c['city']=='厦门')
    known={n['noteId']:n['noteDescSha256'] for r in record['reviews'] if r['city']=='厦门' for n in r['noteEvidence']}
    assert note_ids.issubset(known)
    for nid in note_ids:
        assert prior['notes'][str(nid)]==frozen['notes'][str(nid)]
        assert hashlib.sha256(frozen['notes'][str(nid)]['note_desc'].encode()).hexdigest()==known[nid]
    quotes=[(1435,'酒店房间面积比较大，可以看到厦大，南普陀寺'),
        (1436,'最惊喜的是视野！超大落地窗直面海景与鼓浪屿，厦大风光也尽收眼底，光是看景就回本'),
        (1520,'3⃣️厦门大学：提前3天，线上周一到周五中午及周末开放时间有不同安排')]
    for nid,quote in quotes:
        assert quote in frozen['notes'][str(nid)]['note_desc']
    evidence=[{'kind':'reviewed_attraction_source_scope','snapshotSha256':hashlib.sha256(raw).hexdigest(),
        'file':str(Path(__file__).relative_to(ROOT.parents[3])),
        'reviewedNotes':[{'noteId':nid,'noteDescSha256':known[nid]} for nid in sorted(note_ids)],
        'reusedAfterFullNotesComparison':True,
        'noteQuotes':[{'noteId':nid,'quote':quote} for nid,quote in quotes],
        'conclusion':'28条提及/27篇全文已核，27篇均在前序厦门景点全文阅读并按完整笔记字段和正文哈希复用；本轮重读两篇酒店全文和1520预约清单。6545双子塔酒店窗景/交通参照、6596酒店俯瞰校园，实际推荐住宿，无独立校园游览，隔离待审，不建酒店或机位。其余26条有限校园参观、路线和预约身份保持，5954/5955为同篇不同提及，不假称不同作者；5761南方游客可能觉得一般、6734西门通道太长等负评保持。6790虽出自含屿见闽南推广的多景点笔记，厦大有独立预约条目，不整体按广告删除；不把摇号/预约天数等旧社区说法确认成最新政策。现有根主址思明南路422号，所读嘉庚建筑/芙蓉湖/隧道/白城路线属于本校园语境，不并入校园内文学展馆、纪念像或白城沙滩；全城无另一个厦大裸名根，暂无合并。完整scope必须保全原营业和免费票价及预约资料，若丢失则预演失败且不应用；本轮不伪造媒体或全量运营审核。'}]
    source=next(s for s in frozen['sources'] if s['id']==SID)
    scope={'key':'top30-20261010-batch-114-scope-2554','city':'厦门','sourcePlaceId':SID,
        'expectedSourceHash':source_fingerprint(source),'expectedScopeRevision':0,
        'expectedRevisions':{EID:1},'assignments':[{'mentionId':m['id'],'inputHash':m['inputHash'],
            'entityId':None if m['id'] in runner.UNASSIGNED else EID} for m in rows],
        'evidence':evidence}
    own=[m for m in rows if m['id'] not in runner.UNASSIGNED]
    expected={'city':'厦门','id':EID,'name':entity['canonical_name'],'revision':2,'verified':True,
        'mentionIds':[m['id'] for m in own],**recommendation_metrics(own)}
    assert expected['mentionCount']==26
    return frozen,[scope],[expected]


original_apply_checked=runner.apply_checked


async def apply_checked(session,frozen,scopes,expected):
    report=await original_apply_checked(session,frozen,scopes,expected)
    catalog=await load_mention_catalog(session,'厦门')
    for m in await load_mention_rows(session,'厦门'):
        if m['id'] in expected[0]['mentionIds']:
            assert effective_mention(m,catalog.resolve(m))=={**m,'fact_value':m['fact_value'] or {}}
    assert catalog.catalog.entities[EID]['overrides']==next(e['overrides'] for e in frozen['entities'] if e['entity_id']==EID)
    report['checks'].update(allRetainedOpinionsAndFactsPreserved=True)
    return report


runner.inputs,runner.apply_checked=inputs,apply_checked
if __name__=='__main__':
    try:
        asyncio.run(runner.main())
    except Exception as error:
        print(json.dumps({'failed':True,'errorType':type(error).__name__,'frames':[
            {'file':Path(f.filename).name,'line':f.lineno,'function':f.name}
            for f in traceback.extract_tb(error.__traceback__) if str(ROOT) in f.filename]},ensure_ascii=False))
        sys.exit(1)
