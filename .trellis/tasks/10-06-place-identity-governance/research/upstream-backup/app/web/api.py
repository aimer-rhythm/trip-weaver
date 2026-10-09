"""Web API 路由：任务触发 / SSE 日志 / 库状态 / 地点与笔记浏览 / 问答 / 配置自检。"""
from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse, HTMLResponse
from pydantic import BaseModel, Field as PydanticField, ValidationError
from sqlalchemy import func, select

from app.config import Settings, settings, write_env
from app.db import SessionFactory, init_db
from app.models import (
    CanonicalPlace,
    City,
    CrawlTask,
    NoteImage,
    PlaceMention,
    PlaceRelation,
    PlaceSummary,
    RawNote,
)
from app.web.jobs import JOBS, TRIPWEAVER_SEED_SCRIPT
from app.web.tasks import TaskConflict, TaskManager

manager = TaskManager(JOBS)
router = APIRouter(prefix="/api")


@router.get('/photography/review', response_class=HTMLResponse)
async def photography_review(city: str = Query(min_length=1, max_length=64),
                             run_id: str = Query(pattern='^[a-f0-9]{16}$')):
    from app.photography.pipeline import DEFAULT_ROOT
    from app.photography.store import PhotoStore
    path = PhotoStore(DEFAULT_ROOT, city).path(f'runs/{run_id}/review.html')
    if not path.is_file():
        raise HTTPException(status_code=404, detail='摄影审核页不存在，请先运行摄影任务')
    return HTMLResponse(path.read_text('utf-8'), headers={
        'Content-Security-Policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'",
        'X-Content-Type-Options': 'nosniff',
    })


# ---- 请求体 ----


class TaskRequest(BaseModel):
    kind: str = PydanticField(description="作业标识，见 GET /api/config 的 jobs")
    params: dict[str, Any] = PydanticField(default_factory=dict)


class AskRequest(BaseModel):
    question: str
    city: str | None = None


class CityRequest(BaseModel):
    name: str = PydanticField(description="城市名，如 厦门")


class SettingsUpdate(BaseModel):
    values: dict[str, str] = PydanticField(description=".env 键 → 新值；只接受配置页标 editable 的项")


# ---- 辅助 ----


def _mask_url(url: str) -> str:
    """隐藏数据库密码后再回给前端。"""
    if "@" not in url or "//" not in url:
        return url
    head, tail = url.split("//", 1)
    creds, rest = tail.split("@", 1)
    user = creds.split(":", 1)[0]
    return f"{head}//{user}:***@{rest}"


# 配置页：.env 各项 → 分组展示（敏感值打码，只回显是否配置）
# 每项：(Settings 属性名, .env 里的 key, 是否敏感, 说明)
# editable=True 的组可由界面改值（写回 .env + 同步内存）；敏感项不给编辑，
# 因为回显的是打码值，回写会把真值砸掉。XHS_COOKIE 的变更入口是「扫码更新」。
SETTINGS_GROUPS: tuple[tuple[str, str, bool, tuple[tuple[str, str, bool, str], ...]], ...] = (
    (
        "数据库",
        "PostgreSQL 连接串（需先手动建库）",
        False,
        (("database_url", "DATABASE_URL", True, "密码已打码；改完需重启后端"),),
    ),
    (
        "LLM 提纯",
        "任意 OpenAI 兼容网关",
        False,
        (
            ("llm_base_url", "LLM_BASE_URL", False, "如 https://api.deepseek.com/v1"),
            ("llm_api_key", "LLM_API_KEY", True, "缺失则无法提纯"),
            ("llm_model", "LLM_MODEL", False, "如 deepseek-chat"),
            ("llm_timeout_seconds", "LLM_TIMEOUT_SECONDS", False, "秒"),
            ("llm_max_tokens", "LLM_MAX_TOKENS", False, "单次输出上限，网关默认 8192"),
            ("extract_prompt_version", "EXTRACT_PROMPT_VERSION", False, "提纯提示词版本号"),
        ),
    ),
    (
        "视觉模型",
        "图片文字提取（留空 = 不启用）",
        False,
        (
            ("vision_base_url", "VISION_BASE_URL", False, "OpenAI 兼容视觉接口"),
            ("vision_api_key", "VISION_API_KEY", True, ""),
            ("vision_model", "VISION_MODEL", False, "如 qwen-vl-max / glm-4v-plus"),
            ("vision_timeout_seconds", "VISION_TIMEOUT_SECONDS", False, "秒"),
            ("vision_max_images_per_note", "VISION_MAX_IMAGES_PER_NOTE", False, "每篇最多分析张数"),
            ("vision_concurrency", "VISION_CONCURRENCY", False, "单篇内图片并发数"),
        ),
    ),
    (
        "坐标解析",
        "天地图 POI 搜索 + 地理编码",
        False,
        (
            ("tianditu_tk", "TIANDITU_TK", True, "控制台需单独开通「地名搜索」权限"),
            ("tianditu_base_url", "TIANDITU_BASE_URL", False, ""),
        ),
    ),
    (
        "采集",
        "Spider_XHS 限速与过滤阈值（保存后立即生效）",
        True,
        (
            ("xhs_cookie", "XHS_COOKIE", True, "小红书网页版完整 Cookie 头"),
            ("xhs_proxies", "XHS_PROXIES", True, "可选，如 http://127.0.0.1:7890"),
            ("crawl_rps", "CRAWL_RPS", False, "请求限速（次/秒）"),
            ("crawl_timeout_seconds", "CRAWL_TIMEOUT_SECONDS", False, "秒"),
            ("crawl_attempts", "CRAWL_ATTEMPTS", False, "单请求最多尝试次数"),
            ("min_collected", "MIN_COLLECTED", False, "收藏数下限"),
            ("min_images", "MIN_IMAGES", False, "图片数下限"),
            ("max_notes_per_keyword", "MAX_NOTES_PER_KEYWORD", False, "每关键词取 Top N"),
            ("max_pages_per_keyword", "MAX_PAGES_PER_KEYWORD", False, "每关键词最多翻页数"),
            ("session_request_budget", "SESSION_REQUEST_BUDGET", False, "单会话请求总预算"),
            ("cool_down_seconds", "COOL_DOWN_SECONDS", False, "风控冷却秒数"),
        ),
    ),
    (
        "城市与时效",
        "默认城市与聚合窗口（保存后立即生效）",
        True,
        (
            ("city", "CITY", False, "仅作后端默认值；界面以侧栏选中的城市为准"),
            ("keywords", "KEYWORDS", False, "逗号分隔的默认采集关键词"),
            ("stale_days", "STALE_DAYS", False, "发布日期超此天数 → STALE（不参与提炼）"),
        ),
    ),
)


def _mask_secret(value: str) -> str:
    """敏感值保留头尾各 4 位，中间全部打码（不足则全码）。"""
    if not value:
        return ""
    if len(value) <= 8:
        return "*" * len(value)
    return f"{value[:4]}{'*' * 8}{value[-4:]}"


def _env_file_keys() -> set[str]:
    """直接读 .env（与 Settings 同一相对路径），区分「显式配置」与「默认值」。"""
    path = Path(".env")
    if not path.exists():
        return set()
    keys: set[str] = set()
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        keys.add(line.split("=", 1)[0].strip().upper())
    return keys


def _settings_view() -> dict[str, Any]:
    explicit = _env_file_keys()
    groups = []
    for title, note, editable, items in SETTINGS_GROUPS:
        rows = []
        for attr, key, secret, hint in items:
            raw = getattr(settings, attr, "")
            text = str(raw)
            if attr == "database_url":
                text = _mask_url(text)
            elif secret:
                text = _mask_secret(text)
            rows.append(
                {
                    "key": key,
                    "value": text,
                    "secret": secret,
                    "configured": bool(str(raw).strip()),
                    "source": "env" if key in explicit else "default",
                    "hint": hint,
                    # 敏感项不给改：回显的是打码值，写回去会把真值砸掉
                    "editable": editable and not secret,
                }
            )
        groups.append({"title": title, "note": note, "editable": editable, "items": rows})
    env_path = Path(".env")
    return {
        "env_file": str(env_path.resolve()),
        "env_file_exists": env_path.exists(),
        "groups": groups,
    }


def _editable_attrs() -> dict[str, str]:
    """.env 键 → Settings 属性名，只含界面可改的项（敏感项与只读组排除）。"""
    return {
        key: attr
        for _title, _note, editable, items in SETTINGS_GROUPS
        if editable
        for attr, key, secret, _hint in items
        if not secret
    }


async def _stats(city: str) -> dict[str, Any]:
    async with SessionFactory() as session:
        note_rows = (
            await session.execute(
                select(RawNote.status, func.count()).where(RawNote.city == city).group_by(RawNote.status)
            )
        ).all()
        geo_rows = (
            await session.execute(
                select(CanonicalPlace.geo_status, func.count())
                .where(CanonicalPlace.city == city)
                .group_by(CanonicalPlace.geo_status)
            )
        ).all()
        mentions = await session.scalar(
            select(func.count()).select_from(PlaceMention).join(RawNote, RawNote.id == PlaceMention.raw_note_id).where(RawNote.city == city)
        )
        summaries = await session.scalar(
            select(func.count())
            .select_from(PlaceSummary)
            .join(CanonicalPlace, CanonicalPlace.id == PlaceSummary.canonical_place_id)
            .where(CanonicalPlace.city == city)
        )
        images = await session.scalar(select(func.count()).select_from(NoteImage).where(NoteImage.city == city))
        analyzed = await session.scalar(
            select(func.count()).select_from(RawNote).where(RawNote.city == city, RawNote.img_analysis.is_not(None))
        )
        relations = await session.scalar(select(func.count()).select_from(PlaceRelation).where(PlaceRelation.city == city))
        tasks = await session.scalar(select(func.count()).select_from(CrawlTask).where(CrawlTask.city == city))
        avg_score = await session.scalar(
            select(func.avg(CanonicalPlace.quality_score)).where(CanonicalPlace.city == city)
        )
    notes = {status: count for status, count in note_rows}
    geo = {status: count for status, count in geo_rows}
    return {
        "city": city,
        "crawl_tasks": tasks or 0,
        "notes": {"total": sum(notes.values()), "by_status": notes, "image_analyzed": analyzed or 0},
        "mentions": mentions or 0,
        "canonical": {"total": sum(geo.values()), "by_status": geo},
        "summaries": summaries or 0,
        "images": images or 0,
        "relations": relations or 0,
        "avg_quality_score": round(float(avg_score), 1) if avg_score is not None else 0.0,
    }


# ---- 配置与状态 ----


@router.get("/config")
async def get_config() -> dict[str, Any]:
    return {
        "city": settings.city,
        "keywords": [k.strip() for k in settings.keywords.split(",") if k.strip()],
        "database": {"url": _mask_url(settings.database_url)},
        "readiness": {
            "xhs_cookie": bool(settings.xhs_cookie),
            "llm": bool(settings.llm_api_key),
            "llm_model": settings.llm_model,
            "vision": bool(settings.vision_base_url and settings.vision_api_key and settings.vision_model),
            "vision_model": settings.vision_model,
            "tianditu": bool(settings.tianditu_tk),
            "tripweaver": TRIPWEAVER_SEED_SCRIPT.exists(),
        },
        "crawl": {
            "rps": settings.crawl_rps,
            "stale_days": settings.stale_days,
            "min_collected": settings.min_collected,
            "min_images": settings.min_images,
            "max_notes_per_keyword": settings.max_notes_per_keyword,
            "session_request_budget": settings.session_request_budget,
        },
        "jobs": [spec.as_dict() for spec in JOBS.values()],
        "settings": _settings_view(),
    }


@router.put("/settings")
async def put_settings(body: SettingsUpdate) -> dict[str, Any]:
    """把配置写回 .env 并同步内存值（不用重启）。返回新的配置视图。"""
    editable = _editable_attrs()
    unknown = sorted(set(body.values) - set(editable))
    if unknown:
        raise HTTPException(status_code=400, detail=f"这些配置项不支持在界面修改：{'、'.join(unknown)}")
    for key, value in body.values.items():
        if "\n" in value or "\r" in value:
            raise HTTPException(status_code=400, detail=f"{key} 的值不能包含换行")

    overrides = {editable[key]: value for key, value in body.values.items()}
    if overrides:
        # 先整体校验再落盘/改内存：不然第 3 项非法时，前 2 项已经写进去了
        try:
            Settings(**{**settings.model_dump(), **overrides})
        except ValidationError as exc:
            first = exc.errors()[0]
            bad_attr = str(first["loc"][0])
            bad_key = next((k for k, attr in editable.items() if attr == bad_attr), bad_attr)
            raise HTTPException(status_code=400, detail=f"{bad_key} 的值不合法：{first['msg']}") from exc
        for key, value in body.values.items():
            setattr(settings, editable[key], value)
            write_env(key, value)
    return _settings_view()


@router.get("/stats")
async def get_stats(city: str | None = None) -> dict[str, Any]:
    return await _stats(city or settings.city)


@router.get("/cities")
async def list_cities() -> list[dict[str, Any]]:
    """库里出现过的城市 + 登记过的城市 + 默认城市，带笔记/地点数（供侧栏切换器展示），按笔记数倒序。

    登记过的城市即使还没数据也返回（计数为 0），否则刚新增就选不中。
    """
    async with SessionFactory() as session:
        note_rows = (await session.execute(select(RawNote.city, func.count()).group_by(RawNote.city))).all()
        place_rows = (
            await session.execute(select(CanonicalPlace.city, func.count()).group_by(CanonicalPlace.city))
        ).all()
        registered = list((await session.execute(select(City.name))).scalars().all())
    notes = {city: count for city, count in note_rows}
    places = {city: count for city, count in place_rows}
    cities = set(notes) | set(places) | set(registered) | {settings.city}
    return [
        {"city": name, "notes": notes.get(name, 0), "places": places.get(name, 0)}
        for name in sorted(cities, key=lambda item: (-notes.get(item, 0), item))
    ]


@router.post("/cities")
async def add_city(body: CityRequest) -> dict[str, Any]:
    """登记一个城市（幂等）：侧栏立即可选，数据靠自己到管道页跑采集。"""
    from sqlalchemy.dialects.postgresql import insert as pg_insert
    from sqlalchemy.exc import ProgrammingError

    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="城市名不能为空")
    if len(name) > 32:
        raise HTTPException(status_code=400, detail="城市名过长（≤32 字符）")
    try:
        async with SessionFactory() as session:
            await session.execute(
                pg_insert(City).values(name=name).on_conflict_do_nothing(index_elements=[City.name])
            )
            await session.commit()
    except ProgrammingError as exc:
        raise HTTPException(
            status_code=500,
            detail=f"city 表不存在：先在「任务」页点「建表（init-db）」。{exc.orig}",
        ) from exc
    return {"ok": True, "city": name}


@router.post("/init-db")
async def post_init_db() -> dict[str, Any]:
    await init_db()
    return {"ok": True, "database": _mask_url(settings.database_url)}


# ---- 任务 ----


@router.get("/tasks")
async def list_tasks(limit: int = Query(30, ge=1, le=200)) -> list[dict[str, Any]]:
    return manager.list(limit)


@router.post("/tasks")
async def create_task(body: TaskRequest) -> dict[str, Any]:
    try:
        record = manager.create(body.kind, body.params)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except TaskConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return record.snapshot()


@router.get("/tasks/{task_id}")
async def get_task(task_id: str) -> dict[str, Any]:
    record = manager.get(task_id)
    if record is None:
        raise HTTPException(status_code=404, detail="任务不存在")
    return record.snapshot()


@router.post("/tasks/{task_id}/cancel")
async def cancel_task(task_id: str) -> dict[str, Any]:
    if not manager.cancel(task_id):
        raise HTTPException(status_code=409, detail="任务已结束或不存在")
    return {"ok": True}


@router.get("/tasks/{task_id}/stream")
async def stream_task(task_id: str) -> StreamingResponse:
    if manager.get(task_id) is None:
        raise HTTPException(status_code=404, detail="任务不存在")
    return StreamingResponse(
        manager.stream(task_id),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )


# ---- 数据浏览 ----


@router.get("/places")
async def list_places(
    city: str | None = None,
    q: str | None = None,
    geo_status: str | None = None,
    min_score: float | None = None,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    city = city or settings.city
    cond = [CanonicalPlace.city == city]
    if q:
        cond.append(CanonicalPlace.name.ilike(f"%{q}%"))
    if geo_status:
        cond.append(CanonicalPlace.geo_status == geo_status)
    if min_score is not None:
        cond.append(CanonicalPlace.quality_score >= min_score)
    total = await _count(select(func.count()).select_from(CanonicalPlace).where(*cond))
    stmt = (
        select(CanonicalPlace, PlaceSummary)
        .outerjoin(PlaceSummary, PlaceSummary.canonical_place_id == CanonicalPlace.id)
        .where(*cond)
        .order_by(func.coalesce(PlaceSummary.recommend_score, 0).desc(), CanonicalPlace.id.asc())
        .limit(limit)
        .offset(offset)
    )
    async with SessionFactory() as session:
        rows = (await session.execute(stmt)).all()
    items = [
        {
            "id": place.id,
            "name": place.name,
            "normalized_name": place.normalized_name,
            "place_type": place.place_type,
            "geo_status": place.geo_status,
            "address": place.address,
            "longitude": place.longitude,
            "latitude": place.latitude,
            "theme_tags": place.theme_tags or [],
            "quality_score": place.quality_score,
            "typical_visit_minutes": place.typical_visit_minutes,
            "recommend_score": summary.recommend_score if summary else None,
            "mention_count": summary.mention_count_30d if summary else 0,
            "positive_count": summary.positive_count_30d if summary else 0,
            "source_count": summary.source_count if summary else 0,
            "top_reasons": (summary.top_reasons if summary else None) or [],
        }
        for place, summary in rows
    ]
    return {"city": city, "total": total, "items": items}


@router.get("/notes")
async def list_notes(
    city: str | None = None,
    status: str | None = None,
    q: str | None = None,
    with_image_analysis: bool | None = None,
    limit: int = Query(30, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    city = city or settings.city
    cond = [RawNote.city == city]
    if status:
        cond.append(RawNote.status == status)
    if q:
        cond.append(RawNote.title.ilike(f"%{q}%"))
    if with_image_analysis is not None:
        cond.append(RawNote.img_analysis.is_not(None) if with_image_analysis else RawNote.img_analysis.is_(None))
    total = await _count(select(func.count()).select_from(RawNote).where(*cond))
    stmt = (
        select(
            RawNote.id,
            RawNote.note_id,
            RawNote.title,
            RawNote.desc,
            RawNote.keyword,
            RawNote.status,
            RawNote.author,
            RawNote.collected_count,
            RawNote.liked_count,
            RawNote.img_urls,
            RawNote.img_analysis,
            RawNote.source_url,
            RawNote.created_at,
        )
        .where(*cond)
        .order_by(RawNote.collected_count.desc())
        .limit(limit)
        .offset(offset)
    )
    async with SessionFactory() as session:
        rows = (await session.execute(stmt)).all()
    items = [
        {
            "id": row.id,
            "note_id": row.note_id,
            "title": row.title,
            "excerpt": (row.desc or "")[:200],
            "keyword": row.keyword,
            "status": row.status,
            "author": row.author,
            "collected_count": row.collected_count,
            "liked_count": row.liked_count,
            "image_count": len(row.img_urls or []),
            "image_analyzed": row.img_analysis is not None,
            "source_url": row.source_url,
            "created_at": row.created_at.isoformat(timespec="seconds") if row.created_at else None,
        }
        for row in rows
    ]
    return {"city": city, "total": total, "items": items}


@router.get("/mentions")
async def list_mentions(
    city: str | None = None,
    q: str | None = None,
    mention_type: str | None = None,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    city = city or settings.city
    cond = [RawNote.city == city]
    if q:
        cond.append(PlaceMention.name.ilike(f"%{q}%"))
    if mention_type:
        cond.append(PlaceMention.mention_type == mention_type)
    total = await _count(
        select(func.count()).select_from(PlaceMention).join(RawNote, RawNote.id == PlaceMention.raw_note_id).where(*cond)
    )
    stmt = (
        select(
            PlaceMention.id,
            PlaceMention.name,
            PlaceMention.normalized_name,
            PlaceMention.place_type,
            PlaceMention.mention_type,
            PlaceMention.reason,
            PlaceMention.evidence_text,
            PlaceMention.confidence,
            RawNote.source_url,
            RawNote.title,
        )
        .join(RawNote, RawNote.id == PlaceMention.raw_note_id)
        .where(*cond)
        .order_by(PlaceMention.id.desc())
        .limit(limit)
        .offset(offset)
    )
    async with SessionFactory() as session:
        rows = (await session.execute(stmt)).all()
    return {
        "city": city,
        "total": total,
        "items": [
            {
                "id": row.id,
                "name": row.name,
                "normalized_name": row.normalized_name,
                "place_type": row.place_type,
                "mention_type": row.mention_type,
                "reason": row.reason,
                "evidence": row.evidence_text,
                "confidence": row.confidence,
                "note_title": row.title,
                "source_url": row.source_url,
            }
            for row in rows
        ],
    }


async def _count(stmt: Any) -> int:
    async with SessionFactory() as session:
        return int(await session.scalar(stmt) or 0)


# ---- 问答 ----


@router.post("/ask")
async def post_ask(body: AskRequest) -> dict[str, Any]:
    if not settings.llm_api_key:
        raise HTTPException(status_code=400, detail="缺少 LLM_API_KEY：先在 .env 填 LLM Key")
    question = body.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="问题不能为空")
    from app.qa.ask import ask

    result = await ask(question, body.city)
    return {
        "answer": result["answer"],
        "intent": result["intent"],
        "candidates": [
            {
                "name": c.name,
                "place_type": c.place_type,
                "address": c.address,
                "quality_score": c.quality_score,
                "recommend_score": c.recommend_score,
                "mention_count": c.mention_count,
                "reasons": c.reasons,
                "image_info": c.image_info,
                "source_url": c.source_url,
            }
            for c in result["candidates"]
        ],
    }
