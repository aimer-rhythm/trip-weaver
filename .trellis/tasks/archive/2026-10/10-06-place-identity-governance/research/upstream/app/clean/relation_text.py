"""地点关系文本规则；保持原无向关联语义，不负责身份确认。"""
import re
from app.clean.alias import _ALIAS_MAP

MAX_GAP = 40  # 相邻提及间最大间隔字符数
_SENT_BREAK = re.compile(r"[。！？；;!?\n\r]")  # 句末标点：两地点不同句
# 日程标记：gap 跨天说明两地点不在同一天行程，不算相邻关联
# 「D2」需排除地铁出口编号（「站D2口出」）
_DAY_BREAK = re.compile(
    r"day\s*\d|第\s*[0-9一二三四五六七八九十]+\s*天|(?<![A-Za-z0-9])d\s*\d(?!\s*[口出号])",
    re.IGNORECASE,
)
_CLAUSE_BREAK = re.compile(r"[，,、]")          # 分句标点
# gap 边界的标点属于前一个地点所在句/分句的末尾（如「神武门出，出门就是」的「，」）
_EDGE_TRIM = " \t\r\n。！？；;!?，,、：:"
_TAIL_WINDOW = 10  # 尾部多少字符内出现连接词才认为它紧邻后一个地点

# 顺序约束信号：祼「步行/走路」不算——它只说明可达，不代表先后（「步行可达」「步行街」误报来源）
_MUST_BEFORE = re.compile(r"出来就是|出门就是|出口就是|出园就是|出馆就是|出来对面|紧挨|挨着|分钟到|分钟至|即达|直达")
_VIEWPOINT = re.compile(r"俯瞰|眺望|正对|远观|隔.{0,4}(看|望)")
# 路线箭头：攻略里「A→B→C」表达游览顺序（单篇可能只是排版，故初始 weak，多篇共现升 direct）
_ARROW = re.compile(r"→|->|➡|➜|⇒|⇨|⏩|▶|⟶")
_COMBO = re.compile(r"顺路|再去|然后去|接着去|下一站|步行可达|连在一起")


def _build_vocab(city: str, canonical_names: list[str]) -> list[tuple[str, str]]:
    """(表层写法, 规范名) 列表：规范名自身 + 别名，长名优先（防「故宫」吃掉「故宫博物院」）。"""
    pairs: list[tuple[str, str]] = []
    alias_map = _ALIAS_MAP.get(city, {})
    for name in canonical_names:
        pairs.append((name, name))
    for alias, canonical in alias_map.items():
        if canonical in canonical_names:
            pairs.append((alias, canonical))
    # 长表层优先匹配；同长任意
    pairs.sort(key=lambda p: -len(p[0]))
    return pairs


def _find_mentions(text: str, vocab: list[tuple[str, str]]) -> list[tuple[int, int, str]]:
    """返回 [(start, end, canonical_name)]，位置有序、不重叠（先到先得，长名优先已排序）。"""
    hits: list[tuple[int, int, str]] = []
    occupied = [False] * (len(text) + 1)
    for surface, canonical in vocab:
        start = 0
        while True:
            idx = text.find(surface, start)
            if idx < 0:
                break
            end = idx + len(surface)
            if not any(occupied[idx:end]):
                hits.append((idx, end, canonical))
                for i in range(idx, end):
                    occupied[i] = True
            start = idx + 1
    hits.sort()
    return hits


def _tail_signal(core: str) -> bool:
    """连接词是否紧邻后一个地点（出现在 gap 尾部）。"""
    tail = core.rstrip(_EDGE_TRIM)[-_TAIL_WINDOW:]
    return bool(_MUST_BEFORE.search(tail) or _VIEWPOINT.search(tail))


def _is_related(gap: str) -> bool:
    """相邻两地点之间是否存在关联信号（不区分关系类型，统一为无向关联对）。

    gap 边界的标点属于前一句末尾，先剥掉（「神武门出，出门就是」不应因逗号判失败）。
    跨句末标点 → 两地点不在同一句，不算关联；跨日程标记（Day2/第3天）同理，两地点不同天。
    跨分句标点 → 仅当连接词紧邻后一个地点，或出现路线/共现词时才成立；否则连接词的
    宾语可能是 gap 里没点名的地物（「步行几分钟到珠市口地铁站，…去故宫」的「到」指地铁站）。
    """
    core = gap.lstrip(_EDGE_TRIM)
    if _SENT_BREAK.search(core) or _DAY_BREAK.search(core):
        return False
    if _CLAUSE_BREAK.search(core) and not _tail_signal(core):
        return bool(_ARROW.search(core) or _COMBO.search(core))
    return bool(
        _VIEWPOINT.search(core) or _MUST_BEFORE.search(core) or _ARROW.search(core) or _COMBO.search(core)
    )


def _pair_key(a: str, b: str) -> tuple[str, str]:
    """无向关联对的标准键（与出现顺序无关）。"""
    return (a, b) if a < b else (b, a)


