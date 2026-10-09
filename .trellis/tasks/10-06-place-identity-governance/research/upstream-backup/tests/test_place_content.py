"""地点内容、预约与归一化导出回归；不连接数据库或真实模型。"""
from copy import deepcopy
from app.clean.alias import resolve_alias, aliases_for, planning_name, canonical_display_name
from app.clean.place_content import reservation_policy, validate_extracted_content, build_place_content, legacy_highlights
from app.clean.place_export import consolidate_places
from scripts.repair_place_aliases import build_alias_plan
from scripts.refine_place_content import validate_profile, stable_sources
import pytest


def test_别名传递闭包与行程归属分离():
    assert resolve_alias('后海公园', '北京') == '什刹海'
    assert '后海公园' in aliases_for('北京', '什刹海')
    assert resolve_alias('奥森', '北京') == '奥林匹克森林公园'
    assert resolve_alias('天安门城楼', '北京') == '天安门城楼'
    assert planning_name('天安门城楼', '北京') == '天安门'
    assert planning_name('天安门城楼', '上海') == '天安门城楼'
    assert canonical_display_name('刘阿妹鸡公煲（雍和宫店）', '北京') == '刘阿妹鸡公煲（雍和宫店）'
    for name in ['故宫博物院', '中国国家博物馆', '奥林匹克公园', '西湖', '断桥']:
        assert planning_name(name, '北京') not in ['天安门', '奥林匹克森林公园']


def test_预约非空不等于必需_矛盾不择一():
    assert reservation_policy(['天坛公园无需预约'])['reservation'] == 'none'
    assert reservation_policy(['须实名预约'])['reservation'] == 'required'
    assert reservation_policy(['无需预约', '需预约'])['reservation'] == 'unknown'
    assert reservation_policy(['景山公园'])['reservation'] == 'unknown'
    assert reservation_policy(['旺季可能需要预约'])['reservation'] == 'unknown'


def test_提纯引文必须存在_不能删除不确定性():
    raw = {'highlights': [{'text': '可登万春亭俯瞰故宫', 'quote': '可登万春亭俯瞰故宫'}]}
    assert validate_extracted_content(raw, '景山可登万春亭俯瞰故宫。')
    assert validate_extracted_content(raw, '只介绍北海白塔') is None
    assert validate_extracted_content({'highlights': [{'text': '有古代遗迹', 'quote': '据说有古代遗迹'}]}, '据说有古代遗迹') is None


def _place(name, reservation='unknown', note='', hours=None):
    return {'id': name, 'name': name, 'lat': 39.9, 'lng': 116.4, 'category': '文化', 'payload': {
        'reservation': reservation, 'reservationNote': note, 'reservationEvidence': [note] if note else [],
        'openHours': hours, 'content': build_place_content([{'text': name + '可观赏历史建筑', 'sourceUrl': 'https://example.com/a'}], '2026-10-02')},
        'evidence': [{'kind': 'xhs_reservation', 'content': note, 'sourceUrl': 'https://example.com/a'}]}


def test_主景区唯一但城楼闭馆不污染广场():
    inputs = [_place('天安门'), _place('天安门广场', 'required', '广场预约参观'),
              _place('天安门城楼', 'required', '城楼需单独预约', {'closedWeekdays': [1]}),
              _place('奥森'), _place('奥林匹克森林公园'), _place('奥林匹克公园')]
    before = deepcopy(inputs)
    output = consolidate_places(inputs, '北京', '2026-10-02')
    assert {p['name'] for p in output} == {'天安门', '奥林匹克森林公园', '奥林匹克公园'}
    parent = next(p for p in output if p['name'] == '天安门')
    assert 'openHours' not in parent['payload']
    assert parent['payload']['reservation'] == 'unknown'
    assert any(c['name'] == '天安门城楼' and c['openHours']['closedWeekdays'] == [1] for c in parent['payload']['components'])
    assert '天安门城楼' not in parent['payload']['aliases']
    assert '天安门城楼' in parent['payload']['identity']['memberNames']
    assert inputs == before


def test_存量修复保留规范名ID并软停用重复项_可重跑():
    rows = [{'id': 1, 'name': '奥森', 'normalized_name': '奥森', 'is_active': True},
            {'id': 2, 'name': '奥林匹克森林公园', 'normalized_name': '奥林匹克森林公园', 'is_active': True}]
    changes = build_alias_plan(rows, '北京')
    assert changes[0]['targetId'] == 2
    assert changes[0]['after']['is_active'] is False
    for change in changes:
        next(r for r in rows if r['id'] == change['id']).update(change['after'])
    assert build_alias_plan(rows, '北京') == []
    assert build_alias_plan([{'id': 3, 'name': '餐厅（北京店）', 'normalized_name': '餐厅', 'is_active': True}], '北京') == []


def test_完整介绍必须有引文_不能补造统计数字():
    sources = [{'id': '1', 'text': '故宫是明清两代皇家宫殿，拥有六百年历史。', 'url': 'https://example.com/1', 'observedAt': '2026-10-02'}]
    valid = {'sentences': [{'text': '故宫是明清两代皇家宫殿。', 'sourceId': '1', 'quote': '故宫是明清两代皇家宫殿'}]}
    assert validate_profile(valid, sources, '2026-10-02')['intro'] == '故宫是明清两代皇家宫殿。'
    valid['sentences'][0]['text'] = '故宫有180万件文物。'
    assert validate_profile(valid, sources, '2026-10-02') is None


@pytest.mark.parametrize('text', ['有求必应，可祈福。', '成人票10元。', '需提前7天预约。',
    '24小时开放。', '从附近酒店步行即可到达。', '9点前人少。', '国家级审美。', '硫华菊正值盛放期。'])
def test_社区引文不等于可用事实(text):
    source = {'id': '1', 'text': text, 'url': 'https://example.com', 'observedAt': '2026-10-02'}
    errors = []
    raw = {'sentences': [{'text': text, 'quote': text, 'sourceId': '1'}]}
    assert validate_profile(raw, [source], '2026-10-02', errors) is None
    assert errors
    assert validate_extracted_content({'highlights': [{'text': text, 'quote': text}]}, text) is None
    assert build_place_content([{'text': text, 'sourceUrl': source['url']}], '2026-10-02')['intro'] == ''


def test_输入分层但不能拼接跨段引文():
    source = {'id': '1', 'text': '明清皇家宫殿。门票60元。沿中轴线分布主要殿宇。', 'url': 'https://example.com', 'observedAt': '2026-10-02'}
    cleaned = stable_sources([source])
    assert '门票' not in cleaned[0]['text']
    assert len(cleaned) == 2
    assert all(s['text'] in source['text'] for s in cleaned)
    raw = {'sentences': [{'text': '明清皇家宫殿。', 'quote': ''.join(s['text'] for s in cleaned), 'sourceId': cleaned[0]['id']}]}
    assert validate_profile(raw, cleaned, '2026-10-02') is None
    raw['sentences'][0].pop('quote')
    assert validate_profile(raw, cleaned, '2026-10-02')['highlights'][0]['quote'] == '明清皇家宫殿。'


def test_存量分句不剥掉季节和不确定性():
    rows = legacy_highlights('秋季可能看到红叶，山间层林尽染。需预约，现场即可入园。', 'https://example.com')
    assert [r['text'] for r in rows] == ['秋季可能看到红叶，山间层林尽染']
    assert stable_sources([{'id': 'nav', 'text': ': [在线订票](https://example.com)'}]) == []


def test_提纯请求仅已确认的DeepSeek模型关闭思考(monkeypatch):
    import asyncio
    import json
    import httpx
    from app.extract.llm_extract import LlmClient, settings
    async def run():
        for model in ['deepseek-v4-flash', 'custom-model']:
            seen = []
            def respond(request):
                seen.append(json.loads(request.content))
                return httpx.Response(200, json={'choices': [{'message': {'content': '{"ok":true}'}}]})
            monkeypatch.setattr(settings, 'llm_model', model)
            monkeypatch.setattr(settings, 'llm_base_url', 'https://example.com')
            async with LlmClient() as llm:
                await llm._client.aclose()
                llm._client = httpx.AsyncClient(transport=httpx.MockTransport(respond))
                result, _ = await llm.chat_json('test', 'test')
                assert result == {'ok': True}
            assert seen[0].get('thinking') == ({'type': 'disabled'} if model == 'deepseek-v4-flash' else None)
    asyncio.run(run())
