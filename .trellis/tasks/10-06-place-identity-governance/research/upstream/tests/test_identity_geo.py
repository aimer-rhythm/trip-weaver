"""地图结果必须精确指向目标实体，不能借子串、分店或地理编码猜测。"""
import asyncio
from app.resolve import amap


def test_子地点同名异址与未知编码不能伪装成已解析(monkeypatch):
    async def center(*args):
        return 117, 36.6
    data = {'pois': []}
    async def response(*args, **kwargs):
        return data
    monkeypatch.setattr(amap, '_city_center_wgs', center)
    monkeypatch.setattr(amap, '_tianditu_get', response)
    for results, expected in [
        ([{'name': '老商埠停车场', 'lonlat': '117,36.6'}], False),
        ([{'name': '桔子酒店(大明湖店)', 'lonlat': '117,36.6'}], False),
        ([{'name': '老商埠', 'lonlat': '117,36.6'}, {'name': '老商埠', 'lonlat': '117.1,36.7'}], False),
        ([{'name': '济南老商埠', 'lonlat': '117,36.6', 'address': '经四路333号'}], True),
    ]:
        data['pois'] = results
        assert bool(asyncio.run(amap.poi_search('济南', '老商埠'))) is expected
    async def empty(*args):
        return None
    async def forbidden(*args):
        raise AssertionError('不能用缺少主体的编码结果兜底')
    monkeypatch.setattr(amap, 'poi_search', empty)
    monkeypatch.setattr(amap, 'geocode', forbidden)
    assert asyncio.run(amap.resolve_coordinates('济南', '未知地点')) is None
