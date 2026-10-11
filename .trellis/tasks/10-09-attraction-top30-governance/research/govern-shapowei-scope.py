"""沙坡尾40条/39全文阅读；隔离春节快闪和酒店交通，保留街区游览及正负观点。"""
import asyncio
import hashlib
import importlib.util
import json
import sys
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('scope_runner', ROOT / 'govern-disney-scopes.py')
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)
from app.aggregate.place_identity import apply_decision
from app.aggregate.mention_identity import load_mention_catalog, load_mention_rows
from app.clean.mention_identity import source_fingerprint, effective_mention
from app.clean.recommendation import recommendation_metrics

runner.CITY, runner.BATCH = '厦门', 'batch-109'
runner.SNAPSHOT = ROOT/'snapshot-20261009T221643288652Z/input.json'
runner.EXTRAS = ROOT/'xiamen-scope-04-extras.json'
runner.BASELINE = ROOT/'xiamen-scope-04-baseline.json'
EID, SID = '2caf5439b2ed55aa131dc8a82281f1b2', 2536
runner.TARGETS = {EID}
runner.UNASSIGNED = {6169,6241,6547,6593}
runner.FORBIDDEN_PHRASES = ['有疍家渔歌与民俗表演快闪','疍家歌舞快闪，还有地道小吃',
    '离沙坡尾近，打车7.8分钟即达','离酒店近，打车七八分钟']


def inputs():
    raw = runner.SNAPSHOT.read_bytes()
    frozen = next(c for c in json.loads(raw)['cities'] if c['city']=='厦门')
    entity = next(e for e in frozen['entities'] if e['entity_id']==EID)
    assert entity['revision']==1 and entity['primary_place_id']==SID and entity['overrides']=={}
    assert [int(k) for k,v in frozen['members'].items() if v==EID]==[SID]
    assert not any(EID in [*s['entity_ids'],*s.get('withdrawal_entity_ids',[])] for s in frozen['scopes'])
    rows = [m for m in frozen['mentions'] if m['entityId']==EID]
    notes = frozen['notes']
    assert len(rows)==40 and len({m['raw_note_id'] for m in rows})==39
    quotes = [(1451,'🆕沙坡尾春节疍家渔歌与民俗表演快闪🔥'),
        (1453,'·沙坡尾疍家歌舞快闪（初三前限定）'),
        (1435,'离厦门大学、沙坡尾、白城沙滩打车7.8分钟就到了'),
        (1436,'打车前往沙坡尾、白城沙滩仅需七八分钟'),
        (1355,'沙坡尾没啥意思 秉持着来都来了[睡觉R]'),
        (1279,'✔️可去可不去：沙坡尾/双子塔、中山路、铁路文化公园（3个）'),
        (1317,'但是喜欢拍照打卡的中山路，沙坡尾可以蛮去一下，不用花太多时间在那里。'),
        (1507,'13、沙坡尾也去了，路边景色不错，就是也没啥可吃的。'),
        (1445,'沙坡尾（我去的白天西区未营业，晚上有夜市，也可以选择晚上来）'),
        (1281,'沙坡尾网红店下午两点后去人少很多，错峰打卡'),
        (1272,'然后去沙坡尾 打卡拍照📷非常出片！'),
        (1506,'沙坡尾、幸福路、花🐦市场藏着好多古着屋和咖啡馆，拍照很好看📸'),
        (1520,'🥘沙坡尾：文艺街区，有很多咖啡馆、轻食店和创意闽南菜'),
        (1501,'❹ 沙坡尾（图 6.7）'),
        (1458,'沙坡尾吃闽南小吃')]
    for nid,quote in quotes:
        assert quote in notes[str(nid)]['note_desc'],nid
    evidence = [{'kind':'reviewed_attraction_source_scope','snapshotSha256':hashlib.sha256(raw).hexdigest(),
        'file':str(Path(__file__).relative_to(ROOT.parents[3])),
        'noteQuotes':[{'noteId':nid,'quote':quote} for nid,quote in quotes],
        'reviewedNotes':[{'noteId':nid,'noteDescSha256':hashlib.sha256(notes[str(nid)]['note_desc'].encode()).hexdigest()}
            for nid in sorted({m['raw_note_id'] for m in rows})],
        'conclusion':'40条提及/39篇正文完整阅读。6169/6241只有春节疍家快闪（6241还列食店，无独立街区游览），6547/6593只有双子塔酒店周边可达性，四条null待审，不创建活动酒店餐厅。其余36条街区游览、泛拍照及原观点保留；5356/6820虽标photo_spot但正文是整片游览，不能机械当独立机位删除。5449没啥意思、5728可去可不去、6081商业化与拍照限定、6848路边好看但没啥吃的均保持。5775已实际到沙坡尾，原句只说西区白天未营业；5958是同篇游览后的店铺错峰提醒，均保留原限定，不升级为整片营业规则或实时运营已核实。6794直接描述文艺街区与咖啡馆分布，虽美食栏目仍指向街区；不因美食标题删掉主体。6760原文显式生成城市推荐文案，身份清楚但不称亲历。一般渔港景观、彩色建筑、双子塔视野及艺术西区游览保持，民族路具体机位、双子塔、艺术西区、避风坞与各店不新增合并或正式组成关系。只修来源身份，旧坐标与分类保持，未审核全部商业类型、营业预约或图片。'}]
    source = next(s for s in frozen['sources'] if s['id']==SID)
    scope = {'key':'top30-20261010-batch-109-scope-2536','city':'厦门','sourcePlaceId':SID,
        'expectedSourceHash':source_fingerprint(source),'expectedScopeRevision':0,'expectedRevisions':{EID:1},
        'assignments':[{'mentionId':m['id'],'inputHash':m['inputHash'],
            'entityId':None if m['id'] in runner.UNASSIGNED else EID} for m in rows], 'evidence':evidence}
    own = [m for m in rows if m['id'] not in runner.UNASSIGNED]
    expected = {'city':'厦门','id':EID,'name':entity['canonical_name'],'revision':3,'verified':True,
        'mentionIds':[m['id'] for m in own],**recommendation_metrics(own)}
    assert expected['mentionCount']==36
    runner.ENTITY_DECISIONS = [{'key':'top30-20261010-batch-109-score-2536','city':'厦门','entityId':EID,
        'canonicalName':entity['canonical_name'],'aliases':entity['aliases'],'mergeEntityIds':[],
        'expectedRevisions':{EID:2},'overrides':{'recommendationPolicy':'resolved_attraction_mentions_v1'},
        'evidence':[{'kind':'reviewed_attraction_recommendation_policy','snapshotSha256':hashlib.sha256(raw).hexdigest(),
            'conclusion':'完整scope隔离四条后显式按36条已解析提及绑定评分，避免继续沿用40条原摘要分；名称位置保持。'}]}]
    return frozen,[scope],[expected]


original_apply_checked = runner.apply_checked


async def apply_checked(session,frozen,scopes,expected):
    report = await original_apply_checked(session,frozen,scopes,[{**expected[0],'revision':2}])
    changes = []
    for decision in runner.ENTITY_DECISIONS:
        change = await apply_decision(session,decision)
        assert await apply_decision(session,decision)==change
        changes.append(change)
    report['changes']=changes
    catalog = await load_mention_catalog(session,'厦门')
    assert catalog.catalog.entities[EID]['revision']==3
    for m in await load_mention_rows(session,'厦门'):
        if m['id'] in expected[0]['mentionIds']:
            assert effective_mention(m,catalog.resolve(m))=={**m,'fact_value':m['fact_value'] or {}}
    assert {5356,5449,5728,5775,5958,6081,6760,6794,6820,6848,6863}.issubset(expected[0]['mentionIds'])
    report['checks'].update(originalOpinionsAndVisitsPreserved=True,noFactsRewritten=True,explicitScoreBinding=True)
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
