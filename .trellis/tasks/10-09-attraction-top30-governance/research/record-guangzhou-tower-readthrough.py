"""固化广州塔全实体50条实际全文阅读，不执行业务决定。"""
import hashlib
import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')
ROOT = Path(__file__).resolve().parent
PARENT = ROOT.parents[1] / '10-06-place-identity-governance'
read = lambda p: json.loads(p.read_bytes())
EID = 'c626d628d8cdec42573c8e72d86ae372'
record = read(ROOT / 'seven-cities-semantic-readthrough-27.json')
raw = (ROOT / record['snapshotFile']).read_bytes()
assert hashlib.sha256(raw).hexdigest() == record['snapshotSha256']
city = next(c for c in json.loads(raw)['cities'] if c['city'] == '广州')
before_raw = (ROOT / 'snapshot-20261010T025803181559Z/input.json').read_bytes()
before_city = next(c for c in json.loads(before_raw)['cities'] if c['city'] == '广州')
assert city['notes'] == before_city['notes'], '既有笔记在冻结前后不一致，不能沿用阅读证据'
notes = {n['id']: n for n in city['governanceState']['rawNotes']}
before_notes = {n['id']: n for n in before_city['governanceState']['rawNotes']}
entity = next(e for e in city['entities'] if e['entity_id'] == EID)
rows = [m for m in city['mentions'] if m['entityId'] == EID]
ids = sorted({m['raw_note_id'] for m in rows})
assert entity['revision'] == 1 and entity['primary_place_id'] == 3278
assert entity['canonical_name'] == '广州塔' and entity['aliases'] == ['广州塔']
assert rows == [m for m in before_city['mentions'] if m['entityId'] == EID]
assert len(rows) == len(ids) == 50
for nid in ids:
    assert notes[nid] == before_notes[nid], f'笔记{nid}在冻结前后不一致'

quotes = [
    (1631, '小蛮腰 433 米白云星空观光厅，俯瞰珠江全景超震撼！'),
    (1730, '来了真的别只知道去广州塔下人挤人…'),
    (1881, '个人感觉不值得登塔,排队久、票价贵'),
    (1665, '150块起步，上去就是电梯+观景台，视野没有想象中震撼'),
    (1688, '门票：135元起'),
    (1706, '站在433米的观景台'),
    (1851, '躺在床上就能躺看小蛮腰夜景'),
    (1788, '躺在床上就能饱览塔灯夜景'),
    (1852, '步行可达广州塔，离珠江夜游也很近！'),
    (1854, '广州塔「穿粤记之寻味中秋」游园会'),
    (1855, '塔下广场免费！巨型月亮装置+主题打卡'),
]
for nid, quote in quotes:
    assert nid in ids and quote in city['notes'][str(nid)]['note_desc'], quote

# 同篇1861分列西广场与广场游园会，但这两条提及归属独立根，不属于广州塔本体。
sibling = [(8095, 'b09ddb22ad4ca334ed0b077c94fc6398', '6、广州塔西广场中秋游园会'),
    (8096, 'c953b847433e6a4ad47dad890beecf3a', '7、广州塔广场游园会')]
for mid, owner, quote in sibling:
    row = next(m for m in city['mentions'] if m['id'] == mid)
    assert row['entityId'] == owner != EID and quote in city['notes'][str(row['raw_note_id'])]['note_desc']

conclusion = (
    '50条/50篇正文已读（每条一note，图片文字分析为空）。主体一致：地标塔体、夜景灯光、登塔观景、塔上摩天轮、'
    '珠江夜游与跨年/中秋观景参照，主源3278阅江西路222号位置与正文一致；小蛮腰为正文通用俗称，未新增别名。'
    '负评全部保留并单列：7024/8144塔下人挤人只宜远看、7746与7917登塔排队久票价高且视野不如预期、8262位置偏需顺路；'
    '7192另存元宵灯光秀预约提示、8139另存落日摩天轮排队1.5小时与提前两天购票，均为原作者立场，不据此核实现行票价、'
    '排队时长或预约政策。边界单列：广州塔广场（含西广场）、广州塔站、广州塔摩天轮、广州塔酒店为独立根，'
    '1861同篇把西广场游园会与广场游园会按地点和时间分列，review273西广场/广场范围PENDING、review255站体已被判distinct，'
    '本轮不合并、不改坐标、不创建组成关系。拟隔离待审4条：8100/8108/8133为酒店民宿广告里的窗景或步行可达参照，'
    '正文没有独立游览塔的描述；7693只在节庆活动清单里出现广州塔冠名游园会，无独立游览文字。'
    '7757与7825虽同为活动/路线帖，但分别含塔下广场免费打卡和广州塔→海心桥→珠江夜游推荐路线，保留身份。'
    '不批量改动已验证的其余46条有效字段，' '未做事实、图片、类型或坐标治理。'
)


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


item = {'city': '广州', 'entityId': EID, 'name': entity['canonical_name'], 'expectedRevision': entity['revision'],
    'identityRetained': True, 'fullFactsReviewed': False, 'scope': '全实体50条全文已读；来源/组成/定位边界分别待治理',
    'mentions': [{'mentionId': m['id'], 'inputHash': m['inputHash'], 'resolution': m['resolution']} for m in rows],
    'reviewedSourceMentionIds': [m['id'] for m in rows],
    'noteEvidence': [{'noteId': nid, 'noteDescSha256': hashlib.sha256(city['notes'][str(nid)]['note_desc'].encode()).hexdigest(),
        'fullFrozenNoteSha256': digest(city['notes'][str(nid)]), 'rawNoteSha256': digest(notes[nid])} for nid in ids],
    'existingImageTextEvidence': [{'noteId': nid, 'rawNoteSha256': digest(notes[nid]),
        'textImageIndices': [i for i, value in enumerate(notes[nid]['img_analysis'] or []) if isinstance(value, dict) and value.get('has_text')]} for nid in ids],
    'readSnapshotFile': 'snapshot-20261010T031749976332Z/input.json',
    'reusedAfterFullEntityMentionsAndNotesComparison': True,
    'noteQuotes': [{'noteId': nid, 'quote': quote} for nid, quote in quotes],
    'siblingBoundaryEvidence': [{'mentionId': mid, 'entityId': owner, 'noteId': 1861, 'quote': quote} for mid, owner, quote in sibling],
    'conclusion': conclusion, 'pendingMentionIds': [8100, 8108, 8133, 7693],
    'nextProposedBatch': 'batch-121', 'businessMutationByThisRecord': False, 'userAcceptance': False}
assert not any(r['entityId'] == EID for r in record['reviews'])
record['reviews'].append(item)
count = sum(len(r['mentions']) for r in record['reviews'])
assert len(record['reviews']) == 52 and count == 838
record['limits'] = ('52项/838当前有效提及已读；阅读不等于全来源、同体/组成/定位问题闭合，也不等于各城语义已完成。'
    'batch-120为最新完整验证；未验收、不提交、不归档。')


def write(name, value):
    with (ROOT / name).open('x', encoding='utf-8') as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)


write('seven-cities-semantic-readthrough-28.json', record)
next_evidence = read(ROOT / 'seven-cities-next-evidence-30.json')
next_evidence.update(semanticReadthrough='seven-cities-semantic-readthrough-28.json', nextBatch=121)
next_evidence['remainingReview'][0] = ('广州塔住宿窗景参照8100/8108/8133与活动冠名7693先做完整scope预演；音乐广场/曾厝垵音乐广场同体与两个旧坐标、'
    '玩月坡及海滨商店/设施边界保留待核；继续广州其余候选及成都、杭州、西安、重庆全文治理。')
next_evidence['nextEvidence'].append({'city': '广州', 'entityId': EID, 'pendingMentionIds': item['pendingMentionIds'],
    'conclusion': conclusion})
write('seven-cities-next-evidence-31.json', next_evidence)
lines = ['# 本轮逐项原文阅读记录', '', record['limits'], '', '| 城市 | 地点 | 当前有效提及 | 结论与待办 |', '| --- | --- | --- | --- |']
for review in record['reviews']:
    lines.append('| ' + ' | '.join([review['city'], review['name'],
        '、'.join(str(m['mentionId']) for m in review['mentions']), review['conclusion'].replace('|', '／')]) + ' |')
lines += ['', '证据：[阅读台账](research/seven-cities-semantic-readthrough-28.json)、[下一证据](research/seven-cities-next-evidence-31.json)。', '']
(ROOT.parent / '七城本轮原文复核.md').write_text('\n'.join(lines), encoding='utf-8')
note = record['limits'] + '新增广州塔全实体50条；住宿窗景与活动冠名4条待正式预演。'
for path in [ROOT.parent / 'task.json', PARENT / 'task.json']:
    task = read(path)
    assert task['status'] == 'in_progress' and task['meta']['sevenCityContinuation']['latestValidatedEntityBatch'] == '120'
    task['notes'] = task['notes'] + ' ' + note
    task['meta']['sevenCityContinuation'].update(
        semanticReadthrough='10-09-attraction-top30-governance/research/seven-cities-semantic-readthrough-28.json',
        workingStage=note, accepted=False)
    path.write_text(json.dumps(task, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
for name in ['进展记录.md', '七城剩余问题.md']:
    with (ROOT.parent / name).open('a', encoding='utf-8') as handle:
        handle.write('\n## 广州塔全实体阅读断点\n\n' + note + '\n\n入口：[下一证据](research/seven-cities-next-evidence-31.json)。\n')
print(json.dumps({'readEntities': len(record['reviews']), 'currentMentions': count,
    'newReadEntities': 1, 'newReadMentions': 50, 'pending': item['pendingMentionIds'],
    'latestValidatedBatch': 'batch-120', 'accepted': False}, ensure_ascii=False))
