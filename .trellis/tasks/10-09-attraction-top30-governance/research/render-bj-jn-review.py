"""生成北京、济南前30候选人工审核名单（逐条读原文后的版本）；不覆盖任何历史台账 JSON。"""
import json
import re
import argparse
from pathlib import Path

ROOT = Path(__file__).resolve().parent
TASK = ROOT.parent
parser = argparse.ArgumentParser()
parser.add_argument('--ranking', required=True)
parser.add_argument('--snapshot', required=True)
parser.add_argument('--readthrough', required=True)
parser.add_argument('--ledger', required=True)
args = parser.parse_args()

ranking = json.loads((ROOT / args.ranking).read_bytes())
readthrough = json.loads((ROOT / args.readthrough).read_bytes())
assert readthrough['snapshotSha256'] == ranking['snapshotSha256']
snapshot = json.loads((ROOT / args.snapshot).read_bytes())
read_by_entity = {r['entityId']: r for r in readthrough['reviews']}
read_by_name = {(r['city'], r['name']): r for r in readthrough['reviews']}

BOUNDARY_RE = re.compile(r'边界单列：(.*)$', re.S)


def boundary_summary(conclusion, limit=160):
    found = BOUNDARY_RE.search(conclusion)
    if not found:
        return '—'
    body = found.group(1).strip()
    return body[:limit] + ('…' if len(body) > limit else '')


def cell(value):
    return str(value).replace('|', '／').replace('\n', ' ')


def row(values):
    return '| ' + ' | '.join(cell(v) for v in values) + ' |'


head_file = TASK / '人工审核名单.md'
head = head_file.read_text(encoding='utf-8')
marker = head.index('## 北京')
preamble = head[:marker].rstrip() + '\n'
preamble = preamble.replace(
    '**当前未达到“每城前30全部治理完成”。下表为当前已解析实体提及重算得到的60个候选，不能当作60个已完成结果。**',
    '**当前未达到“每城前30全部治理完成”。下表为当前已解析实体提及重算得到的60个候选，'
    '本轮已完成60项逐条读原文，但不等于全部来源、同体／组成／定位问题闭合，仍不能当作60个已完成结果。**')

lines = [preamble.rstrip(), '',
    '## 本轮逐条原文阅读完成情况', '',
    f"北京30项、济南30项全部已按冻结快照逐条读完当前有效提及，合计"
    f"{sum(len(r['mentions']) for r in readthrough['reviews'])}条提及／"
    f"{sum(len(r['noteEvidence']) for r in readthrough['reviews'])}篇正文；"
    f"台账见[research/{args.readthrough}](research/{args.readthrough})，"
    f"逐项结论见[北京济南本轮原文复核.md](北京济南本轮原文复核.md)，"
    f"下一批证据入口见research/bj-jn-next-evidence-39.json。", '',
    '阅读只覆盖同一快照内的当前提及与已读复用笔记：该快照不含 governanceState.rawNote，'
    'rawNote 指纹与图片文字证据记为不可用，图片文字一律另核，不进结论事实。'
    '本轮未改来源、分数与坐标；原文冲突事实（门票、开放时间、地址、预约口径等）各自保留。', '',
    '本表“组成边界摘要”只摘取逐项结论中的边界单列要点，'
    '不构成新增组成关系或主体身份裁定；完整边界原文见各城逐项结论。', '']

ledger_rows = []
problems = ['# 北京、济南剩余问题与继续入口', '',
    '名单口径已验收（2026-10-10，用户答复「验收九城 270 行名单（推荐）」，证据见 research/nine-city-user-acceptance-01.json）；'
    '未决项未关闭，未提交、未归档。以下是当前断点，不是缩小完成标准。', '']

for city in ranking['cities']:
    frozen = next(c for c in snapshot['cities'] if c['city'] == city['city'])
    entities = {e['entity_id']: e for e in frozen['entities']}
    lines += [f"## {city['city']}", '',
        '| 名次 | 主名 | 重算分／下游分 | 提及／笔记 | 现有别名与旧记录 | 组成边界摘要 | 本轮证据 | 稳定ID | 审核状态 |',
        '| ---: | --- | --- | --- | --- | --- | --- | --- | --- |']
    details = [f"### {city['city']}逐项结论", '']
    for p in city['top30']:
        read = read_by_entity.get(p['entityId'])
        assert read is not None, f"未入账：{city['city']}/{p['name']}"
        aliases = '、'.join(p['aliases']) or '—'
        legacy = '、'.join(p['legacyIds'])
        quotes = read['noteQuotes']
        first = f"{quotes[0]['noteId']}「{quotes[0]['quote']}」" if quotes else '—'
        status = (f"已逐条读原文{len(read['mentions'])}条/{len(read['noteEvidence'])}篇，未做来源变更")
        if read['pendingMentionIds']:
            status += f"；待决提及{read['pendingMentionIds']}"
        if p['uncertainMentionIds']:
            status += f"；未确认归属提及{len(p['uncertainMentionIds'])}条不计入本行分数"
        if not p['hasCoordinates']:
            status += '；缺坐标：路线定位与可行性未核实，行程可用性按原文走法人工串联、不补坐标'
        lines.append(row([p['rank'], p['name'], f"{p['score']}／{p['downstreamScore']}",
            f"{p['mentionCount']}／{p['noteCount']}", f"{aliases}；旧记录{legacy}；源{p['sourceIds']}",
            boundary_summary(read['conclusion']), f"引文{len(quotes)}条，例{first}；正文见复核md",
            p['entityId'], status]))
        details += [f"#### {p['rank']}. {p['name']}（稳定ID `{p['entityId']}`）", '',
            read['conclusion'], '']
        ledger_rows.append({'city': city['city'], 'rank': p['rank'], 'name': p['name'],
            'entityId': p['entityId'], 'score': p['score'], 'downstreamScore': p['downstreamScore'],
            'mentionCount': p['mentionCount'], 'noteCount': p['noteCount'],
            'aliases': p['aliases'], 'legacyIds': p['legacyIds'], 'sourceIds': p['sourceIds'],
            'boundarySummary': boundary_summary(read['conclusion'], 400),
            'readMentions': len(read['mentions']), 'readNotes': len(read['noteEvidence']),
            'noteQuotes': len(quotes), 'pendingMentionIds': read['pendingMentionIds'],
            'uncertainMentionIds': p['uncertainMentionIds'], 'hasCoordinates': p['hasCoordinates'],
            'reviewStatus': status, 'userAcceptance': False, 'taskCompleted': False})
    lines += ['', f"本城逐项结论见下节；历史来源、旧ID与全部原始提及见冻结快照`{city['city']}`项。", '']
    lines += details

    problems += [f'## {city["city"]} 排名边界待核', '',
        '| 主体 | 当前分 | 保守可能上界 | 未决提及 | 未决审核 |', '| --- | ---: | ---: | --- | --- |']
    for p in city['rankAffectingUncertainty']:
        problems.append(row([p['name'], p['score'], p['potentialScore'],
            p['uncertainMentionIds'], p['pendingReviewIds']]))
    if not city['rankAffectingUncertainty']:
        problems.append('| 当前算法未识别未决记录，仍须人工核查别名／组成关系 | — | — | — | — |')
    problems.append('')

(TASK / '人工审核名单.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
(TASK / '北京济南剩余问题.md').write_text('\n'.join(problems) + '\n', encoding='utf-8')
with (ROOT / args.ledger).open('x', encoding='utf-8') as handle:
    json.dump({'rankingFile': args.ranking, 'readthroughFile': args.readthrough,
        'snapshotSha256': ranking['snapshotSha256'], 'taskCompleted': False,
        'userAcceptance': False, 'rows': ledger_rows}, handle, ensure_ascii=False, indent=2)
print(f'{len(ledger_rows)} rows written; task remains in_progress')
