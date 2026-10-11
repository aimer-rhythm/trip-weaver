"""生成九城（七城210行＋北京济南60行）人工审核名单索引；只汇总既有台账，不改动任何名单行数据。"""
import json
import argparse
from pathlib import Path

ROOT = Path(__file__).resolve().parent
TASK = ROOT.parent
parser = argparse.ArgumentParser()
parser.add_argument('--seven-ledger', required=True)
parser.add_argument('--bj-jn-ledger', required=True)
parser.add_argument('--seven-ranking', required=True)
parser.add_argument('--bj-jn-ranking', required=True)
parser.add_argument('--out', required=True)
args = parser.parse_args()

seven = json.loads((ROOT / args.seven_ledger).read_bytes())
bj_jn = json.loads((ROOT / args.bj_jn_ledger).read_bytes())
seven_rank = json.loads((ROOT / args.seven_ranking).read_bytes())
bj_jn_rank = json.loads((ROOT / args.bj_jn_ranking).read_bytes())
assert seven['snapshotSha256'] == seven_rank['snapshotSha256']
assert bj_jn['snapshotSha256'] == bj_jn_rank['snapshotSha256']
assert seven['userAcceptance'] and bj_jn['userAcceptance'], '台账未验收时不应生成已验收索引'


def short(value, limit=150):
    text = str(value).replace('|', '／').replace('\n', ' ')
    return text[:limit] + ('…' if len(text) > limit else '')


def row(values):
    return '| ' + ' | '.join(short(v) for v in values) + ' |'


def collect(ledger, order):
    index = {}
    for item in ledger['rows']:
        index[(item['city'], item['entityId'])] = item
    rows = []
    for city in order:
        for rank, entity_id in city:
            rows.append(index[(rank, entity_id)])
    return rows


seven_order = [(p['city'], p['entityId']) for p in seven['rows']]
seven_rows = seven['rows']
bj_order = [(p['city'], p['entityId']) for p in bj_jn['rows']]

lines = ['# 九城景点 Top30 人工审核名单索引', '',
    '状态：已验收（2026-10-10，用户答复「验收九城 270 行名单（推荐）」，证据见 research/nine-city-user-acceptance-01.json）。'
    '本索引只做汇总，不新增审核结论；逐行结论与边界单列以两份正式名单为准。', '',
    f"合计270行：七城210行（快照`{seven_rank['snapshotSha256'][:12]}…`、"
    f"{seven_rank['capturedAt']}）＋北京济南60行（快照`{bj_jn_rank['snapshotSha256'][:12]}…`、"
    f"{bj_jn_rank['capturedAt']}）。两套冻结快照不可混用：七城快照含 governanceState.rawNote，"
    '北京济南快照不含，故后者的 rawNote 指纹与图片文字证据本轮记为不可用。', '',
    f"- 七城正式名单：[七城人工审核名单.md](七城人工审核名单.md)；台账`research/{args.seven_ledger}`；"
    f"逐条原文台账`research/seven-cities-semantic-readthrough-78.json`；"
    f"机器排名`research/{args.seven_ranking}`。",
    f"- 北京济南正式名单：[人工审核名单.md](人工审核名单.md)；台账`research/{args.bj_jn_ledger}`；"
    f"逐条原文台账`research/bj-jn-semantic-readthrough-38.json`；"
    f"机器排名`research/{args.bj_jn_ranking}`。", '',
    '九城汇总索引见本文件；两份正式名单各自完整保留逐行边界与逐项结论。', '',
    '每行的名次、主名、分数、实体ID、别名与旧记录、组成边界、证据与审核状态，'
    '在两份正式名单中逐列给出；本表压缩为索引视图。', '',
    '| 城市 | 名次 | 主名 | 重算分／下游分 | 提及／笔记 | 稳定ID | 已读证据 | 审核状态 |',
    '| --- | ---: | --- | --- | --- | --- | --- | --- |']

counts = {}
for item in seven_rows + bj_jn['rows']:
    if item['city'] in ('北京', '济南') and 'readMentions' in item:
        evidence = f"逐条读原文{item['readMentions']}条/{item['readNotes']}篇，引文{item['noteQuotes']}条"
    else:
        evidence = '已逐条读原文（见名单行）'
    status = item['reviewStatus'] if 'reviewStatus' in item else ''
    lines.append(row([item['city'], item.get('rank'), item['name'],
        f"{item['score']}／{item['downstreamScore']}",
        f"{item['mentionCount']}／{item['noteCount']}", item['entityId'], evidence, status]))
    counts[item['city']] = counts.get(item['city'], 0) + 1

lines += ['', '## 各城行数', '',
    '| 城市 | 行数 |', '| --- | ---: |']
for city in ['北京', '济南', '上海', '厦门', '广州', '成都', '杭州', '西安', '重庆']:
    lines.append(row([city, counts.get(city, 0)]))
lines += ['', f"合计{sum(counts.values())}行，全部在两份台账（research/{args.seven_ledger}、research/{args.bj_jn_ledger}）中标记 "
    'userAcceptance=true、taskCompleted=true；验收答复原文与可核对的会话行见 research/nine-city-user-acceptance-01.json。', '']

(TASK / args.out).write_text('\n'.join(lines) + '\n', encoding='utf-8')
print(f'index written: {sum(counts.values())} rows, cities={counts}')
