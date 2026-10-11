"""有既有scope的城市不得以不完整快照或未审核目标进入合并预演。"""
import copy
import hashlib
import importlib.util
import json
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('city_merges', ROOT / 'govern-city-merges.py')
merges = importlib.util.module_from_spec(spec)
spec.loader.exec_module(merges)


class MergePlanSafety(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.plan = json.loads((ROOT / 'xiamen-identity-plan-03.json').read_bytes())
        cls.snapshot = json.loads((ROOT / cls.plan['snapshot']).read_bytes())

    def prepare(self, mutate=None):
        plan, snapshot = copy.deepcopy(self.plan), copy.deepcopy(self.snapshot)
        city = next(c for c in snapshot['cities'] if c['city'] == plan['city'])
        if mutate:
            mutate(plan, city)
        raw = json.dumps(snapshot, ensure_ascii=False).encode()
        plan['snapshotSha256'] = hashlib.sha256(raw).hexdigest()
        with patch.object(Path, 'read_bytes', return_value=raw):
            return merges.prepare(plan, ROOT / 'test-plan.json')

    def test_complete_unrelated_scope_is_retained(self):
        city, decisions, _ = self.prepare()
        self.assertEqual(len(city['scopes']), 1)
        self.assertEqual(len(city['assignments']), 2)
        self.assertEqual(len(decisions), 1)

    def test_missing_governance_tables_rejected(self):
        with self.assertRaises(AssertionError):
            self.prepare(lambda p, c: c.pop('governanceState'))

    def test_missing_production_export_rejected(self):
        with self.assertRaises(AssertionError):
            self.prepare(lambda p, c: p.pop('baselineExport'))

    def test_scoped_target_cannot_use_simple_merge(self):
        def change(plan, city):
            target = next(e for e in city['entities'] if e['canonical_name'] == '黄厝沙滩')
            city['scopes'][0]['entity_ids'].append(target['entity_id'])
        with self.assertRaises(AssertionError):
            self.prepare(change)

    def test_unrelated_evidence_mention_rejected(self):
        with self.assertRaises(AssertionError):
            self.prepare(lambda p, c: p['merges'][0]['evidenceMentions'].append(-1))

    def test_quote_not_in_original_rejected(self):
        with self.assertRaises(AssertionError):
            self.prepare(lambda p, c: p['merges'][0]['noteQuotes'].append({'noteId': 1261, 'quote': '测试伪造的景点结论'}))

    def test_exact_geographic_alias_can_admit_unresolved_mention(self):
        plan = json.loads((ROOT / 'xiamen-identity-plan-04.json').read_bytes())
        _, decisions, expectations = merges.prepare(plan, ROOT / 'xiamen-identity-plan-04.json')
        self.assertEqual(decisions[0]['evidence'][0]['admitMentions'][0]['mentionId'], 5876)
        self.assertEqual(expectations[0]['mentionCount'], 17)

    def test_admission_rejects_stale_or_scoped_or_nonexact_evidence(self):
        for mode in ['owned', 'scope', 'hash', 'alias', 'quote']:
            with self.subTest(mode=mode):
                plan = json.loads((ROOT / 'xiamen-identity-plan-04.json').read_bytes())
                snapshot = json.loads((ROOT / plan['snapshot']).read_bytes())
                city = snapshot['cities'][0]
                mention = next(m for m in city['mentions'] if m['id'] == 5876)
                if mode == 'owned': mention['entityId'] = 'another-root'
                if mode == 'scope': mention['resolution']['scopePlaceIds'] = [1]
                if mode == 'hash': mention['inputHash'] = 'changed'
                if mode == 'alias': plan['merges'][0]['aliases'] = ['日光岩']
                if mode == 'quote': plan['merges'][0]['admitMentions'][0]['quote'] = '日光岩（伪造）'
                raw = json.dumps(snapshot, ensure_ascii=False).encode()
                plan['snapshotSha256'] = hashlib.sha256(raw).hexdigest()
                with patch.object(Path, 'read_bytes', return_value=raw), self.assertRaises(AssertionError):
                    merges.prepare(plan, ROOT / 'test-plan.json')


if __name__ == '__main__':
    unittest.main()
