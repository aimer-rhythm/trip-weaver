"""固化广州永庆坊49条与陈家祠28条实际全文阅读，不执行业务决定。"""
import hashlib
import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')
ROOT = Path(__file__).resolve().parent
PARENT = ROOT.parents[1] / '10-06-place-identity-governance'
read = lambda p: json.loads(p.read_bytes())
record = read(ROOT / 'seven-cities-semantic-readthrough-28.json')
raw = (ROOT / record['snapshotFile']).read_bytes()
assert hashlib.sha256(raw).hexdigest() == record['snapshotSha256']
city = next(c for c in json.loads(raw)['cities'] if c['city'] == '广州')
before_city = next(c for c in read(ROOT / 'snapshot-20261010T025803181559Z/input.json')['cities'] if c['city'] == '广州')
assert city['notes'] == before_city['notes'], '既有笔记在冻结前后不一致，不能沿用阅读证据'
notes = {n['id']: n for n in city['governanceState']['rawNotes']}
before_notes = {n['id']: n for n in before_city['governanceState']['rawNotes']}

cases = [
    ('8673e17f764a38199f233e82635f94cf', 3272, 49, [7694],
     [(1589, '永庆坊晚上打卡月亮桥，亮灯时间19:00-21:50'),
      (1671, '永庆坊人很多，商业色彩比较浓厚'), (1841, '感觉一般，感觉有点商业化'),
      (1672, '月亮桥在粤剧博物馆西门'), (1611, '景点类似北京的南锣鼓巷或上海的田子坊'),
      (1854, '3、永庆坊月亮桥夜游'),
      (1616, '改造升级过后的传统骑楼街区，虽然商业化程度较高，但街区改造得不错，很好逛'),
      (1904, '连带周边的永庆坊可以玩一天')],
     '49条/49篇正文已读（每条一note，图片文字分析为空）。主体一致：恩宁路西关骑楼街区、月亮桥与荔枝湾涌倒影、'
     '灯笼街、李小龙祖居、粤剧艺术博物馆同址区域、美食与非遗小店；主源3272未改，也未新增别名。'
     '负评与未参观意见全部保留：1671/1841明确人多、商业化、只宜消食散步，1808月亮桥没拍到，1611因时间与兴趣放弃并形容为类似南锣鼓巷。'
     '边界单列：粤剧艺术博物馆、李小龙祖居、月亮桥为街区内的场馆/点位而非独立主体，恩宁路、泮塘古村、荔湾湖公园、荔枝湾涌、上下九、沙面各为独立根，'
     '1634同篇把恩宁路骑楼与永庆坊分别描述，1904把泮塘古村与周边永庆坊并列为半日到一日行程；本轮不合并、不创建组成关系、不改坐标。'
     '拟隔离待审1条：7694只在33项中秋活动清单里出现「永庆坊月亮桥夜游」一行，无独立游览文字；'
     '1672/1673/1676/1677/1717/1855/1858/1861等灯会帖虽同为节庆语境，但分别含月亮桥点位、灯笼巷打卡指引或亮灯时间等街区游览内容，保留身份。'
     '未核实灯会起止日期、粤剧演出时刻与票价等现行运营信息。'),
    ('58b7c4cfac4ab4444caf1cecd2aae678', 3280, 28, [],
     [(1611, '是广东现存规模最大、装饰华丽精美、巧夺天工、保存完好的传统岭南祠堂式建筑'),
      (1612, '陈家祠：10r，民间工艺博物馆，精美且保存完整'),
      (1590, '全室内超大空间，木雕/砖雕/灰塑细节绝美'),
      (1628, '陈家祠一定要提前预约，现场排队很久'), (1807, '人山人海，排队绕了好几圈'),
      (1881, '门票10r很值得!岭南建筑的砖雕、灰塑超精美'), (1820, '岭南雕刻工艺古建筑'),
      (1831, '越秀公园 → 中山纪念堂 → 南越王博物院 → 北京路 → 陈家祠')],
     '28条/28篇正文已读（每条一note，图片文字分析为空）。主体一致：岭南祠堂式建筑、陈氏书院/广东民间工艺博物馆同址身份、'
     '三雕两塑一铸一画工艺、门票10元；主源3280未改。负评与劝退保留：1807春节11点门口人山人海排队绕圈，带老人小孩果断放弃；'
     '1591仅称适合大孩子。预约说法同批内不一致：1628写「一定要提前预约」，1611写无需预约、1612/1685写公众号预约，'
     '保持原抽取类型与原文，不据冲突说法确认现行预约或票价政策。'
     '边界单列：广东民间工艺博物馆与陈氏书院是同一祠堂的牌匾与馆名，不新建主体；陈廉伯公馆、陈家祠地铁站、荔湾博物馆、'
     '陈氏书院周边商圈与永庆坊各为独立对象，1590路线把它们按顺序列出而不合并。本轮无拟隔离提及，不改字段、不重排。'),
]

new_reviews = []
def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).hexdigest()

for eid, sid, total, pending, quotes, conclusion in cases:
    assert not any(r['entityId'] == eid for r in record['reviews'])
    entity = next(e for e in city['entities'] if e['entity_id'] == eid)
    assert entity == next(e for e in before_city['entities'] if e['entity_id'] == eid)
    assert entity['revision'] == 1 and entity['primary_place_id'] == sid and entity['aliases'] == [entity['canonical_name']]
    rows = [m for m in city['mentions'] if m['entityId'] == eid]
    assert rows == [m for m in before_city['mentions'] if m['entityId'] == eid]
    ids = sorted({m['raw_note_id'] for m in rows})
    assert len(rows) == len(ids) == total, (entity['canonical_name'], len(rows))
    for nid in ids:
        assert notes[nid] == before_notes[nid], f'笔记{nid}在冻结前后不一致'
        assert not notes[nid]['img_analysis'], '存在图片文字分析，须单独阅读'
    for nid, quote in quotes:
        assert nid in ids and quote in city['notes'][str(nid)]['note_desc'], (entity['canonical_name'], nid, quote)
    item = {'city': '广州', 'entityId': eid, 'name': entity['canonical_name'], 'expectedRevision': entity['revision'],
        'identityRetained': True, 'fullFactsReviewed': False, 'scope': '全实体当前提及全文已读；来源/组成/定位边界分别待治理',
        'mentions': [{'mentionId': m['id'], 'inputHash': m['inputHash'], 'resolution': m['resolution']} for m in rows],
        'reviewedSourceMentionIds': [m['id'] for m in rows],
        'noteEvidence': [{'noteId': nid, 'noteDescSha256': hashlib.sha256(city['notes'][str(nid)]['note_desc'].encode()).hexdigest(),
            'fullFrozenNoteSha256': digest(city['notes'][str(nid)]), 'rawNoteSha256': digest(notes[nid])} for nid in ids],
        'existingImageTextEvidence': [{'noteId': nid, 'rawNoteSha256': digest(notes[nid]), 'textImageIndices': []} for nid in ids],
        'readSnapshotFile': 'snapshot-20261010T031749976332Z/input.json',
        'reusedAfterFullEntityMentionsAndNotesComparison': True,
        'noteQuotes': [{'noteId': nid, 'quote': quote} for nid, quote in quotes],
        'conclusion': conclusion, 'pendingMentionIds': pending,
        'businessMutationByThisRecord': False, 'userAcceptance': False}
    if pending:
        item['nextProposedBatch'] = 'batch-121'
    new_reviews.append(item)

record['reviews'].extend(new_reviews)
count = sum(len(r['mentions']) for r in record['reviews'])
assert len(record['reviews']) == 54 and count == 915, (len(record['reviews']), count)
record['limits'] = ('54项/915当前有效提及已读；阅读不等于全来源、同体/组成/定位问题闭合，也不等于各城语义已完成。'
    'batch-120为最新完整验证；未验收、不提交、不归档。')


def write(name, value):
    with (ROOT / name).open('x', encoding='utf-8') as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)


write('seven-cities-semantic-readthrough-29.json', record)
next_evidence = read(ROOT / 'seven-cities-next-evidence-31.json')
next_evidence.update(semanticReadthrough='seven-cities-semantic-readthrough-29.json', nextBatch=121)
next_evidence['remainingReview'][0] = ('广州批量待预演：广州塔住宿窗景8100/8108/8133、活动冠名7693，永庆坊活动清单7694；'
    '音乐广场/曾厝垵音乐广场同体与两个旧坐标、玩月坡海滨商店/设施边界保留待核；继续广州其余候选及成都、杭州、西安、重庆全文治理。')
for item in new_reviews:
    next_evidence['nextEvidence'].append({'city': '广州', 'entityId': item['entityId'],
        'pendingMentionIds': item['pendingMentionIds'], 'conclusion': item['conclusion']})
write('seven-cities-next-evidence-32.json', next_evidence)
lines = ['# 本轮逐项原文阅读记录', '', record['limits'], '', '| 城市 | 地点 | 当前有效提及 | 结论与待办 |', '| --- | --- | --- | --- |']
for review in record['reviews']:
    lines.append('| ' + ' | '.join([review['city'], review['name'],
        '、'.join(str(m['mentionId']) for m in review['mentions']), review['conclusion'].replace('|', '／')]) + ' |')
lines += ['', '证据：[阅读台账](research/seven-cities-semantic-readthrough-29.json)、[下一证据](research/seven-cities-next-evidence-32.json)。', '']
(ROOT.parent / '七城本轮原文复核.md').write_text('\n'.join(lines), encoding='utf-8')
note = record['limits'] + '新增广州永庆坊49条、陈家祠28条；永庆坊活动清单1条待正式预演。'
for path in [ROOT.parent / 'task.json', PARENT / 'task.json']:
    task = read(path)
    assert task['status'] == 'in_progress' and task['meta']['sevenCityContinuation']['latestValidatedEntityBatch'] == '120'
    task['notes'] = task['notes'] + ' ' + note
    task['meta']['sevenCityContinuation'].update(
        semanticReadthrough='10-09-attraction-top30-governance/research/seven-cities-semantic-readthrough-29.json',
        workingStage=note, accepted=False)
    path.write_text(json.dumps(task, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
for name in ['进展记录.md', '七城剩余问题.md']:
    with (ROOT.parent / name).open('a', encoding='utf-8') as handle:
        handle.write('\n## 广州西关两主体阅读断点\n\n' + note + '\n\n入口：[下一证据](research/seven-cities-next-evidence-32.json)。\n')
print(json.dumps({'readEntities': len(record['reviews']), 'currentMentions': count, 'newReadEntities': 2,
    'newReadMentions': 77, 'pending': {r['name']: r['pendingMentionIds'] for r in new_reviews},
    'latestValidatedBatch': 'batch-120', 'accepted': False}, ensure_ascii=False))
