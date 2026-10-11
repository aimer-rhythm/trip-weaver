"""记录用户对九城270行名单口径的验收：只写新台账文件与名单状态行，不覆盖历史台账。"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
TASK = ROOT.parent
ACCEPTED_AT = '2026-10-10'
SCOPE = ('验收范围：九城各城前30行的原文语义阅读与身份边界记录口径——'
         '每行的名次、主名、分数、实体ID、别名与旧记录、组成边界、证据与审核状态；'
         '未决项（广州来源隔离门禁、鼓浪屿／集美大社媒体方案、杭州住宿参照、成都永陵疑同址、'
         '6处缺坐标、8项算法排名风险、北京济南11项边界待决）仍单列待处置，不因本次验收而关闭。')
MARK = f"已验收（{ACCEPTED_AT}）：{SCOPE}"


def mark_ledger(src, dst, kind):
    data = json.loads((ROOT / src).read_bytes())
    assert not data['userAcceptance'], f'{src} 已验收，不能重复'
    data['userAcceptance'] = True
    data['taskCompleted'] = True
    data['acceptedAt'] = ACCEPTED_AT
    data['acceptanceScope'] = SCOPE
    data['acceptedBy'] = 'user'
    data['supersedes'] = src
    for row in data['rows']:
        row['userAcceptance'] = True
        row['taskCompleted'] = True
    out = ROOT / dst
    assert not out.exists(), '不能覆盖历史台账'
    out.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return len(data['rows'])


seven_rows = mark_ledger('seven-cities-review-ledger-71.json', 'seven-cities-review-ledger-72.json', 'seven')
bj_rows = mark_ledger('bj-jn-review-ledger-01.json', 'bj-jn-review-ledger-02.json', 'bj-jn')


def set_status(path, old_first_line, new_first_line, extra=None):
    text = (TASK / path).read_text(encoding='utf-8')
    assert old_first_line in text, f'{path} 未找到待替换状态行'
    text = text.replace(old_first_line, new_first_line, 1)
    if extra:
        assert extra[0] in text, f'{path} 未找到锚点'
        text = text.replace(extra[0], extra[0] + '\n\n' + extra[1], 1)
    (TASK / path).write_text(text, encoding='utf-8')


set_status('七城人工审核名单.md',
    '状态：进行中。以下为按当前已解析提及评分、去重并应用本轮类型审核后的各城30个候选，共210行；仍存在归属、类型与排名边界待审，不能视为最终已治理前30。北京、济南60行保持原独立名单。',
    f'状态：{MARK} 名单为按当前已解析提及评分、去重并应用本轮类型审核后的各城30个候选，共210行；'
    '归属、类型与排名边界仍按未决项单列。北京、济南60行见[人工审核名单.md](人工审核名单.md)。')

set_status('人工审核名单.md',
    '**当前未达到“每城前30全部治理完成”。下表为当前已解析实体提及重算得到的60个候选，本轮已完成60项逐条读原文，但不等于全部来源、同体／组成／定位问题闭合，仍不能当作60个已完成结果。**',
    f'**{MARK}** 下表为当前已解析实体提及重算得到的60个候选，本轮已完成60项逐条读原文；'
    '全部来源、同体／组成／定位问题中未闭合的部分按未决项单列，不因本次验收而关闭。')

set_status('九城人工审核名单索引.md',
    '状态：进行中，未验收、不提交、不归档。本索引只做汇总，不新增审核结论；逐行结论与边界单列以两份正式名单为准。',
    f'状态：{MARK} 本索引只做汇总，不新增审核结论；逐行结论与边界单列以两份正式名单为准。')

task = json.loads((TASK / 'task.json').read_bytes())
task['meta']['sevenCityContinuation']['accepted'] = True
task['meta']['sevenCityContinuation']['acceptedAt'] = ACCEPTED_AT
task['meta']['sevenCityContinuation']['acceptanceScope'] = SCOPE
task['meta']['sevenCityContinuation']['sevenCitiesLedger'] = '10-09-attraction-top30-governance/research/seven-cities-review-ledger-72.json'
task['meta']['sevenCityContinuation']['bjJnLedger'] = '10-09-attraction-top30-governance/research/bj-jn-review-ledger-02.json'
task['notes'] = task['notes'].rstrip() + (
    f' 用户已验收九城270行名单口径（{ACCEPTED_AT}）：七城台账 seven-cities-review-ledger-72.json、'
    '北京济南台账 bj-jn-review-ledger-02.json 置 userAcceptance/taskCompleted=true；'
    f'{SCOPE}')
(TASK / 'task.json').write_text(json.dumps(task, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

print(json.dumps({'seven_rows': seven_rows, 'bj_rows': bj_rows,
                  'acceptedAt': ACCEPTED_AT, 'taskStatus': task['status']}, ensure_ascii=False))
