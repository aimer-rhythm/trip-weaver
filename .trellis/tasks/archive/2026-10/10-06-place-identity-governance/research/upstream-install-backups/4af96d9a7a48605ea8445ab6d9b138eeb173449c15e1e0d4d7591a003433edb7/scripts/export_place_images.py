"""导出景点封面图：note_image → tripweaver data/media 的 webp + manifest。

上游 `fetch_scenery_images.py` 已经把笔记风景图转存到 `data/images/{city}/{note_id}/NN.jpg`
并做了 CLIP 分类与景点关联；本脚本把这些图片按 canonical_place 归拢、转码成 webp，
每个景点取封面时**优先高收藏/高点赞笔记的图**（平局才比 CLIP 分）。输出 tripweaver 侧能直接导入的两个产物：

  1. manifest  `tripweaver/import/xhs-place-images-{city}.json`
  2. 图片文件  `tripweaver/data/media/xhs/{city}/{placeId}/00.webp`

tripweaver 只把相对 key 写进 `canonical_places.payload.coverImage`，
展示 URL 前缀由 server 的 MEDIA_BASE_URL 拼（换对象存储只改环境变量）。

用法:
  python scripts/export_place_images.py                      # 城市取 .env 的 CITY
  python scripts/export_place_images.py --city 杭州
  python scripts/export_place_images.py --city 杭州 --dry-run
  python scripts/export_place_images.py --city 杭州 --max-per-place 2
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import logging
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, ".")
sys.path.insert(0, "vendor/spider_xhs")

from PIL import Image
from sqlalchemy import select, func

from app.config import settings
from app.db import SessionFactory
from app.aggregate.place_identity import load_catalog
from app.models import CanonicalPlace, NoteImage, PlaceSummary, RawNote
from app.vision.eligibility import export_conditions
from app.photography.export import export_selected
from app.photography.pipeline import DEFAULT_ROOT
from app.photography.store import PhotoStore

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_IMPORT_DIR = Path(r"D:\Project\tripweaver\import")
DEFAULT_MEDIA_ROOT = Path(r"D:\Project\tripweaver\data\media")
# 卡片位展示尺寸小，1024 足够；再往上只增体积
MAX_EDGE = 1024
WEBP_QUALITY = 80

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s: %(message)s", datefmt="%H:%M:%S")
log = logging.getLogger("export_img")

# 每个景点取封面：只认风景图 + 已关联景点。
# 优先级「收藏 → 点赞 → CLIP 分」：优先用高收藏高点赞笔记的图做封面，平局才看 CLIP 分。
# 取的是上游自增 id 吗？不是——manifest 的 placeId 必须由 place_id() 算成 tripweaver 的
# sha256(city+name)[:32]，否则 seed 一条也写不进去。这里只取名字与图片信息。
def pick_query(city: str, min_score: float = 0.0):
    return (
        select(CanonicalPlace.name.label("place_name"), CanonicalPlace.id.label('source_place_id'), NoteImage.file_path,
               NoteImage.img_score, NoteImage.source_url)
        .join(CanonicalPlace, CanonicalPlace.id == NoteImage.canonical_place_id)
        .join(PlaceSummary, PlaceSummary.canonical_place_id == CanonicalPlace.id)
        .join(RawNote, RawNote.id == NoteImage.raw_note_id)
        .where(*export_conditions(city, min_score), NoteImage.city == city,
               RawNote.city == city, RawNote.status != "DELETED", NoteImage.img_type == "scenery")
        .order_by(func.coalesce(RawNote.collected_count, 0).desc(),
                  func.coalesce(RawNote.liked_count, 0).desc(),
                  NoteImage.img_score.desc().nulls_last(), NoteImage.id)
    )


def place_id(city: str, name: str) -> str:
    """与 tripweaver seed-canonical-places.ts 同算法：sha256(city+name)[:32]。"""
    return hashlib.sha256(f"{city}{name}".encode()).hexdigest()[:32]


def transcode(src: Path, dst: Path) -> tuple[int, int, int] | None:
    """转 webp，返回 (宽, 高, 字节数)；源文件缺失或解码失败返回 None。"""
    if not src.exists():
        return None
    try:
        with Image.open(src) as img:
            rgb = img.convert("RGB")
            rgb.thumbnail((MAX_EDGE, MAX_EDGE), Image.LANCZOS)
            dst.parent.mkdir(parents=True, exist_ok=True)
            rgb.save(dst, "WEBP", quality=WEBP_QUALITY, method=4)
            return rgb.width, rgb.height, dst.stat().st_size
    except OSError as e:
        log.warning("转码失败 %s: %s", src, e)
        return None


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--city", default=settings.city, help="城市（默认取 .env 的 CITY）")
    ap.add_argument("--out", default=None, help="manifest 路径（默认 import/xhs-place-images-{city}.json）")
    ap.add_argument("--media-root", default=str(DEFAULT_MEDIA_ROOT), help="图片根目录")
    ap.add_argument("--max-per-place", type=int, default=1, help="每个景点最多导出几张（默认 1）")
    ap.add_argument("--min-score", type=float, default=0.0, help="与地点导出使用相同质量阈值")
    ap.add_argument("--dry-run", action="store_true", help="只统计不写文件")
    ap.add_argument('--photography-root', default=str(DEFAULT_ROOT), help='独立摄影目录，优先采用正式精选顺序')
    args = ap.parse_args()
    if args.max_per_place < 1:
        ap.error("--max-per-place 必须大于 0")

    city = args.city
    out_path = Path(args.out) if args.out else DEFAULT_IMPORT_DIR / f"xhs-place-images-{city}.json"
    media_root = Path(args.media_root)

    async with SessionFactory() as session:
        catalog = await load_catalog(session, city)
        rows = [dict(r._mapping) for r in (await session.execute(pick_query(city, args.min_score))).all()]
        allowed_names = None
        if PhotoStore(Path(args.photography_root), city).path('selected.json').exists():
            allowed_names = set((await session.execute(select(CanonicalPlace.name)
                .join(PlaceSummary, PlaceSummary.canonical_place_id == CanonicalPlace.id)
                .where(*export_conditions(city, args.min_score)))).scalars().all())
    if not rows:
        log.info("%s 没有可导出的风景图（先跑 fetch_scenery_images.py）", city)

    # 每个景点取前 N 张（查询已按分数降序，先到先得）。分组键 = tripweaver 侧地点 id。
    picked: dict[str, list[dict]] = {}
    names: dict[str, str] = {}
    for row in rows:
        entity = catalog.resolve(place_id=row['source_place_id'])
        if not entity or entity['status'] != 'ACTIVE':
            continue
        pid = entity['entity_id']
        names.setdefault(pid, entity['canonical_name'])
        bucket = picked.setdefault(pid, [])
        bucket.append(row)

    entries: list[dict] = export_selected(city, Path(args.photography_root), media_root,
                                        dry_run=args.dry_run, allowed_names=allowed_names, catalog=catalog)
    curated_ids = {entry['placeId'] for entry in entries}
    skipped = 0
    total_bytes = 0
    for pid, shots in picked.items():
        if pid in curated_ids:
            continue
        exported = 0
        for row in shots:
            if exported >= args.max_per_place:
                break
            idx = exported
            src = ROOT / row["file_path"]
            key = f"xhs/{city}/{pid}/{idx:02d}.webp"
            dst = media_root / key
            if args.dry_run:
                try:
                    with Image.open(src) as check:
                        check.verify()
                except (OSError, ValueError):
                    skipped += 1
                    continue
                entries.append({"placeId": pid, "placeName": names[pid], "key": key,
                                "score": row["img_score"], "sourceUrl": row["source_url"] or ""})
                exported += 1
                continue
            encoded = transcode(src, dst)
            if encoded is None:
                skipped += 1
                continue
            width, height, size = encoded
            exported += 1
            total_bytes += size
            entries.append({
                "placeId": pid,
                "placeName": names[pid],
                "key": key,
                "width": width,
                "height": height,
                "bytes": size,
                "score": round(row["img_score"], 4) if row["img_score"] is not None else None,
                # 保留原链仅作溯源与下线依据（小红书 CDN 签名链约 24h 过期）
                "sourceUrl": row["source_url"] or "",
            })

    log.info("%s：景点 %d 个 → 导出 %d 张%s", city, len(picked), len(entries),
             f"，跳过 {skipped} 张（源文件缺失或解码失败）" if skipped else "")
    if not args.dry_run and entries:
        log.info("总体积 %.1f MB，平均 %.0f KB", total_bytes / 1024 / 1024, total_bytes / len(entries) / 1024)
    if args.dry_run:
        log.info("（dry-run，未写文件）")
        return

    data = {
        "_comment": (
            f"{city}景点封面图（xhs-travel-pipeline 离线导出，{date.today().isoformat()}）。"
            "导入 canonical_places.payload.coverImage；图片本体的展示前缀由 server 的 MEDIA_BASE_URL 拼。"
        ),
        "city": city,
        "generatedAt": date.today().isoformat(),
        "count": len(entries),
        "images": entries,
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    log.info("manifest → %s（%.0f KB）", out_path, out_path.stat().st_size / 1024)
    log.info("图片目录 → %s", media_root / "xhs" / city)


if __name__ == "__main__":
    asyncio.run(main())
