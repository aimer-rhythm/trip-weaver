"""95—96批已核对原文的单主体范围隔离；复用完整预演/回滚与审计门禁。"""
import argparse
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
from app.aggregate.place_identity import apply_decision
from app.clean.mention_identity import source_fingerprint, effective_mention
from app.clean.recommendation import recommendation_metrics

CASES = {
    'suzhou-river': {
        'city': '上海', 'batch': 'batch-95', 'prefix': 'shanghai-scope-03',
        'target': '73ce6d33d1fb9b6416e2be727f940a76', 'source': 4670,
        'total': 4, 'unassigned': {10357}, 'score': 12.5,
        'quotes': [(2354, '酒店紧挨着苏州河，傍晚沿河散步巨舒服'),
                   (2347, '苏州河（四行仓库→外白渡桥）：历史+拍照'),
                   (2309, 'p6 苏州河'),
                   (2307, '2️⃣苏州河岸 P18')],
        'forbidden': ['酒店紧挨苏州河，傍晚沿河散步舒服'],
        'conclusion': '10357的整段主语为未具名酒店，仅用苏州河说明位置，null待审。保留原有9925/10031/10383河岸与散步语境归属，但三条涉及具体路线/视角，不表示整条河流与所有步道/河畔同义。保留review6及苏州河步道/苏州河畔两个现行根，不新增别名、关系或路线定位，不扩大为全部事实审核。',
    },
    'datang': {
        'city': '西安', 'batch': 'batch-96-v2', 'prefix': 'xian-scope-03',
        'preserveCategory': '娱乐',
        'target': '553ffb978fc4f1c37370829fb4cc4321', 'source': 5515,
        'total': 29, 'unassigned': {12030, 12352, 12473, 12504, 12487}, 'score': 63.5,
        'quotes': [(2644, 'P8、P9➡️大唐不夜城牡丹亭茶叙门口处'),
                   (2731, '看中的摄影师有档期，拍了一套，看到样片的第一秒已经爱上了'),
                   (2729, '238=服装任选+精致妆造（不含拍摄）'),
                   (2732, 'P1 大唐不夜城和大雁塔中间交叉的广场\nP2 大唐不夜城（在树的灯带下拍！）'),
                   (2774, '晚上边走边逛还是不错的'),
                   (2711, '游玩路线：\nDay1️⃣：大雁塔——大唐不夜城'),
                   (2778, '附近就是大唐不夜城、大雁塔、大唐芙蓉园，可以一起逛逛')],
        'forbidden': ['牡丹亭茶叙门口处适合拍照', '牡丹亭茶叙门口处有出片机位',
                      '拍摄唐风轻复原，样片效果惊艳', '适合拍摄汉服写真，风格多样',
                      '多个机位适合拍照，如广场交叉处和树的灯带下'],
        'conclusion': '12030/12352为同篇商户门口机位，12487混合交叉广场与灯带机位，12473主语为摄影服务且地点只在标签，12504为未具名妆造商户广告，五条null待审。其余24条保留原景区游览/路线/夜景归属和原作者体验，不因此核实巡演营业时间。大唐不夜城夜市原市场根、12019负评、review382全保持，只读对照，不把市场事实并入景区，不创建机位/商户/活动主体。',
    },
}


def configure(case_name):
    case = CASES[case_name]
    target = case['target']
    runner.CITY, runner.BATCH = case['city'], case['batch']
    runner.SNAPSHOT = ROOT / 'snapshot-20261009T184019187146Z/input.json'
    runner.EXTRAS = ROOT / (case['prefix'] + '-extras.json')
    runner.BASELINE = ROOT / (case['prefix'] + '-baseline.json')
    runner.TARGETS, runner.UNASSIGNED = {target}, case['unassigned']
    runner.FORBIDDEN_PHRASES = case['forbidden']

    def inputs():
        raw = runner.SNAPSHOT.read_bytes()
        frozen = next(c for c in json.loads(raw)['cities'] if c['city'] == case['city'])
        assert not any(target in [*s['entity_ids'], *s.get('withdrawal_entity_ids', [])] for s in frozen['scopes'])
        entity = next(e for e in frozen['entities'] if e['entity_id'] == target)
        assert entity['revision'] == 1 and entity['primary_place_id'] == case['source']
        rows = [m for m in frozen['mentions'] if m['entityId'] == target]
        assert len(rows) == case['total'] and case['unassigned'].issubset({m['id'] for m in rows})
        for nid, quote in case['quotes']:
            assert quote in frozen['notes'][str(nid)]['note_desc']
        evidence = [{'kind': 'reviewed_attraction_source_scope', 'snapshotSha256': hashlib.sha256(raw).hexdigest(),
            'file': str(Path(__file__).relative_to(ROOT.parents[3])), 'case': case_name,
            'noteQuotes': [{'noteId': n, 'quote': q} for n, q in case['quotes']], 'conclusion': case['conclusion']}]
        assignments = [{'mentionId': m['id'], 'inputHash': m['inputHash'],
            'entityId': None if m['id'] in case['unassigned'] else target} for m in rows]
        source = next(s for s in frozen['sources'] if s['id'] == case['source'])
        scope = {'key': f"top30-20261010-{case['batch']}-{case_name}-scope", 'city': case['city'],
            'sourcePlaceId': case['source'], 'expectedSourceHash': source_fingerprint(source),
            'expectedScopeRevision': 0, 'expectedRevisions': {target: 1}, 'assignments': assignments, 'evidence': evidence}
        own = [m for m in rows if m['id'] not in case['unassigned']]
        expected = {'city': case['city'], 'id': target, 'name': entity['canonical_name'], 'revision': 3 if case.get('preserveCategory') else 2,
            'verified': True, 'mentionIds': [m['id'] for m in own], **recommendation_metrics(own)}
        assert expected['recommendScore'] == case['score']
        if case.get('preserveCategory'):
            baseline = json.loads(runner.BASELINE.read_bytes())
            before = next(p for p in baseline['places'] if p['id'] == target)
            assert before['category'] == case['preserveCategory']
            runner.ENTITY_DECISIONS = [{'key': f"top30-20261010-{case['batch']}-{case_name}-category", 'city': case['city'],
                'entityId': target, 'canonicalName': entity['canonical_name'], 'aliases': entity['aliases'],
                'mergeEntityIds': [], 'expectedRevisions': {target: 2},
                'overrides': {**entity['overrides'], 'category': case['preserveCategory']},
                'evidence': [{'kind': 'preserve_existing_product_category', 'file': runner.BASELINE.name,
                    'sha256': hashlib.sha256(runner.BASELINE.read_bytes()).hexdigest(),
                    'category': case['preserveCategory'], 'conclusion': '完整scope停用旧themes时默认分类从娱乐回落文化；本批只隔离来源，通过版本化实体API显式保留原娱乐分类，不恢复混合旧主题，不声称完成新类型审核。'}]}]
        return frozen, [scope], [expected]

    original_apply_checked = runner.apply_checked

    async def apply_checked(session, frozen, scopes, expected):
        intermediate = [{**p, 'revision': 2} for p in expected]
        report = await original_apply_checked(session, frozen, scopes, intermediate)
        if runner.ENTITY_DECISIONS:
            changes = []
            for decision in runner.ENTITY_DECISIONS:
                change = await apply_decision(session, decision)
                assert await apply_decision(session, decision) == change
                changes.append(change)
            report['changes'] = changes
        catalog = await load_mention_catalog(session, case['city'])
        assert catalog.catalog.entities[target]['revision'] == expected[0]['revision']
        if case.get('preserveCategory'):
            assert catalog.catalog.entities[target]['overrides']['category'] == case['preserveCategory']
            report['checks']['existingCategoryExplicitlyPreserved'] = True
        rows = await load_mention_rows(session, case['city'])
        for m in rows:
            if m['id'] in expected[0]['mentionIds']:
                assert effective_mention(m, catalog.resolve(m)) == {**m, 'fact_value': m['fact_value'] or {}}
        report['checks']['remainingAssignedFactsPreserved'] = True
        return report

    runner.inputs, runner.apply_checked = inputs, apply_checked


if __name__ == '__main__':
    try:
        parser = argparse.ArgumentParser(add_help=False)
        parser.add_argument('--case', required=True, choices=list(CASES))
        args, remainder = parser.parse_known_args()
        sys.argv = [sys.argv[0], *remainder]
        configure(args.case)
        asyncio.run(runner.main())
    except Exception as error:
        driver = getattr(getattr(error, 'orig', None), '__cause__', None)
        print(json.dumps({'failed': True, 'errorType': type(error).__name__, 'sqlstate': getattr(driver, 'sqlstate', None),
            'constraint': getattr(driver, 'constraint_name', None), 'frames': [
                {'file': Path(f.filename).name, 'line': f.lineno, 'function': f.name}
                for f in traceback.extract_tb(error.__traceback__) if str(ROOT) in f.filename]}, ensure_ascii=False))
        sys.exit(1)
