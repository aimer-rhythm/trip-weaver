"""开放问答 MVP：LLM 意图解析 → SQL 确定性检索 → LLM 事实约束答案。

对齐 Yuntu 的「确定性核心 + 创造性外围」：
- 意图解析（LLM）：自然语言 → 结构化查询条件
- 检索（纯 SQL）：只查 is_active 的高可信地点，可回溯
- 答案组织（LLM）：只基于检索到的事实（含提及理由 + 图片提取的关键信息），不许编造
"""
from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any

import httpx
from sqlalchemy import or_, select
from sqlalchemy.dialects.postgresql import array

from app.clean.theme import THEMES
from app.config import settings
from app.db import SessionFactory
from app.models import CanonicalPlace, PlaceMention, PlaceSummary, RawNote

logger = logging.getLogger(__name__)

MAX_CANDIDATES = 12

# 路线式文本（整日行程/多点串联）不能当单点信息
_ROUTE_MARKERS = ("→", "Day", "DAY", "全天行程", "路线")

INTENT_PROMPT = """你是旅行问答的意图解析器。把用户问题转成结构化检索条件。

严格输出 JSON：
{{
  "place_types": ["attraction|food|hotel|cafe|market|photo_spot|other"],
  "themes": ["主题偏好，只能从下面给定集合中选"],
  "keywords": ["主题词，如 火锅/夜景/亲子"],
  "must_include": ["用户明确指定的具体地点名，如 洪崖洞/长江索道"],
  "avoid": ["要避开的地点名或类型"],
  "want_details": ["price|reservation|hours|tips|duration|route"],
  "explain": "一句话说明用户想问什么"
}}

可选 themes 集合（只能从中选，不要自造）：{themes}

关键规则：
1. **城市名（如“重庆”）绝不要放进 must_include 或 keywords**，城市已作为查询条件
2. must_include 只放用户明确点名的具体地点；泛问（“有哪些必去景点”）时留空数组
3. themes 仅在用户明确表达偏好时填（“自然风光”“历史人文”“看夜景”），否则留空数组
4. keywords 只放主题/类别词（夜景/火锅/亲子/小众），不要放地点名，也不要放“必去景点”这类空词
5. 无法确定时留空数组，不要编造
6. 只输出 JSON，不要其他内容
"""

ALIGN_PROMPT = """你是地名归一助手。把用户口头说的地点简称改写成该城市的官方名称。

城市：{city}
用户点名：{names}

规则：
1. 只改写确定是同一地点的简称，例如 奥森=奥林匹克森林公园、故宫=故宫博物院、国博=国家博物馆、鸟巢=国家体育场
2. 不确定就原样返回，不要猜
3. 不要编造该城市没有的地点，不要输出解释
4. 严格输出 JSON：{{"items":[{{"query":"奥森","official":"奥林匹克森林公园"}}]}}
"""

ANSWER_PROMPT = """你是旅行顾问。只根据下面提供的【事实材料】回答用户问题。

硬性要求：
1. 只能使用材料中出现的信息，不得编造地点、价格、时间
2. 每个结论后标注来源编号，如 [1]
3. 材料不足时说"资料里没有提到"，不要猜
4. 用简洁中文，分点作答，可给出行建议
5. 如果材料里有价格/预约/营业时间/提示，优先呈现这些实用信息
"""


@dataclass
class Candidate:
    """检索到的候选地点（含事实材料）。"""

    name: str
    place_type: str
    address: str | None
    quality_score: float
    recommend_score: float
    mention_count: int
    reasons: list[str] = field(default_factory=list)
    image_info: list[str] = field(default_factory=list)  # 图片提取的价格/预约/时间等
    source_url: str | None = None


def _extract_json(text: str) -> dict | None:
    candidates = [text or ""]
    block = re.search(r"```(?:json)?\s*(.*?)\s*```", text or "", re.DOTALL)
    if block:
        candidates.append(block.group(1))
    for cand in candidates:
        try:
            parsed = json.loads(cand)
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            last = cand.rfind("}")
            if last > 0:
                try:
                    parsed = json.loads(cand[: last + 1])
                    if isinstance(parsed, dict):
                        return parsed
                except json.JSONDecodeError:
                    continue
    return None


class LlmClient:
    def __init__(self) -> None:
        self._client = httpx.AsyncClient(timeout=settings.llm_timeout_seconds)

    async def __aenter__(self) -> "LlmClient":
        return self

    async def __aexit__(self, *exc: Any) -> None:
        await self._client.aclose()

    async def chat(self, system: str, user: str, *, json_mode: bool = False) -> str:
        payload: dict[str, Any] = {
            "model": settings.llm_model,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            "temperature": 0.2,
        }
        if json_mode:
            payload["response_format"] = {"type": "json_object"}
        for attempt in range(3):
            try:
                resp = await self._client.post(
                    f"{settings.llm_base_url.rstrip('/')}/chat/completions",
                    headers={"Authorization": f"Bearer {settings.llm_api_key}"},
                    json=payload,
                )
                resp.raise_for_status()
                body = resp.json()
                data = body.get("data") if isinstance(body.get("data"), dict) else body
                return (data.get("choices") or [{}])[0].get("message", {}).get("content", "")
            except Exception as e:  # noqa: BLE001
                logger.warning("问答 LLM 调用失败 %d/3: %s", attempt + 1, e)
                if attempt < 2:
                    import asyncio

                    await asyncio.sleep(3 * (attempt + 1))
        return ""


async def parse_intent(llm: LlmClient, question: str) -> dict:
    """LLM 意图解析 → 结构化条件。"""
    raw = await llm.chat(INTENT_PROMPT.format(themes=" / ".join(THEMES)), question, json_mode=True)
    parsed = _extract_json(raw) or {}
    return {
        "place_types": [t for t in (parsed.get("place_types") or []) if isinstance(t, str)],
        # 只保留合法主题，防 LLM 自造
        "themes": [t for t in (parsed.get("themes") or []) if t in THEMES],
        "keywords": [k for k in (parsed.get("keywords") or []) if isinstance(k, str)],
        "must_include": [k for k in (parsed.get("must_include") or []) if isinstance(k, str)],
        "avoid": [k for k in (parsed.get("avoid") or []) if isinstance(k, str)],
        "want_details": [k for k in (parsed.get("want_details") or []) if isinstance(k, str)],
        "explain": str(parsed.get("explain") or ""),
    }


async def retrieve(city: str, intent: dict, llm: LlmClient | None = None) -> list[Candidate]:
    """SQL 确定性检索：高可信地点 + 类型过滤 + 关键词加权排序。

    过滤策略（避免关键词硬过滤把结果掏空）：
    1. 基线：city + is_active (+ place_types)
    2. must_include（用户点名的具体地点）：name 匹配，命中则用；全空则降级忽略
    3. keywords（主题词）：不做硬过滤，命中 name/reasons 的加权排序
    """
    # 清理：剔除城市名与空词（LLM 偶尔把城市放进 must_include）
    must = await _align_must(
        llm,
        city,
        [k.strip() for k in intent.get("must_include", []) if k.strip() and city not in k],
    )
    keywords = [k.strip() for k in intent.get("keywords", []) if k.strip() and city not in k]
    themes = [t for t in intent.get("themes", []) if t in THEMES]

    async with SessionFactory() as session:
        image_rows = (
            (
                await session.execute(
                    select(RawNote.img_analysis).where(
                        RawNote.city == city, RawNote.img_analysis.is_not(None)
                    )
                )
            )
            .scalars()
            .all()
        )
        image_pool = _collect_image_facts(image_rows)

        rows = await _query_candidates(session, city, intent.get("place_types", []), must, themes)
        # 降级链：themes 过滤无结果 → 去掉 themes；must 也无结果 → 去掉 must
        if themes and not rows:
            logger.info("themes %s 无匹配，降级忽略", themes)
            rows = await _query_candidates(session, city, intent.get("place_types", []), must, [])
        if must and not rows:
            logger.info("must_include %s 无匹配，降级为基线检索", must)
            rows = await _query_candidates(session, city, intent.get("place_types", []), [], [])

        # 取来源 URL（批量）
        names = [r[1] for r in rows]
        src_map: dict[str, str] = {}
        if names:
            src_rows = (
                await session.execute(
                    select(PlaceMention.normalized_name, RawNote.source_url)
                    .join(RawNote, RawNote.id == PlaceMention.raw_note_id)
                    .where(PlaceMention.normalized_name.in_(names), RawNote.city == city)
                )
            ).all()
            for nm, url in src_rows:
                if url and nm not in src_map:
                    src_map[nm] = url

        candidates: list[Candidate] = []
        for pid, name, ptype, addr, qs, score, mc, top_reasons in rows:
            reasons = [r.get("reason", "") for r in (top_reasons or []) if isinstance(r, dict)][:4]
            candidates.append(
                Candidate(
                    name=name,
                    place_type=ptype,
                    address=addr,
                    quality_score=qs or 0.0,
                    recommend_score=score or 0.0,
                    mention_count=mc or 0,
                    reasons=[r for r in reasons if r],
                    image_info=_match_image_facts(image_pool, name),
                    source_url=src_map.get(name),
                )
            )

    # keywords 加权排序（名字命中强加权，理由命中次之），不丢弃任何候选
    if keywords:
        candidates.sort(key=lambda c: (_keyword_bonus(c, keywords), c.recommend_score), reverse=True)
    return candidates[:MAX_CANDIDATES]


async def _query_candidates(
    session: Any, city: str, place_types: list[str], must_names: list[str], themes: list[str] | None = None
) -> list[Any]:
    """执行一次候选 SQL（取上限 60 条供后续加权排序）。"""
    stmt = (
        select(
            CanonicalPlace.id,
            CanonicalPlace.name,
            CanonicalPlace.place_type,
            CanonicalPlace.address,
            CanonicalPlace.quality_score,
            PlaceSummary.recommend_score,
            PlaceSummary.mention_count_30d,
            PlaceSummary.top_reasons,
        )
        .join(PlaceSummary, PlaceSummary.canonical_place_id == CanonicalPlace.id)
        .where(CanonicalPlace.city == city, CanonicalPlace.is_active.is_(True))
    )
    if place_types:
        stmt = stmt.where(CanonicalPlace.place_type.in_(place_types))
    if themes:
        # JSONB ?| text[]：theme_tags 与给定主题有交集
        stmt = stmt.where(CanonicalPlace.theme_tags.op("?|")(array(themes)))
    if must_names:
        stmt = stmt.where(or_(*[CanonicalPlace.name.like(f"%{n}%") for n in must_names]))
    stmt = stmt.order_by(PlaceSummary.recommend_score.desc()).limit(60)
    return (await session.execute(stmt)).all()


def _expand_must(city: str, names: list[str]) -> list[str]:
    """静态别名表展开。精确命中才改，盖不住「奥森」这种简称。"""
    from app.clean.alias import resolve_alias

    out: list[str] = []
    for name in names:
        canonical = resolve_alias(name, city)
        if canonical not in out:
            out.append(canonical)
        if name not in out and name != canonical:
            out.append(name)
    return out


async def _align_must(llm: LlmClient | None, city: str, names: list[str]) -> list[str]:
    """先走别名表，再用 LLM 把简称改成官方名，最后仍用 SQL 核对库内地点。"""
    expanded = _expand_must(city, names)
    if not names or llm is None:
        return expanded
    raw = await llm.chat(
        ALIGN_PROMPT.format(city=city, names="、".join(names)),
        "只输出 JSON",
        json_mode=True,
    )
    parsed = _extract_json(raw) or {}
    officials = [
        str(item.get("official") or "").strip()
        for item in (parsed.get("items") or [])
        if isinstance(item, dict)
    ]
    aligned = _expand_must(city, [n for n in officials if n and city not in n])
    for name in aligned:
        if name not in expanded:
            expanded.append(name)
    if aligned:
        logger.info("地名归一：%s → %s", names, expanded)
    return expanded


def _keyword_bonus(c: Candidate, keywords: list[str]) -> int:
    """关键词加权：名字命中 +100，理由/类型命中 +30。"""
    bonus = 0
    joined_reasons = " ".join(c.reasons)
    for kw in keywords:
        if kw in c.name:
            bonus += 100
        elif kw in joined_reasons or kw == c.place_type:
            bonus += 30
    return bonus


def _collect_image_facts(image_rows: list[Any]) -> list[tuple[str, str]]:
    """收集图片事实池：[(事实文本, 图片全文)]，供按地点名匹配。"""
    pool: list[tuple[str, str]] = []
    for analysis in image_rows:
        for item in analysis or []:
            if not item.get("has_text"):
                continue
            text = str(item.get("text_content") or "")
            ki = item.get("key_info") or {}
            for field, label in (("price", "价格"), ("reservation", "预约"), ("hours", "营业时间"), ("tips", "提示")):
                val = ki.get(field)
                if val:
                    pool.append((f"{label}: {val}", text))
    return pool


def _match_image_facts(pool: list[tuple[str, str]], place_name: str) -> list[str]:
    """从图片事实池里筛出属于该地点的事实。

    严格匹配：**事实值本身**必须含地点名（而非整图文字含即算）。
    原因：一张图的文字常跨多个地点（“火锅人均73元；洪崖洞免费”），
    用整图文字判断会把“长江索道需提前预约”错配给洪崖洞。

    再按分隔符拆子句（价格/预约/营业时间这三类结构化的必须拆，
    “重庆动物园：当天可；洪崖洞：当天” → 只取“洪崖洞：当天”；
    提示类保留整句，因为叙述性建议拆开会丢语义）。

    按字段分组（价格/预约/营业时间/提示）各取前 2 条，避免某一类信息把其他类挤掉。
    """
    STRICT_LABELS = ("价格", "预约", "营业时间")
    by_field: dict[str, list[str]] = {}
    for fact, _text in pool:
        label, _, value = fact.partition(":")
        if not value:
            continue
        if label in STRICT_LABELS:
            segments = [s.strip() for s in re.split(r"[，,、；;\n]+", value) if s.strip()]
            kept = [
                s
                for s in segments
                if place_name in s and not any(m in s for m in _ROUTE_MARKERS)
            ]
            if not kept:
                continue
            merged = f"{label}: {'，'.join(kept)}"
        else:
            if place_name not in value or any(m in value for m in _ROUTE_MARKERS):
                continue
            merged = fact
        bucket = by_field.setdefault(label, [])
        if merged not in bucket:
            bucket.append(merged)
    out: list[str] = []
    for label in ("价格", "预约", "营业时间", "提示"):
        out.extend(by_field.get(label, [])[:2])
    return out


def build_material(candidates: list[Candidate]) -> str:
    """把候选拼成事实材料（编号供引用）。"""
    lines: list[str] = []
    for i, c in enumerate(candidates, 1):
        parts = [f"[{i}] {c.name}（{c.place_type}）"]
        if c.address:
            parts.append(f"地址：{c.address}")
        if c.reasons:
            parts.append("评价：" + "；".join(c.reasons))
        if c.image_info:
            parts.append("图片信息：" + "；".join(c.image_info))
        parts.append(f"热度：提及 {c.mention_count} 次")
        if c.source_url:
            parts.append(f"来源：{c.source_url}")
        lines.append("　".join(parts))
    return "\n".join(lines)


async def compose_answer(llm: LlmClient, question: str, candidates: list[Candidate]) -> str:
    """LLM 基于事实材料组织答案。"""
    if not candidates:
        return "资料库里没有匹配的地点。可以换个说法，或先采集更多该城市数据。"
    material = build_material(candidates)
    user = f"用户问题：{question}\n\n【事实材料】\n{material}"
    return (await llm.chat(ANSWER_PROMPT, user)).strip()


async def ask(question: str, city: str | None = None) -> dict:
    """问答入口。返回 {answer, intent, candidates}。"""
    city = city or settings.city
    async with LlmClient() as llm:
        intent = await parse_intent(llm, question)
        candidates = await retrieve(city, intent, llm)
        logger.info(
            "问答：意图 types=%s themes=%s keywords=%s → 候选 %d",
            intent["place_types"], intent.get("themes"), intent["keywords"], len(candidates),
        )
        answer = await compose_answer(llm, question, candidates)
    return {"answer": answer, "intent": intent, "candidates": candidates}
