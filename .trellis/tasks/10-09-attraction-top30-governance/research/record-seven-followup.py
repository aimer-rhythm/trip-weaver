"""保存本轮验证覆盖和继续入口；不提交、归档或标记完成。"""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
TASKS = ROOT.parents[1]
FLOW = TASKS / '10-06-place-identity-governance/research/all-cities/flow/run-82'


def load(path): return json.loads(path.read_bytes())


def write_new(path, value):
    with path.open('x', encoding='utf-8') as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)


ranking_bytes = (ROOT / 'seven-cities-ranking-10.json').read_bytes()
ranking = json.loads(ranking_bytes)
flow = load(FLOW / 'report.json')
assert flow['isolated'] and flow['failures'] == [] and load(FLOW / 'cleanup.json')['removed']
assert (FLOW / 'target-ranking.json').read_bytes() == ranking_bytes
coverage = []
for city in ranking['cities']:
    actual = next(c for c in flow['cities'] if c['city'] == city['city'])
    target = actual['targetCoverage']
    assert target['requested'] == target['passed'] == 30
    assert target['ids'] == [p['entityId'] for p in city['top30']]
    probes = {p['id']: p for p in actual['probes']}
    assert all(all(probes[eid][k] for k in ['candidate', 'schedule', 'persistence', 'edit', 'revisit']) for eid in target['ids'])
    coverage.append({'city': city['city'], **target})
write_new(ROOT / 'seven-cities-flow-coverage-03.json', {'passed': True, 'run': 'run-82',
    'ranking': 'seven-cities-ranking-10.json', 'rankingSha256': hashlib.sha256(ranking_bytes).hexdigest(),
    'failures': 0, 'temporaryDatabaseRemoved': True, 'cities': coverage,
    'limits': '明确七城210个原ID的候选/身份排程/保存/编辑/重访检查。其他城市为兼容回归，不扩展治理范围；缺坐标路线可行性未验证。'})

snapshot = load(ROOT / 'snapshot-20261009T171425234590Z/input.json')
reviews = [
    ('厦门', 6042, '傍晚走山海步道盼归塔段', '原文为具名路线段；不能作为整个山海步道的全局同义名，也不能把盼归塔段与塔体合并。'),
    ('成都', 3459, '东郊记忆(南大门)', '原文路线终点为南大门；不能给整个园区增加入口别名。'),
    ('成都', 4178, '主街＝逛吃热闹区', '原文明确分出主街、一街七巷、四大会馆；主街是商业片段，当前继续未分配，不能按normalized_name算给古镇整体。'),
    ('西安', 12305, '兵马俑门票包含骊山园', '原文区分兵马俑和骊山园，本条抽取名带博物院前缀；需逐提及明确与既有兵马俑根的关系，不能归入全博物院。'),
    ('重庆', 1147, '📍祖父的阳台', '本条为远观洪崖洞的具名机位；不能把机位名称登记为洪崖洞全局别名。'),
    ('重庆', 759, '[五R]黄葛古道（崇文门段）', '明确路线段，往返2小时仅描述该段；不把分段名或分钟数扩展为全古道。'),
    ('重庆', 1295, '[五R]黄葛古道（崇文门段）', '与759同篇再次抽取，不是第二篇证据；分段范围及交通文字另核。'),
]
evidence = []
for city_name, mid, quote, conclusion in reviews:
    city = next(c for c in snapshot['cities'] if c['city'] == city_name)
    mention = next(m for m in city['mentions'] if m['id'] == mid)
    assert quote in city['notes'][str(mention['raw_note_id'])]['note_desc']
    evidence.append({'city': city_name, 'mentionId': mid, 'noteId': mention['raw_note_id'],
        'inputHash': mention['inputHash'], 'quote': quote, 'conclusion': conclusion,
        'businessMutation': False, 'resolutionPreserved': mention['resolution']})
write_new(ROOT / 'seven-cities-next-evidence-02.json', {'snapshotSha256': ranking['snapshotSha256'],
    'applied': False, 'evidence': evidence, 'resolvedPreviousItems': [
        '钟楼12132/12488及新增11999已由第86批隔离，原历史待审保留；不能计入塔体当前分数',
        '日光岩5876已由第88批精确别名纳入，不再待审',
        '麓湖CPI商业类型已由cpi-fetch-01实际正文补证，仅退出景点配额',
        '成都note759的26条景点错城来源已做配额资格审核，原scope和PENDING保持'],
    'nextEntityBoundaries': ['上海城隍庙/豫园组合与苏州河段', '厦门山海步道三组名称及天泉广场/步道',
        '广州白云山景区/机位、广州塔广场商业体/西广场', '成都蜀锦两馆及洛带组成',
        '杭州九溪系列与全城别名/组成复核', '西安博物院/兵马俑、夜市范围', '重庆黄葛古道分段/洪崖洞机位']})

notes = ('第86—88批已应用并双同步：西安钟楼归一，3条错配/片区来源隔离及1字段排除；洛带古镇修分7.5；日光岩精确地域别名纳入5876，17提及。'
         '麓湖CPI按抓取正文退出景点配额，成都26条已隔离北京来源退出本城配额但原待审保持。ranking-10七城各30且分数差异0；6903目录检查、210项召回覆盖（4新测/206完整行比对复用）、flow82的210项身份消费及4实体变更范围保全通过。仍有15个潜在排名边界记录及6处缺坐标，完整语义未完成，未验收不提交归档。')
for task_name in ['10-09-attraction-top30-governance', '10-06-place-identity-governance']:
    path = TASKS / task_name / 'task.json'
    task = load(path)
    assert task['status'] == 'in_progress' and task['completedAt'] is None
    task['notes'] = notes
    meta = task['meta']['sevenCityContinuation']
    meta.update(latestEntityBatch=88, latestFlowRun=82, pendingSyncBatches=[],
        ranking='10-09-attraction-top30-governance/research/seven-cities-ranking-10.json',
        accepted=False, latestAppliedBatches=['batch-86', 'batch-87', 'batch-88'])
    path.write_text(json.dumps(task, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print('run82 coverage and next evidence saved; task metadata remains in_progress/unaccepted')
