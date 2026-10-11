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
    def boundary_fixture(self):
        data = fixture()
        data['mentions'][0].update(entityId=None, inputHash='hash', resolution={'status': 'review', 'scopePlaceIds': []})
        data['notes'] = {'1': {'note_desc': '甲只是远景，拍摄机位是乙平台'}}
        review = {'city': '北京', 'entityId': 'a', 'name': '甲', 'expectedRevision': 1, 'mentionId': 1,
            'inputHash': 'hash', 'expectedResolution': dict(data['mentions'][0]['resolution']),
            'noteId': 1, 'quote': '甲只是远景，拍摄机位是乙平台', 'relation': 'not_same_entity',
            'subjectType': 'photo_spot', 'conclusion': '平台不等于甲母项'}
        return data, review

    def test_non_equivalent_reference_remains_visible_without_parent_upper_bound(self):
        import copy
        data, review = self.boundary_fixture()
        before = copy.deepcopy(data)
        out = build_city(data, mention_boundaries=[review])
        self.assertEqual(out['rankAffectingUncertainty'], [])
        self.assertEqual(out['top30'][0]['reviewedNonEquivalentMentions'], [review])
        self.assertEqual(out['top30'][0]['potentialScore'], 0)
        self.assertEqual(data, before)

    def test_boundary_cannot_hide_assigned_stale_or_unrelated_mentions(self):
        for mode in ['assigned', 'input', 'resolution', 'quote', 'duplicate', 'unrelated', 'revision', 'type']:
            with self.subTest(mode=mode):
                data, review = self.boundary_fixture()
                if mode == 'assigned': data['mentions'][0]['entityId'] = 'a'
                if mode == 'input': data['mentions'][0]['inputHash'] = 'changed'
                if mode == 'resolution': data['mentions'][0]['resolution']['reason'] = 'new'
                if mode == 'quote': review['quote'] = '不存在的引述'
                if mode == 'unrelated': data['mentions'][0].update(name='乙', normalized_name='乙')
                if mode == 'revision': data['entities'][0]['revision'] += 1
                if mode == 'type': review['subjectType'] = 'unverified'
                with self.assertRaises(AssertionError):
                    build_city(data, mention_boundaries=[review, review] if mode == 'duplicate' else [review])

    def test_event_transfer_and_service_do_not_add_to_attraction_upper_bound(self):
        import copy
        for typ, quote in [('activity', '甲中秋古乐夜是限时活动'),
                           ('transport', '走到甲再换乘地铁'),
                           ('service', '甲附近商户的妆造服务238元，不含拍摄')]:
            with self.subTest(subjectType=typ):
                data, review = self.boundary_fixture()
                data['mentions'].append(mention(2, 2))
                data['notes']['1']['note_desc'] = quote
                review.update(subjectType=typ, quote=quote, conclusion='独立活动或交通语境不等于景观主体')
                before = copy.deepcopy(data)
                self.assertGreater(build_city(data)['top30'][0]['potentialScore'], 7.5)
                result = build_city(data, mention_boundaries=[review])['top30'][0]
                self.assertEqual(result['score'], 7.5)
                self.assertEqual(result['potentialScore'], 7.5)
                self.assertEqual(result['reviewedNonEquivalentMentions'], [review])
                self.assertEqual(data, before)
                data['mentions'][0]['entityId'] = 'a'
                with self.assertRaises(AssertionError):
                    build_city(data, mention_boundaries=[review])

    def geography_fixture(self):
        data = fixture()
        data['city'] = '成都'
        data['mentions'][0].update(entityId=None, inputHash='hash', resolution={'status': 'review', 'scopePlaceIds': [1]})
        data['notes'] = {'1': {'note_desc': '北京旅游路线：甲'}}
        data['scopes'] = [{'place_id': 1, 'entity_ids': ['a'], 'revision': 1}]
        data['downstream'][0]['payload']['identityWithdrawal'] = {'reason': 'unavailable_source'}
        review = {'city': '成都', 'actualCity': '北京', 'entityId': 'a', 'name': '甲', 'expectedRevision': 1,
                  'sourceIds': [1], 'scopeSnapshot': [dict(data['scopes'][0])], 'mentionHashes': {'1': 'hash'},
                  'noteQuotes': [{'noteId': 1, 'quote': '北京旅游路线：甲'}], 'conclusion': '已隔离的北京来源'}
        return data, review

    def test_geography_excludes_only_quota_and_preserves_business_state(self):
        import copy
        data, review = self.geography_fixture()
        before = copy.deepcopy(data)
        out = build_city(data, geography_reviews=[review])
        self.assertEqual(out['rankAffectingUncertainty'], [])
        self.assertEqual(out['excludedOtherCities'][0]['uncertainMentionIds'], [1])
        self.assertEqual(data, before)

    def test_geography_rejects_changed_ownership_evidence_or_scope(self):
        for mode in ['owned', 'new_mention', 'input', 'scope', 'revision', 'quote', 'city', 'duplicate', 'unwithdrawn']:
            with self.subTest(mode=mode):
                data, review = self.geography_fixture()
                if mode == 'owned': data['mentions'][0]['entityId'] = 'a'
                if mode == 'new_mention': data['mentions'].append({**data['mentions'][0], 'id': 2})
                if mode == 'input': data['mentions'][0]['inputHash'] = 'new'
                if mode == 'scope': data['scopes'][0]['revision'] = 2
                if mode == 'revision': data['entities'][0]['revision'] = 2
                if mode == 'quote': review['noteQuotes'][0]['quote'] = '北京假引述'
                if mode == 'city': review['actualCity'] = '成都'
                if mode == 'unwithdrawn': del data['downstream'][0]['payload']['identityWithdrawal']
                with self.assertRaises(AssertionError):
                    build_city(data, geography_reviews=[review, review] if mode == 'duplicate' else [review])

    def classification_fixture(self):
        data = fixture()
        data['mentions'][0]['inputHash'] = 'frozen-input'
        data['notes'] = {'1': {'note_desc': '这里是渡口，用于搭乘轮渡过江。'}}
        review = {'city': '北京', 'entityId': 'a', 'name': '甲', 'expectedRevision': 1,
                  'mentionHashes': {'1': 'frozen-input'}, 'effectiveType': 'transport',
                  'conclusion': '搭乘轮渡的交通设施，不占景点配额。',
                  'noteQuotes': [{'noteId': 1, 'quote': '用于搭乘轮渡过江'}]}
        return data, review

    def test_reviewed_transport_does_not_take_attraction_slot(self):
        data, review = self.classification_fixture()
        out = build_city(data, [review])
        self.assertEqual(out['top30'], [])
        self.assertEqual(out['excludedOtherTypes'][0]['effectiveType'], 'transport')
        self.assertEqual(data['sources'][0]['place_type'], 'attraction')

    def test_classification_rejects_new_or_changed_mentions(self):
        for mode in ['new', 'changed']:
            with self.subTest(mode=mode):
                data, review = self.classification_fixture()
                if mode == 'new':
                    data['mentions'].append({**mention(2, 2), 'inputHash': 'new'})
                else:
                    data['mentions'][0]['inputHash'] = 'changed'
                with self.assertRaises(AssertionError):
                    build_city(data, [review])

    def test_classification_rejects_stale_revision_and_invented_quote(self):
        for mode in ['revision', 'quote']:
            with self.subTest(mode=mode):
                data, review = self.classification_fixture()
                if mode == 'revision':
                    data['entities'][0]['revision'] = 2
                else:
                    review['noteQuotes'][0]['quote'] = '没有的文字'
                with self.assertRaises(AssertionError):
                    build_city(data, [review])

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

    def test_governed_category_overrides_stale_source_type(self):
        data = fixture()
        data['entities'][0]['overrides']['category'] = '美食'
        out = build_city(data)
        self.assertEqual(out['top30'], [])
        self.assertEqual(out['excludedOtherTypes'][0]['governedCategory'], '美食')
        self.assertEqual(data['sources'][0]['place_type'], 'attraction')

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
