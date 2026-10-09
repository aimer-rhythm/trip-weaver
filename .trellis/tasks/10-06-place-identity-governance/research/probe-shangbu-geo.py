"""只读核对地图原始 POI；不打印请求凭据，不写数据库。"""
import asyncio
import argparse
import json
import logging
import sys
from pathlib import Path
sys.path.insert(0, 'D:/Project/xhs-travel-pipeline')
sys.dont_write_bytecode = True
sys.stdout.reconfigure(encoding='utf-8')
logging.getLogger('httpx').setLevel(logging.WARNING)
from app.resolve.amap import _tianditu_get, _city_center_wgs, _to_result, _parse_lonlat
import httpx

def safe_error(error):
    # httpx异常字符串包含带tk的请求URL；只记录错误类型和状态码。
    result = {'type': type(error).__name__}
    if isinstance(error, httpx.HTTPStatusError):
        result['statusCode'] = error.response.status_code
    return result

async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--hangzhou', action='store_true')
    parser.add_argument('--city')
    parser.add_argument('--names', nargs='+')
    parser.add_argument('--bare-names', action='store_true')
    parser.add_argument('--out')
    args = parser.parse_args()
    output = []
    city = args.city or ('杭州' if args.hangzhou else '济南')
    root = Path(__file__).resolve().parent
    path = (root / (args.out or ('hangzhou-geo.json' if city == '杭州' else 'shangbu-geo.json'))).resolve()
    if not path.is_relative_to(root) or path.exists():
        raise ValueError('证据输出须在research内且不能覆盖已有文件')
    gate = root / 'map-credential-rotation-required.json'
    if gate.exists() and json.loads(gate.read_text(encoding='utf-8')).get('status') == 'rotation_required':
        raise RuntimeError('地图凭据待轮换；暂停联网地图探针')
    names = args.names or (['灵隐寺'] if city == '杭州' else ['融汇老商埠', '经三路老商埠', '老商埠'])
    center = await _city_center_wgs(city)
    if center is None:
        raise RuntimeError('地图城市中心未返回，不能核实坐标')
    path.parent.mkdir(parents=True, exist_ok=True)
    path.touch(exist_ok=False)
    async with httpx.AsyncClient() as client:
        for name in names:
            keyword = name if args.bare_names else f'{city}{name}'
            try:
                body = await _tianditu_get(client, '/v2/search', {'postStr': json.dumps({'keyWord': keyword,
                    'level': '12', 'mapBound': ','.join(str(v) for v in [center[0]-.2,center[1]-.2,center[0]+.2,center[1]+.2]),
                    'queryType': '1', 'start': 0, 'count': 10}, ensure_ascii=False), 'type': 'query'})
            except Exception as error:
                output.append({'query': name, 'keyword': keyword, 'matched': False, 'error': safe_error(error)})
                path.write_text(json.dumps(output, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
                print(json.dumps({'file': str(path), 'rows': len(output), 'error': safe_error(error)}, ensure_ascii=False))
                return 1
            pois = body.get('pois') or []
            if not pois:
                output.append({'query': name, 'keyword': keyword, 'matched': False})
            for poi in pois:
                loc = _parse_lonlat(poi.get('lonlat', ''))
                output.append({'query': name, 'keyword': keyword, 'matched': True, 'name': poi.get('name'), 'address': poi.get('address'),
                    'lonlat': poi.get('lonlat'), 'coordinateSystem': 'CGCS2000',
                    'gcj02': _to_result(*loc, poi.get('address', '')) if loc else None})
            path.write_text(json.dumps(output, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'file': str(path), 'queries': len(names), 'rows': len(output)}, ensure_ascii=False))
    return 0

if __name__ == '__main__':
    try:
        code = asyncio.run(main())
    except Exception as error:
        print(json.dumps({'error': safe_error(error)}, ensure_ascii=False))
        code = 1
    raise SystemExit(code)
