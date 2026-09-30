"""在隔离副本中组装上游补丁。"""
from pathlib import Path

ROOT = Path(__file__).parent / 'upstream-stage'

def replace(file, old, new):
    path = ROOT / file
    content = path.read_text(encoding='utf-8')
    assert old in content, (file, old)
    path.write_text(content.replace(old, new, 1), encoding='utf-8')

replace('app/models.py', '    canonical_place_id: Mapped[int | None] = mapped_column(ForeignKey("canonical_place.id"))\n    created_at:', '    canonical_place_id: Mapped[int | None] = mapped_column(ForeignKey("canonical_place.id"))\n    assignment: Mapped[dict | None] = mapped_column(JSONB(none_as_null=True))  # 图片级归属版本、依据与审核记录\n    created_at:')
replace('app/vision/extract.py', 'async def analyze_image(self, image_url: str) -> dict | None:', 'async def analyze_image(self, image_url: str, *, system_prompt: str = VISION_SYSTEM_PROMPT, instruction: str = "提取这张图片的文字与关键信息。") -> dict | None:')
replace('app/vision/extract.py', '"content": VISION_SYSTEM_PROMPT', '"content": system_prompt')
replace('app/vision/extract.py', '"text": "提取这张图片的文字与关键信息。"', '"text": instruction')
replace('app/vision/extract.py', 'logger.warning("视觉调用失败 %d/3 url=%s: %s", attempt + 1, image_url[:60], e)', 'logger.warning("视觉调用失败 %d/3: %s", attempt + 1, type(e).__name__)')
replace('scripts/export_to_tripweaver.py', 'from app.config import settings', 'from app.vision.eligibility import export_conditions\nfrom app.config import settings')
replace('scripts/export_to_tripweaver.py', '    ap.add_argument("--out",', '    ap.add_argument("--city", default=settings.city)\n    ap.add_argument("--out",')
replace('scripts/export_to_tripweaver.py', 'city = settings.city', 'city = args.city')
replace('scripts/export_to_tripweaver.py', '''                    CanonicalPlace.city == city,
                    CanonicalPlace.is_active.is_(True),
                    CanonicalPlace.quality_score >= args.min_score,
                    CanonicalPlace.latitude.is_not(None),''', '                    *export_conditions(city, args.min_score),')
replace('app/vision/pipeline.py', 'from app.models import NoteImage, RawNote', 'from app.models import NoteImage, RawNote\nfrom app.vision.sampling import sample_images')
replace('app/vision/pipeline.py', '    vision_ok: bool,\n)', '    vision_ok: bool,\n    sampling: str = "spread",\n)')
replace('app/vision/pipeline.py', '''    urls = [u for u in (urls or []) if isinstance(u, str) and u.startswith("http")]
    urls = urls[: settings.vision_max_images_per_note]''', '    urls = sample_images(urls or [], settings.vision_max_images_per_note, sampling)')
replace('app/vision/pipeline.py', 'for i, u in enumerate(urls)', 'for i, u in urls')
replace('app/vision/pipeline.py', '    scope: str = "missing",', '    scope: str = "missing",\n    sampling: str = "spread",')
replace('app/vision/pipeline.py', '    if scope not in ("missing", "all", "notes"):', '    sample_images([], settings.vision_max_images_per_note, sampling)\n    if max_scenery_per_note < 1:\n        raise ValueError("每篇风景图上限必须至少为 1")\n    if scope not in ("missing", "all", "notes"):')
replace('app/vision/pipeline.py', '_process_note(client, sem, row, max_scenery_per_note, vision_ok)', '_process_note(client, sem, row, max_scenery_per_note, vision_ok, sampling)')
replace('scripts/extract_note_images.py', '    parser.add_argument("--city",', '    parser.add_argument("--sampling", choices=("head", "spread"), default="spread", help="head=前部；spread=同预算覆盖前中后部")\n    parser.add_argument("--city",')
replace('scripts/extract_note_images.py', '        scope=args.scope,', '        scope=args.scope,\n        sampling=args.sampling,')
replace('app/web/jobs.py', '    if scope == "notes":', '    sampling = str(params.get("sampling", "spread"))\n    _require(sampling in ("head", "spread"), "未知图片取样方式")\n    cmd += ["--sampling", sampling]\n    if scope == "notes":')
replace('app/web/jobs.py', '        "max_per_note": max_per_note,', '        "max_per_note": max_per_note,\n        "sampling": sampling,')
replace('app/web/jobs.py', '            Field("max_per_note",', '            Field("sampling", "图片取样", "select", "spread", "同样预算覆盖前中后部；head 仅前部", ("spread", "head")),\n            Field("max_per_note",')
print('副本补丁已组装')
