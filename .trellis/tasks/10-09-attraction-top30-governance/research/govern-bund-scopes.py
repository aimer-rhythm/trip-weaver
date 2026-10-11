"""外滩与万国建筑群分别治理酒店/餐饮参照，保留区域、建筑群及观景台边界。"""
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
from app.aggregate.mention_identity import load_mention_catalog, load_mention_rows
from app.clean.mention_identity import source_fingerprint, effective_mention
from app.clean.recommendation import recommendation_metrics

BUND = '97930a0a0c32d968eeed64e754e58382'
BUILDINGS = '0700e088ebd6e984525c32fecc476cef'
runner.CITY, runner.BATCH = '上海', 'batch-101'
runner.SNAPSHOT = ROOT / 'snapshot-20261009T194755823218Z/input.json'
runner.EXTRAS = ROOT / 'shanghai-scope-05-extras.json'
runner.BASELINE = ROOT / 'shanghai-scope-05-baseline.json'
runner.TARGETS = {BUND, BUILDINGS}
runner.UNASSIGNED = {10143, 10236, 10336, 10339, 10350, 10990, 11147, 11328, 10353, 10993}
runner.FORBIDDEN_PHRASES = ['地铁直达，可看江景和历史建筑', '酒店位置便利，去外滩和南京路都方便',
    '位于外滩旁，可近距离看三件套', '过马路即达，江景视野好', '靠窗位景观很好',
    '餐厅窗边即可观赏外滩风景', '路线规划合理，不绕路不赶场']
FACT_EXCLUSIONS = {
    9947: 'P15：外滩观景台（北京东路路口红绿灯对面）',
    10260: '📍外滩滨江观景台：蓝调时刻拍摄，万国建筑与对岸陆家嘴灯火同框，夜景大片首选',
    11011: '📍外滩滨江观景台：蓝调时刻拍摄，万国建筑与对岸陆家嘴灯火同框，夜景大片首选',
    11256: '📍外滩广场：正对陆家嘴三件套，傍晚拍日落夜景，万国建筑同框很好看',
}


def inputs():
    raw = runner.SNAPSHOT.read_bytes()
    frozen = next(c for c in json.loads(raw)['cities'] if c['city'] == '上海')
    entities = {e['entity_id']: e for e in frozen['entities']}
    assert not any(runner.TARGETS.intersection([*s['entity_ids'], *s.get('withdrawal_entity_ids', [])]) for s in frozen['scopes'])
    quotes = [
        (2319, '1️⃣外滩\n📍李百蟹・蟹黄面\n📍外滩家宴上海菜'),
        (2282, '和平饭店🔜外滩万国建筑群'),
        (2351, '先来夸夸酒店的位置吧，从酒店出来就是地铁站🚇，去陆家嘴和外滩都很方便'),
        (2352, '2️⃣位置外滩附近，不管是去外滩还是南京路都超方便，全屋智能家居105💰/人'),
        (2354, '出门就是地铁站，就在外滩旁，可以近距离看三件套，东方明珠，黄浦江，还有金碧辉煌的万国建筑群'),
        (2475, '过个马路就是外滩，坐在店里就能看到东方明珠、黄浦江景🌃，晚上万国建筑群亮灯超有氛围'),
        (2477, '靠窗位景观很好…隔壁就是红房子的屋顶'),
        (2464, '外滩22号的景观位复古风李百蟹面馆！！\n窗边就是外滩和东方明珠！还有古风表演'),
        (2480, '吃完直接步行去外滩散步'),
        (2482, '吃完了外滩家宴！还能去外滩散个步'),
        (2459, '🧭顺路怎么玩（这点很加分）吃完可以直接逛：\n豫园 / 城隍庙\n南京路步行街\n外滩夜景'),
        (2296, '从邮政博物馆开始，再到外滩源至外滩'),
        (2281, '国金中心➡️人民广场➡️外滩'),
        (2444, '国金中心➡️人民广场➡️外滩'),
        (2491, '看了无数次的外滩夜景，今天突然想着吃了饭来北外滩消消食'),
        (2508, '在外滩沿路矗立的一片租界时期的房子'),
        (2493, '外滩西侧一排历史老建筑，是上海的标志性景观'),
        (2497, '7️⃣外滩万国建筑'),
    ]
    for nid, quote in quotes:
        assert quote in frozen['notes'][str(nid)]['note_desc'], nid
    generic = frozen['notes']['2474']['note_desc']
    start, end = '这次上海 3 日游，按景点气质分成三条线', 'Day1：城隍庙→豫园→南京路步行街→外滩→浦江游轮'
    FACT_EXCLUSIONS[11236] = generic[generic.index(start):generic.index(end) + len(end)]
    mentions = {m['id']: m for m in frozen['mentions']}
    for mid, quote in FACT_EXCLUSIONS.items():
        assert quote in frozen['notes'][str(mentions[mid]['raw_note_id'])]['note_desc'] and '外滩' in quote
    reviewed_note_ids = sorted({m['raw_note_id'] for m in frozen['mentions'] if m['entityId'] in runner.TARGETS})
    evidence = [{'kind': 'reviewed_attraction_source_scope', 'snapshotSha256': hashlib.sha256(raw).hexdigest(),
        'file': str(Path(__file__).relative_to(ROOT.parents[3])),
        'noteQuotes': [{'noteId': nid, 'quote': quote} for nid, quote in quotes],
        'reviewedNotes': [{'noteId': nid, 'noteDescSha256': hashlib.sha256(frozen['notes'][str(nid)]['note_desc'].encode()).hexdigest()} for nid in reviewed_note_ids],
        'conclusion': '完整读过外滩50条及建筑群8条对应正文。10143是美食片区标题；10336/10339/10350为酒店参照；10990/11147/11328为餐厅位置/窗景；10236明确建筑群，非外滩泛区域，均null待审，不新增或写入餐饮/酒店/机位。建筑群10353酒店视野、10993餐厅窗景隔离；原全简称及独立根保持，不将10236跨scope强行并入。9947/10260/11011/11256同篇有明确外滩路线，保留身份但排除具体观景台/广场的reason/evidence_text；11236排除整份路线说明。11201/11300/11313明确饭后游览外滩，保留；11132是过去多次外滩游览与北外滩对比，也保留。原风大/摄影防骗等警示不改写，原媒体及位置不改。本批没有把沿江区域、建筑群、观景台和北外滩合为一项；外滩旧主源黄浦路199号与正文黄浦区中山东一路存在定位待核，不声明路线位置已验证。'}]
    sources = {s['id']: s for s in frozen['sources']}
    scopes, expected = [], []
    for eid, sid, revision, total in [(BUND, 4654, 2, 50), (BUILDINGS, 4714, 3, 8)]:
        entity = entities[eid]
        assert entity['revision'] == revision and entity['primary_place_id'] == sid
        rows = [m for m in frozen['mentions'] if m['entityId'] == eid]
        assert len(rows) == total
        source_ids = sorted(int(key) for key, value in frozen['members'].items() if value == eid)
        assert source_ids == ([4654] if eid == BUND else [4668, 4714, 5201, 5210])
        assignments = [{'mentionId': m['id'], 'inputHash': m['inputHash'],
            'entityId': None if m['id'] in runner.UNASSIGNED else eid} for m in rows]
        for a in assignments:
            if a['mentionId'] in FACT_EXCLUSIONS:
                a['factExclusions'] = {field: {'reason': 'subject_mismatch', 'quote': FACT_EXCLUSIONS[a['mentionId']]}
                    for field in ['reason', 'evidence_text']}
        scope = {'key': f'top30-20261010-batch-101-scope-{sid}', 'city': '上海', 'sourcePlaceId': sid,
            'expectedSourceHash': source_fingerprint(sources[sid]), 'expectedScopeRevision': 0,
            'expectedRevisions': {eid: revision}, 'assignments': assignments, 'evidence': evidence}
        if len(source_ids) > 1:
            scope['sources'] = [{'sourcePlaceId': s, 'sourceHash': source_fingerprint(sources[s])} for s in source_ids]
        own = [m for m in rows if m['id'] not in runner.UNASSIGNED]
        scopes.append(scope)
        expected.append({'city': '上海', 'id': eid, 'name': entity['canonical_name'], 'revision': revision + 1,
            'verified': True, 'mentionIds': [m['id'] for m in own], **recommendation_metrics(own)})
    assert [p['mentionCount'] for p in expected] == [42, 6]
    return frozen, scopes, expected


original_apply_checked = runner.apply_checked


async def apply_checked(session, frozen, scopes, expected):
    report = await original_apply_checked(session, frozen, scopes, expected)
    catalog = await load_mention_catalog(session, '上海')
    own_ids = {mid for p in expected for mid in p['mentionIds']}
    for mention in await load_mention_rows(session, '上海'):
        if mention['id'] not in own_ids:
            continue
        projected = effective_mention(mention, catalog.resolve(mention))
        wanted = {**mention, 'fact_value': mention['fact_value'] or {}}
        if mention['id'] in FACT_EXCLUSIONS:
            wanted.update(reason=None, evidence_text=None)
        assert projected == wanted
    assert {10020, 10261, 11012, 11033, 11198, 11201, 11300, 11313}.issubset(own_ids)
    report['checks'].update(warningsAndExplicitPostMealWalksPreserved=True,
        onlyBoundSubjectMismatchFactsExcluded=True, buildingAndWaterfrontRootsStaySeparate=True)
    return report


runner.inputs, runner.apply_checked = inputs, apply_checked
if __name__ == '__main__':
    try:
        asyncio.run(runner.main())
    except Exception as error:
        print(json.dumps({'failed': True, 'errorType': type(error).__name__, 'frames': [
            {'file': Path(f.filename).name, 'line': f.lineno, 'function': f.name}
            for f in traceback.extract_tb(error.__traceback__) if str(ROOT) in f.filename]}, ensure_ascii=False))
        sys.exit(1)
