"""保留来福士建筑主体，隔离外部机位和商场负评，保持原文及独立商场。"""
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

TARGET = '5aab3e5fc03ca61f0d7c56b769184c80'
MALL = 'beb24edb246b3bc00503728b24110a59'
runner.CITY, runner.BATCH = '重庆', 'batch-98'
runner.SNAPSHOT = ROOT / 'snapshot-20261009T190946794061Z/input.json'
runner.EXTRAS = ROOT / 'chongqing-scope-02-extras.json'
runner.BASELINE = ROOT / 'chongqing-scope-02-baseline.json'
runner.TARGETS = {TARGET}
runner.UNASSIGNED = {550, 1173, 1599, 1632, 1068}
runner.FORBIDDEN_PHRASES = ['普通商场，无特色亮点', '经典机位拍照，出片效果好',
    '小什字站出站步行至港渝广场可观景', '小什字站8号口步行到港渝广场，可拍来福士全景']


def inputs():
    raw = runner.SNAPSHOT.read_bytes()
    frozen = next(c for c in json.loads(raw)['cities'] if c['city'] == '重庆')
    assert not any(TARGET in [*s['entity_ids'], *s.get('withdrawal_entity_ids', [])] for s in frozen['scopes'])
    entity = next(e for e in frozen['entities'] if e['entity_id'] == TARGET)
    assert entity['revision'] == 1 and entity['primary_place_id'] == 55
    rows = [m for m in frozen['mentions'] if m['entityId'] == TARGET]
    assert len(rows) == 12 and runner.UNASSIGNED.issubset({m['id'] for m in rows})
    quotes = [(8, '图14：来福士\n📍轨道小什字站8号出口，步行导航港渝广场'),
        (321, '图11：来福士\n📍轨道小什字站8号出口，步行导航港渝广场'),
        (176, '1，来福士就一个商场，没啥亮点。'),
        (241, '再沿着【朝东路】走就可以拍到来福士经典机位了'),
        (241, '穿过来福士就抵达了朝天门'),
        (311, '先打卡重庆地标来福士，再去朝天门看两江交汇'),
        (148, '重庆的标志性打卡建筑，随手一拍都是大片')]
    for nid, quote in quotes:
        assert quote in frozen['notes'][str(nid)]['note_desc']
    public_bytes = (ROOT / 'raffles-fetch-01.json').read_bytes()
    public = json.loads(public_bytes)
    public_quote = '由8栋塔楼、底部裙楼及一座横跨天际的空中连廊组成'
    assert public['ok'] and public_quote in public['content']
    assert public['url'] == 'https://www.capitaland.com/cn/zh/shop/malls-listing/raffles-city-chongqi.html'
    evidence = [{'kind': 'reviewed_attraction_source_scope', 'snapshotSha256': hashlib.sha256(raw).hexdigest(),
        'file': str(Path(__file__).relative_to(ROOT.parents[3])),
        'noteQuotes': [{'noteId': n, 'quote': q} for n, q in quotes],
        'publicSource': {'file': 'raffles-fetch-01.json', 'sha256': hashlib.sha256(public_bytes).hexdigest(),
            'url': public['url'], 'quote': public_quote},
        'conclusion': '550/1173/1599同篇及1632另一篇明确定位港渝广场远观机位，不能把摄影站位当来福士建筑本身；1068评价商场，null待审，原负评完整保留，不把商场和地标整体混同，也不写入域外市场。1207原路线确有穿过来福士到朝天门，保留身份；其reason/evidence_text只描述朝东路机位，按subject_mismatch排除。其它6条建筑打卡/路线归属保持；官网区分塔楼、底部裙楼及高空设施，不新增同义名或正式part_of，不合并来福士商场、后街、千佛寺机位。'}]
    assignments = [{'mentionId': m['id'], 'inputHash': m['inputHash'],
        'entityId': None if m['id'] in runner.UNASSIGNED else TARGET} for m in rows]
    next(a for a in assignments if a['mentionId'] == 1207)['factExclusions'] = {
        field: {'reason': 'subject_mismatch', 'quote': quotes[3][1]} for field in ['reason', 'evidence_text']}
    source = next(s for s in frozen['sources'] if s['id'] == 55)
    scope = {'key': 'top30-20261010-batch-98-raffles-scope', 'city': '重庆', 'sourcePlaceId': 55,
        'expectedSourceHash': source_fingerprint(source), 'expectedScopeRevision': 0,
        'expectedRevisions': {TARGET: 1}, 'assignments': assignments, 'evidence': evidence}
    own = [m for m in rows if m['id'] not in runner.UNASSIGNED]
    metrics = recommendation_metrics(own)
    assert metrics == {'mentionCount': 7, 'recommendScore': 22.5}
    expected = {'city': '重庆', 'id': TARGET, 'name': entity['canonical_name'], 'revision': 2,
        'verified': True, 'mentionIds': [m['id'] for m in own], **metrics}
    return frozen, [scope], [expected]


original_apply_checked = runner.apply_checked


async def apply_checked(session, frozen, scopes, expected):
    report = await original_apply_checked(session, frozen, scopes, expected)
    catalog = await load_mention_catalog(session, '重庆')
    for mention in await load_mention_rows(session, '重庆'):
        if mention['id'] == 1207:
            projected = effective_mention(mention, catalog.resolve(mention))
            assert projected['reason'] is None and projected['evidence_text'] is None
            assert catalog.resolve(mention)['entity']['entity_id'] == TARGET
        elif mention['id'] in expected[0]['mentionIds']:
            assert effective_mention(mention, catalog.resolve(mention)) == {**mention, 'fact_value': mention['fact_value'] or {}}
    assert catalog.catalog.entities[MALL] == next(e for e in frozen['entities'] if e['entity_id'] == MALL)
    report['checks'].update(routeIdentityPreservedWithSpotFactsExcluded=True, independentMallPreserved=True)
    return report


runner.inputs, runner.apply_checked = inputs, apply_checked
if __name__ == '__main__':
    try:
        asyncio.run(runner.main())
    except Exception as error:
        driver = getattr(getattr(error, 'orig', None), '__cause__', None)
        print(json.dumps({'failed': True, 'errorType': type(error).__name__, 'sqlstate': getattr(driver, 'sqlstate', None),
            'constraint': getattr(driver, 'constraint_name', None), 'frames': [
                {'file': Path(f.filename).name, 'line': f.lineno, 'function': f.name}
                for f in traceback.extract_tb(error.__traceback__) if str(ROOT) in f.filename]}, ensure_ascii=False))
        sys.exit(1)
