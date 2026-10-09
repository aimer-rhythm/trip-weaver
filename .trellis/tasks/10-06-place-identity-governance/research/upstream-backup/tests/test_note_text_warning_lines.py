"""相邻两行地点名与原评价逐字保全，拒绝截断、改写、混合主体和空行。"""
from __future__ import annotations

import copy

import pytest

from app.clean.note_text_warnings import validate_text_warnings, warning_input


def packet(quote):
    note = {'city': '成都', 'title': '攻略', 'desc': '作者体验，仅供参考。', 'unavailable': False,
            'images': [{'text_content': '🧭景点评价\n'+quote+'\n\n另一地点'}],
            'observedAt': '2026-09-21T00:00:00Z', 'publishedAt': '2026-09-20T00:00:00Z'}
    text = note['images'][0]['text_content']
    item = {**warning_input(1, 0, note), 'entityId': 'tea', 'start': text.index(quote),
            'end': text.index(quote)+len(quote), 'quote': quote}
    context = {'city': '成都', 'notes': {1: note}, 'confirmed_ids': {'tea'},
               'entities': {'tea': {'city': '成都', 'canonical_name': '鹤鸣茶社',
                                   'aliases': ['人民公园鹤鸣茶社'], 'status': 'ACTIVE'}}}
    return item, context


@pytest.mark.parametrize('separator', ['\n', '\r\n', '\r', '\u2028', '\u2029'])
@pytest.mark.parametrize('lines', [('可以不去', '鹤鸣茶社'), ('人民公园鹤鸣茶社', '人很多，时间紧可以不去。')])
def test_原换行位置和否定词原样保留(separator, lines):
    quote = separator.join(lines)
    item, context = packet(quote)
    result = validate_text_warnings([item], **context)
    assert result == [item] and result[0]['quote'] == quote
    result[0]['quote'] = '改写'
    assert item['quote'] == quote, '校验返回深拷贝，不能反向修改已冻结原文'


@pytest.mark.parametrize('quote', ['可以不去\n\n鹤鸣茶社', '可以不去\n鹤鸣茶社\n人很多',
    '鹤鸣茶社人很多\n可以不去', '可以不去\n鹤鸣茶社、乙茶馆', '鹤鸣\n茶社可以不去',
    '可以不去\n 鹤鸣茶社', '可以不去 \n鹤鸣茶社'])
def test_拒绝非完整主体行或跨段组合(quote):
    item, context = packet(quote)
    with pytest.raises(ValueError):
        validate_text_warnings([item], **context)


@pytest.mark.parametrize('case', ['trim_negation', 'replace', 'reorder', 'stale_text', 'stale_date'])
def test_跨行仍拒绝否定剪裁和原文日期变化(case):
    item, context = packet('不要因为照片就去\n鹤鸣茶社')
    original = copy.deepcopy(item)
    if case == 'trim_negation':
        item['start'] += 2
        item['quote'] = item['quote'][2:]
    elif case == 'replace':
        item['quote'] = '一定要去\n鹤鸣茶社'
    elif case == 'reorder':
        item['quote'] = '\n'.join(reversed(item['quote'].splitlines()))
    elif case == 'stale_text':
        context['notes'][1]['images'][0]['text_content'] += '内容变化'
    else:
        context['notes'][1]['publishedAt'] = '2026-09-22T00:00:00Z'
    with pytest.raises(ValueError):
        validate_text_warnings([item], **context)
    assert original['quote'] == '不要因为照片就去\n鹤鸣茶社'
