"""坐标转换与城市视野护栏。"""
import asyncio

from app.resolve.amap import _in_city_bounds, _parse_location, _parse_lonlat
from app.resolve.geo import gcj02_to_wgs84, wgs84_to_gcj02

# tripweaver tianditu.test.ts 的上海向量：WGS-84 与 GCJ-02 偏差约 0.005°
_SHANGHAI_GCJ = (31.2304, 121.4737)


def test_wgs84_roundtrip():
    lat, lng = _SHANGHAI_GCJ
    back_lat, back_lng = wgs84_to_gcj02(*gcj02_to_wgs84(lat, lng))
    assert abs(back_lat - lat) < 1e-9
    assert abs(back_lng - lng) < 1e-9


def test_offset_is_hundreds_of_meters():
    """中国境内必须偏移；不偏移说明算法没生效，天地图坐标会整体偏几百米。"""
    lat, lng = wgs84_to_gcj02(*_SHANGHAI_GCJ)
    assert abs(lat - _SHANGHAI_GCJ[0]) > 0.001
    assert abs(lng - _SHANGHAI_GCJ[1]) > 0.001


def test_out_of_china_untouched():
    assert wgs84_to_gcj02(40.7, -74.0) == (40.7, -74.0)


def test_parse_lonlat():
    assert _parse_lonlat("121.47,31.23") == (121.47, 31.23)
    assert _parse_lonlat("") is None
    assert _parse_lonlat("0,0") is None
    assert _parse_location({"lon": "120.1", "lat": 30.2}) == (120.1, 30.2)
    assert _parse_location({"lon": "x"}) is None


def test_city_bounds():
    center = (120.0, 30.0)
    assert _in_city_bounds(120.4, 30.4, center)
    assert not _in_city_bounds(120.6, 30.0, center)


def test_live_resolve_hangzhou():
    """真实天地图：灵隐寺应解析到杭州，且坐标是 GCJ-02（与 WGS-84 有偏移）。"""
    from app.resolve.amap import resolve_coordinates

    result = asyncio.run(resolve_coordinates("杭州", "灵隐寺"))
    assert result is not None, "灵隐寺应能解析"
    assert 30.2 < result["latitude"] < 30.3
    assert 120.0 < result["longitude"] < 120.2
    assert result["address"], "POI 搜索应带回地址"
