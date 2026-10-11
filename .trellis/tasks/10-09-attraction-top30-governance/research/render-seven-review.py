"""生成七城当前候选审核名单；不把解析检查或已应用批次计为用户验收。"""
import json
import argparse
import hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent
TASK = ROOT.parent
parser = argparse.ArgumentParser()
parser.add_argument('--ranking', required=True)
parser.add_argument('--snapshot', required=True)
parser.add_argument('--catalog', required=True)
parser.add_argument('--retrieval', required=True)
parser.add_argument('--ledger', required=True)
parser.add_argument('--readthrough', help='逐项原文阅读台账；只有已入账主体才展示已读状态，未读仍为待复核')
parser.add_argument('--batches', nargs='+', required=True)
args = parser.parse_args()
assert not (ROOT / args.ledger).exists(), '不能覆盖历史台账'
readthrough = json.loads((ROOT / args.readthrough).read_bytes()) if args.readthrough else None
if readthrough:
    assert readthrough['snapshotSha256'] == json.loads((ROOT / args.ranking).read_bytes())['snapshotSha256']
read_by_entity = {} if not readthrough else {r['entityId']: r for r in readthrough['reviews']}
RANKING = args.ranking
ranking = json.loads((ROOT / RANKING).read_bytes())
snapshot_bytes = (ROOT / args.snapshot).read_bytes()
snapshot = json.loads(snapshot_bytes)
assert hashlib.sha256(snapshot_bytes).hexdigest() == ranking['snapshotSha256']
catalog = json.loads((ROOT / args.catalog).read_bytes())
retrieval = json.loads((ROOT / args.retrieval).read_bytes())
assert catalog['snapshotSha256'] == ranking['snapshotSha256'] and catalog['passed']
assert retrieval['snapshotSha256'] == ranking['snapshotSha256'] and retrieval['passed']
retrieved = {p['entityId'] for p in retrieval['rows'] if p['passed']}
BATCH_ROOT = ROOT.parents[1] / '10-06-place-identity-governance/research/all-cities'
changes = {}
for batch in args.batches:
    assert not (BATCH_ROOT / f'{batch}-rolled-back.json').exists(), '已撤回批次不能计为当前治理成果'
    assert json.loads((BATCH_ROOT / f'{batch}-applied.json').read_bytes())['apply']
    for d in json.loads((BATCH_ROOT / f'{batch}-decisions.json').read_bytes()):
        changes[d['entityId']] = {'batch': batch, 'kind': '归一' if d['mergeEntityIds'] else
            '别名补齐' if any(e.get('admitMentions') for e in d['evidence']) else
            '类别保持' if any(e.get('kind') == 'preserve_existing_product_category' for e in d['evidence']) else '评分'}
    scope_file = BATCH_ROOT / f'{batch}-scope-decisions.json'
    if scope_file.exists():
        for scope in json.loads(scope_file.read_bytes()):
            for eid in scope['expectedRevisions']:
                existing = changes.get(eid)
                kind = (existing['kind'] + '及来源隔离') if existing and existing['batch'] == batch else '来源隔离'
                changes[eid] = {'batch': batch, 'kind': kind}
WU = '300d2ae16b4e2787a84d7661a06f580e'
differences = sum(p['score'] != p['downstreamScore'] for c in ranking['cities'] for p in c['top30'])
type_file = Path(ranking['classificationFile']).name if ranking.get('classificationFile') else None
type_count = len(json.loads((ROOT / type_file).read_bytes())) if type_file else 0
geography_count = sum(len(c.get('excludedOtherCities', [])) for c in ranking['cities'])
boundary_file = Path(ranking['mentionBoundaryFile']).name if ranking.get('mentionBoundaryFile') else None
boundary_count = len(json.loads((ROOT / boundary_file).read_bytes())) if boundary_file else 0
merged_names = [p['name'] for c in ranking['cities'] for p in c['top30']
                if changes.get(p['entityId'], {}).get('kind', '').startswith('归一')]


def escape(value):
    return str(value).replace('|', '／').replace('\n', ' ')


def line(values):
    return '| ' + ' | '.join(escape(v) for v in values) + ' |'


lines = ['# 剩余七城景点 Top30 人工审核名单', '',
    '状态：进行中。以下为按当前已解析提及评分、去重并应用本轮类型审核后的各城30个候选，共210行；仍存在归属、类型与排名边界待审，不能视为最终已治理前30。北京、济南60行保持原独立名单。', '',
    f"冻结时间：{ranking['capturedAt']}；输入SHA256：`{ranking['snapshotSha256']}`。", '',
    f"[机器排名](research/{RANKING}) · [{type_count}项类型审核](research/{type_file}) · [目录{catalog['totalChecks']}项核验](research/{args.catalog}) · [{len(retrieval['rows'])}项真实召回](research/{args.retrieval})", '',
    '评分：唯一提及ID×2＋推荐提及比例×5＋不同笔记ID×0.5；同分按笔记数、稳定ID排序。缺坐标不静默移出身份榜。旧的美食／购物／住宿治理粗类优先于未更新的源attraction类型。', '',
    f"本报告已应用归一：{'、'.join(merged_names)}。类型审核只决定本任务配额；{geography_count}条已隔离异城主体不占本城配额，原始归属与历史待审仍保留。技术检查不代替主体及原文语义审核。", '',
    f"[逐提及非同体边界](research/{boundary_file})：{boundary_count}条子项、分段、机位或异类主体不计入所列母项的潜在分数，原始未分配/待审状态保持。这不等于已建立正式组成关系或确认了新的具体主体。", '']
problems = ['# 七城剩余问题与继续入口', '',
    '名单口径已验收（2026-10-10，用户答复「验收九城 270 行名单（推荐）」，证据见 research/nine-city-user-acceptance-01.json）；'
    '未决项未关闭，未提交、未归档。以下历史断点段落保留追加当时的表述；目标仍是九城全部按原标准治理。', '',
    '## 下一步', '',
    '1. 继续上海全城候选及补位者原文审核，厘清城隍庙／寺庙与豫园组合、苏州河片段；保留武康大楼、迪士尼度假区／乐园和博物馆不同场馆的边界。',
    '2. 继续厦门、广州、成都、杭州、西安、重庆剩余语义及组成审核。保留沙面公园／堂／大街、黄厝海滨及溪头下、下浩里、钟鼓楼各自边界；已隔离来源不按名称重新补回母项。',
    f'3. 当前仍有{differences}处分数差异；合并及补位后持续重排。只对本轮景点写入范围内的实际有效提及修分。',
    f'4. 本次已绑定{type_count}项类型审核与{geography_count}项异城配额审核；不改变原业务类型或将历史PENDING改为已解决。公开来源以实际抓取正文为准，搜索生成答案不作为独立证据。',
    f"5. 当前缺坐标项单列行程可用性，不借邻近点补位置。本报告覆盖{len(retrieved)}项实际SQL及真实向量参与的混合召回，仍有{sum(len(c['top30']) for c in ranking['cities']) - len(retrieved)}项未覆盖；身份排程通过不代表路线可行性。", '',
    '## 当前各城摘要', '',
    '| 城市 | 候选 | 第30名分数 | 旧分数差异 | 可能影响排名的未决记录 | 缺坐标 |',
    '| --- | ---: | ---: | ---: | ---: | --- |']
ledger = []
for city in ranking['cities']:
    frozen = next(c for c in snapshot['cities'] if c['city'] == city['city'])
    entities = {e['entity_id']: e for e in frozen['entities']}
    problems.append(line([city['city'], len(city['top30']), city['boundaryScore'],
        sum(p['score'] != p['downstreamScore'] for p in city['top30']), len(city['rankAffectingUncertainty']),
        '、'.join(p['name'] for p in city['top30'] if not p['hasCoordinates']) or '无']))
    lines += [f"## {city['city']}", '',
        '| 排名 | 主名 | 推荐分／旧库分 | 提及／笔记 | 已并别名与来源 | 边界与当前审核状态 | 稳定ID |',
        '| ---: | --- | --- | --- | --- | --- | --- |']
    for p in city['top30']:
        own_reviews = [r for r in frozen['reviews'] if p['entityId'] in r['detail'].get('entityIds', [])]
        boundaries = []
        for review in own_reviews:
            verdict = review['detail'].get('assessment', {}).get('verdict')
            if verdict in ['distinct', 'part_of']:
                names = [entities[e]['canonical_name'] for e in review['detail']['entityIds'] if e in entities and e != p['entityId']]
                boundaries.append(('独立：' if verdict == 'distinct' else '组成关系：') + '、'.join(names))
        read = read_by_entity.get(p['entityId'])
        if p['entityId'] in changes:
            change = changes[p['entityId']]
            status = f"{change['batch']}已{change['kind']}，主体/事实未全面审核"
        elif read:
            status = '已逐条读原文，未做来源变更'
        elif p['entityId'] == WU:
            status = '第71批同步补齐／真实召回通过，保留旧事实审核边界'
        else:
            status = '待本轮原文复核；目录解析通过'
        if read and p['entityId'] != WU:
            status += f"；已逐条读原文{len(read['mentions'])}条/{len(read['noteEvidence'])}篇，主体与原文边界已有阅读证据但不等于全部事实已核"
        if not read:
            status += '；目录解析通过' if p['entityId'] in changes else ''
        status += '；实际SQL/向量通过' if p['entityId'] in retrieved else '；本轮实际召回未覆盖'
        issues = [*boundaries, *p['issues']]
        if p.get('reviewedNonEquivalentMentions'):
            issues.append('已核非同体提及' + str([r['mentionId'] for r in p['reviewedNonEquivalentMentions']]) + '不计母项分；源待审保持')
        if not p['hasCoordinates']:
            issues.append('缺坐标，路线定位与可行性未核实；行程可用性按原文走法人工串联、不参与距离排序、不补坐标（口径见七城剩余问题task-6节）')
        state = '；'.join([status, *issues])
        lines.append(line([p['rank'], p['name'], f"{p['score']}／{p['downstreamScore']}",
            f"{p['mentionCount']}／{p['noteCount']}", '、'.join(p['aliases']) + f"；源{p['sourceIds']}", state, p['entityId']]))
        ledger.append({**p, 'reviewStatus': status, 'boundaryReviews': [r['id'] for r in own_reviews],
            'userAcceptance': False, 'taskCompleted': False})
    lines += ['', f"本城原文、历史审核与全部旧ID见冻结快照的`{city['city']}`项；身份库无冲突不等于语义已完成。", '']

for city in ranking['cities']:
    problems += ['', f"## {city['city']} 排名边界待核", '',
        '| 主体 | 当前分 | 保守可能上界 | 未决提及 | 未决审核 |', '| --- | ---: | ---: | --- | --- |']
    for p in city['rankAffectingUncertainty']:
        problems.append(line([p['name'], p['score'], p['potentialScore'], p['uncertainMentionIds'], p['pendingReviewIds']]))
    if not city['rankAffectingUncertainty']:
        problems.append('| 当前算法未识别未决记录，仍须人工核查别名／组成关系 | — | — | — | — |')

(TASK / '七城人工审核名单.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
(TASK / '七城剩余问题.md').write_text('\n'.join(problems) + '\n', encoding='utf-8')
with (ROOT / args.ledger).open('x', encoding='utf-8') as handle:
    json.dump({'rankingFile': RANKING, 'snapshotSha256': ranking['snapshotSha256'],
        'taskCompleted': False, 'userAcceptance': False, 'rows': ledger}, handle, ensure_ascii=False, indent=2)
print(f'{len(ledger)} review rows written, task remains in_progress')
