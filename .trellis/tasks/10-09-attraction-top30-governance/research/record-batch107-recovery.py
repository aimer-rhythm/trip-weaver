"""记录失败回滚与鼓浪屿阅读；不计为已治理、不收尾。"""
import hashlib
import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')
ROOT = Path(__file__).resolve().parent
PARENT = ROOT.parents[1] / '10-06-place-identity-governance'
SOURCE = 'snapshot-20261009T220123759512Z/input.json'
raw = (ROOT / SOURCE).read_bytes()
current = json.loads(raw)
sha = hashlib.sha256(raw).hexdigest()
read = lambda path: json.loads(path.read_bytes())
recovery = read(ROOT / 'batch-107-recovery-verification.json')
assert recovery['passed'] and recovery['afterSha256'] == sha
assert read(ROOT / 'strict-media-preview-01/report.json')['passed']
record = read(ROOT / 'seven-cities-semantic-readthrough-06.json')
previous = read(ROOT / record['snapshotFile'])
for r in record['reviews']:
    old = next(c for c in previous['cities'] if c['city'] == r['city'])
    new = next(c for c in current['cities'] if c['city'] == r['city'])
    eid = r['entityId']
    assert old['notes'] == new['notes']
    assert next(e for e in old['entities'] if e['entity_id']==eid) == next(e for e in new['entities'] if e['entity_id']==eid)
    assert [m for m in old['mentions'] if m['entityId']==eid] == [m for m in new['mentions'] if m['entityId']==eid]
    r['reusedAfterFullEntityMentionsAndNotesComparison'] = True
city = next(c for c in current['cities'] if c['city']=='厦门')
eid = '582cedb34ba4cbff94e3481f8e1e9acd'
entity = next(e for e in city['entities'] if e['entity_id']==eid)
mentions = [m for m in city['mentions'] if m['entityId']==eid]
scope = read(PARENT / 'research/all-cities/batch-107-scope-decisions.json')[0]
assert entity['revision']==1 and len(mentions)==53
assert len(scope['evidence'][0]['reviewedNotes'])==50
for note in scope['evidence'][0]['reviewedNotes']:
    assert hashlib.sha256(city['notes'][str(note['noteId'])]['note_desc'].encode()).hexdigest()==note['noteDescSha256']
conclusion = ('53条提及/50篇正文已完整阅读。第107批曾隔离5条活动/服务/酒店窗景并按字段排除3条，'
    '但完整scope触发下游旧封面和1图丢失，已通过双端审计API逆序恢复；当前仍是原53条/134.4分，'
    '旧图片实际消费保持。阅读结论保留为待应用证据，不声称121.73分或48条已生效。'
    '五条拟隔离为6172/6289/6504/6549/6595，6242/6654/6731拟按字段排除；'
    '保留步行累、贵、商业化、防野导及有限路线观点，不合并岛上馆园码头或屿见闽南。'
    '6758来自明确生成文案，不称亲历。需先解决只做身份来源治理时的媒体保全，图片身份未审核。')
record['reviews'].append({'city':'厦门','entityId':eid,'name':'鼓浪屿','expectedRevision':1,
    'identityRetained':True,'fullFactsReviewed':False,'scope':'完整提及与原文身份语境阅读；治理失败已回滚。',
    'mentions':[{'mentionId':m['id'],'inputHash':m['inputHash'],'resolution':m['resolution']} for m in mentions],
    'noteEvidence':scope['evidence'][0]['reviewedNotes'], 'reviewedSourceMentionIds':[m['id'] for m in mentions],
    'conclusion':conclusion,'businessMutationByThisRecord':False,'userAcceptance':False,
    'rolledBackScopeBatch':'batch-107','pendingMentionIds':[6172,6289,6504,6549,6595,6242,6654,6731]})
record.update(snapshotFile=SOURCE,snapshotSha256=sha,
    limits='36项/420当前有效提及阅读；鼓浪屿107已回滚，阅读不等于治理成功、图片审核或用户验收。')
with (ROOT / 'seven-cities-semantic-readthrough-07.json').open('x',encoding='utf-8') as file:
    json.dump(record,file,ensure_ascii=False,indent=2)
for path in [ROOT.parent/'task.json',PARENT/'task.json']:
    task = read(path)
    task['meta']['sevenCityContinuation'].update(latestEntityBatch=106,latestAttemptedEntityBatch=108,
        latestValidatedEntityBatch=106,pendingSyncBatches=[],rolledBackBatches=['batch-107'],accepted=False,
        recoverySnapshot='10-09-attraction-top30-governance/research/'+SOURCE,
        semanticReadthrough='10-09-attraction-top30-governance/research/seven-cities-semantic-readthrough-07.json',
        workingStage='107媒体回归已双端审计恢复，七城完整旧状态核对通过；严格媒体预演正反例及12契约测试通过。正在预演中山路108-v2，未应用。')
    task['notes'] += '\n第107批鼓浪屿因旧媒体回归已完整撤回；七城4036来源/8798提及/1051笔记/3737旧行/201行程恢复，第107批禁止重新同步或计入成功。36项/420条阅读含鼓浪屿50全文。'
    path.write_text(json.dumps(task,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
lines = ['# 本轮逐项原文阅读记录','','36项、420条当前有效提及已阅读；鼓浪屿107失败已回滚，不计入成功治理。','',
    '| 城市 | 地点 | 当前有效提及 | 结论与待办 |','| --- | --- | --- | --- |']
for r in record['reviews']:
    lines.append('| '+' | '.join([r['city'],r['name'],'、'.join(str(m['mentionId']) for m in r['mentions']),r['conclusion'].replace('|','／')])+' |')
lines += ['','证据：[阅读台账](research/seven-cities-semantic-readthrough-07.json)、[107恢复核验](research/batch-107-recovery-verification.json)。','']
(ROOT.parent/'七城本轮原文复核.md').write_text('\n'.join(lines),encoding='utf-8')
note = ('\n## 第107批失败恢复与媒体门禁补强\n\n'+conclusion+'\n\n'
    '七城4036来源、8798提及、1051笔记、3737旧行与201行程逐字段恢复，审计历史保留新增两条已撤回决定。'
    '严格预演验证所有既有媒体字段及facts实际消费，107真实负例被拦、106真实正例通过，12同步契约与研究及全仓typecheck通过。'
    '原107导出/应用/预演工件保留为历史，rolled-back标记阻止同步和人工名单误计。'
    '完整scope共用入口新增下游媒体前置门禁；鼓浪屿与集美大社有旧媒体，来源隔离需另行保全设计。'
    '中山路49篇原文已读，108-v2正在预演；5363抽取全名/正文简称使事实排除门禁不通过，保留正确路线和原描述待核。\n')
for name in ['进展记录.md','七城剩余问题.md']:
    with (ROOT.parent/name).open('a',encoding='utf-8') as file:
        file.write(note)
print(json.dumps({'recoveryRecorded':True,'reviews':len(record['reviews']),
    'currentMentions':sum(len(r['mentions']) for r in record['reviews']),'accepted':False}))
