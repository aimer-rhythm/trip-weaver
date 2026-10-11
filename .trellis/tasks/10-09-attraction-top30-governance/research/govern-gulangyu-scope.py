"""鼓浪屿53提及/50正文阅读；保留登岛身份与负评，隔离活动/服务/窗景。"""
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

runner.CITY, runner.BATCH = '厦门', 'batch-107'
runner.SNAPSHOT = ROOT / 'snapshot-20261009T213645389978Z/input.json'
runner.EXTRAS = ROOT / 'xiamen-scope-02-extras.json'
runner.BASELINE = ROOT / 'xiamen-scope-02-baseline.json'
EID, SID = '582cedb34ba4cbff94e3481f8e1e9acd', 2540
runner.TARGETS = {EID}
runner.UNASSIGNED = {6172, 6289, 6504, 6549, 6595}
runner.FORBIDDEN_PHRASES = ['有艺术高地音乐会', '可观赏漳州港跨年烟花',
    '提供鼓浪屿游玩省钱攻略，并可解答坐船问题', '酒店对面就是鼓浪屿', '酒店落地窗正对鼓浪屿',
    '音乐会全天有', '套票值得，皓月园草坪晒太阳看海舒服', '海岛可穿平底鞋逛玩，海边傍晚舒服']
FACTS = {6242: (['reason'], '·鼓浪屿艺术高地音乐会（假期全天）')}


def inputs():
    raw = runner.SNAPSHOT.read_bytes()
    frozen = next(c for c in json.loads(raw)['cities'] if c['city'] == '厦门')
    assert not any(EID in [*s['entity_ids'], *s.get('withdrawal_entity_ids', [])] for s in frozen['scopes'])
    entity = next(e for e in frozen['entities'] if e['entity_id'] == EID)
    source = next(s for s in frozen['sources'] if s['id'] == SID)
    assert entity['revision'] == 1 and entity['primary_place_id'] == SID and entity['overrides'] == {}
    assert [int(k) for k, v in frozen['members'].items() if v == EID] == [SID]
    rows = [m for m in frozen['mentions'] if m['entityId'] == EID]
    notes = frozen['notes']
    assert len(rows) == 53 and len({m['raw_note_id'] for m in rows}) == 50
    for mid, nid, start, end in [
        (6654, 1519, '🌤️厦门6-7月出行天气指南', '逛完海岛刚好来歇脚。'),
        (6731, 1481, '▪️𝐃𝐚𝐲𝟐：鼓浪屿 + 环海南路日落', '在皓月园草坪上晒太阳看海太舒服了～')]:
        text = notes[str(nid)]['note_desc']
        FACTS[mid] = (['reason', 'evidence_text'], text[text.index(start):text.index(end) + len(end)])
    quotes = [(1451, '🆕鼓浪屿艺术高地音乐会'),
        (1522, '厦门推荐观赏位置：鼓浪屿／双子塔／鹭江码头／演武大桥观景平台／白城沙滩'),
        (1499, '《鼓浪屿》鼓浪屿游玩的省钱攻略'),
        (1435, '对面就是鼓浪屿，楼下吃饭逛商场也能统统满足'),
        (1436, '最惊喜的是视野！超大落地窗直面海景与鼓浪屿，厦大风光也尽收眼底，光是看景就回本'),
        (1453, '2.鼓浪屿船票提前5天在“屿.见厦门”约'),
        (1318, '鼓浪屿一定只花35，不要再花钱了。'),
        (1316, '1️⃣别对鼓浪屿抱太大期待'),
        (1548, '缺点：游客多，商业化重。'),
        (1458, '厦门的新年慢到骨子里！鼓浪屿逛文艺小店，环岛路骑行追日落')]
    for nid, quote in quotes:
        assert quote in notes[str(nid)]['note_desc'], nid
    assert '别只去鼓浪屿' in notes['1267']['note_title']
    assignments = []
    for m in rows:
        a = {'mentionId': m['id'], 'inputHash': m['inputHash'], 'entityId': None if m['id'] in runner.UNASSIGNED else EID}
        if m['id'] in FACTS:
            fields, quote = FACTS[m['id']]
            assert quote in notes[str(m['raw_note_id'])]['note_desc']
            a['factExclusions'] = {field: {'reason': 'subject_mismatch', 'quote': quote} for field in fields}
        assignments.append(a)
    evidence = [{'kind': 'reviewed_attraction_source_scope', 'snapshotSha256': hashlib.sha256(raw).hexdigest(),
        'file': str(Path(__file__).relative_to(ROOT.parents[3])),
        'noteQuotes': [{'noteId': n, 'quote': q} for n, q in quotes],
        'reviewedNotes': [{'noteId': n, 'noteDescSha256': hashlib.sha256(notes[str(n)]['note_desc'].encode()).hexdigest()}
            for n in sorted({m['raw_note_id'] for m in rows})],
        'conclusion': '完整53条提及及50篇正文阅读。6172仅春节艺术高地音乐会、6289仅跨年烟花观赏位置，6504仅主页攻略/答疑服务推广，6549/6595仅双子塔酒店窗景，五条null待审。6242有独立登岛船票预约提醒，保留身份与原预约字段及引文，只排混合音乐会reason。6654正文提出逛完海岛后去屿见闽南，保留有限登岛路线身份，只排整城天气/鞋履和邻接景区描述，不当作独立岛上景观。6731明确鼓浪屿路线，保留身份但排皓月园草坪及多点套票的混合描述。原登岛步行累、物价贵、商业化重与防野导评价保持；5463标题别只去鼓浪屿是有限比较意见，原warning保持，不写成作者认为岛不值得。6758正文显式为生成推荐文案，地名指向明确，原文保留但不称为亲历证据。岛、日光岩、菽庄花园、皓月园、各馆、码头、屿见闽南及海上看金门各自保持，不合并任何组成或活动；旧位置和票务时效未重新核实。'}]
    scope = {'key': 'top30-20261010-batch-107-scope-2540', 'city': '厦门', 'sourcePlaceId': SID,
        'expectedSourceHash': source_fingerprint(source), 'expectedScopeRevision': 0,
        'expectedRevisions': {EID: 1}, 'assignments': assignments, 'evidence': evidence}
    own = [m for m in rows if m['id'] not in runner.UNASSIGNED]
    expected = {'city': '厦门', 'id': EID, 'name': entity['canonical_name'], 'revision': 3, 'verified': True,
        'mentionIds': [m['id'] for m in own], **recommendation_metrics(own)}
    assert expected['mentionCount'] == 48
    runner.ENTITY_DECISIONS = [{'key': 'top30-20261010-batch-107-score-2540', 'city': '厦门',
        'entityId': EID, 'canonicalName': entity['canonical_name'], 'aliases': entity['aliases'],
        'mergeEntityIds': [], 'expectedRevisions': {EID: 2},
        'overrides': {'recommendationPolicy': 'resolved_attraction_mentions_v1'},
        'evidence': [{'kind': 'reviewed_attraction_recommendation_policy', 'snapshotSha256': hashlib.sha256(raw).hexdigest(),
            'conclusion': '完整scope隔离五条来源后，按当前48条有效提及显式绑定评分，防止旧摘要高分沿用。名称、旧ID和位置保持。'}]}]
    return frozen, [scope], [expected]


original_apply_checked = runner.apply_checked


async def apply_checked(session, frozen, scopes, expected):
    report = await original_apply_checked(session, frozen, scopes, [{**expected[0], 'revision': 2}])
    changes = []
    for decision in runner.ENTITY_DECISIONS:
        change = await apply_decision(session, decision)
        assert await apply_decision(session, decision) == change
        changes.append(change)
    report['changes'] = changes
    catalog = await load_mention_catalog(session, '厦门')
    assert catalog.catalog.entities[EID]['revision'] == 3
    assert catalog.catalog.entities[EID]['overrides'] == {'recommendationPolicy': 'resolved_attraction_mentions_v1'}
    for m in await load_mention_rows(session, '厦门'):
        if m['id'] not in expected[0]['mentionIds']:
            continue
        wanted = {**m, 'fact_value': m['fact_value'] or {}}
        if m['id'] in FACTS:
            wanted.update({field: None for field in FACTS[m['id']][0]})
        assert effective_mention(m, catalog.resolve(m)) == wanted
    assert {5463, 5528, 5760, 5961, 6242, 6415, 6654, 6706, 6731, 6758}.issubset(expected[0]['mentionIds'])
    report['checks'].update(originalWarningsPreserved=True, selectiveFactsOnly=True, explicitRecommendationBinding=True)
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
