"""完整介绍入口、缺资料、校验拒绝、预览及逐条取消保护；不连接真实模型/数据库。"""
from __future__ import annotations
import asyncio
import json
from types import SimpleNamespace
import pytest
from app.extract import place_profiles as profiles


SOURCES = [
    {'id': 'a', 'text': '测试公园是一处历史园林，园内保存着古代建筑，整体格局沿中轴线展开，构成了层次分明的庭院景观。', 'url': 'https://example.com/a', 'observedAt': '2026-10-02'},
    {'id': 'b', 'text': '园内的古松与殿宇相映成趣，石桥连接两岸步道，可沿湖岸观察建筑倒影，并从不同角度欣赏传统园林景观。', 'url': 'https://example.com/b', 'observedAt': '2026-10-02'},
]


def setup_run(monkeypatch, places=None, review=None, save=True, cancel_at=None):
    places = places or [{'id': 1, 'name': '测试公园', 'before': None}]
    writes, calls = [], []
    async def select(*args):
        return places, [], len(places)
    async def sources(*args):
        return SOURCES
    async def research(city, name, **kwargs):
        return {'sources': await profiles.load_sources(city, name), 'cacheHit': False}
    async def persist(city, update):
        writes.append(update)
        return save
    class Client:
        async def __aenter__(self):
            return self
        async def __aexit__(self, *args):
            pass
        async def chat_json(self, system, user):
            calls.append(system)
            if cancel_at == len(calls):
                raise asyncio.CancelledError()
            if system == profiles.REVIEW_PROMPT:
                return (review if review is not None else {'approved': True, 'issues': []}), {}
            entry = json.loads(user)[0]
            assert all('originalText' not in source for source in entry['sources'])
            return {'profiles': [{'name': entry['name'], 'sentences': [
                {'text': s['text'], 'sourceId': s['id']} for s in entry['sources']]}]}, {}
    monkeypatch.setattr(profiles, 'select_places', select)
    monkeypatch.setattr(profiles, 'load_sources', sources)
    monkeypatch.setattr(profiles, 'research_place', research)
    monkeypatch.setattr(profiles, 'save_profile', persist)
    monkeypatch.setattr(profiles, 'LlmClient', Client)
    monkeypatch.setattr(profiles.settings, 'llm_api_key', 'test')
    return writes, calls


@pytest.mark.parametrize('limit', [0, 201, -1, True, 2.5, None, 'abc'])
def test_非法上限在访问库前拒绝(limit):
    with pytest.raises(RuntimeError):
        profiles.parse_options('北京', limit=limit)


def test_别名主实体和默认上限():
    options = profiles.parse_options('北京', '奥森，奥林匹克森林公园\n天安门城楼')
    assert options['names'] == ['奥林匹克森林公园', '天安门']
    assert options['limit'] == 20
    assert profiles.protected_profile({'method': 'source_grounded_editor', 'intro': '旧内容'})
    assert not profiles.complete_profile({'intro': '旧看点'})
    assert not profiles.complete_profile({'profileVersion': 1, 'qualityVersion': 2, 'intro': ' '})


@pytest.mark.parametrize('preview', [True, False])
def test_预览不写库_保存先有审计(monkeypatch, tmp_path, preview):
    writes, calls = setup_run(monkeypatch)
    path = tmp_path / 'report.json'
    if not preview:
        async def persist(city, update):
            audit = json.loads(path.read_text(encoding='utf-8'))
            assert audit['updates'][0]['before'] is None
            assert audit['updates'][0]['after']['intro']
            writes.append(update)
            return True
        monkeypatch.setattr(profiles, 'save_profile', persist)
    result = asyncio.run(profiles.refine_profiles('北京', preview=preview, report_path=path))
    assert result['generated'] == 1 and result['saved'] == int(not preview)
    assert len(writes) == int(not preview) and len(calls) == 2
    assert result['items'][0]['highlights'][0]['quote'] in [s['text'] for s in SOURCES]
    assert not any('review' in u['after'] for u in json.loads(path.read_text(encoding='utf-8'))['updates'])
    with pytest.raises(FileExistsError):
        asyncio.run(profiles.refine_profiles('北京', report_path=path))


def test_原文不足不调用模型(monkeypatch, tmp_path):
    writes, calls = setup_run(monkeypatch)
    async def empty(*args):
        return []
    monkeypatch.setattr(profiles, 'load_sources', empty)
    result = asyncio.run(profiles.refine_profiles('北京', report_path=tmp_path / 'r.json'))
    assert result['insufficient'] == 1
    assert not writes and not calls


def test_机器审稿拒绝不落库(monkeypatch, tmp_path):
    writes, _ = setup_run(monkeypatch, review={'approved': False, 'issues': ['主体混淆']})
    result = asyncio.run(profiles.refine_profiles('北京', report_path=tmp_path / 'r.json'))
    assert result['rejected'] == 1 and not writes
    assert '主体混淆' in result['items'][0]['reason']


def test_并发冲突保留当前内容(monkeypatch, tmp_path):
    setup_run(monkeypatch, save=False)
    result = asyncio.run(profiles.refine_profiles('北京', report_path=tmp_path / 'r.json'))
    assert result['conflicts'] == 1 and result['saved'] == 0


def test_取消保留此前逐条成功和报告(monkeypatch, tmp_path):
    writes, _ = setup_run(monkeypatch, places=[{'id': 1, 'name': '甲园', 'before': None},
        {'id': 2, 'name': '乙园', 'before': None}], cancel_at=3)
    path = tmp_path / 'r.json'
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(profiles.refine_profiles('北京', report_path=path))
    result = json.loads(path.read_text(encoding='utf-8'))['result']
    assert result['status'] == 'cancelled' and result['saved'] == 1
    assert len(writes) == 1


def test_选择仅补缺_上限不被已有内容占用(monkeypatch):
    rows = [SimpleNamespace(id=1, name='故宫博物院', content_profile={'method': 'source_grounded_editor'}),
            SimpleNamespace(id=2, name='天安门城楼', content_profile=None),
            SimpleNamespace(id=3, name='测试公园', content_profile=None),
            SimpleNamespace(id=4, name='另一个公园', content_profile=None)]
    queries = []
    class Session:
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def execute(self, query):
            queries.append(str(query))
            return SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: rows))
    monkeypatch.setattr(profiles, 'SessionFactory', Session)
    selected, skipped, eligible = asyncio.run(profiles.select_places('北京', [], 1))
    assert [p['id'] for p in selected] == [3] and eligible == 2
    assert skipped[0]['name'] == '故宫博物院'
    assert all(s in queries[0] for s in ['city =', 'is_active IS true', 'geo_status =', 'place_type ='])


@pytest.mark.parametrize('changed', ['profile', 'inactive', 'renamed'])
def test_持锁比较阻止并发改动(monkeypatch, changed):
    row = SimpleNamespace(is_active=True, geo_status='resolved', place_type='attraction', name='公园', content_profile=None)
    if changed == 'profile': row.content_profile = {'method': 'source_grounded_editor'}
    if changed == 'inactive': row.is_active = False
    if changed == 'renamed': row.name = '新名'
    class Session:
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def execute(self, query):
            assert 'FOR UPDATE' in str(query)
            return SimpleNamespace(scalar_one_or_none=lambda: row)
        async def commit(self): pytest.fail('并发变化不允许写入')
    monkeypatch.setattr(profiles, 'SessionFactory', Session)
    assert not asyncio.run(profiles.save_profile('北京', {'id': 1, 'name': '公园', 'before': None, 'after': {}}))


@pytest.mark.parametrize('enabled', [False, True])
def test_Web全链路开关及参数传递(monkeypatch, enabled):
    from app.web import jobs
    calls = []
    async def step(*args): return {}
    for name in ('crawl', 'extract', 'sync', 'build_theme_tags', 'build_tag_topics', 'build_visit_duration', 'summary', 'mine_relations', 'grade'):
        monkeypatch.setattr(jobs, 'job_' + name, step)
    async def content(params, record):
        calls.append(params)
        return {'saved': 1}
    monkeypatch.setattr(jobs, 'job_refine_content', content)
    result = asyncio.run(jobs.job_run_all({'city': '北京', 'with_content': enabled, 'content_limit': 7}, SimpleNamespace(result=None)))
    assert bool(calls) is enabled
    if enabled:
        assert calls == [{'city': '北京', 'limit': 7, 'preview': False, 'search_model': profiles.DEFAULT_SEARCH_MODEL}]
        assert result['place_content']['saved'] == 1


def test_CLI关闭及独立入口默认值一致(monkeypatch):
    import sys
    from app import cli
    from app.web.jobs import JOBS
    calls = []
    async def okay(args): pass
    async def content(args): calls.append(args)
    for name in ('init_db', 'crawl', 'extract', 'sync', 'summary', 'grade', 'report'):
        monkeypatch.setattr(cli, 'cmd_' + name, okay)
    monkeypatch.setattr(cli, 'cmd_refine_content', content)
    monkeypatch.setattr(sys, 'argv', ['app.cli', 'run-all', '--skip-content'])
    cli.main()
    assert not calls
    monkeypatch.setattr(sys, 'argv', ['app.cli', 'refine-content', '--city', '北京', '--preview'])
    cli.main()
    fields = {f.name: f.default for f in JOBS['refine-content'].fields}
    assert calls[0].limit == fields['limit'] == profiles.DEFAULT_LIMIT
    assert calls[0].preview is True


def test_补充资料拒绝错城与非法来源():
    with pytest.raises(RuntimeError):
        profiles.supplemental_sources({'city': '上海', 'places': {}}, '北京')
    with pytest.raises(RuntimeError):
        profiles.supplemental_sources({'city': '北京', 'places': {'公园': [{'text': '资料'}]}}, '北京')


def test_完整笔记不进入单点提纯输入(monkeypatch, tmp_path):
    setup_run(monkeypatch)
    async def sources(*args):
        return [{**s, 'originalText': s['text'] + '。其他景点有1000年历史。'} for s in SOURCES]
    monkeypatch.setattr(profiles, 'load_sources', sources)
    result = asyncio.run(profiles.refine_profiles('北京', preview=True, report_path=tmp_path / 'r.json'))
    assert result['generated'] == 1


def test_Web非法全链路参数在采集之前失败(monkeypatch):
    from app.web import jobs
    async def forbidden(*args):
        pytest.fail('参数非法时不应启动采集')
    monkeypatch.setattr(jobs, 'job_crawl', forbidden)
    with pytest.raises(RuntimeError):
        asyncio.run(jobs.job_run_all({'city': '北京', 'content_limit': 0}, SimpleNamespace(result=None)))


@pytest.mark.parametrize('text,quote', [
    ('地坛公园是北京一处从皇家坛庙走来的公园，承载着古坛的历史气息。', '从皇家坛庙走到'),
    ('南锣鼓巷是来北京必逛的胡同，适合city walk慢慢逛。', '来北京必逛的胡同'),
    ('南锣鼓巷和什刹海超多网红上房揭瓦咖啡店，真正有风韵的老胡同就在边上。', '南锣鼓巷和什刹海超多网红上房揭瓦咖啡店'),
])
def test_真实预览短引文扩写与营销不能由机器审稿豁免(text, quote):
    assert profiles.profile_support_errors({'highlights': [{'text': text, 'quote': quote}]})


def test_网页与模型知识可组合但不伪造引文():
    sentences = [{'text': s['text'], 'sourceId': s['id']} for s in SOURCES]
    sentences.append({'text': '漫步园中可以观察传统园林的空间布局与建筑细节。', 'basis': 'model_knowledge'})
    result = profiles.validate_profile({'sentences': sentences}, SOURCES, '2026-10-02', allow_knowledge=True)
    assert result and result['highlights'][-1]['sourceUrl'] is None
    assert result['highlights'][-1]['quote'] is None
    assert result['highlights'][-1]['strength'] == 'unverified'
    sentences[-1]['sourceId'] = 'a'
    assert profiles.validate_profile({'sentences': sentences}, SOURCES, '', allow_knowledge=True) is None


@pytest.mark.parametrize('text', ['园中有180万件文物。', '园林始建于明永乐十八年。', '这里无需预约。'])
def test_模型知识不能提供未经核实数字或政策(text):
    errors = []
    assert profiles.validate_profile({'sentences': [{'text': text, 'basis': 'model_knowledge'}]},
        SOURCES, '', errors, allow_knowledge=True) is None
    assert errors


def test_无小红书资料仍可通过网页生成(monkeypatch, tmp_path):
    writes, _ = setup_run(monkeypatch)
    async def research(*args, **kwargs):
        return {'sources': SOURCES, 'cacheHit': False}
    async def forbidden(*args):
        pytest.fail('完整介绍不得读取小红书摘录')
    monkeypatch.setattr(profiles, 'research_place', research)
    monkeypatch.setattr(profiles, 'load_sources', forbidden)
    result = asyncio.run(profiles.refine_profiles('北京', report_path=tmp_path / 'r.json'))
    assert result['saved'] == 1 and writes
    assert writes[0]['after']['method'] == 'web_research_with_model_knowledge'


def test_搜索失败不偷偷退回小红书或写入模型猜测(monkeypatch, tmp_path):
    writes, calls = setup_run(monkeypatch)
    async def failed(*args, **kwargs):
        raise RuntimeError('搜索不可用')
    monkeypatch.setattr(profiles, 'research_place', failed)
    result = asyncio.run(profiles.refine_profiles('北京', report_path=tmp_path / 'r.json'))
    assert result['search_failed'] == 1 and not writes and not calls


def test_一句可综合多个真实引文_不能借不存在的出处():
    sources = [
        {'id': 'a', 'text': '园林位于北京，园内保存着多处历史建筑和古树。', 'url': 'https://example.com/a', 'observedAt': ''},
        {'id': 'b', 'text': '园中的古塔始建于1420年，是园林的重要历史建筑。', 'url': 'https://example.com/b', 'observedAt': ''},
    ]
    raw = {'sentences': [{'text': '园林位于北京，园中古塔始建于1420年。', 'sourceIds': ['a', 'b']}]}
    result = profiles.validate_profile(raw, sources, '')
    assert result and len(result['highlights'][0]['citations']) == 2
    assert result['highlights'][0]['citations'][1]['quote'] == sources[1]['text']
    raw['sentences'][0]['sourceIds'] = ['a', 'missing']
    assert profiles.validate_profile(raw, sources, '') is None


def test_图片Markdown不进入介绍事实():
    assert profiles.stable_sources([{'id': 'img', 'text': '![](https://example.com/image.jpg)'}]) == []


def test_近似限定只约束使用到的数量事实():
    sources = [{'id': 'a', 'text': '可园仿苏州园林而建，约占地4亩，保留叠石假山与池榭。',
                'url': 'https://example.com/a', 'observedAt': ''}]
    raw = {'sentences': [{'text': '可园仿苏州园林而建，保留叠石假山与池榭。', 'sourceId': 'a'}]}
    assert profiles.validate_profile(raw, sources, '')
    raw['sentences'][0]['text'] = '可园占地4亩，保留叠石假山与池榭。'
    assert profiles.validate_profile(raw, sources, '') is None


def test_超长段落只舍弃末尾完整句不从句中截断():
    sentences = [{'text': SOURCES[i % 2]['text'], 'sourceId': SOURCES[i % 2]['id']} for i in range(5)]
    result = profiles.validate_profile({'sentences': sentences}, SOURCES, '')
    assert result and len(result['intro']) <= 200
    assert result['intro'] == ''.join(s['text'] for s in sentences[:len(result['highlights'])])
    assert len(result['highlights']) < 5
