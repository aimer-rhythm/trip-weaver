"""九城交付自检：核对名单行数、逐条阅读状态、快照绑定与五处口径；只读检查，不写业务数据。"""
import json
import re
import argparse
from pathlib import Path

ROOT = Path(__file__).resolve().parent
TASK = ROOT.parent
parser = argparse.ArgumentParser()
parser.add_argument('--out', default='nine-city-delivery-check-01.json')
args = parser.parse_args()
report = {'task': '10-09-attraction-top30-governance', 'kind': 'nine_city_delivery_check',
          'accepted': True, 'acceptedAt': '2026-10-10', 'acceptedBy': 'user',
          'checks': [], 'failures': []}


def check(name, ok, detail):
    report['checks'].append({'name': name, 'ok': bool(ok), 'detail': detail})
    if not ok:
        report['failures'].append(name)


def table_rows(path):
    text = (TASK / path).read_text(encoding='utf-8')
    return len([l for l in text.splitlines()
                if l.startswith('| ') and not re.match(r'^\|[\s\-:|]+\|$', l)
                and not l.startswith('| 城市 |') and not l.startswith('| 名次 |')
                and not l.startswith('| 排名 |') and not l.startswith('| 主体 |')
                and not l.startswith('| 序号 |')])


seven = json.loads((ROOT / 'seven-cities-review-ledger-72.json').read_bytes())
bj_jn = json.loads((ROOT / 'bj-jn-review-ledger-02.json').read_bytes())
seven_rank = json.loads((ROOT / 'seven-cities-ranking-36.json').read_bytes())
bj_rank = json.loads((ROOT / 'ranking-09.json').read_bytes())
readthrough = json.loads((ROOT / 'bj-jn-semantic-readthrough-38.json').read_bytes())
task = json.loads((TASK / 'task.json').read_bytes())

check('七城台账210行', len(seven['rows']) == 210, len(seven['rows']))
check('七城各城30行', all(sum(1 for r in seven['rows'] if r['city'] == c) == 30
    for c in ['上海', '厦门', '广州', '成都', '杭州', '西安', '重庆']),
    {c: sum(1 for r in seven['rows'] if r['city'] == c) for c in
     ['上海', '厦门', '广州', '成都', '杭州', '西安', '重庆']})
check('北京济南台账60行', len(bj_jn['rows']) == 60, len(bj_jn['rows']))
check('北京济南各城30行', all(sum(1 for r in bj_jn['rows'] if r['city'] == c) == 30
    for c in ['北京', '济南']),
    {c: sum(1 for r in bj_jn['rows'] if r['city'] == c) for c in ['北京', '济南']})
check('北京济南每行逐条读原文', all('已逐条读原文' in r['reviewStatus'] for r in bj_jn['rows']),
    sum(1 for r in bj_jn['rows'] if '已逐条读原文' not in r['reviewStatus']))
check('北京济南每行含实体ID与别名旧记录', all(r['entityId'] and r['legacyIds'] is not None
    and r['aliases'] is not None for r in bj_jn['rows']), 'checked 60 rows')
check('北京济南读账覆盖1029提及', sum(len(r['mentions']) for r in readthrough['reviews']) == 1029,
    sum(len(r['mentions']) for r in readthrough['reviews']))
check('北京济南已用户验收（每行同步标记）',
    bj_jn['userAcceptance'] and bj_jn['taskCompleted'] and all(r['userAcceptance'] for r in bj_jn['rows']),
    bj_jn.get('acceptedAt'))
check('七城已用户验收（每行同步标记）',
    seven['userAcceptance'] and seven['taskCompleted'] and all(r['userAcceptance'] for r in seven['rows']),
    seven.get('acceptedAt'))
check('名单每行已用户验收（七城＋北京济南）',
    all(r['userAcceptance'] for r in seven['rows']) and all(r['userAcceptance'] for r in bj_jn['rows']), '')
check('快照绑定一致（北京济南）',
    bj_jn['snapshotSha256'] == bj_rank['snapshotSha256'] == readthrough['snapshotSha256'],
    bj_jn['snapshotSha256'][:12])
check('快照绑定一致（七城）', seven['snapshotSha256'] == seven_rank['snapshotSha256'],
    seven['snapshotSha256'][:12])
check('两套快照不同（不可混用）', seven['snapshotSha256'] != bj_jn['snapshotSha256'], '')
check('七城名单210数据行', table_rows('七城人工审核名单.md') >= 210,
    table_rows('七城人工审核名单.md'))
check('北京济南名单60数据行', table_rows('人工审核名单.md') >= 60, table_rows('人工审核名单.md'))
check('九城索引270数据行', table_rows('九城人工审核名单索引.md') >= 270,
    table_rows('九城人工审核名单索引.md'))
seven_names = (TASK / '七城人工审核名单.md').read_text(encoding='utf-8')
bj_names = (TASK / '人工审核名单.md').read_text(encoding='utf-8')
check('七城名单无待本轮原文复核', '待本轮原文复核' not in seven_names, '')
check('北京济南名单指向九城索引', '九城人工审核名单索引.md' in bj_names, '')
check('七城名单指向九城索引', '九城人工审核名单索引.md' in seven_names, '')
check('task.json仍in_progress', task['status'] == 'in_progress', task['status'])
check('task.json记录九城索引',
    task['meta']['sevenCityContinuation'].get('nineCityIndex', '').endswith('九城人工审核名单索引.md'),
    task['meta']['sevenCityContinuation'].get('nineCityIndex'))
check('task.json notes含九城收口', '九城收口' in task['notes'], '')
check('task.json meta已记录验收', task['meta']['sevenCityContinuation'].get('accepted') is True,
    task['meta']['sevenCityContinuation'].get('acceptedAt'))
acceptance = json.loads((ROOT / 'nine-city-user-acceptance-01.json').read_bytes())
check('验收范围与未决项声明',
    '未决项' in acceptance['acceptanceScope'] and bool(acceptance['notInScope']), '')
check('验收证据含用户答复原文与会话定位',
    acceptance['answer'] == '验收九城 270 行名单（推荐）'
    and acceptance['sessionEvidence']['lineNumber'] == 1629
    and acceptance['sessionEvidence']['toolName'] == 'ask_user_question'
    and acceptance['accepted'] is True, acceptance['acceptedAt'])
acceptance_session = Path(acceptance['sessionEvidence']['sessionFile'])
check('会话日志文件存在（harness 写入，可第三方核对）', acceptance_session.exists(),
    acceptance['sessionEvidence']['sessionFile'])
status_docs = ['七城人工审核名单.md', '人工审核名单.md', '九城人工审核名单索引.md',
    '进展记录.md', '七城剩余问题.md', '北京济南剩余问题.md',
    '北京济南本轮原文复核.md', '七城本轮原文复核.md']
status_texts = {p: (TASK / p).read_text(encoding='utf-8') for p in status_docs}
check('五处（八份）口径已记录验收', all('已验收' in t for t in status_texts.values()),
    [p for p, t in status_texts.items() if '已验收' not in t])
check('无残留“仍为 false”当前状态行（含无空格写法）',
    not any(re.search(r'仍为\s*false', t) for t in status_texts.values()),
    [p for p, t in status_texts.items() if re.search(r'仍为\s*false', t)])
check('各文档已验收状态行自身不含未验收',
    all('未验收' not in line for t in status_texts.values()
        for line in t.splitlines() if '已验收' in line),
    {p: [line[:80] for line in t.splitlines() if '已验收' in line and '未验收' in line]
     for p, t in status_texts.items()})
check('状态行均引用验收证据或用户答覆原文',
    all(('nine-city-user-acceptance-01.json' in t) or ('验收九城 270 行名单' in t)
        for t in status_texts.values()),
    [p for p, t in status_texts.items()
     if not ('nine-city-user-acceptance-01.json' in t or '验收九城 270 行名单' in t)])
check('验收台账与历史台账并存',
    (ROOT / 'seven-cities-review-ledger-71.json').exists()
    and (ROOT / 'bj-jn-review-ledger-01.json').exists(), '')

report['summary'] = {'checks': len(report['checks']), 'failures': len(report['failures']),
                     'rows': len(seven['rows']) + len(bj_jn['rows']), 'accepted': True,
                     'acceptedAt': report['acceptedAt']}
out = ROOT / args.out
report['reportFile'] = args.out
assert not out.exists(), '不能覆盖历史自检报告'
out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps(report['summary'], ensure_ascii=False))
for item in report['checks']:
    if not item['ok']:
        print('FAIL', item['name'], item['detail'])
