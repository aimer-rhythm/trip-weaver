"""记录90—94批验证和当前继续入口；保持任务进行中，不执行任何Git收尾。"""
import ast
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PARENT = ROOT.parents[1] / '10-06-place-identity-governance'
FLOW = PARENT / 'research/all-cities/flow/run-85'
ranking_bytes = (ROOT / 'seven-cities-ranking-15.json').read_bytes()
ranking = json.loads(ranking_bytes)
flow = json.loads((FLOW / 'report.json').read_bytes())
assert not flow['failures'] and json.loads((FLOW / 'cleanup.json').read_bytes())['removed']
assert (FLOW / 'target-ranking.json').read_bytes() == ranking_bytes
assert all(p['score'] == p['downstreamScore'] for c in ranking['cities'] for p in c['top30'])
cities = []
for city in ranking['cities']:
    coverage = next(c['targetCoverage'] for c in flow['cities'] if c['city'] == city['city'])
    assert coverage['requested'] == coverage['passed'] == 30
    assert coverage['snapshotSha256'] == ranking['snapshotSha256']
    assert coverage['ids'] == [p['entityId'] for p in city['top30']]
    cities.append({'city': city['city'], **coverage})
for name in ['seven-cities-catalog-08.json', 'seven-cities-retrieval-06.json']:
    check = json.loads((ROOT / name).read_bytes())
    assert check['passed'] and check['snapshotSha256'] == ranking['snapshotSha256']
preservation = json.loads((ROOT / 'seven-cities-preservation-07.json').read_bytes())
assert preservation['passed'] and preservation['afterSha256'] == ranking['snapshotSha256']
for batch in range(90, 95):
    directory = PARENT / f'research/all-cities/batch-{batch}/sync-01'
    state = json.loads((directory / 'sync-state.json').read_bytes())
    assert all(c.get('importedAt') and c.get('relationsImportedAt') and c.get('embeddingRunAt') for c in state['cities'].values())
    after = list(directory.glob('post-import-check-*.json'))
    assert after and all(not json.loads(p.read_bytes())['failures'] for p in after)
with (ROOT / 'seven-cities-flow-coverage-05.json').open('x', encoding='utf-8') as handle:
    json.dump({'passed': True, 'run': 'run-85', 'ranking': 'seven-cities-ranking-15.json',
        'rankingSha256': hashlib.sha256(ranking_bytes).hexdigest(), 'failures': 0,
        'temporaryDatabaseRemoved': True, 'cities': cities,
        'limits': '七城210项身份候选/排程/保存/编辑/重访；其他城市仅兼容回归，无外部地图及路线可行性验收。'}, handle, ensure_ascii=False, indent=2)
syntax_files = ['rank.py', 'test_rank.py', 'inspect-seven-cities.py', 'render-seven-review.py',
    'govern-shanghai-temple.py', 'govern-guangzhou-baiyun.py', 'govern-disney-scopes.py',
    'govern-tianquan-scope.py', 'record-batch92-boundaries.py', 'record-batch94-boundary.py',
    'record-batch94-validation.py']
for name in syntax_files:
    ast.parse((ROOT / name).read_text(encoding='utf-8'))
notes = ('第90—94批已应用并完成地点/关系/向量双同步及事后核验，无待同步。'
    '城隍庙全简称归一并隔离8条，16有效提及44.38分；白云山归一并隔离4条，9提及27.5分；'
    '迪士尼两个原根分别隔离酒店/门口机位，乐园4提及15分、度假区1提及7.5分；'
    '田子坊补位并修分为3提及12.5分；天泉广场隔离1机位并排除2条路线事实，6提及20分。'
    'ranking15七城210项分差0，6911目录检查、210召回覆盖（4新测/206完整行复用）、flow85的210目标通过。'
    '4036原来源、8798提及、1051笔记、3737旧行、309旧媒体字段及201行程保全；24测试/28子测试通过。'
    '26条非同体边界已绑定；仍6项潜在排名风险和6处缺坐标，完整语义未完成。未验收不提交归档。')
for path in [ROOT.parent / 'task.json', PARENT / 'task.json']:
    task = json.loads(path.read_bytes())
    assert task['status'] == 'in_progress' and task['completedAt'] is None
    task['notes'] = notes
    task['meta']['sevenCityContinuation'].update(latestEntityBatch=94, latestFlowRun=85,
        pendingSyncBatches=[], ranking='10-09-attraction-top30-governance/research/seven-cities-ranking-15.json',
        accepted=False, latestAppliedBatches=[f'batch-{b}' for b in range(90, 95)])
    path.write_text(json.dumps(task, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
snapshot = json.loads((ROOT / 'snapshot-20261009T184019187146Z/input.json').read_bytes())
new_evidence = []
for city_name, mids, quote, conclusion in [
    ('上海', [10357], '酒店紧挨着苏州河，傍晚沿河散步巨舒服', '酒店广告位置参照仍计入苏州河；待正式scope隔离，不能仅改排名。其他河岸/路线片段保持review6，不直接同义合并。'),
    ('西安', [12030, 12352], 'P8、P9➡️大唐不夜城牡丹亭茶叙门口处', '同篇两提及均为指定商户门口机位，待正式scope；不能当整个景区的独立游览推荐。'),
    ('西安', [12473], '看中的摄影师有档期，拍了一套，看到样片的第一秒已经爱上了', '评价摄影服务，地点仅在大唐不夜城/大唐芙蓉园标签中，待scope厘清，不据标签归景区推荐。'),
    ('西安', [12504], '238=服装任选+精致妆造（不含拍摄）', '未具名商户妆造服务广告，不等同整个景区；待正式scope隔离，不新增域外商户。'),
    ('西安', [12019], '5.大唐不夜城夜市\n❌ 雷点：价格昂贵，小吃性价比低，多数为连锁店', '已有夜市独立市场根仍只读，负评保留；明确不能并入景区事实，但原文缺具体夜市边界，review382保持。'),
]:
    city = next(c for c in snapshot['cities'] if c['city'] == city_name)
    for mid in mids:
        mention = next(m for m in city['mentions'] if m['id'] == mid)
        assert quote in city['notes'][str(mention['raw_note_id'])]['note_desc']
        new_evidence.append({'city': city_name, 'mentionId': mid, 'noteId': mention['raw_note_id'],
            'entityId': mention['entityId'], 'inputHash': mention['inputHash'], 'quote': quote,
            'conclusion': conclusion, 'businessMutation': False})
with (ROOT / 'seven-cities-next-evidence-04.json').open('x', encoding='utf-8') as handle:
    json.dump({'snapshotSha256': ranking['snapshotSha256'], 'evidence': new_evidence,
        'shujinFetch': {'files': ['shujin-fetch-03.json', 'shujin-fetch-04.json'], 'ok': False,
            'conclusion': '两个地图抓取终态均network_error且无正文；不作同体证据。裸名馆原文无馆址，保持两馆独立与review313。'}}, handle, ensure_ascii=False, indent=2)
with (ROOT / 'batch90-94-attempt-notes.json').open('x', encoding='utf-8') as handle:
    json.dump({'attempts': [
        {'step': 'ranking14 retrieval reuse', 'passed': False, 'reason': '田子坊score12.5与实库10不一致；未生成复用报告，后由93批修正。'},
        {'step': 'score plan filename', 'passed': False, 'reason': '旧seven-cities-score-plan-03已存在，拒绝覆盖；误读旧计划的预演又被旧报告保护拦下，无业务写入，改用batch93-score-plan。'},
        {'step': 'batch94 preview-01', 'passed': True, 'limit': '复用预演器的导出文件名仍写上海，实际内容为厦门；修正城市文件名后完整重跑preview-02并以02应用。'},
        {'step': 'flow84', 'passed': True, 'limit': '身份流程基于93批前ranking14，不能代替补位评分验证；最终改用flow85与ranking15。'}],
        'noCommitOrArchive': True}, handle, ensure_ascii=False, indent=2)
print(json.dumps({'flowTargets': sum(c['passed'] for c in cities), 'syntaxFiles': len(syntax_files),
    'newEvidenceMentions': len(new_evidence), 'tasksRemainInProgress': True}))
