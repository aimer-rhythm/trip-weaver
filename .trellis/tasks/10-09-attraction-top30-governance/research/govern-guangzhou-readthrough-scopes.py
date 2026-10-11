"""121永庆坊：隔离中秋活动清单参照；广州塔因旧媒体待保全暂缓，不入本批。"""
import asyncio
import hashlib
import importlib.util
import json
import sys
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('scope_runner', ROOT / 'govern-disney-scopes.py')
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)
from app.clean.mention_identity import source_fingerprint, effective_mention
from app.clean.recommendation import recommendation_metrics
from app.clean.legacy_operational_facts import FIELDS
from app.aggregate.mention_identity import load_mention_catalog, load_mention_rows

EID, SID = '8673e17f764a38199f233e82635f94cf', 3272
runner.CITY, runner.BATCH = '广州', 'batch-121'
runner.SNAPSHOT = ROOT / 'snapshot-20261010T031749976332Z/input.json'
runner.EXTRAS = ROOT / 'guangzhou-scope-02-extras.json'
runner.BASELINE = ROOT / 'guangzhou-scope-02-baseline.json'
runner.TARGETS, runner.UNASSIGNED = {EID}, {7694}
runner.FORBIDDEN_PHRASES = ['3、永庆坊月亮桥夜游']
runner.PRESERVED_TARGET_PAYLOAD_FIELDS = [*FIELDS, 'typicalVisitMinutes', 'images', 'coverImage', 'imageGallery', 'amapPhoto']
HELD_TOWER = 'c626d628d8cdec42573c8e72d86ae372'


def inputs():
    raw = runner.SNAPSHOT.read_bytes()
    frozen = next(c for c in json.loads(raw)['cities'] if c['city'] == '广州')
    entity = next(e for e in frozen['entities'] if e['entity_id'] == EID)
    assert entity['revision'] == 1 and entity['primary_place_id'] == SID
    assert sorted(int(k) for k, v in frozen['members'].items() if v == EID) == [SID]
    assert not any(EID in [*s['entity_ids'], *s.get('withdrawal_entity_ids', [])] for s in frozen['scopes'])
    rows = [m for m in frozen['mentions'] if m['entityId'] == EID]
    assert len(rows) == len({m['raw_note_id'] for m in rows}) == 49
    # 广州塔本体有下游旧封面与1项图库，完整scope会触发媒体重控，按既有协议暂缓。
    tower = next(r for r in frozen['downstream'] if r['id'] == HELD_TOWER)
    assert tower['payload']['coverImage'] and len(tower['payload']['imageGallery']) == 1
    record = json.loads((ROOT / 'seven-cities-semantic-readthrough-29.json').read_bytes())
    assert record['snapshotSha256'] == hashlib.sha256(raw).hexdigest()
    reviewed = next(r for r in record['reviews'] if r['entityId'] == EID)
    raw_notes = {n['id']: n for n in frozen['governanceState']['rawNotes']}
    for evidence in reviewed['noteEvidence']:
        nid = evidence['noteId']
        assert hashlib.sha256(json.dumps(raw_notes[nid], ensure_ascii=False, sort_keys=True).encode()).hexdigest() == evidence['rawNoteSha256']
        assert hashlib.sha256(frozen['notes'][str(nid)]['note_desc'].encode()).hexdigest() == evidence['noteDescSha256']
    for nid in [1854, 1616, 1672]:
        assert not raw_notes[nid]['img_analysis']
    quote = '3、永庆坊月亮桥夜游'
    assert quote in frozen['notes']['1854']['note_desc']
    evidence = [{'kind': 'reviewed_attraction_source_scope', 'snapshotSha256': record['snapshotSha256'],
        'file': str(Path(__file__).relative_to(ROOT.parents[3])), 'reviewedNotes': reviewed['noteEvidence'],
        'existingImageTextEvidence': reviewed['existingImageTextEvidence'],
        'noteQuotes': [{'noteId': 1854, 'quote': quote}],
        'conclusion': '7694只在33项中秋活动清单里出现「永庆坊月亮桥夜游」一行，同篇没有永庆坊街区独立游览文字，图片文字为空，null待审；'
        '不新建活动主体，也不把它转给月亮桥。其余48条明确骑楼街区、月亮桥、灯笼街、李小龙祖居与西关小吃游览保持，原负评'
        '（1671/1841人多商业化、1808月亮桥没拍到、1611放弃游览）全部保留；1672/1673/1676/1677/1717/1855/1858/1861等灯会帖'
        '含月亮桥点位、灯笼巷打卡或亮灯时间等街区内容，保留身份，不因节庆词整条隔离。'
        '广州塔c626d628d8cdec42573c8e72d86ae372另有8100/8108/8133住宿窗景与7693活动冠名4条待隔离，'
        '但该主体冻结下游仍有旧封面与1项图库，完整scope会触发媒体重控，按第107批协议先暂缓，不借用名称纠错或放宽媒体门禁绕过。'
        '完整保持原免费/未知营业预约输出及已有图片消费，不虚构运营保全声明或图片已审。'}]
    source = next(s for s in frozen['sources'] if s['id'] == SID)
    assignments = [{'mentionId': m['id'], 'inputHash': m['inputHash'],
        'entityId': None if m['id'] in runner.UNASSIGNED else EID} for m in rows]
    scope = {'key': 'top30-20261010-batch-121-scope-3272', 'city': '广州', 'sourcePlaceId': SID,
        'expectedSourceHash': source_fingerprint(source), 'expectedScopeRevision': 0,
        'expectedRevisions': {EID: 1}, 'assignments': assignments, 'evidence': evidence}
    own = [m for m in rows if m['id'] not in runner.UNASSIGNED]
    expected = {'city': '广州', 'id': EID, 'name': entity['canonical_name'], 'revision': 2, 'verified': True,
        'mentionIds': [m['id'] for m in own], **recommendation_metrics(own)}
    return frozen, [scope], [expected]


original_apply = runner.apply_checked


async def apply_checked(session, frozen, scopes, expected):
    report = await original_apply(session, frozen, scopes, expected)
    catalog = await load_mention_catalog(session, '广州')
    for m in await load_mention_rows(session, '广州'):
        if m['id'] in expected[0]['mentionIds']:
            assert effective_mention(m, catalog.resolve(m)) == {**m, 'fact_value': m['fact_value'] or {}}
    assert {6978, 8020, 8168, 8214, 7809} <= set(expected[0]['mentionIds'])
    assert catalog.catalog.entities[EID]['overrides'] == next(e['overrides'] for e in frozen['entities'] if e['entity_id'] == EID)
    report['checks']['allRemainingFieldsAndUnresolvedBoundariesPreserved'] = True
    return report


runner.inputs, runner.apply_checked = inputs, apply_checked
if __name__ == '__main__':
    try:
        asyncio.run(runner.main())
    except Exception as error:
        print(json.dumps({'failed': True, 'errorType': type(error).__name__, 'frames': [
            {'file': Path(f.filename).name, 'line': f.lineno, 'function': f.name}
            for f in traceback.extract_tb(error.__traceback__)]}, ensure_ascii=False))
        sys.exit(1)
