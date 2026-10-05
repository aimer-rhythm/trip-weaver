"""营业/闭馆时间结构化挖掘（供导出 tripweaver payload.openHours）。

输入：该地点的笔记文本 + 证据语料 + 图片提取事实。
输出：{text, openTime, closeTime, closedWeekdays, note} 或 None。

设计：规则挖掘而非 LLM——营业时间表述高度模板化，正则足够；保持确定性、可回归。
区分「营业时间」与「放票时间」：「20:00放票」是预约信息，不是开放时段。
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import urlsplit, urlunsplit

# 星期 → closedWeekdays 数字（0=周日 … 6=周六，对齐 tripweaver 排程 isClosedOnDate）
_WEEKDAY = {"日": 0, "天": 0, "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6}

# 闭馆：周X闭馆/休息/不开放/不营业；支持「周一、周二闭馆」「每周一闭馆」
_CLOSED_RE = re.compile(
    r"(?:每?周|星期)([日天一二三四五六])(?:[、，]周?([日天一二三四五六]))?\s*(?:闭馆|闭园|休息|不开放|不营业|不对外)"
)
# 营业时段：08:30-17:00 / 9:00~16:30 / 9点-17点；排除放票语境
_OPEN_RANGE_RE = re.compile(
    r"(\d{1,2})[:：点时](\d{2})?\s*[-–—~至到]\s*(\d{1,2})[:：点时](\d{2})?"
)
# 排除语境：放票/抢票/开售 前后出现的时间不是营业时间
_TICKET_CONTEXT = re.compile(r"(放票|抢票|开售|预售|预约放号)")
# 停止入场
_STOP_ENTRY_RE = re.compile(r"(闭馆前\d+\s*分钟停止[检入]|(\d{1,2})[:：点时](\d{2})?后?停止(?:入场|入园|检票|售票)|停止入场|停止入园)")
_24H_RE = re.compile(r"24\s*小时|全天开放|全天开放|全天候")


def _wd(ch: str) -> int:
    return _WEEKDAY[ch]


def _parse_time(h: str, m: str | None) -> str | None:
    hh = int(h)
    mm = int(m) if m else 0
    if hh > 24 or mm > 59:
        return None
    return f"{hh:02d}:{mm:02d}"


def _mine_hours(texts: list[str]) -> dict | None:
    """从一组文本中挖营业/闭馆结构化信息。无命中返回 None。"""
    open_time: str | None = None
    close_time: str | None = None
    closed: set[int] = set()
    notes: list[str] = []
    raw_hits: list[str] = []

    for raw in texts:
        if not raw:
            continue
        text = str(raw)
        # 闭馆
        for m in _CLOSED_RE.finditer(text):
            closed.add(_wd(m.group(1)))
            if m.group(2):
                closed.add(_wd(m.group(2)))
            raw_hits.append(text)
        # 24 小时
        if _24H_RE.search(text):
            open_time = open_time or "00:00"
            close_time = close_time or "23:59"
            raw_hits.append(text)
        # 时段（排除放票语境；末尾紧跟「停止入场」的是停止检票时间，不是闭馆时间）
        for m in _OPEN_RANGE_RE.finditer(text):
            start_i, end_i = m.start(), m.end()
            window = re.split(r"[，,；;。]", text[:start_i])[-1][-8:] + m.group() + re.split(r"[，,；;。]", text[end_i:])[0][:8]
            if _TICKET_CONTEXT.search(window):
                continue
            if text[end_i: end_i + 4].startswith("停止"):
                continue
            ot = _parse_time(m.group(1), m.group(2))
            ct = _parse_time(m.group(3), m.group(4))
            if ot and ct and ot < ct:
                if open_time is None:
                    open_time, close_time = ot, ct
                    raw_hits.append(text)
        # 停止入场/停止检票
        sm = _STOP_ENTRY_RE.search(text)
        if sm:
            seg = text[sm.start(): sm.end()].strip()
            if seg not in notes:
                notes.append(seg[:40])

    if not (open_time or closed or notes):
        return None

    # 组装 text 摘要
    parts: list[str] = []
    if open_time and close_time:
        parts.append(f"{open_time}-{close_time}")
    if closed:
        wd_label = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"]
        parts.append("、".join(wd_label[d] for d in sorted(closed)) + "闭馆")
    if notes:
        parts.append(notes[0])
    return {
        "text": "；".join(parts),
        "openTime": open_time,
        "closeTime": close_time,
        "closedWeekdays": sorted(closed),
        "note": "；".join(notes[:2]) if notes else "",
        "evidence": list(dict.fromkeys(raw_hits))[:3],
    }


@dataclass(frozen=True)
class HoursEvidence:
    """target只是候选归属；scope=place须由调用方提供已确认的单实体来源。"""
    target: str
    text: str
    source_url: str = ""
    scope: str = "unattributed"
    source_kind: str = "text"


_SUBJECT_HINT = re.compile(r"(?:馆内|园内|景区内|其中|内的|内部).{0,8}(?:馆|厅|楼|餐厅|咖啡|设施)|(?:各|其他|附近|旁边).{0,8}(?:博物馆|场馆|餐厅)")
_ENTITY = re.compile(r"[\u4e00-\u9fffA-Za-z]{2,20}(?:博物院|博物馆|纪念馆|美术馆|展览馆|展厅|餐厅|咖啡馆|公园|景区|寺|街|城楼)")
_FACILITY = re.compile(r"(?:馆内|园内|景区内)?(?:商铺|商店|店铺|展厅|餐厅|咖啡厅|内部场馆|部分场馆)")
_SIGNAL = re.compile(r"(?:每?周|星期)[日天一二三四五六]|24\s*小时|全天开放|全天候|\d{1,2}[:：点时]|停止[入检]")


def mine_open_hours(records: list[HoursEvidence], *, target: str,
                    aliases: list[str] | tuple[str, ...] = (),
                    known_names: list[str] | tuple[str, ...] = ()) -> dict | None:
    """先按实体划分原句，再提取；未知/其他主体只留审阅证据，不生成确定营业事实。"""
    own = {target, *aliases} - {""}
    names = sorted({*known_names, *own} - {""}, key=lambda name: (-len(name), name))
    accepted: list[dict] = []
    rejected: list[dict] = []
    for record in records:
        if not isinstance(record, HoursEvidence):
            raise TypeError("营业提取必须传 HoursEvidence，不能把无归属字符串当单实体事实")
        if not record.text or not isinstance(record.text, str):
            continue
        for sentence in re.split(r"[；;。！？!?\n]+", record.text):
            if not _mine_hours([sentence]):
                continue
            # 优先最长实体，避免父名/别名匹配覆盖子设施。保留位置而非裁掉主体。
            spans: list[tuple[int, int, str]] = []
            for name in names:
                for match in re.finditer(re.escape(name), sentence):
                    if not any(match.start() < end and match.end() > start for start, end, _ in spans):
                        spans.append((match.start(), match.end(), name))
            for match in [*_ENTITY.finditer(sentence), *_FACILITY.finditer(sentence)]:
                if not any(match.start() < end and match.end() > start for start, end, _ in spans):
                    spans.append((match.start(), match.end(), match.group()))
            spans.sort()
            # 多实体同句也拆开：目标全日开放后紧跟别馆闭馆，不能合并成目标的规则。
            chunks = [(sentence, None)] if not spans else [
                (sentence[start:(spans[i + 1][0] if i + 1 < len(spans) else len(sentence))], name)
                for i, (start, _end, name) in enumerate(spans)]
            if spans and _mine_hours([sentence[:spans[0][0]]]):
                chunks.insert(0, (sentence[:spans[0][0]], None))
            for clause, owner in chunks:
                parsed = _mine_hours([clause])
                if not parsed:
                    continue
                reason = None
                if record.target not in own:
                    reason = "record_target_mismatch"
                elif record.scope == "component" or _SUBJECT_HINT.search(clause):
                    reason = "component_or_other_scope"
                elif owner is not None and owner not in own:
                    reason = "other_entity"
                elif owner is None and record.scope != "place":
                    reason = "unknown_subject"
                elif owner in own:
                    # 有目标名仍不够：主语和营业谓语之间出现未知子设施/另一个主体则待审。
                    tail = clause[len(owner):]
                    signal = _SIGNAL.search(tail)
                    prefix = tail[:signal.start()] if signal else tail
                    if prefix.strip(" ：:，,()（）的每营业开放时间为是于 "):
                        reason = "ambiguous_subject"
                url = urlsplit(record.source_url)
                source_url = urlunsplit((url.scheme, url.netloc, url.path, '', '')) if url.scheme in ('http', 'https') else ''
                item = {"target": target, "subject": owner, "scope": record.scope, "sentence": sentence.strip(),
                        "clause": clause.strip(), "rawText": record.text, "sourceUrl": source_url,
                        "sourceKind": record.source_kind}
                if reason:
                    rejected.append({**item, "reason": reason})
                else:
                    accepted.append(item)
    if not accepted and not rejected:
        return None
    result = _mine_hours([item["clause"] for item in accepted]) or {
        "text": "", "openTime": None, "closeTime": None, "closedWeekdays": [], "note": "", "evidence": []}
    result.update(version=2, subject=target, scope="place", status="attributed" if accepted else "unknown",
                  attributions=accepted, review=rejected)
    return result
