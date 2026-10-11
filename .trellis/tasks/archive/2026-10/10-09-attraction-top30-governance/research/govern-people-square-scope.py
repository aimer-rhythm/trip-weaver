"""人民广场保留路线主体，隔离住宿和美食分区并按字段处理同篇住宿描述。"""
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
from app.aggregate.mention_identity import load_mention_catalog, load_mention_rows
from app.clean.mention_identity import source_fingerprint, effective_mention
from app.clean.recommendation import recommendation_metrics

runner.CITY, runner.BATCH = '上海', 'batch-105'
runner.SNAPSHOT = ROOT / 'snapshot-20261009T211214228056Z/input.json'
runner.EXTRAS = ROOT / 'shanghai-scope-09-extras.json'
runner.BASELINE = ROOT / 'shanghai-scope-09-baseline.json'
EID, SID = '63ad45b24bf49d9d084da69ed2c08c9f', 4653
runner.TARGETS = {EID}
runner.UNASSIGNED = {9981, 10017, 10049, 10148}
runner.FORBIDDEN_PHRASES = ['近地铁，住宿性价比高', '交通枢纽，住宿出行方便',
    '住宿优先选择，地铁直达交通便利', '市中心经典生煎、小笼、麻酱面等老字号众多',
    '交通枢纽，周边住宿方便', '地铁枢纽，去各景点方便']
FACTS = {
    10259: '🉑南京东路/人民广场周边',
    11255: '🉑人民广场/南京东路周边：地铁1/2/8/10号线枢纽，步行到南京路、外滩、豫园',
}


def inputs():
    raw = runner.SNAPSHOT.read_bytes()
    frozen = next(c for c in json.loads(raw)['cities'] if c['city'] == '上海')
    assert not any(EID in [*s['entity_ids'], *s.get('withdrawal_entity_ids', [])] for s in frozen['scopes'])
    entity = next(e for e in frozen['entities'] if e['entity_id'] == EID)
    source = next(s for s in frozen['sources'] if s['id'] == SID)
    assert entity['revision'] == 2 and entity['primary_place_id'] == SID
    assert [int(k) for k, v in frozen['members'].items() if v == EID] == [SID]
    rows = [m for m in frozen['mentions'] if m['entityId'] == EID]
    assert len(rows) == 13
    quotes = [(2278, '✅静安寺 人民广场 江苏路地铁口附近 性价比高'),
        (2347, '1️⃣ 来上海住哪里\n南京东路很方便但又贵又吵，可以考虑人民广场附近（交通枢纽）'),
        (2345, '🏠住宿：\n优先住人民广场/南京东路！'),
        (2319, '6️⃣人民广场\n📍莱莱小笼\n📍舒蔡记生煎菜饭'),
        (2281, 'Day1：南京路步行街➡️东方明珠➡️陆家嘴➡️国金中心➡️人民广场➡️外滩'),
        (2444, 'Day1：南京路步行街➡️东方明珠➡️陆家嘴➡️国金中心➡️人民广场➡️外滩')]
    for nid, quote in quotes:
        assert quote in frozen['notes'][str(nid)]['note_desc'], nid
    assignments = []
    for m in rows:
        a = {'mentionId': m['id'], 'inputHash': m['inputHash'],
            'entityId': None if m['id'] in runner.UNASSIGNED else EID}
        if m['id'] in FACTS:
            quote = FACTS[m['id']]
            assert quote in frozen['notes'][str(m['raw_note_id'])]['note_desc']
            a['factExclusions'] = {field: {'reason': 'subject_mismatch', 'quote': quote} for field in ['reason', 'evidence_text']}
        assignments.append(a)
    evidence = [{'kind': 'reviewed_attraction_source_scope', 'snapshotSha256': hashlib.sha256(raw).hexdigest(),
        'file': str(Path(__file__).relative_to(ROOT.parents[3])),
        'noteQuotes': [{'noteId': n, 'quote': q} for n, q in quotes],
        'reviewedNotes': [{'noteId': n, 'noteDescSha256': hashlib.sha256(frozen['notes'][str(n)]['note_desc'].encode()).hexdigest()}
            for n in sorted({m['raw_note_id'] for m in rows})],
        'conclusion': '完整13条提及身份语境审核。9981/10017/10049分别为住宿地铁口片区、住宿推荐与酒店出行参照，10148为美食清单分区标题，四条null待审，不建酒店商户。10259/11255虽然描述来自住宿段，但同篇Day1分别明确将人民广场列作独立路线站，保留身份，只排reason/evidence_text两个错配字段。其余明确路线、城市广场及餐后实际游览保持；不把周边上海博物馆、地下商场、地铁站或整片住宿区合并进广场，不补定位与营业事实。'}]
    scope = {'key': 'top30-20261010-batch-105-scope-4653', 'city': '上海', 'sourcePlaceId': SID,
        'expectedSourceHash': source_fingerprint(source), 'expectedScopeRevision': 0,
        'expectedRevisions': {EID: 2}, 'assignments': assignments, 'evidence': evidence}
    own = [m for m in rows if m['id'] not in runner.UNASSIGNED]
    expected = {'city': '上海', 'id': EID, 'name': entity['canonical_name'], 'revision': 3, 'verified': True,
        'mentionIds': [m['id'] for m in own], **recommendation_metrics(own)}
    assert expected['mentionCount'] == 9 and expected['recommendScore'] == 27.5
    return frozen, [scope], [expected]


original_apply_checked = runner.apply_checked


async def apply_checked(session, frozen, scopes, expected):
    report = await original_apply_checked(session, frozen, scopes, expected)
    catalog = await load_mention_catalog(session, '上海')
    for m in await load_mention_rows(session, '上海'):
        if m['id'] not in expected[0]['mentionIds']:
            continue
        wanted = {**m, 'fact_value': m['fact_value'] or {}}
        if m['id'] in FACTS:
            wanted.update(reason=None, evidence_text=None)
        assert effective_mention(m, catalog.resolve(m)) == wanted
    report['checks'].update(explicitRouteIdentityPreserved=True, selectiveFactsOnly=True)
    return report


runner.inputs, runner.apply_checked = inputs, apply_checked
if __name__ == '__main__':
    try:
        asyncio.run(runner.main())
    except Exception as error:
        print(json.dumps({'failed': True, 'errorType': type(error).__name__, 'frames': [
            {'file': Path(f.filename).name, 'line': f.lineno, 'function': f.name}
            for f in traceback.extract_tb(error.__traceback__) if str(ROOT) in f.filename]}, ensure_ascii=False))
        sys.exit(1)
