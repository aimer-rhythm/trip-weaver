"""白城沙滩36篇完整阅读；三源联合，隔离活动及酒店参照，保留全部原观点。"""
import asyncio
import hashlib
import importlib.util
import json
import sys
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('scope_runner', ROOT/'govern-disney-scopes.py')
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)
from app.clean.mention_identity import source_fingerprint, effective_mention
from app.clean.recommendation import recommendation_metrics
from app.aggregate.mention_identity import load_mention_catalog, load_mention_rows

runner.CITY, runner.BATCH = '厦门', 'batch-110'
runner.SNAPSHOT = ROOT/'snapshot-20261009T223050497667Z/input.json'
runner.EXTRAS = ROOT/'xiamen-scope-05-extras.json'
runner.BASELINE = ROOT/'xiamen-scope-05-baseline.json'
EID, SID = '9eca880667ffe616ddea0fa7db4b7049', 2602
runner.TARGETS = {EID}
runner.UNASSIGNED = {6293,6548,6594}
runner.FORBIDDEN_PHRASES = ['适合看烟花和感受跨年氛围','离白城沙滩近，打车7.8分钟即达','离酒店近，打车七八分钟，适合看海']


def inputs():
    raw = runner.SNAPSHOT.read_bytes()
    frozen = next(c for c in json.loads(raw)['cities'] if c['city']=='厦门')
    entity = next(e for e in frozen['entities'] if e['entity_id']==EID)
    assert entity['revision']==3 and entity['primary_place_id']==SID
    assert entity['overrides']['recommendationPolicy']=='resolved_attraction_mentions_v1'
    assert sorted(int(k) for k,v in frozen['members'].items() if v==EID)==[2602,2787,2944]
    assert not any(EID in [*s['entity_ids'],*s.get('withdrawal_entity_ids',[])] for s in frozen['scopes'])
    rows = [m for m in frozen['mentions'] if m['entityId']==EID]
    assert len(rows)==len({m['raw_note_id'] for m in rows})==36
    notes = frozen['notes']
    quotes = [(1522,'厦门推荐观赏位置：鼓浪屿／双子塔／鹭江码头／演武大桥观景平台／白城沙滩'),
        (1435,'离厦门大学、沙坡尾、白城沙滩打车7.8分钟就到了'),
        (1436,'打车前往沙坡尾、白城沙滩仅需七八分钟'),
        (1316,'白城沙滩和黄厝沙滩人超多，体验感一般很差'),
        (1317,'别去厦大白城沙滩人特别多，特别堵。'),
        (1455,'珍珠湾、音乐广场、溪头下、黄厝（白城不要去❌）一路骑行过去'),
        (1260,'沿着环岛路慢慢骑，从黄厝晃到曾厝垵，再往厦大白城走'),
        (1445,'白城校门出去白城沙滩（或者芙蓉隧道出）'),
        (1444,'Day1:厦门科技馆→钟鼓索道→南普陀寺→厦门大学→白城沙滩→沙坡尾'),
        (1505,'椰风寨一路晃到白城沙滩，海岸线有种朦胧滤镜'),
        (1263,'日落在音乐广场、白城沙滩，日出在后面三个沙滩'),
        (1514,'白城沙滩看绝美日落，沙子比较细，可以踩踩水，吹吹海风'),
        (1375,'1️⃣6️⃣白城沙滩'),
        (1377,'白城沙滩（赏暮色）→ 沿海边步道步行 → 演武大桥观景平台（赏夜景'),
        (1547,'傍晚逆光拍剪影，氛围感直接拉满，傍晚人会偏多')]
    for nid,quote in quotes:
        assert quote in notes[str(nid)]['note_desc'], nid
    evidence = [{'kind':'reviewed_attraction_source_scope','snapshotSha256':hashlib.sha256(raw).hexdigest(),
        'file':str(Path(__file__).relative_to(ROOT.parents[3])),
        'noteQuotes':[{'noteId':nid,'quote':quote} for nid,quote in quotes],
        'reviewedNotes':[{'noteId':nid,'noteDescSha256':hashlib.sha256(notes[str(nid)]['note_desc'].encode()).hexdigest()}
            for nid in sorted({m['raw_note_id'] for m in rows})],
        'conclusion':'36条提及/36篇正文完整阅读。沿用白城沙滩、厦大白城、厦大白城沙滩既有同体决定，三源联合scope，不新增合并。6293仅为2025-2026跨年漳州港烟花活动的观赏位置，没有独立沙滩游览；6548/6594仅介绍双子塔酒店周边交通，三条隔离待审，不创建活动或酒店。其余33条保留且不排除或改写任何事实字段。5763人多体验差、6086人多拥堵别去、6482白城不要去的负评保持；5895珍珠湾更安静、6502傍晚偏多等原有限评价保持。5668厦大白城是环岛骑行终点语境，不是乘公交站；5750/5777/6772虽标photo_spot仍是路线和沙滩游览。5777同篇后段明确白城沙滩，开头白石错写不新增别名，也不宣称芙蓉隧道出入口已核。6882照片列表含其他店铺机位，但独立Day1明确白城沙滩及日落，应保留。5978虽有卖车推广，前文单列白城免费摄影目的地，不能因广告删掉地点；6316餐后沙滩游览保持。6236夜游分别列沙滩和演武观景平台，不把1-2小时联游、桥边地址或平台高度转为沙滩独立事实。厦大、校门、公交站、演武大桥观景台、双子塔、珍珠湾、黄厝及整条环岛路保持边界；旧位置和分类保持，未全量核实设施、运营、季节日落或媒体。'}]
    sources = {s['id']:s for s in frozen['sources']}
    scope = {'key':'top30-20261010-batch-110-scope-2602','city':'厦门','sourcePlaceId':SID,
        'expectedSourceHash':source_fingerprint(sources[SID]),'expectedScopeRevision':0,
        'sources':[{'sourcePlaceId':sid,'sourceHash':source_fingerprint(sources[sid])} for sid in [2602,2787,2944]],
        'expectedRevisions':{EID:3},'assignments':[{'mentionId':m['id'],'inputHash':m['inputHash'],
            'entityId':None if m['id'] in runner.UNASSIGNED else EID} for m in rows],'evidence':evidence}
    own = [m for m in rows if m['id'] not in runner.UNASSIGNED]
    expected = {'city':'厦门','id':EID,'name':entity['canonical_name'],'revision':4,'verified':True,
        'mentionIds':[m['id'] for m in own],**recommendation_metrics(own)}
    assert expected['mentionCount']==33
    return frozen,[scope],[expected]


original_apply_checked = runner.apply_checked


async def apply_checked(session,frozen,scopes,expected):
    report = await original_apply_checked(session,frozen,scopes,expected)
    catalog = await load_mention_catalog(session,'厦门')
    for m in await load_mention_rows(session,'厦门'):
        if m['id'] in expected[0]['mentionIds']:
            assert effective_mention(m,catalog.resolve(m))=={**m,'fact_value':m['fact_value'] or {}}
    assert {5668,5750,5763,5777,5895,5978,6086,6236,6316,6482,6502,6772,6882}.issubset(expected[0]['mentionIds'])
    assert catalog.catalog.entities[EID]['overrides']==next(e['overrides'] for e in frozen['entities'] if e['entity_id']==EID)
    report['checks'].update(originalOpinionsAndVisitsPreserved=True,noFactsRewritten=True,
        existingGeographyCategoryAndScorePolicyPreserved=True)
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
