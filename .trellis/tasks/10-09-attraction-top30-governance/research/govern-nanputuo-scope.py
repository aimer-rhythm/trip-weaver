"""南普陀34条/30全文；隔离酒店窗景，保留真实入寺及原观点。"""
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

runner.CITY,runner.BATCH='厦门','batch-112'
runner.SNAPSHOT=ROOT/'snapshot-20261009T231058589044Z/input.json'
runner.EXTRAS=ROOT/'xiamen-scope-07-extras.json'
runner.BASELINE=ROOT/'xiamen-scope-07-baseline.json'
EID,SID='d0e0f1dff1caee95784a31c71d9ac46f',2534
runner.TARGETS={EID}
runner.UNASSIGNED={6546}
runner.FORBIDDEN_PHRASES=['从酒店可看到南普陀寺，位置便利']


def inputs():
    raw=runner.SNAPSHOT.read_bytes()
    frozen=next(c for c in json.loads(raw)['cities'] if c['city']=='厦门')
    entity=next(e for e in frozen['entities'] if e['entity_id']==EID)
    assert entity['revision']==3 and entity['primary_place_id']==SID
    assert entity['overrides']['recommendationPolicy']=='resolved_attraction_mentions_v1'
    assert sorted(int(k) for k,v in frozen['members'].items() if v==EID)==[2534,2814]
    assert not any(EID in [*s['entity_ids'],*s.get('withdrawal_entity_ids',[])] for s in frozen['scopes'])
    rows=[m for m in frozen['mentions'] if m['entityId']==EID]
    assert len(rows)==34 and len({m['raw_note_id'] for m in rows})==30
    notes=frozen['notes']
    quotes=[(1435,'酒店房间面积比较大，可以看到厦大，南普陀寺'),
        (1452,'👉🏻朝拜顺序：请香（东山门进来小木屋，可以🆓请一根香）→净手（两侧台阶下荷花池边净手）→点香（左手掌香，右手点香）→敬香'),
        (1452,'2️⃣南普陀大雄宝殿旁（图3）：这边人很多，需要排大长队，怕排队不要在这个领取点！！！'),
        (1452,'‼️‼️在南普陀两侧门口很多假本地人，举着景点卡跟你说去环岛路一日游或者看海豚玩帆船⛵，千万别去，厦门旅游大雷'),
        (1452,'🚗不要自驾，这边太堵了，不要自驾'),
        (1480,'在南普陀寺领了春联——马上有福🧧'),
        (1454,'Day1️⃣：下午抵达【厦门】先去【南普陀寺】走走静心又惬意，晚餐选了【南普陀素食】 清淡适口，爷爷奶奶很喜欢；'),
        (1464,'p7：南普陀寺山上'),
        (1478,'南普陀寺（一定要爬后山）→思明南路【厦门破狱斗争旧址】'),
        (1281,'厦大南门走路五分钟即到🙏免费请香祈福，素饼可以顺手带当伴手礼，后山上顶20分钟能看厦大全景'),
        (1320,'来厦门必逛的南普陀寺，全程免费开放，不用提前预约'),
        (1452,'⚠️南普陀需要提前预约，然后扫码入寺'),
        (1544,'DAY2｜厦门植物园→钟鼓索道→南普陀寺→厦门大学→沙坡尾→鹭江夜游'),
        (1471,'【南普陀寺】闽南人说：一年来南普，三年不受苦！'),
        (1244,'P6 五老峰'),(1569,'🟠五老峰 — 184.8 米')]
    for nid,quote in quotes:
        assert quote in notes[str(nid)]['note_desc'],nid
    evidence=[{'kind':'reviewed_attraction_source_scope','snapshotSha256':hashlib.sha256(raw).hexdigest(),
        'file':str(Path(__file__).relative_to(ROOT.parents[3])),
        'noteQuotes':[{'noteId':nid,'quote':quote} for nid,quote in quotes],
        'reviewedNotes':[{'noteId':nid,'noteDescSha256':hashlib.sha256(notes[str(nid)]['note_desc'].encode()).hexdigest()}
            for nid in sorted({m['raw_note_id'] for m in rows})],
        'additionalBoundaryNotes':[{'noteId':nid,'noteDescSha256':hashlib.sha256(notes[str(nid)]['note_desc'].encode()).hexdigest()}
            for nid in [1244,1569]],
        'conclusion':'34条提及/30篇正文完整阅读，两篇五老峰正文另作只读边界。沿用南普陀/南普陀寺已确认同体，两源联合scope；6546只有双子塔酒店房间窗景，无独立入寺游览，隔离待审。其余33条全部保持effective字段，不新增事实排除。6262—6266同篇既有春联领取又有完整入寺请香礼佛，不能按活动或交通短reason把全篇的正确寺院身份抹掉；邮局旁人少、大殿旁排队、门口假本地人推销及出租车、周边拥堵等原意见保持。排队是具体领取点体验，不泛化全寺；外部揽客警示不改写成寺方行为。6677明确本人到寺领春联，保留实际寺院到访而非仅活动通知，不推广为常设服务或仍有春联。6350寺院游览与6351南普陀素食晚餐分列，保持后者独立，不新建餐饮。6379虽同篇还推荐厦大/南普陀住宿片区，Day2已有明确寺院路线，身份保持。5570寺山上、5956后山、6506南普陀寺爬后山属于原游览语境，保持有限体验；五老峰两条独立提及及主体不归并为寺庙，不把登顶20分钟当寺院独立时长。6410无需预约与6265等需预约均为原社区说法，身份不受影响，当前预约及开放时效未核；不删改其中任何作者观点。6862民间俗语保留为原文，不认定宗教效果。旧名称别名、定位、类别及评分策略保持；南普陀素食、厦大、五老峰、公交站、领取点和外部游览服务不新合并或创建组成关系。'}]
    sources={s['id']:s for s in frozen['sources']}
    scope={'key':'top30-20261010-batch-112-scope-2534','city':'厦门','sourcePlaceId':SID,
        'expectedSourceHash':source_fingerprint(sources[SID]),'expectedScopeRevision':0,
        'sources':[{'sourcePlaceId':sid,'sourceHash':source_fingerprint(sources[sid])} for sid in [2534,2814]],
        'expectedRevisions':{EID:3},'assignments':[{'mentionId':m['id'],'inputHash':m['inputHash'],
            'entityId':None if m['id'] in runner.UNASSIGNED else EID} for m in rows],'evidence':evidence}
    own=[m for m in rows if m['id'] not in runner.UNASSIGNED]
    expected={'city':'厦门','id':EID,'name':entity['canonical_name'],'revision':4,'verified':True,
        'mentionIds':[m['id'] for m in own],**recommendation_metrics(own)}
    assert expected['mentionCount']==33
    return frozen,[scope],[expected]


original_apply_checked=runner.apply_checked


async def apply_checked(session,frozen,scopes,expected):
    report=await original_apply_checked(session,frozen,scopes,expected)
    catalog=await load_mention_catalog(session,'厦门')
    for m in await load_mention_rows(session,'厦门'):
        if m['id'] in expected[0]['mentionIds']:
            assert effective_mention(m,catalog.resolve(m))=={**m,'fact_value':m['fact_value'] or {}}
    assert {5570,5956,6262,6263,6264,6265,6266,6350,6379,6410,6506,6677,6862}.issubset(expected[0]['mentionIds'])
    assert catalog.catalog.entities[EID]['overrides']==next(e['overrides'] for e in frozen['entities'] if e['entity_id']==EID)
    report['checks'].update(originalOpinionsAndVisitsPreserved=True,noFactsRewritten=True,
        existingGeographyCategoryAndScorePolicyPreserved=True)
    return report


runner.inputs,runner.apply_checked=inputs,apply_checked
if __name__=='__main__':
    try:
        if '--apply' in sys.argv:
            assert not (ROOT/'batch-112-operational-preservation-hold.json').exists(), \
                '112运营资料保全未过，禁止应用旧计划；修复后须新版本完整预演。'
        asyncio.run(runner.main())
    except Exception as error:
        print(json.dumps({'failed':True,'errorType':type(error).__name__,'frames':[
            {'file':Path(f.filename).name,'line':f.lineno,'function':f.name}
            for f in traceback.extract_tb(error.__traceback__) if str(ROOT) in f.filename]},ensure_ascii=False))
        sys.exit(1)
