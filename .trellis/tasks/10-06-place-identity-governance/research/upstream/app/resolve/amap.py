"""坐标解析：天地图 POI 搜索优先 → 天地图地理编码回退 → 城市视野护栏。

解析策略：
1. 地名搜索 v2：同城精确名称/显式别名匹配，保留分店和子项
2. 同名异址或缺少精确 POI 时保持未知，不用 geocoder 猜测地点
3. 城市视野：geocoder 仅解析城市中心，作为 mapBound

坐标系：天地图回 CGCS2000（≈WGS-84），落库前转 GCJ-02（库内与 tripweaver 一致）。
天地图不下发 adcode，跨城护栏由视野框承担，不再依赖行政区划码。

关键教训：通用名词（"红墙"/"悬空栈道"）会被解析到外省同名地点。
视野框把结果限制在目标城市及近郊，框外一律丢弃。
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

import httpx

from app.config import settings
from app.resolve.geo import wgs84_to_gcj02

logger = logging.getLogger(__name__)

# 城市视野半径（度）：±1.5° ≈ 经向 165km。
# 0.5° 会裁掉城市下辖的远郊景区（千岛湖距杭州市中心约 150km，临安天屿山约 145km）
_CITY_BOUND_DEGREES = 1.5
_SEARCH_OK = 1000
_GEOCODER_OK = "0"
_INTERVAL = 0.35  # 天地图无公开 QPS 约定，沿用 tripweaver 的串行间隔

_lock = asyncio.Lock()
_last_call_at = 0.0
# 城市中心 WGS-84 缓存：(lat, lng)；None 表示该城市解析失败
_city_center_cache: dict[str, tuple[float, float] | None] = {}


class AmapError(RuntimeError):
    """坐标服务失败（历史类名，调用方按无结果降级）。"""


async def _throttle() -> None:
    global _last_call_at
    async with _lock:
        wait = _INTERVAL - (asyncio.get_event_loop().time() - _last_call_at)
        if wait > 0:
            await asyncio.sleep(wait)
        _last_call_at = asyncio.get_event_loop().time()


async def _tianditu_get(client: httpx.AsyncClient, api: str, params: dict) -> dict:
    """天地图 GET。搜索接口失败码在 status.infocode，geocoder 的失败是字符串 status。"""
    if not settings.tianditu_tk:
        raise AmapError("未配置 TIANDITU_TK")
    await _throttle()
    resp = await client.get(
        f"{settings.tianditu_base_url.rstrip('/')}{api}",
        params={**params, "tk": settings.tianditu_tk},
        timeout=10.0,
    )
    resp.raise_for_status()
    body = resp.json()
    status = body.get("status")
    if isinstance(status, dict) and status.get("infocode") not in (None, _SEARCH_OK):
        raise AmapError(f"天地图 {api} 失败: {status.get('cndesc')} (infocode={status.get('infocode')})")
    if isinstance(status, str) and status != _GEOCODER_OK:
        raise AmapError(f"天地图 {api} 失败: {body.get('msg') or status}")
    return body


def _parse_lonlat(raw: str) -> tuple[float, float] | None:
    """「lon,lat」串 → (lng, lat)。非法回 None。"""
    parts = (raw or "").split(",")
    if len(parts) != 2:
        return None
    try:
        lng, lat = float(parts[0]), float(parts[1])
    except ValueError:
        return None
    if lat == 0 and lng == 0:
        return None
    return lng, lat


def _parse_location(raw: Any) -> tuple[float, float] | None:
    """geocoder 的 location 对象 {lon, lat} → (lng, lat)。"""
    if not isinstance(raw, dict):
        return None
    try:
        lng, lat = float(raw.get("lon")), float(raw.get("lat"))
    except (TypeError, ValueError):
        return None
    if lat == 0 and lng == 0:
        return None
    return lng, lat


async def _geocode_wgs(keyword: str) -> tuple[float, float] | None:
    """天地图正向地理编码，返回 WGS-84 (lng, lat)。失败回 None。"""
    async with httpx.AsyncClient() as client:
        try:
            body = await _tianditu_get(
                client,
                "/geocoder",
                {"ds": json.dumps({"keyWord": keyword[:80]}, ensure_ascii=False)},
            )
        except (AmapError, httpx.HTTPError) as e:
            logger.debug("geocode 失败 %s: %s", keyword, e)
            return None
    return _parse_location(body.get("location"))


async def _city_center_wgs(city: str) -> tuple[float, float] | None:
    """城市中心 WGS-84 (lng, lat)，按城市缓存。"""
    if city in _city_center_cache:
        return _city_center_cache[city]
    center = await _geocode_wgs(city)
    _city_center_cache[city] = center
    return center


def _in_city_bounds(lng: float, lat: float, center: tuple[float, float]) -> bool:
    """点是否落在城市中心 ±视野半径内（WGS-84 度数比较）。"""
    c_lng, c_lat = center
    return abs(lng - c_lng) <= _CITY_BOUND_DEGREES and abs(lat - c_lat) <= _CITY_BOUND_DEGREES


def _to_result(lng: float, lat: float, address: str, poi_type: str = "") -> dict:
    """WGS-84 坐标转 GCJ-02 并组装落库字段。天地图无 adcode / poi id。"""
    gcj_lat, gcj_lng = wgs84_to_gcj02(lat, lng)
    return {
        "longitude": gcj_lng,
        "latitude": gcj_lat,
        "adcode": "",
        "address": address,
        "formatted_address": address,
        "poi_id": "",
        # poiType 是整数分类码，map_theme 按关键词匹配命不中，主题退回地点名兜底
        "amap_type": poi_type,
    }


def _core_name(name: str) -> str:
    from app.clean.identity import name_key

    return name_key(name)


async def poi_search(city: str, name: str, city_prefix: str = "") -> dict | None:
    """天地图地名搜索：城市视野 + 名称模糊匹配 + 结果落在视野内。

    city_prefix 保留签名兼容（旧调用方传入高德 adcode 前缀），天地图不使用。
    """
    del city_prefix
    center = await _city_center_wgs(city)
    if center is None:
        return None
    c_lng, c_lat = center
    bound = ",".join(
        f"{v:.6f}"
        for v in (
            c_lng - _CITY_BOUND_DEGREES,
            c_lat - _CITY_BOUND_DEGREES,
            c_lng + _CITY_BOUND_DEGREES,
            c_lat + _CITY_BOUND_DEGREES,
        )
    )
    post_str = json.dumps(
        {
            "keyWord": name[:80],
            "level": "12",
            "mapBound": bound,
            "queryType": "1",
            "start": 0,
            "count": 5,
        },
        ensure_ascii=False,
    )
    async with httpx.AsyncClient() as client:
        try:
            body = await _tianditu_get(client, "/v2/search", {"postStr": post_str, "type": "query"})
        except (AmapError, httpx.HTTPError) as e:
            logger.debug("poi_search 失败 %s%s: %s", city, name, e)
            return None
    from app.clean.alias import resolve_alias
    core = resolve_alias(name, city)
    matches = []
    for poi in body.get("pois") or []:
        poi_name = str(poi.get('name') or '')
        candidates = [poi_name, poi_name.removeprefix(city + '市'), poi_name.removeprefix(city)]
        if not core or not any(resolve_alias(candidate, city) == core for candidate in candidates):
            continue
        loc = _parse_lonlat(str(poi.get("lonlat") or ""))
        if loc is None or not _in_city_bounds(loc[0], loc[1], center):
            continue
        matches.append((poi, loc))
    locations = {(round(loc[0], 5), round(loc[1], 5)) for _, loc in matches}
    if len(locations) != 1:
        return None  # 同名不同位置必须消歧；不能默认选搜索第一项。
    poi, loc = matches[0]
    return _to_result(loc[0], loc[1], str(poi.get('address') or ''), str(poi.get('poiType') or ''))


async def geocode(city: str, name: str, city_prefix: str = "") -> dict | None:
    """天地图地理编码回退：'城市+地点名'，结果必须落在城市视野内。"""
    del city_prefix
    center = await _city_center_wgs(city)
    if center is None:
        return None
    loc = await _geocode_wgs(f"{city}{name}")
    if loc is None:
        return None
    if not _in_city_bounds(loc[0], loc[1], center):
        logger.debug("geocode 跨城丢弃 %s: %s,%s", name, loc[0], loc[1])
        return None
    return _to_result(loc[0], loc[1], "")


async def resolve_coordinates(city: str, name: str) -> dict[str, Any] | None:
    """组合解析：POI 搜索优先（有真实地址），地理编码回退。两者都受城市视野护栏。"""
    result = await poi_search(city, name)
    if result and result.get("latitude"):
        return result
    # geocoder 只返回一个猜测位置，缺少实体名称/POI 身份，不足以认定地点坐标。
    return None
