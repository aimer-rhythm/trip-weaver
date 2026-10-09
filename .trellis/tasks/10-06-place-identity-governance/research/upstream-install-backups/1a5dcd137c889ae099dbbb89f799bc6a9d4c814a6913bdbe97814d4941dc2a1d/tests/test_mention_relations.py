"""真实原文位置、逐提及身份和无向关系的边界；不依赖网络或应用数据库。"""
import copy

import pytest

from app.clean.identity import IdentityCatalog
from app.clean.mention_identity import MentionIdentityCatalog, digest, mention_fingerprint
from app.clean.mention_relations import mine_mention_relations


def entity(eid, name, **changes):
    return dict(entity_id=eid, city='测试城', canonical_name=name, aliases=[], status='ACTIVE',
                revision=1, redirect_to=None, **changes)


def mention(mid, nid, name, text, quote='', **changes):
    return dict(id=mid, raw_note_id=nid, name=name, normalized_name=name, evidence_text=quote,
                note_city='测试城', note_title='', note_desc=text, note_images=None,
                note_unavailable=False, **changes)


def catalog(entities=None, assignments=None, source_valid=True):
    entities = entities or [entity('a', '甲店'), entity('b', '乙园'), entity('c', '丙塔')]
    scopes = [] if assignments is None else [dict(place_id=1, city='测试城', name_keys=['同名咖啡'],
        entity_ids=['a', 'c'], source_valid=source_valid)]
    return MentionIdentityCatalog(IdentityCatalog('测试城', entities, []), scopes, assignments or [])


def assignment(row, eid):
    return dict(mention_id=row['id'], scope_place_id=1, entity_id=eid, input_hash=mention_fingerprint(row))


def mine(rows, cat=None, **kwargs):
    return mine_mention_relations(cat or catalog(), rows, min_mentions=kwargs.pop('min_mentions', 1), **kwargs)


def pairs(result):
    return {(r['fromEntityId'], r['toEntityId']) for r in result['relations']}


def test_same_name_branches_use_unique_original_quotes():
    text = '东门同名咖啡→乙园。西门同名咖啡→丙塔'
    rows = [mention(1, 1, '同名咖啡', text, '东门同名咖啡'),
            mention(2, 1, '同名咖啡', text, '西门同名咖啡'),
            mention(3, 1, '乙园', text), mention(4, 1, '丙塔', text)]
    cat = catalog(assignments=[assignment(rows[0], 'a'), assignment(rows[1], 'c')])
    result = mine(rows, cat)
    assert pairs(result) == {('a', 'b')}  # 西门咖啡已归丙塔，自环排除。
    proof = result['relations'][0]['evidence'][0]
    assert proof['from']['mentions'] == [{'mentionId': 1, 'inputHash': mention_fingerprint(rows[0])}]
    assert proof['from']['surface'] == '同名咖啡'
    assert ('\n' + text)[proof['from']['start']:proof['from']['end']] == '同名咖啡'
    assert proof['textHash'] == digest(['relation_text', '\n' + text])


def test_two_different_branches_never_share_or_swap_occurrences():
    text = '东门同名咖啡→乙园。西门同名咖啡→乙园'
    rows = [mention(1, 1, '同名咖啡', text, '东门同名咖啡'),
            mention(2, 1, '同名咖啡', text, '西门同名咖啡'), mention(3, 1, '乙园', text)]
    result = mine(rows, catalog(assignments=[assignment(rows[0], 'a'), assignment(rows[1], 'c')]))
    assert pairs(result) == {('a', 'b'), ('b', 'c')}
    proofs = [r['evidence'][0] for r in result['relations']]
    assert proofs[0]['from']['start'] < proofs[1]['to']['start']


def test_reviewed_brand_mention_can_locate_its_explicit_full_branch_but_not_another_branch():
    text = '同名咖啡（东店）→乙园。同名咖啡（西店）→丙塔'
    rows = [mention(1, 1, '同名咖啡', text), mention(2, 1, '乙园', text), mention(3, 1, '丙塔', text)]
    entities = [entity('a', '同名咖啡（东店）'), entity('b', '乙园'), entity('c', '丙塔'), entity('d', '同名咖啡（西店）')]
    result = mine(rows, catalog(entities, [assignment(rows[0], 'a')]))
    assert pairs(result) == {('a', 'b')}
    assert result['relations'][0]['evidence'][0]['from']['surface'] == '同名咖啡（东店）'


@pytest.mark.parametrize('quote', ['', '同名咖啡', '未出现在正文的同名咖啡', '乙园', '同名咖啡→乙园。西门同名咖啡'])
def test_unlocated_controlled_mention_blocks_all_possible_positions(quote):
    text = '东门同名咖啡→乙园。西门同名咖啡→乙园'
    rows = [mention(1, 1, '同名咖啡', text, quote), mention(2, 1, '乙园', text)]
    result = mine(rows, catalog(assignments=[assignment(rows[0], 'a')]))
    assert not result['relations']
    assert any('ambiguous_text_occurrence' in item.get('reasons', []) for item in result['unresolved'])


def test_unlocated_assignment_cannot_be_ignored_beside_located_assignment():
    text = '东门同名咖啡→乙园。西门同名咖啡→乙园'
    rows = [mention(1, 1, '同名咖啡', text, '东门同名咖啡'),
            mention(2, 1, '同名咖啡', text), mention(3, 1, '乙园', text)]
    assert not mine(rows, catalog(assignments=[assignment(rows[0], 'a'), assignment(rows[1], 'c')]))['relations']


def test_conflicting_assignments_at_single_position_are_unresolved():
    text = '同名咖啡→乙园'
    rows = [mention(1, 1, '同名咖啡', text), mention(2, 1, '同名咖啡', text), mention(3, 1, '乙园', text)]
    result = mine(rows, catalog(assignments=[assignment(rows[0], 'a'), assignment(rows[1], 'c')]))
    assert not result['relations']
    assert result['unresolved'][0]['reasons'] == ['conflicting_position_owners']


@pytest.mark.parametrize('failure', ['null', 'hash', 'source', 'private', 'cross_city', 'review', 'missing'])
def test_invalid_source_never_falls_back_to_name(failure):
    text = '同名咖啡→乙园'
    rows = [mention(1, 1, '同名咖啡', text), mention(2, 1, '乙园', text)]
    binding = assignment(rows[0], None if failure == 'null' else 'a')
    if failure == 'hash':
        binding['input_hash'] = '0' * 64
    if failure in ('private', 'cross_city'):
        for row in rows:
            row.update({'note_unavailable': True} if failure == 'private' else {'note_city': '外城'})
    cat = catalog(assignments=[] if failure == 'missing' else [binding], source_valid=failure != 'source')
    if failure == 'review':
        cat.catalog.entities['a']['status'] = 'REVIEW'
    assert not mine(rows, cat)['relations']


def test_unreviewed_second_mention_blocks_position_even_with_valid_assignment():
    text = '同名咖啡→乙园'
    rows = [mention(1, 1, '同名咖啡', text), mention(2, 1, '同名咖啡', text), mention(3, 1, '乙园', text)]
    assert not mine(rows, catalog(assignments=[assignment(rows[0], 'a')]))['relations']


def test_repeated_and_reverse_pairs_count_distinct_notes_and_keep_both_endpoints():
    text = '甲店→乙园→甲店→乙园'
    rows = [mention(1, 1, '甲店', text), mention(2, 1, '乙园', text)]
    once = mine(rows)['relations'][0]
    assert (once['strength'], once['noteCount']) == ('weak', 1)
    rows += [mention(3, 2, '甲店', '乙园→甲店'), mention(4, 2, '乙园', '乙园→甲店')]
    twice = mine(rows)['relations'][0]
    assert (twice['strength'], twice['noteCount']) == ('direct', 2)
    assert twice['evidence'][1]['from']['start'] > twice['evidence'][1]['to']['start']
    assert twice['evidence'][1]['from']['entityId'] == 'a'


@pytest.mark.parametrize('gap', ['。Day2→', ' 第三天→', ' 今天去逛街。明天再去', 'x' * 41 + '→'])
def test_cross_day_sentence_and_long_gap_are_excluded(gap):
    text = '甲店' + gap + '乙园'
    assert not mine([mention(1, 1, '甲店', text), mention(2, 1, '乙园', text)])['relations']


@pytest.mark.parametrize('barrier', ['unregistered', 'review', 'not_exported', 'low_frequency'])
def test_ineligible_middle_endpoint_is_not_removed_before_pairing(barrier):
    text = '甲店→未知地点→乙园'
    rows = [mention(1, 1, '甲店', text), mention(2, 1, '未知地点', text), mention(3, 1, '乙园', text)]
    cat = catalog()
    if barrier != 'unregistered':
        e = entity('c', '未知地点')
        if barrier == 'review':
            e['status'] = 'REVIEW'
        cat = catalog([entity('a', '甲店'), entity('b', '乙园'), e])
    options = {'eligible_entity_ids': {'a', 'b'}} if barrier == 'not_exported' else {}
    if barrier == 'low_frequency':
        rows += [mention(4, 2, '甲店', '甲店'), mention(5, 3, '乙园', '乙园')]
        options['min_mentions'] = 2
    assert not mine(rows, cat, **options)['relations']


def test_unextracted_known_location_and_external_surface_also_block_bridging():
    for options in ({}, {'extra_surfaces': ['丙塔入口']}):
        middle = '丙塔入口' if options else '丙塔'
        text = f'甲店→{middle}→乙园'
        assert not mine([mention(1, 1, '甲店', text), mention(2, 1, '乙园', text)], **options)['relations']


@pytest.mark.parametrize('middle', ['思南公guan', 'taste of china味餐厅', '未抽取地点'])
@pytest.mark.parametrize('arrow', ['→', '➡️', '->'])
def test_unrecognized_middle_route_segment_cannot_be_bridged(middle, arrow):
    text = f'甲店{arrow}{middle}{arrow}乙园'
    result = mine([mention(1, 1, '甲店', text), mention(2, 1, '乙园', text)])
    assert not result['relations']
    assert any(item.get('reason') == 'unbound_route_segment' for item in result['unresolved'])


def test_unbound_route_note_cannot_promote_one_valid_note_to_direct():
    rows = [mention(1, 1, '甲店', '甲店→乙园'), mention(2, 1, '乙园', '甲店→乙园'),
            mention(3, 2, '甲店', '甲店→思南公guan→乙园'), mention(4, 2, '乙园', '甲店→思南公guan→乙园')]
    relation = mine(rows)['relations'][0]
    assert relation['strength'] == 'weak'
    assert relation['noteCount'] == 1


def test_multiple_arrow_transport_annotation_is_conservatively_excluded():
    text = '甲店→地铁15分钟→乙园'
    assert not mine([mention(1, 1, '甲店', text), mention(2, 1, '乙园', text)])['relations']
    text = '甲店 地铁15分钟→乙园'
    assert pairs(mine([mention(1, 1, '甲店', text), mention(2, 1, '乙园', text)])) == {('a', 'b')}


def test_long_component_name_does_not_lend_position_to_parent_mention():
    cat = catalog([entity('a', '甲店'), entity('b', '乙园'), entity('c', '乙园东门')])
    text = '甲店→乙园东门'
    rows = [mention(1, 1, '甲店', text), mention(2, 1, '乙园', text)]
    assert not mine(rows, cat)['relations']
    rows.append(mention(3, 1, '乙园东门', text))
    assert pairs(mine(rows, cat)) == {('a', 'c')}


@pytest.mark.parametrize('suffix', ['北门', '西南门', '门口', '入口', '游客中心', '（南门）'])
@pytest.mark.parametrize('at_end', [False, True])
def test_unregistered_facility_suffix_does_not_bind_parent(suffix, at_end):
    text = f'甲店→乙园{suffix}' if at_end else f'乙园{suffix}出来就是甲店'
    rows = [mention(1, 1, '甲店', text), mention(2, 1, '乙园', text)]
    assert not mine(rows)['relations']


def test_named_facility_keeps_its_own_endpoint_and_full_confirmed_alias_can_bind():
    e = entity('b', '乙园')
    e['aliases'] = ['乙园公园']
    cat = catalog([entity('a', '甲店'), e, entity('c', '乙园北门')])
    text = '甲店→乙园北门'
    assert pairs(mine([mention(1, 1, '甲店', text), mention(2, 1, '乙园北门', text)], cat)) == {('a', 'c')}
    text = '甲店→乙园公园'
    assert pairs(mine([mention(1, 1, '甲店', text), mention(2, 1, '乙园', text)], cat)) == {('a', 'b')}


def test_ocr_only_and_normalized_name_cannot_create_a_text_endpoint():
    rows = [mention(1, 1, '未核实店', '甲店→乙园'), mention(2, 1, '乙园', '甲店→乙园')]
    rows[0]['normalized_name'] = '甲店'
    for row in rows:
        row['note_images'] = [{'text': '未核实店→乙园'}]
    result = mine(rows)
    assert not result['relations']
    assert any(item.get('reason') == 'no_text_occurrence' for item in result['unresolved'])


def test_same_entity_aliases_do_not_create_self_loop_and_inputs_remain_unchanged():
    e = entity('a', '甲店')
    e['aliases'] = ['甲馆']
    cat = catalog([e])
    text = '甲店→甲馆'
    rows = [mention(1, 1, '甲店', text), mention(2, 1, '甲馆', text)]
    before = copy.deepcopy(rows)
    assert not mine(rows, cat)['relations']
    assert rows == before


def test_duplicate_ids_and_inconsistent_note_snapshots_rejected():
    row = mention(1, 1, '甲店', '甲店→乙园')
    with pytest.raises(ValueError, match='重复提及ID'):
        mine([row, row])
    with pytest.raises(ValueError, match='不一致'):
        mine([row, mention(2, 1, '乙园', '乙园→甲店')])


def test_row_order_has_no_effect_on_relation_evidence():
    rows = [mention(1, 1, '甲店', '甲店→乙园'), mention(2, 1, '乙园', '甲店→乙园'),
            mention(3, 1, '甲店', '甲店→乙园')]
    assert mine(rows) == mine(list(reversed(rows)))
