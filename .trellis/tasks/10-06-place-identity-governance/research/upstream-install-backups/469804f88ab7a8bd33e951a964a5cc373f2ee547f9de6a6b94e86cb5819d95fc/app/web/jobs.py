"""Web 端作业定义：把 CLI 各步包装成可按城市/参数触发的后台任务。

与 app/cli.py 的区别：
- 城市与关键词按参数传入（CLI 只读 .env），便于在界面上切城市、跑多城
- 缺 Key 时抛异常记为任务失败（CLI 是 sys.exit），前端能直接看到原因
- 长耗时作业（export-embed）走子进程并实时转发行输出
"""
from __future__ import annotations

import asyncio
import os
import sys
from collections.abc import Iterable
from pathlib import Path
from typing import Any

from app.config import settings
from app.extract.place_profiles import DEFAULT_LIMIT, parse_options
from app.extract.place_research import DEFAULT_SEARCH_MODEL
from app.web.tasks import Field, JobSpec, TaskRecord
from app.photography.entrypoints import execute as execute_photography, job_fields as photography_fields, ensure_complete

PROJECT_ROOT = Path(__file__).resolve().parents[2]
# 与 scripts/export_to_tripweaver.py 的 DEFAULT_OUT 同目录，按城市分文件（对齐 export_and_embed.ps1）
TRIPWEAVER_ROOT = Path(r"D:\Project\tripweaver")
TRIPWEAVER_IMPORT_DIR = TRIPWEAVER_ROOT / "import"
TRIPWEAVER_SEED_SCRIPT = TRIPWEAVER_ROOT / "apps" / "server" / "scripts" / "seed-xhs-places.ts"


def _split(raw: Any) -> list[str]:
    if not raw:
        return []
    if isinstance(raw, (list, tuple)):
        items: Iterable[str] = raw
    else:
        items = str(raw).replace("，", ",").split(",")
    return [str(x).strip() for x in items if str(x).strip()]


def _city(params: dict[str, Any]) -> str:
    return str(params.get("city") or settings.city).strip()


def _require(ok: bool, message: str) -> None:
    if not ok:
        raise RuntimeError(message)


# ---- 核心管道 ----


async def job_login_cookie(params: dict[str, Any], record: TaskRecord) -> dict[str, Any]:
    """扫码登录小红书 → 写回 .env（二维码走 record.extra 实时推给前端）。

    只把二维码和昵称往外带，cookie 明文不进日志也不进 result。
    """
    from app.crawl.login import cookie_key_count, qr_png_data_url, qrcode_login, update_env_cookie

    def on_qr(url: str) -> None:
        record.extra["qr_png"] = qr_png_data_url(url)
        record.log("INFO", "二维码已生成：用小红书 App 扫码并确认登录")

    cookie, nickname = await qrcode_login(on_qr)
    env_path = update_env_cookie(cookie)
    record.log("INFO", f"Cookie 已写入 {env_path}（{cookie_key_count(cookie)} 个键值对），运行时已生效")
    return {"user": nickname, "env_file": str(env_path), "cookie_keys": cookie_key_count(cookie)}


async def job_crawl(params: dict[str, Any], record: TaskRecord) -> dict[str, Any]:
    city = _city(params)
    keywords = _split(params.get("keywords")) or _split(settings.keywords)
    _require(bool(settings.xhs_cookie), "缺少 XHS_COOKIE：先在 .env 填小红书网页版 Cookie 头")
    from app.crawl.client import XhsClient
    from app.crawl.pipeline import crawl_city

    record.log("INFO", f"城市 {city}，关键词 {len(keywords)} 个，限速 {settings.crawl_rps} 次/秒")
    async with XhsClient() as client:
        stats = await crawl_city(client, city, keywords)
    return {"city": city, **stats}


async def job_extract(params: dict[str, Any], record: TaskRecord) -> dict[str, Any]:
    city = _city(params)
    _require(bool(settings.llm_api_key), "缺少 LLM_API_KEY：先在 .env 填 LLM Key（OpenAI 兼容网关）")
    from app.extract.llm_extract import extract_all_pending

    stats = await extract_all_pending(city)
    return {"city": city, **stats}


async def job_refine_content(params: dict[str, Any], record: TaskRecord) -> dict[str, Any]:
    from app.extract.place_profiles import refine_profiles, DEFAULT_LIMIT

    def progress(result):
        record.extra['place_content'] = result.copy()
        # 取消/异常后 extra 会清理，保留已经完成部分的结果供复查。
        if record.kind == 'run-all':
            record.result = {**(record.result or {}), 'place_content': result.copy()}
        else:
            record.result = result.copy()
        record.log('INFO', f"{result.get('current_place', '')} {result.get('phase', '')}：介绍 {result['processed']}/{result['selected']}，保存 {result['saved']}，资料不足 {result['insufficient']}，未通过 {result['rejected']}")

    return await refine_profiles(_city(params), names=params.get('names'),
        limit=params.get('limit', DEFAULT_LIMIT), preview=params.get('preview', False), on_progress=progress,
        search_model=params.get('search_model', DEFAULT_SEARCH_MODEL))


async def job_extract_images(params: dict[str, Any], record: TaskRecord) -> dict[str, Any]:
    """统一图片步骤：一次下载 → CLIP 分流 → 风景转存配景点 / 攻略图 VLM 抽文字。

    走子进程：app/vision/classify.py 顶层 import torch，不能拉进 FastAPI 进程。
    独立作业可保存风景图；run-all 强制 save_scenery=False，仅提取攻略文字。
    """
    city = _city(params)
    _require(
        bool(settings.vision_base_url and settings.vision_api_key and settings.vision_model),
        "未配置视觉模型：在 .env 填 VISION_BASE_URL / VISION_API_KEY / VISION_MODEL",
    )
    scope = str(params.get("scope") or "missing")
    refresh_urls = bool(params.get("refresh_urls", True))
    max_per_note = int(params.get("max_per_note") or 5)
    save_scenery = params.get("save_scenery", True)
    _require(isinstance(save_scenery, bool), "保存风景图开关必须为布尔值")
    interval = float(params.get("interval") if params.get("interval") is not None else 6)
    batch_size = int(params.get("batch_size") or 20)
    pause_seconds = int(params.get("pause_seconds") if params.get("pause_seconds") is not None else 1800)
    if refresh_urls:
        _require(bool(settings.xhs_cookie), "缺少 XHS_COOKIE：重取图片 URL 需调用小红书详情接口")

    cmd = [
        sys.executable,
        "scripts/extract_note_images.py",
        "--city",
        city,
        "--scope",
        scope,
        "--max-per-note",
        str(max_per_note),
        "--interval",
        str(interval),
        "--batch-size",
        str(batch_size),
        "--pause-seconds",
        str(pause_seconds),
        "--refresh-urls" if refresh_urls else "--no-refresh-urls",
        "--save-scenery" if save_scenery else "--no-save-scenery",
    ]
    sampling = str(params.get("sampling", "spread"))
    _require(sampling in ("head", "spread"), "未知图片取样方式")
    cmd += ["--sampling", sampling]
    target_places = _split(params.get("target_places"))
    if target_places:
        cmd += ["--target-places", ",".join(target_places)]
    if scope == "notes":
        note_ids = _split(params.get("note_ids"))
        _require(bool(note_ids), "范围选「指定 note_id」时，必须在下方填入至少一个 note_id")
        cmd += ["--note-ids", ",".join(note_ids)]
    await _stream_process(record, cmd)
    return {
        "city": city,
        "scope": scope,
        "max_per_note": max_per_note,
        "save_scenery": save_scenery,
        "sampling": sampling,
        "interval": interval,
        "batch_size": batch_size,
        "pause_seconds": pause_seconds,
        "refresh_urls": refresh_urls,
    }


async def job_sync(params: dict[str, Any], record: TaskRecord) -> dict[str, Any]:
    city = _city(params)
    _require(bool(settings.tianditu_tk), "缺少 TIANDITU_TK：先在 .env 填天地图 Key（需开通地名搜索权限）")
    from app.aggregate.summary import sync_canonical

    stats = await sync_canonical(city)
    return {"city": city, **stats}


async def job_summary(params: dict[str, Any], record: TaskRecord) -> dict[str, Any]:
    city = _city(params)
    from app.aggregate.summary import refresh_summary

    updated = await refresh_summary(city)
    return {"city": city, "places": updated}


async def job_grade(params: dict[str, Any], record: TaskRecord) -> dict[str, Any]:
    city = _city(params)
    from app.aggregate.grade import grade_canonical

    stats = await grade_canonical(city)
    return {"city": city, **stats}


async def job_build_theme_tags(params: dict[str, Any], record: TaskRecord) -> dict[str, Any]:
    """天地图 POI 分类 → canonical_place.amap_type / theme_tags。

    会**整体覆盖** theme_tags，所以必须跑在「话题标签补主题」之前（那个是合并）。
    """
    city = _city(params)
    _require(bool(settings.tianditu_tk), "缺少 TIANDITU_TK：先在 .env 填天地图 Key（需开通地名搜索权限）")
    cmd = [sys.executable, "scripts/build_theme_tags.py"]
    if params.get("dry_run"):
        cmd.append("--dry-run")
    # 脚本读 settings.city，所以城市走环境变量传（与 job_export 同套路）
    await _stream_process(record, cmd, env_extra={"CITY": city})
    return {"city": city, "dry_run": bool(params.get("dry_run"))}


async def job_build_tag_topics(params: dict[str, Any], record: TaskRecord) -> dict[str, Any]:
    """笔记 tag_list 聚合话题 → 合并进 canonical_place.theme_tags。"""
    city = _city(params)
    cmd = [sys.executable, "scripts/build_tag_topics.py", "--city", city]
    if params.get("dry_run"):
        cmd.append("--dry-run")
    await _stream_process(record, cmd)
    return {"city": city, "dry_run": bool(params.get("dry_run"))}


async def job_build_visit_duration(params: dict[str, Any], record: TaskRecord) -> dict[str, Any]:
    """抽游览时长 → canonical_place.typical_visit_minutes（覆盖 sync 阶段的粗值）。"""
    city = _city(params)
    cmd = [sys.executable, "scripts/build_visit_duration.py", "--city", city]
    if params.get("dry_run"):
        cmd.append("--dry-run")
    await _stream_process(record, cmd)
    return {"city": city, "dry_run": bool(params.get("dry_run"))}


async def job_mine_relations(params: dict[str, Any], record: TaskRecord) -> dict[str, Any]:
    """挖「常在同天/相邻」的地点对 → 物化 place_relation。

    词表门槛取自 place_summary.mention_count_30d，所以必须跑在「聚合刷新」之后。
    """
    city = _city(params)
    min_mentions = int(params.get("min_mentions") or 2)
    cmd = [
        sys.executable,
        "scripts/mine_place_relations.py",
        "--city",
        city,
        "--min-mentions",
        str(min_mentions),
    ]
    if params.get("prune"):
        cmd.append("--prune")
    await _stream_process(record, cmd)
    return {"city": city, "min_mentions": min_mentions, "pruned": bool(params.get("prune"))}


async def job_suggest_keywords(params: dict[str, Any], record: TaskRecord) -> dict[str, Any]:
    """LLM 推荐采集关键词（由「采集」卡片上的按钮触发）。"""
    from app.web.keywords import suggest_keywords

    _require(bool(settings.llm_api_key), "缺少 LLM_API_KEY：先在 .env 填 LLM Key（OpenAI 兼容网关）")
    city = _city(params)
    count = int(params.get("count") or 20)
    exclude = _split(params.get("exclude")) if params.get("exclude") else []
    result = await suggest_keywords(city, count, exclude)
    record.log("INFO", f"生成 {len(result['keywords'])} 个关键词：{'、'.join(result['keywords'])}")
    return result


async def job_photography(params: dict[str, Any], record: TaskRecord) -> dict[str, Any]:
    from urllib.parse import urlencode
    result = await execute_photography(_city(params), params)
    result['review_url'] = '/api/photography/review?' + urlencode({'city': result['city'], 'run_id': result['run_id']})
    record.result = result
    ensure_complete(result)
    return result


async def job_run_all(params: dict[str, Any], record: TaskRecord) -> dict[str, Any]:
    """一键攻略链路：crawl → extract → sync →（可选）攻略图文字 → 数据增强 → summary → 关联对 → grade。

    顺序有依赖，别随意调整：
    - 攻略图仅提取文字，不保存风景图；排行摄影必须单独触发
    - 主题标签在话题标签之前：前者整体覆盖 theme_tags，后者是合并进去
    - 关联对在 summary 之后：词表门槛取自 place_summary.mention_count_30d
    - 时长挖掘在 sync 之后：它的三道闸比 sync_canonical 的粗算更严，要能覆盖掉
    """
    city = _city(params)
    if not isinstance(params.get('with_content', True), bool):
        raise RuntimeError('完整介绍开关须为布尔值')
    if params.get('with_content', True):
        parse_options(city, limit=params.get('content_limit', DEFAULT_LIMIT))
    result: dict[str, Any] = {"city": city}
    result["crawl"] = await job_crawl(params, record)
    result["extract"] = await job_extract(params, record)
    result["sync"] = await job_sync(params, record)
    if params.get("with_images"):
        result["extract_images"] = await job_extract_images({**params, "scope": "missing", "save_scenery": False}, record)
    result["build_theme_tags"] = await job_build_theme_tags(params, record)
    result["build_tag_topics"] = await job_build_tag_topics(params, record)
    result["build_visit_duration"] = await job_build_visit_duration(params, record)
    result["summary"] = await job_summary(params, record)
    result["mine_relations"] = await job_mine_relations(params, record)
    result["grade"] = await job_grade(params, record)
    record.result = result
    if params.get('with_content', True):
        result['place_content'] = await job_refine_content({
            'city': city, 'limit': params.get('content_limit', DEFAULT_LIMIT), 'preview': False,
            'search_model': params.get('search_model', DEFAULT_SEARCH_MODEL)}, record)
    return result


# ---- 导出 ----


async def _stream_process(record: TaskRecord, cmd: list[str], env_extra: dict[str, str] | None = None) -> int:
    """跑子进程并把 stdout 逐行写进任务日志；取消时终止子进程。"""
    env = os.environ.copy()
    env["PYTHONIOENCODING"] = "utf-8"
    env.update(env_extra or {})
    record.log("INFO", f"$ {' '.join(cmd)}")
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        cwd=str(PROJECT_ROOT),
        env=env,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )
    try:
        assert proc.stdout is not None
        while True:
            raw = await proc.stdout.readline()
            if not raw:
                break
            line = raw.decode("utf-8", errors="replace").rstrip()
            if line:
                record.log("INFO", line)
        code = await proc.wait()
    except asyncio.CancelledError:
        proc.terminate()
        await proc.wait()
        raise
    if code != 0:
        raise RuntimeError(f"子进程退出码 {code}")
    return code


def _safe_out_path(raw: Any, city: str) -> Path:
    """限制导出落盘位置：只允许 tripweaver 导入目录或本仓库内。

    out 由界面传入（无鉴权的本地服务 = 任意写风险），越界直接报错。
    """
    out = Path(str(raw or TRIPWEAVER_IMPORT_DIR / f"xhs-places-{city}.json"))
    if not out.is_absolute():
        out = PROJECT_ROOT / out
    out = out.resolve()
    allowed = (TRIPWEAVER_IMPORT_DIR.resolve(), PROJECT_ROOT.resolve())
    if not any(out.is_relative_to(root) for root in allowed):
        raise ValueError(f"导出路径越界：{out}（只允许 {TRIPWEAVER_IMPORT_DIR} 或仓库目录内）")
    return out


async def job_export(params: dict[str, Any], record: TaskRecord) -> dict[str, Any]:
    """导出城市地点库为 tripweaver 导入 JSON（只写本地文件）。"""
    city = _city(params)
    min_score = float(params.get("min_score") or 0)
    out = _safe_out_path(params.get("out"), city)
    out.parent.mkdir(parents=True, exist_ok=True)
    await _stream_process(
        record,
        [sys.executable, "scripts/export_to_tripweaver.py", "--out", str(out), "--min-score", str(min_score)],
        env_extra={"CITY": city},
    )
    size_kb = round(out.stat().st_size / 1024, 1) if out.exists() else 0
    return {"city": city, "out": str(out), "size_kb": size_kb}


async def job_export_embed(params: dict[str, Any], record: TaskRecord) -> dict[str, Any]:
    """导出 → tripweaver 入库 → 向量回填（scripts/export_and_embed.ps1 全流程）。"""
    city = _city(params)
    _require(
        TRIPWEAVER_SEED_SCRIPT.exists(),
        f"找不到 tripweaver 入库脚本：{TRIPWEAVER_SEED_SCRIPT}（需 tripweaver 仓库与 Node 环境）",
    )
    tables = str(params.get("tables") or "both")
    with_images = bool(params.get("with_images", True))
    cmd = [
        "powershell",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        str(PROJECT_ROOT / "scripts" / "export_and_embed.ps1"),
        "-City",
        city,
        "-Tables",
        tables,
    ]
    if params.get("purge"):
        cmd.append("-Purge")
    if with_images:
        cmd.append("-WithImages")
    await _stream_process(record, cmd)
    return {
        "city": city,
        "tables": tables,
        "purged": bool(params.get("purge")),
        "with_images": with_images,
    }


# ---- 注册表 ----

JOBS: dict[str, JobSpec] = {
    'photography': JobSpec(
        kind='photography', title='排行景点摄影', group='xhs',
        description='按有效景点排行定向搜图，确认地点与摄影质量后自动精选最多三张。独立保存，支持断点续跑。',
        fields=photography_fields(), runner=job_photography,
    ),
    "login-cookie": JobSpec(
        kind="login-cookie",
        title="更新 Cookie",
        group="xhs",
        description=(
            "扫码登录小红书（纯 HTTP，不开浏览器），成功后把完整 Cookie 头写回 .env 并立即生效。"
            "点「运行」后抽屉里出二维码，用小红书 App 扫码并确认即可。"
        ),
        fields=(),
        runner=job_login_cookie,
    ),
    "crawl": JobSpec(
        kind="crawl",
        title="采集（小红书）",
        group="xhs",
        description="搜索关键词 → 硬过滤（收藏/图数）→ Top N → 抓详情 → 入 raw_note。有风控风险，串行限速。",
        fields=(
            Field(
                "keywords",
                "关键词",
                "textarea",
                "",
                "逗号分隔；留空用 .env 的默认关键词表；可点「LLM 推荐」生成",
                suggest="keywords",
            ),
        ),
        runner=job_crawl,
    ),
    "extract": JobSpec(
        kind="extract",
        title="LLM 提纯",
        group="llm",
        description="对 status=RAW 的笔记做 JSON 模式提纯，产出 place_mention（地点/理由/避坑/时长）。",
        fields=(),
        runner=job_extract,
    ),
    "sync": JobSpec(
        kind="sync",
        title="坐标解析 + canonical 库",
        group="db",
        description="提及按地点聚合 → canonical_place upsert → 天地图 geocode/POI 解析坐标。",
        fields=(),
        runner=job_sync,
    ),
    "extract-images": JobSpec(
        kind="extract-images",
        title="图片提取（攻略文字 + 风景配图）",
        group="llm",
        description=(
            "一次下载笔记图片，本地 CLIP 分流：风景图转存本地并挂到景点，"
            "攻略图（文字卡片/地图/拼图）交视觉模型抽文字。风景图每篇最多 5 张。"
            "配景点需先建好 canonical 库（先跑 sync）。图片链约 24h 过期，默认先重取。"
            "防风控：每轮只重取 N 篇就转去分析，分析耗时天然形成冷却。"
        ),
        fields=(
            Field(
                "scope",
                "范围",
                "select",
                "missing",
                "missing=只补未处理；all=重刷全部有图笔记；notes=指定 note_id",
                ("missing", "all", "notes"),
            ),
            Field("note_ids", "指定 note_id", "text", "", "仅范围=notes 时生效，逗号或换行分隔"),
            Field("sampling", "图片取样", "select", "spread", "同样预算覆盖前中后部；head 仅前部", ("spread", "head")),
            Field("target_places", "优先补图景点", "text", "", "逗号分隔；优先处理正文中明确图号对应的缺图景点"),
            Field("max_per_note", "每篇最多风景图", "number", 5, "默认 5 张，不足则全存"),
            Field(
                "interval",
                "重取篇间隔（秒）",
                "number",
                6,
                "叠加在 crawl_rps 节流上（±20% 抖动）；调大更防风控",
            ),
            Field(
                "batch_size",
                "每轮重取篇数",
                "number",
                20,
                "刷这么多篇就转去分析，分析耗时形成冷却；调小则请求更分散",
            ),
            Field(
                "pause_seconds",
                "风控暂停（秒）",
                "number",
                1800,
                "连续空返回判为限流后暂停多久，默认 1800（30 分钟）；实测 3 分钟不够冷却",
            ),
            Field(
                "refresh_urls",
                "先重取图片 URL",
                "bool",
                True,
                "需 XHS_COOKIE，会消耗小红书会话预算（单次运行上限见 SESSION_REQUEST_BUDGET）；关掉则只用库里现有 URL",
            ),
        ),
        runner=job_extract_images,
    ),
    "summary": JobSpec(
        kind="summary",
        title="聚合刷新",
        group="db",
        description="只对坐标已解析的地点刷新 place_summary（提及数/正向数/推荐分/top_reasons）。",
        fields=(),
        runner=job_summary,
    ),
    "mine-relations": JobSpec(
        kind="mine-relations",
        title="关联对挖掘",
        group="db",
        description=(
            "从笔记原文挖「常在同天/相邻」的地点对，物化 place_relation（无向，先后顺序由消费端决定）。"
            "词表门槛取自 place_summary，所以必须在「聚合刷新」之后跑。"
        ),
        fields=(
            Field("min_mentions", "词表门槛（提及数）", "number", 2, "低于此提及数的地点不进词表，默认 2"),
            Field("prune", "删过期边", "bool", False, "删除本次未再生成的关系边（笔记删除/改名后的残留）"),
        ),
        runner=job_mine_relations,
    ),
    "grade": JobSpec(
        kind="grade",
        title="质量分级",
        group="db",
        description="给 canonical_place 打 quality_score（问答与规划排序依据）。",
        fields=(),
        runner=job_grade,
    ),
    "build-theme-tags": JobSpec(
        kind="build-theme-tags",
        title="主题标签（天地图）",
        group="db",
        description=(
            "拉天地图 POI 分类 → canonical_place.amap_type / theme_tags。"
            "会整体覆盖 theme_tags，所以要在「话题标签补主题」之前跑。逐点请求，分钟级。"
        ),
        fields=(Field("dry_run", "只看不写", "bool", False, "勾选则只打印样例，不写库"),),
        runner=job_build_theme_tags,
    ),
    "build-tag-topics": JobSpec(
        kind="build-tag-topics",
        title="话题标签补主题",
        group="db",
        description=(
            "从笔记 tag_list 聚话题（≥2 篇交叉验证，或占比≥50%）→ 合并进 theme_tags，"
            "补高德分类覆盖不到的小众地点。"
        ),
        fields=(Field("dry_run", "只看不写", "bool", False, "勾选则只打印样例，不写库"),),
        runner=job_build_tag_topics,
    ),
    "build-visit-duration": JobSpec(
        kind="build-visit-duration",
        title="游览时长挖掘",
        group="db",
        description=(
            "从正文与图片文字抽「逛 2 小时」这类表达，过三道闸（20 字符窗 / 排除通勤语境 / 窗口内无其他地点）"
            "后取中位数写 typical_visit_minutes，覆盖坐标解析阶段的粗值。"
        ),
        fields=(Field("dry_run", "只看不写", "bool", False, "勾选则只打印样例，不写库"),),
        runner=job_build_visit_duration,
    ),
    # 不占用管道页的卡片位（PIPELINE_ORDER 未列它），由「采集」卡片的 LLM 推荐按钮触发
    "suggest-keywords": JobSpec(
        kind="suggest-keywords",
        title="LLM 推荐关键词",
        group="llm",
        description="按城市 + 库里热门地点生成采集关键词。当前模型带推理，约 1 分钟。",
        fields=(),
        runner=job_suggest_keywords,
    ),
    "refine-content": JobSpec(
        kind="refine-content", title="完整介绍提纯补充", group="llm",
        description="搜索景区官网、政府文旅等介绍，抓取正文并结合模型知识编写定位、历史与看点。小红书用于体验、避坑等其他信息。保留已有完整及已复核内容，结果可查看网页引文与模型知识补充。完成后导出导入同步行程库。",
        fields=(
            Field("names", "指定景点（可选）", "textarea", "", "逗号或换行分隔，支持已知别名；留空按质量分优先补缺"),
            Field("limit", "本次最多处理", "number", DEFAULT_LIMIT, "1～200 个景点；每点提纯及审稿各一次模型调用，耗时取决于资料与模型"),
            Field("preview", "仅预览，不写入", "bool", False, "开启后只生成介绍、来源与报告；关闭则保存通过校验的介绍，缺资料不编造"),
            Field("search_model", "搜索模型", "text", DEFAULT_SEARCH_MODEL, "使用本机 smart-search 配置；逐次指定模型，不修改全局设置。资料缓存7天，最多抓取3个页面"),
        ), runner=job_refine_content,
    ),
    "run-all": JobSpec(
        kind="run-all",
        title="一键全链路",
        group="db",
        description=(
            "crawl → extract → sync →（可选攻略图文字）→ 主题标签 → 话题标签 → 时长挖掘 → summary → 关联对 → grade →（可选完整介绍），"
            "串行执行，中途失败即停。不保存风景配图；补充小红书照片请单独运行「排行景点摄影」。"
        ),
        fields=(
            Field(
                "keywords",
                "关键词",
                "textarea",
                "",
                "逗号分隔；留空用 .env 的默认关键词表；可点「LLM 推荐」生成",
                suggest="keywords",
            ),
            Field(
                "with_images",
                "含攻略图文字提取",
                "bool",
                True,
                "只从文字卡片、地图和拼图中提取攻略信息，不保存风景图（需视觉模型配置，分钟级）",
            ),
            Field("with_content", "含完整介绍提纯补充", "bool", True, "聚合分级后搜索网页并结合模型知识补齐介绍，保留已有完整内容，不额外采集小红书"),
            Field("content_limit", "介绍补充上限", "number", DEFAULT_LIMIT, "每次1～200个景点；剩余可在独立介绍作业继续处理"),
            Field("search_model", "介绍搜索模型", "text", DEFAULT_SEARCH_MODEL, "本机 smart-search 搜索模型；不修改全局搜索配置"),
        ),
        runner=job_run_all,
    ),
    "export": JobSpec(
        kind="export",
        title="导出 tripweaver JSON",
        group="db",
        description="写成 tripweaver 导入格式（canonical_places + research_evidence），只落本地文件。",
        fields=(
            Field("min_score", "quality_score 阈值", "number", 0, "0 = 不过滤"),
            Field("out", "输出路径", "text", "", f"留空用 {TRIPWEAVER_IMPORT_DIR}\\xhs-places-<城市>.json"),
        ),
        runner=job_export,
    ),
    "export-embed": JobSpec(
        kind="export-embed",
        title="导出并入库 tripweaver",
        group="db",
        description=(
            "导出 → tripweaver 入库 → 向量回填（调 scripts/export_and_embed.ps1，需 Node 环境）。"
            "勾选「含景点封面图」时会先在 tripweaver 建好地点行，再导出景点风景图并写入 payload.coverImage。"
        ),
        fields=(
            Field("tables", "回填表", "select", "both", "向量回填范围", ("both", "places", "evidence")),
            Field(
                "with_images",
                "含景点封面图",
                "bool",
                True,
                "顺带导出景点风景图（webp → tripweaver/data/media）并写入 payload.coverImage；需先提过图片",
            ),
            Field("purge", "全量重建", "bool", False, "先清 source='xhs' 数据再导（慢，会重算全部向量）"),
        ),
        runner=job_export_embed,
    ),
}
