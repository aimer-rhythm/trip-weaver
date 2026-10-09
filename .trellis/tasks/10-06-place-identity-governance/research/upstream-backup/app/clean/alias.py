"""地点实体别名归一（同义地名 → 规范名）。

normalize_name（app/clean/dedup.py）只做文本规范化，无法识别
"故宫"/"故宫博物院"、"奥森"/"奥林匹克森林公园"这类语义同义名。

本模块维护 城市 → {别名: 规范名} 映射：提纯入库（extract）时把别名解析到规范名，
使同义地名在 (city, normalized_name) 维度自然聚合，而不是事后靠 POI 合并。

规范名选取原则：官方/更正式、更通用、无歧义（如"故宫博物院"而非口语"故宫"）。
别名来源：canonical_place 共享 amap_poi_id 的名称组 + 常见口语简称。

注意：城市维度必须保留——同一别名在不同城市指不同实体（如"太古里"
在北京=三里屯太古里，在成都=成都太古里）。
"""
from __future__ import annotations

from app.clean.dedup import normalize_name

# city -> {规范化别名: 规范名}
_ALIAS_MAP: dict[str, dict[str, str]] = {
    "杭州": {
        # 仅确定同一景点的称呼；不要合并西湖/断桥、灵隐寺/飞来峰、九溪烟树/十八涧。
        "断桥": "西湖断桥",
        "断桥残雪": "西湖断桥",
        "西湖苏堤": "苏堤",
        "苏堤春晓": "苏堤",
        "西溪国家湿地公园": "西溪湿地",
    },
    "北京": {
        # 用户明确指出的 case
        "故宫": "故宫博物院",
        "故宫博物馆": "故宫博物院",
        "天坛": "天坛公园",
        "奥森": "奥林匹克森林公园",
        "奥森公园": "奥林匹克森林公园",
        # 片区细分归并（高德 POI 不同，但语义上是同一片区的组成）
        "后海": "什刹海",
        "前门大栅栏": "大栅栏",
        "前门/大栅栏": "大栅栏",
        # 共享高德 POI 的确定同义组（排除子实体/语义差异组）
        "动物园": "北京动物园",
        "中国国家博物馆": "国家博物馆",
        "地坛": "地坛公园",
        "八达岭": "八达岭长城",
        "后海公园": "后海",
        "UCCA": "尤伦斯当代艺术中心",
        "什刹海银锭桥": "银锭桥",
        "金锭桥/银锭桥": "银锭桥",
        "太古里": "三里屯太古里",
        "太古里北区": "三里屯太古里北区",
        "太古里南区": "三里屯太古里南区",
        "文宇奶酪": "文宇奶酪店",
        "四季民福烤鸭": "四季民福烤鸭店",
        "雁栖湖北山栈道": "雁栖湖",
        "雁栖湖景区": "雁栖湖",
        "运河森林公园": "大运河森林公园",
        "双清别墅": "香山双清别墅",
    },
    "成都": {
        "锦里古街": "锦里",
        "锦里古街主巷": "锦里",
        "成都人民公园": "人民公园",
        "祠堂街人民公园": "人民公园",
        "大熊猫繁育研究基地": "成都大熊猫繁育研究基地",
        "都江堰景区": "都江堰",
        "太古里": "成都太古里",
        "杜甫草堂博物馆": "杜甫草堂",
        "武侯祠博物馆": "武侯祠",
        "奎星楼": "奎星楼街",
        "人民公园鹤鸣茶社": "鹤鸣茶社",
        "大慈寺庙": "大慈寺",
        "玉林街": "玉林",
        "洛带古镇主街": "洛带古镇",
    },
}


def resolve_alias(name: str, city: str) -> str:
    """归一地点名：先文本规范化，再按 (city, 别名) 映射到规范名。未命中返回原规范化名。"""
    norm = normalize_name(name)
    mapping = {normalize_name(a): normalize_name(c) for a, c in _ALIAS_MAP.get(city, {}).items()}
    seen: set[str] = set()
    current = norm
    while current in mapping:
        if current in seen:
            return norm  # 错误配置不得无限循环或任意挑一个实体。
        seen.add(current)
        target = mapping[current]
        if target == current:
            return current
        current = target
    return current


def aliases_for(city: str, canonical: str) -> list[str]:
    """反查：规范名 → 该城市的已知别名列表（供导出 payload.aliases，消费端自行展开）。"""
    norm = resolve_alias(canonical, city)
    return [a for a in _ALIAS_MAP.get(city, {}) if normalize_name(a) != norm and resolve_alias(a, city) == norm]


# 行程粒度归属不同于同义词：子项仍独立保存事实/坐标，导出时归入主地点。
# 只维护明确确认的组成关系，不能以字符串包含或同一POI自动扩散。
_PLANNING_GROUPS: dict[str, dict[str, tuple[str, ...]]] = {
    '北京': {
        '天安门': ('天安门广场', '天安门城楼', '天安门升旗', '天安门降旗', '天安门城楼外金水桥',
                 '天安门广场西广场01安检口', '天安门广场地下通道'),
        '奥林匹克森林公园': ('奥森南门', '奥森南园', '奥森公园银杏大道'),
    },
}


def canonical_display_name(name: str, city: str) -> str:
    """仅显式同义规则改展示名；不能借文本清洗去掉餐厅/酒店的分店名。"""
    norm = normalize_name(name)
    return resolve_alias(name, city) if norm in _ALIAS_MAP.get(city, {}) else name.strip()


def planning_name(name: str, city: str) -> str:
    canonical = canonical_display_name(name, city)
    for parent, members in _PLANNING_GROUPS.get(city, {}).items():
        if canonical == parent or canonical in members:
            return parent
    return canonical


def planning_members(name: str, city: str) -> list[str]:
    parent = planning_name(name, city)
    return [parent, *_PLANNING_GROUPS.get(city, {}).get(parent, ())]
