"""LLM 提纯：从笔记正文提取结构化地点（对齐 Yuntu extract.py）。

prompt 版本：xhs_full_v2_city_filter（含城市边界过滤，防跨城市污染）。
容错：非法 JSON → 剥 markdown 代码块 → 再失败标记 FAILED，不阻塞管道。
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from typing import Any

import httpx

from app.config import settings
from app.db import SessionFactory
from app.models import ExtractLog, PlaceMention

logger = logging.getLogger(__name__)

SYSTEM_PROMPT_TEMPLATE = """你是一个旅游数据分析助手。从小红书笔记中提取结构化旅游信息。

请严格按以下 JSON 格式输出（不要输出其他内容）：
{{
  "title": "笔记标题",
  "content_summary": "内容摘要，50 字内",
  "tags": ["标签1", "标签2"],
  "places": [
    {{
      "name": "地点名称",
      "place_type": "attraction|food|hotel|cafe|market|photo_spot|other",
      "mention_type": "recommend|warning",
      "sentiment": "positive|negative|neutral",
      "reason": "推荐或避坑理由，简洁 30 字内",
      "evidence_text": "原文中支持该判断的摘录，20 字内",
      "place_content": {{"highlights": [{{"text": "该地点的介绍或核心看点，保留不确定措辞", "quote": "逐字摘录支持这一看点的原文"}}]}},
      "route_order": 1,
      "visit_duration": 120,
      "confidence": 0.9
    }}
  ]
}}

规则：
1. 只提取属于【{city}】的地点，外市地点一律丢弃（跨城市污染是硬错误）
2. place_type=warning 时，reason 写避坑原因（如"需要提前预约""网红人多排队"）
3. mention_type=warning 且与预约相关时，额外输出 "reservation": true
4. visit_duration 为建议游玩时长（分钟）：原文提到时长（如"玩2小时""游览1.5小时""驻足40分钟"）时必须换算为分钟数字输出；只有原文完全未提时长时才填 null
5. reason 要具体，避免"不错""好看"这类空话
6. 地点 name 使用最通用的官方名称（如"故宫博物院"而非"故宫"、"奥林匹克森林公园"而非"奥森"），同一地点在不同笔记中保持同一名称
7. 无地点可提取时 places 输出空数组
8. place_content 只提取原文明示的地点定位、建筑、历史、景观与体验看点，最多4条；不把价格、预约、营业、闭馆、排队写进该字段。动态信息保留在reason/evidence_text中。排除神效承诺（如有求必应）、营销夸张（如封神）、当次客流/酒店距离和“正在盛放”等临时状态。每条text的所有事实都必须由同一quote支持。不补百科知识，不删“可能/据说/相传/约/秋季”等限定，没材料则highlights为空。
"""

_JSON_BLOCK_RE = re.compile(r"```(?:json)?\s*(.*?)\s*```", re.DOTALL)


def _extract_json(text: str) -> dict | None:
    """从 LLM 输出中稳健抽取 JSON：直接解析 → markdown 代码块 → 首尾括号截断。"""
    candidates: list[str] = []
    stripped = (text or "").strip()
    if stripped:
        candidates.append(stripped)
    for m in _JSON_BLOCK_RE.finditer(stripped):
        candidates.append(m.group(1))
    # 常见修复：去掉尾随杂文（从最后一个 } 截断）
    for cand in list(candidates):
        last = cand.rfind("}")
        if last > 0 and last < len(cand) - 1:
            candidates.append(cand[: last + 1])
    for cand in candidates:
        try:
            parsed = json.loads(cand)
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            continue
    return None


class LlmClient:
    """OpenAI 兼容 LLM 客户端（DeepSeek / OpenAI / 豆包…）。"""

    def __init__(self) -> None:
        self._client = httpx.AsyncClient(timeout=settings.llm_timeout_seconds)

    async def __aenter__(self) -> "LlmClient":
        return self

    async def __aexit__(self, *exc: Any) -> None:
        await self._client.aclose()

    async def chat_json(self, system: str, user: str) -> tuple[dict | None, dict[str, int]]:
        """返回 (解析后的 JSON, 用量)。内置 3 次重试（网络异常、输出非 JSON 都重试）。"""
        last_error: Exception | None = None
        for attempt in range(3):
            try:
                resp = await self._client.post(
                    f"{settings.llm_base_url.rstrip('/')}/chat/completions",
                    headers={"Authorization": f"Bearer {settings.llm_api_key}"},
                    json={
                        "model": settings.llm_model,
                        "messages": [
                            {"role": "system", "content": system},
                            {"role": "user", "content": user},
                        ],
                        "response_format": {"type": "json_object"},
                        "temperature": 0.2,
                        # 地点多的长笔记输出会超网关默认 8192，JSON 被截断 → 显式放宽上限
                        "max_tokens": settings.llm_max_tokens,
                        **({'thinking': {'type': 'disabled'}}
                           if settings.llm_model.lower() in ('deepseek-v4-flash', 'deepseek-v4-pro') else {}),
                    },
                )
                resp.raise_for_status()
                body = resp.json()
                # 兼容两种响应壳：标准 OpenAI 顶层 choices / 网关包装 data.choices（如 cline）
                payload = body.get("data") if isinstance(body.get("data"), dict) else body
                content = (payload.get("choices") or [{}])[0].get("message", {}).get("content", "")
                usage = payload.get("usage") or {}
                tokens = {
                    "tokens_in": int(usage.get("prompt_tokens") or 0),
                    "tokens_out": int(usage.get("completion_tokens") or 0),
                }
                parsed = _extract_json(content)
                if parsed is None:
                    # 非 JSON（截断/杂文）也重试：与网络异常同等待遇
                    last_error = RuntimeError("LLM 输出无法解析为 JSON")
                    logger.warning("LLM 输出非 JSON（第 %d/3 次）", attempt + 1)
                    if attempt < 2:
                        await asyncio.sleep(3 * (attempt + 1))
                        continue
                    return None, tokens
                return parsed, tokens
            except Exception as e:  # noqa: BLE001  网络/网关错误重试
                last_error = e
                logger.warning("LLM 调用失败（第 %d/3 次）: %s", attempt + 1, e)
                if attempt < 2:
                    await asyncio.sleep(3 * (attempt + 1))
        raise RuntimeError(f"LLM 调用 3 次全部失败: {last_error}") from last_error


def normalize_place(raw: dict) -> dict:
    """规范化单条地点输出：补默认值、清理空串。"""
    name = (raw.get("name") or "").strip()
    if not name:
        return {}
    visit_duration = raw.get("visit_duration")
    try:
        minutes = int(visit_duration) if visit_duration not in (None, "", "null") else None
    except (TypeError, ValueError):
        minutes = None
    return {
        "name": name,
        "place_type": str(raw.get("place_type") or "attraction"),
        "mention_type": str(raw.get("mention_type") or "recommend"),
        "sentiment": str(raw.get("sentiment") or "neutral"),
        "reason": (raw.get("reason") or "").strip(),
        "evidence_text": (raw.get("evidence_text") or "").strip(),
        "route_order": raw.get("route_order"),
        "confidence": float(raw.get("confidence") or 0.5),
        "reservation": bool(raw.get("reservation")),
        "visit_duration_minutes": minutes,
        "place_content": raw.get('place_content'),
    }


def mention_facts(place: dict, source: str) -> dict | None:
    from app.clean.place_content import validate_extracted_content
    facts = {}
    if place['visit_duration_minutes']:
        facts['minutes'] = place['visit_duration_minutes']
    if place['reservation']:
        facts['reservation'] = True  # 仅标“涉及预约”，不能解释成“必须预约”。
    content = validate_extracted_content(place.get('place_content'), source)
    if content:
        facts['placeContent'] = content
    return facts or None


async def extract_note(raw_note_id: int, title: str, desc: str, city: str, llm: LlmClient) -> ExtractLog:
    """对一条笔记执行提纯，写 ExtractLog + PlaceMention。失败标记 FAILED 不抛错。"""
    from app.clean.alias import resolve_alias

    started = time.monotonic()
    system = SYSTEM_PROMPT_TEMPLATE.format(city=city)
    user = f"标题：{title}\n正文：\n{desc[:4000]}"
    try:
        parsed, usage = await llm.chat_json(system, user)
    except Exception as e:  # noqa: BLE001  网络失败单条不中断管道
        logger.warning("提纯网络失败 raw_note_id=%s: %s", raw_note_id, e)
        parsed, usage = None, {"tokens_in": 0, "tokens_out": 0}
        error = f"网络失败: {e}"[:300]
    else:
        error = None
        status = "SUCCESS"
    latency_ms = int((time.monotonic() - started) * 1000)

    async with SessionFactory() as session:
        # 先建 ExtractLog（占位），失败也留痕
        log = ExtractLog(
            raw_note_id=raw_note_id,
            model=settings.llm_model,
            prompt_version=f'{settings.extract_prompt_version}:content-v1'[:64],
            status="SUCCESS",
            tokens_in=usage["tokens_in"],
            tokens_out=usage["tokens_out"],
            latency_ms=latency_ms,
        )
        session.add(log)
        await session.flush()

        if parsed is None:
            status = "FAILED"
            if error is None:
                error = "LLM 输出无法解析为 JSON"
            logger.warning("提纯失败 raw_note_id=%s error=%s", raw_note_id, error)
        else:
            places = parsed.get("places") or []
            for raw_place in places:
                p = normalize_place(raw_place)
                if not p:
                    continue
                session.add(
                    PlaceMention(
                        raw_note_id=raw_note_id,
                        extract_log_id=log.id,
                        name=p["name"],
                        normalized_name=resolve_alias(p["name"], city),
                        place_type=p["place_type"],
                        mention_type=p["mention_type"],
                        sentiment=p["sentiment"],
                        reason=p["reason"],
                        evidence_text=p["evidence_text"],
                        route_order=p["route_order"],
                        confidence=p["confidence"],
                        fact_type=(
                            "visit_duration"
                            if p["visit_duration_minutes"]
                            else ("reservation" if p["reservation"] else None)
                        ),
                        fact_value=mention_facts(p, f'{title}\n{desc[:4000]}'),
                    )
                )
            logger.info(
                "提纯成功 raw_note_id=%s 地点 %d 个（%dms）",
                raw_note_id,
                len(parsed.get("places") or []),
                latency_ms,
            )

        log.status = status
        log.error = error
        # 标记 raw 状态
        from sqlalchemy import update

        from app.models import RawNote

        await session.execute(
            update(RawNote)
            .where(RawNote.id == raw_note_id)
            .values(
                status="EXTRACTED" if status == "SUCCESS" else "FAILED",
                extract_log_id=log.id,
            )
        )
        await session.commit()
        return log


async def extract_all_pending(city: str) -> dict[str, int]:
    """批量提纯：处理该城市所有 status='RAW' 的笔记。返回统计。"""
    from sqlalchemy import select

    from app.models import RawNote

    async with SessionFactory() as session:
        rows = (
            await session.execute(
                select(RawNote)
                .where(RawNote.city == city, RawNote.status == "RAW")
                .order_by(RawNote.collected_count.desc())
            )
        ).scalars().all()

    logger.info("待提纯笔记 %d 条（城市=%s）", len(rows), city)
    ok = failed = 0
    async with LlmClient() as llm:
        for note in rows:
            # 串行提纯：避免触发网关限流；并发留待数据量大后加 semaphore
            log = await extract_note(note.id, note.title or "", note.desc or "", city, llm)
            if log.status == "SUCCESS":
                ok += 1
            else:
                failed += 1
    return {"ok": ok, "failed": failed}
