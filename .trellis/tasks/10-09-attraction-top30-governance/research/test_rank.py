import unittest
from rank import score, build_city


def mention(mid, nid, typ='recommend', eid='a'):
    return {'id': mid, 'raw_note_id': nid, 'mention_type': typ, 'entityId': eid,
            'name': '甲', 'normalized_name': '甲', 'resolution': {'status': 'resolved' if eid else 'review', 'scopePlaceIds': []}}


def fixture():
    entity = {'entity_id': 'a', 'canonical_name': '甲', 'primary_place_id': 1, 'aliases': ['甲'],
              'legacy_ids': ['a'], 'revision': 1, 'status': 'ACTIVE', 'redirect_to': None, 'overrides': {}, 'evidence': []}
    return {'city': '北京', 'entities': [entity], 'sources': [{'id': 1, 'name': '甲', 'normalized_name': '甲', 'place_type': 'attraction'}],
            'members': {'1': 'a'}, 'mentions': [mention(1, 1)], 'reviews': [], 'scopes': [],
            'downstream': [{'id': 'a', 'verified': True, 'lat': None, 'lng': None, 'has_embedding': False,
                            'payload': {'identity': {'revision': 1}, 'recommendScore': 7.5}}]}


class RankingTests(unittest.TestCase):
    def test_merge_recomputes_mentions_and_distinct_notes(self):
        first, second = mention(1, 8), mention(2, 8)
        self.assertEqual(score([first, first, second]), 9.5)
        self.assertNotEqual(score([first, second]), score([first]) + score([second]))

    def test_warning_and_duplicate_note_do_not_count_as_recommend_or_new_note(self):
        self.assertEqual(score([mention(1, 8), mention(2, 8, 'warning')]), 7.0)

    def test_missing_coordinate_does_not_silently_remove_attraction(self):
        rows = build_city(fixture())['top30']
        self.assertEqual(len(rows), 1)
        self.assertFalse(rows[0]['hasCoordinates'])

    def test_withdrawn_name_is_retained_as_rank_risk(self):
        data = fixture()
        data['downstream'][0]['payload']['identityWithdrawal'] = {'reason': 'split_source'}
        data['mentions'][0]['entityId'] = None
        data['mentions'][0]['resolution']['status'] = 'review'
        out = build_city(data)
        self.assertEqual(out['top30'], [])
        self.assertEqual(len(out['rankAffectingUncertainty']), 1)

    def test_upper_bound_does_not_assume_all_pending_rows_raise_score(self):
        data = fixture()
        data['mentions'].append(mention(2, 1, 'warning', None))
        row = build_city(data)['top30'][0]
        self.assertEqual(row['allAssignedScore'], 7.0)
        self.assertGreaterEqual(row['potentialScore'], row['score'])

    def test_explicit_non_attraction_type_is_out_of_write_scope(self):
        data = fixture()
        data['entities'][0]['overrides']['xhsPlaceType'] = 'photo_spot'
        out = build_city(data)
        self.assertEqual(out['top30'], [])
        self.assertEqual(out['excludedOtherTypes'][0]['effectiveType'], 'photo_spot')

    def test_redirected_sources_do_not_take_two_top30_slots(self):
        data = fixture()
        data['entities'].append({**data['entities'][0], 'entity_id': 'old', 'redirect_to': 'a', 'primary_place_id': 2})
        data['sources'].append({**data['sources'][0], 'id': 2, 'name': '甲别名'})
        data['members']['2'] = 'old'
        data['mentions'].append(mention(2, 2, eid='old'))
        rows = build_city(data)['top30']
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['sourceIds'], [1, 2])
        self.assertEqual(rows[0]['score'], 10)


if __name__ == '__main__':
    unittest.main()
