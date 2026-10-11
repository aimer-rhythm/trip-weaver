"""120椰风寨：隔离黄厝方向参照，保留其余身份、旧资料及尚未核定的范围。"""
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

EID, SID = '78c1fde81fb990a665712a8547b66f4b', 2557
runner.CITY, runner.BATCH = '厦门', 'batch-120'
runner.SNAPSHOT = ROOT / 'snapshot-20261010T025803181559Z/input.json'
runner.EXTRAS = ROOT / 'xiamen-scope-09-extras.json'
runner.BASELINE = ROOT / 'xiamen-scope-09-baseline.json'
runner.TARGETS, runner.UNASSIGNED = {EID}, {5663}
runner.FORBIDDEN_PHRASES = ['往椰风寨方向走100米', '人少80%']
runner.PRESERVED_TARGET_PAYLOAD_FIELDS = [*FIELDS, 'typicalVisitMinutes', 'images', 'coverImage', 'imageGallery', 'amapPhoto']


def inputs():
    raw = runner.SNAPSHOT.read_bytes()
    frozen = next(c for c in json.loads(raw)['cities'] if c['city'] == '厦门')
    entity = next(e for e in frozen['entities'] if e['entity_id'] == EID)
    assert entity['revision'] == 1 and entity['primary_place_id'] == SID
    assert sorted(int(k) for k, v in frozen['members'].items() if v == EID) == [SID]
    assert not any(EID in [*s['entity_ids'], *s.get('withdrawal_entity_ids', [])] for s in frozen['scopes'])
    rows = [m for m in frozen['mentions'] if m['entityId'] == EID]
    assert len(rows) == len({m['raw_note_id'] for m in rows}) == 19
    record = json.loads((ROOT / 'seven-cities-semantic-readthrough-26.json').read_bytes())
    assert record['snapshotSha256'] == hashlib.sha256(raw).hexdigest()
    reviewed = next(r for r in record['reviews'] if r['entityId'] == EID)
    raw_notes = {n['id']: n for n in frozen['governanceState']['rawNotes']}
    for evidence in reviewed['noteEvidence']:
        nid = evidence['noteId']
        assert hashlib.sha256(json.dumps(raw_notes[nid], ensure_ascii=False, sort_keys=True).encode()).hexdigest() == evidence['rawNoteSha256']
        assert hashlib.sha256(frozen['notes'][str(nid)]['note_desc'].encode()).hexdigest() == evidence['noteDescSha256']
    assert not raw_notes[1260]['img_analysis']
    quote = '✅神仙机位：别挤沙滩入口！往椰风寨方向走100米，人比入口少80%，整条无遮挡海平线都是你的'
    assert quote in frozen['notes']['1260']['note_desc']
    trace = json.loads((ROOT / 'operational-source-trace-03.json').read_bytes())
    assert trace['snapshotSha256'] == record['snapshotSha256']
    assert next(t for t in trace['targets'] if t['entityId'] == EID)['sourceCandidates'] == []
    evidence = [{'kind': 'reviewed_attraction_source_scope', 'snapshotSha256': record['snapshotSha256'],
        'file': str(Path(__file__).relative_to(ROOT.parents[3])), 'reviewedNotes': reviewed['noteEvidence'],
        'existingImageTextEvidence': reviewed['existingImageTextEvidence'],
        'noteQuotes': [{'noteId': 1260, 'quote': quote}],
        'conclusion': '19条/19篇正文及已有图片文字已读。5663仅在黄厝日出攻略中用椰风寨作方向参照，没有椰风寨独立游览文字，null待审；不新建机位、不直接转给黄厝。其余18条全部身份及有效字段保持。'
        '仅方向不足以唯一确定独立机位的地理归属，不将该待审项伪装成已完成not_same_entity排名排除。6322星空营地与6918标语混写继续待核，商店参照不据关键词整条删除；不核现行露营政策。'
        '完整保持原免费/未知营业预约输出及已有图片消费，不虚构运营保全声明或图片已审。'}]
    source = next(s for s in frozen['sources'] if s['id'] == SID)
    assignments = [{'mentionId': m['id'], 'inputHash': m['inputHash'], 'entityId': None if m['id'] in runner.UNASSIGNED else EID} for m in rows]
    scope = {'key': 'top30-20261010-batch-120-scope-2557', 'city': '厦门', 'sourcePlaceId': SID,
        'expectedSourceHash': source_fingerprint(source), 'expectedScopeRevision': 0,
        'expectedRevisions': {EID: 1}, 'assignments': assignments, 'evidence': evidence}
    own = [m for m in rows if m['id'] not in runner.UNASSIGNED]
    expected = {'city': '厦门', 'id': EID, 'name': entity['canonical_name'], 'revision': 2, 'verified': True,
        'mentionIds': [m['id'] for m in own], **recommendation_metrics(own)}
    return frozen, [scope], [expected]


original_apply = runner.apply_checked
async def apply_checked(session, frozen, scopes, expected):
    report = await original_apply(session, frozen, scopes, expected)
    catalog = await load_mention_catalog(session, '厦门')
    for m in await load_mention_rows(session, '厦门'):
        if m['id'] in expected[0]['mentionIds']:
            assert effective_mention(m, catalog.resolve(m)) == {**m, 'fact_value': m['fact_value'] or {}}
    assert {6322, 6918, 5407, 6113, 5515} <= set(expected[0]['mentionIds'])
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
