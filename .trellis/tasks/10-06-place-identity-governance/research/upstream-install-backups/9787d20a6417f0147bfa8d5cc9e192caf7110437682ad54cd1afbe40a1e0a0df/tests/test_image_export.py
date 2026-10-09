"""导出遇到坏首图继续尝试，空结果覆盖旧 manifest，查询排除无效地点。"""
from __future__ import annotations

import asyncio
import json
import sys

from PIL import Image
from sqlalchemy.dialects import postgresql

from scripts import export_place_images as exporter
from app.clean.identity import IdentityCatalog, legacy_id


class Result:
    def __init__(self, rows):
        self.rows = [type("Row", (), {"_mapping": row})() for row in rows]

    def all(self):
        return self.rows


class Session:
    def __init__(self, rows):
        self.rows = rows

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        pass

    async def execute(self, *args):
        return Result(self.rows)


def run_export(monkeypatch, tmp_path, rows):
    output = tmp_path / "manifest.json"
    output.write_text('{"images":[{"stale":true}]}')
    monkeypatch.setattr(exporter, "ROOT", tmp_path)
    monkeypatch.setattr(exporter, "SessionFactory", lambda: Session(rows))
    async def catalog(*args):
        return IdentityCatalog('杭州', [dict(entity_id=legacy_id('杭州', '雷峰塔'), city='杭州', canonical_name='雷峰塔',
            aliases=[], status='ACTIVE', legacy_ids=[], revision=1)], [{'place_id': 1, 'entity_id': legacy_id('杭州', '雷峰塔')}])
    monkeypatch.setattr(exporter, 'load_catalog', catalog)
    monkeypatch.setattr(sys, "argv", ["export", "--city", "杭州", "--out", str(output),
                                     "--media-root", str(tmp_path / "media")])
    asyncio.run(exporter.main())
    return json.loads(output.read_text(encoding="utf-8"))


def test_缺失和损坏首图不占封面配额(monkeypatch, tmp_path):
    (tmp_path / "broken.jpg").write_bytes(b"broken")
    Image.new("RGB", (80, 60), "green").save(tmp_path / "valid.jpg")
    rows = [dict(place_name="雷峰塔", source_place_id=1, file_path=name, img_score=0.9, source_url="")
            for name in ("missing.jpg", "broken.jpg", "valid.jpg")]
    output = run_export(monkeypatch, tmp_path, rows)
    assert output["count"] == 1
    assert output["images"][0]["key"].endswith("/00.webp")
    with Image.open(tmp_path / "media" / output["images"][0]["key"]) as image:
        assert image.size == (80, 60)


def test_空结果也刷新清单(monkeypatch, tmp_path):
    assert run_export(monkeypatch, tmp_path, [])["images"] == []


def test_地点图片共享资格并隔离城市():
    sql = str(exporter.pick_query("杭州", 8).compile(
        dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}))
    assert "canonical_place.is_active IS true" in sql
    assert "canonical_place.latitude IS NOT NULL" in sql
    assert "canonical_place.longitude IS NOT NULL" in sql
    assert "canonical_place.quality_score >= 8" in sql
    assert "JOIN place_summary" in sql
    assert "note_image.city = '杭州'" in sql
    assert "raw_note.city = '杭州'" in sql
