"""PostgreSQL 表模型：采集任务 → 原始笔记 → 提纯日志 → 地点提及 → 权威地点 → 来源 → 聚合。

对齐 Yuntu 语义的精简版（Yuntu 40 表 → 本 7 表）：
  crawl_task           ~ travel_crawl_task
  raw_note             ~ travel_raw_item
  extract_log          ~ travel_extract_log
  place_mention        ~ travel_content_place_mention + travel_place_fact（合一）
  canonical_place      ~ travel_canonical_place
  canonical_place_source ~ travel_canonical_place_source
  place_summary        ~ travel_place_summary
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class CrawlTask(Base):
    """一次采集任务：城市 × 关键词。"""

    __tablename__ = "crawl_task"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    city: Mapped[str] = mapped_column(String(64), nullable=False)
    keyword: Mapped[str] = mapped_column(String(128), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="PENDING")  # PENDING/RUNNING/DONE/FAILED
    last_result_status: Mapped[str | None] = mapped_column(String(32))  # OK / RISK_BLOCKED / EMPTY
    fail_reason: Mapped[str | None] = mapped_column(Text)
    notes_fetched: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (UniqueConstraint("city", "keyword", name="uq_crawl_task_identity"),)


class RawNote(Base):
    """小红书原始笔记（搜索详情接口完整返回 + 正文）。"""

    __tablename__ = "raw_note"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    note_id: Mapped[str] = mapped_column(String(64), nullable=False)  # 小红书 note id
    city: Mapped[str] = mapped_column(String(64), nullable=False)
    keyword: Mapped[str] = mapped_column(String(128), nullable=False)
    crawl_task_id: Mapped[int | None] = mapped_column(ForeignKey("crawl_task.id"))

    title: Mapped[str | None] = mapped_column(Text)
    desc: Mapped[str | None] = mapped_column(Text)  # 正文
    author: Mapped[str | None] = mapped_column(String(128))
    author_id: Mapped[str | None] = mapped_column(String(64))
    img_urls: Mapped[list | None] = mapped_column(JSONB)  # 图片 URL 列表（仅存 URL，不转存图片）
    img_analysis: Mapped[list | None] = mapped_column(JSONB)  # 图片 VLM 分析结果（[{has_text,text_content,key_info,summary},...]）
    img_analysis_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))  # 最近图片处理时间（CLIP 分流 + VLM；统一图片步骤是否跑过的标记）
    collected_count: Mapped[int] = mapped_column(Integer, default=0)
    liked_count: Mapped[int] = mapped_column(Integer, default=0)
    shared_count: Mapped[int] = mapped_column(Integer, default=0)
    comment_count: Mapped[int] = mapped_column(Integer, default=0)
    publish_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    source_url: Mapped[str | None] = mapped_column(Text)

    raw_json: Mapped[dict | None] = mapped_column(JSONB)  # 详情接口完整返回（溯源）
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="RAW")  # RAW/EXTRACTED/DELETED/PRIVATE/FAILED
    extract_log_id: Mapped[int | None] = mapped_column(ForeignKey("extract_log.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    __table_args__ = (
        UniqueConstraint("note_id", name="uq_raw_note_note_id"),
        Index("idx_raw_note_city", "city"),
    )


class ExtractLog(Base):
    """LLM 提纯日志（每次提纯一条记录，prompt 版本可回溯）。"""

    __tablename__ = "extract_log"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    raw_note_id: Mapped[int] = mapped_column(ForeignKey("raw_note.id"), nullable=False)
    model: Mapped[str] = mapped_column(String(64))
    prompt_version: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(16), default="SUCCESS")  # SUCCESS/FAILED
    error: Mapped[str | None] = mapped_column(Text)
    tokens_in: Mapped[int] = mapped_column(Integer, default=0)
    tokens_out: Mapped[int] = mapped_column(Integer, default=0)
    latency_ms: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    __table_args__ = (Index("idx_extract_log_raw", "raw_note_id"),)


class PlaceMention(Base):
    """LLM 从笔记中提纯出的地点提及（含推荐理由 / 避坑事实）。"""

    __tablename__ = "place_mention"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    raw_note_id: Mapped[int] = mapped_column(ForeignKey("raw_note.id"), nullable=False)
    extract_log_id: Mapped[int | None] = mapped_column(ForeignKey("extract_log.id"))

    name: Mapped[str] = mapped_column(String(128), nullable=False)
    normalized_name: Mapped[str] = mapped_column(String(128), nullable=False)
    place_type: Mapped[str] = mapped_column(String(32), default="attraction")  # attraction/food/hotel/cafe/...
    mention_type: Mapped[str] = mapped_column(String(16), default="recommend")  # recommend/warning
    sentiment: Mapped[str | None] = mapped_column(String(16))  # positive/negative/neutral
    reason: Mapped[str | None] = mapped_column(Text)           # 展示给用户的推荐理由
    evidence_text: Mapped[str | None] = mapped_column(Text)    # 原文摘录（溯源）
    route_order: Mapped[int | None] = mapped_column(Integer)   # 路线顺序，无路线时 null
    confidence: Mapped[float] = mapped_column(Float, default=0.5)
    fact_type: Mapped[str | None] = mapped_column(String(32))  # visit_duration 等
    # none_as_null=True：None 写成 SQL NULL 而非 JSON null（否则 IS NOT NULL 统计失真）
    fact_value: Mapped[dict | None] = mapped_column(JSONB(none_as_null=True))  # {"minutes": 120} 等

    __table_args__ = (Index("idx_mention_raw", "raw_note_id"),)


class CanonicalPlace(Base):
    """权威地点库：坐标解析成功后入库，规划/问答只认这张表。"""

    __tablename__ = "canonical_place"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    normalized_name: Mapped[str] = mapped_column(String(128), nullable=False)
    city: Mapped[str] = mapped_column(String(64), nullable=False)
    address: Mapped[str | None] = mapped_column(Text)
    adcode: Mapped[str | None] = mapped_column(String(16))
    latitude: Mapped[float | None] = mapped_column(Float)
    longitude: Mapped[float | None] = mapped_column(Float)
    amap_poi_id: Mapped[str | None] = mapped_column(String(64))
    place_type: Mapped[str] = mapped_column(String(32), default="attraction")
    amap_type: Mapped[str | None] = mapped_column(String(256))  # 高德三级分类原文（可溯源）
    theme_tags: Mapped[list | None] = mapped_column(JSONB)  # 主题标签，如 ["自然风光","夜景"]
    geo_status: Mapped[str] = mapped_column(String(16), default="pending")  # resolved/unresolvable/pending
    quality_score: Mapped[float] = mapped_column(Float, default=0.0)  # 0-100，问答/规划排序依据
    typical_visit_minutes: Mapped[int | None] = mapped_column(Integer)
    typical_visit_source: Mapped[str | None] = mapped_column(String(16))  # manual/amap/xhs_median
    content_profile: Mapped[dict | None] = mapped_column(JSONB(none_as_null=True))  # 有来源的完整介绍与看点，提纯后复用
    source_type: Mapped[str] = mapped_column(String(16), default="xhs")   # xhs/manual
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    __table_args__ = (
        UniqueConstraint("city", "normalized_name", name="uq_canonical_city_name"),
        Index("idx_canonical_geo_status", "geo_status"),
    )


class PlaceEntity(Base):
    """持久地点身份；展示名变化不改变 entity_id，归并保留旧身份重定向。"""
    __tablename__ = 'place_entity'
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    entity_id: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    city: Mapped[str] = mapped_column(String(64), nullable=False)
    canonical_name: Mapped[str] = mapped_column(String(128), nullable=False)
    primary_place_id: Mapped[int | None] = mapped_column(ForeignKey('canonical_place.id'))
    aliases: Mapped[list] = mapped_column(JSONB(none_as_null=True), default=list)
    legacy_ids: Mapped[list] = mapped_column(JSONB(none_as_null=True), default=list)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(16), default='ACTIVE')  # ACTIVE/REVIEW
    redirect_to: Mapped[str | None] = mapped_column(ForeignKey('place_entity.entity_id'))
    overrides: Mapped[dict] = mapped_column(JSONB(none_as_null=True), default=dict)
    evidence: Mapped[list] = mapped_column(JSONB(none_as_null=True), default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    __table_args__ = (Index('idx_place_entity_city', 'city'),)


class PlaceEntityMember(Base):
    """源地点只能归属一个实体；原始地点与照片关联不删除。"""
    __tablename__ = 'place_entity_member'
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    place_id: Mapped[int] = mapped_column(ForeignKey('canonical_place.id'), unique=True, nullable=False)
    entity_id: Mapped[str] = mapped_column(ForeignKey('place_entity.entity_id'), nullable=False)
    __table_args__ = (Index('idx_place_entity_member_entity', 'entity_id'),)


class PlaceIdentityScope(Base):
    """源地点的受审范围；命中范围的新提及必须显式分配，不能按旧源绑定回落。"""
    __tablename__ = 'place_identity_scope'
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    place_id: Mapped[int] = mapped_column(ForeignKey('canonical_place.id'), unique=True, nullable=False)
    city: Mapped[str] = mapped_column(String(64), nullable=False)
    name_keys: Mapped[list] = mapped_column(JSONB(none_as_null=True), nullable=False)
    entity_ids: Mapped[list] = mapped_column(JSONB(none_as_null=True), nullable=False, default=list)
    withdrawal_entity_ids: Mapped[list | None] = mapped_column(JSONB(none_as_null=True), nullable=True)
    text_warnings: Mapped[list | None] = mapped_column(JSONB(none_as_null=True), nullable=True)
    mode: Mapped[str | None] = mapped_column(String(32), nullable=True)
    operational_facts: Mapped[list | None] = mapped_column(JSONB(none_as_null=True), nullable=True)
    source_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    change_key: Mapped[str] = mapped_column(String(128), nullable=False)
    evidence: Mapped[list] = mapped_column(JSONB(none_as_null=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    __table_args__ = (Index('idx_place_identity_scope_city', 'city'),)


class PlaceIdentityScopeSource(Base):
    """联合范围的完整源成员；旧单源scope无需回填，源ID只能由一个范围占用。"""
    __tablename__ = 'place_identity_scope_source'
    place_id: Mapped[int] = mapped_column(ForeignKey('canonical_place.id'), primary_key=True)
    scope_place_id: Mapped[int] = mapped_column(ForeignKey('place_identity_scope.place_id'), nullable=False)
    source_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    __table_args__ = (Index('idx_place_identity_scope_source_scope', 'scope_place_id'),)


class PlaceImageAssignment(Base):
    """逐图治理独立于原图片审核；稳定图片键绑定文件、来源及当前主体。"""
    __tablename__ = 'place_image_assignment'
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    city: Mapped[str] = mapped_column(String(64), nullable=False)
    image_key: Mapped[str] = mapped_column(String(200), nullable=False)
    source_place_id: Mapped[int | None] = mapped_column(ForeignKey('canonical_place.id'))
    entity_id: Mapped[str | None] = mapped_column(ForeignKey('place_entity.entity_id'))
    input_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    revision: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    change_key: Mapped[str] = mapped_column(String(128), nullable=False)
    evidence: Mapped[list] = mapped_column(JSONB(none_as_null=True), nullable=False)
    __table_args__ = (UniqueConstraint('city', 'image_key', name='uq_place_image_assignment_key'),)


class PlaceMentionAssignment(Base):
    """保留原始提及；null目标默认待审，明确非地点须单独保存排除证据。"""
    __tablename__ = 'place_mention_assignment'
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    mention_id: Mapped[int] = mapped_column(ForeignKey('place_mention.id'), unique=True, nullable=False)
    scope_place_id: Mapped[int] = mapped_column(ForeignKey('place_identity_scope.place_id'), nullable=False)
    entity_id: Mapped[str | None] = mapped_column(ForeignKey('place_entity.entity_id'))
    input_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    exclusion: Mapped[dict | None] = mapped_column(JSONB(none_as_null=True), nullable=True)
    fact_exclusions: Mapped[dict | None] = mapped_column(JSONB(none_as_null=True), nullable=True)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    change_key: Mapped[str] = mapped_column(String(128), nullable=False)
    __table_args__ = (Index('idx_place_mention_assignment_scope', 'scope_place_id'),
                     Index('idx_place_mention_assignment_entity', 'entity_id'))


class PlaceEntityReview(Base):
    """可重复审计产生的持久候选；相似名和坐标异常不得静默归并。"""
    __tablename__ = 'place_entity_review'
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    fingerprint: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    city: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(16), default='PENDING')  # PENDING/RESOLVED/REJECTED
    detail: Mapped[dict] = mapped_column(JSONB(none_as_null=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class PlaceEntityChange(Base):
    """每次治理的前后快照，回滚采用比较后再恢复，禁止覆盖后续治理。"""
    __tablename__ = 'place_entity_change'
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    change_key: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    city: Mapped[str] = mapped_column(String(64), nullable=False)
    before: Mapped[dict] = mapped_column(JSONB(none_as_null=True), nullable=False)
    after: Mapped[dict] = mapped_column(JSONB(none_as_null=True), nullable=False)
    evidence: Mapped[list] = mapped_column(JSONB(none_as_null=True), nullable=False)
    request: Mapped[dict] = mapped_column(JSONB(none_as_null=True), nullable=False)
    rolled_back: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class CanonicalPlaceSource(Base):
    """权威地点 ← 原始笔记的来源关联（溯源 + 合规：只存摘要 + URL，不转存正文）。"""

    __tablename__ = "canonical_place_source"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    canonical_place_id: Mapped[int] = mapped_column(ForeignKey("canonical_place.id"), nullable=False)
    source_type: Mapped[str] = mapped_column(String(16), default="xhs")
    source_note_id: Mapped[str | None] = mapped_column(String(64))
    source_url: Mapped[str | None] = mapped_column(Text)
    source_name: Mapped[str | None] = mapped_column(String(256))
    evidence_summary: Mapped[str | None] = mapped_column(Text)  # 短摘要（≤200 字符）

    __table_args__ = (Index("idx_csource_canonical", "canonical_place_id"),)


class PlaceSummary(Base):
    """聚合视图：30 天提及数 / 正向数 / Top 理由 / 推荐分。只聚合坐标已解析的地点。"""

    __tablename__ = "place_summary"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    canonical_place_id: Mapped[int] = mapped_column(ForeignKey("canonical_place.id"), nullable=False, unique=True)
    mention_count_30d: Mapped[int] = mapped_column(Integer, default=0)
    positive_count_30d: Mapped[int] = mapped_column(Integer, default=0)
    source_count: Mapped[int] = mapped_column(Integer, default=0)       # 去重后的来源笔记数
    top_reasons: Mapped[list] = mapped_column(JSONB, default=list)      # [{"reason": "...", "evidence": "..."}]
    recommend_score: Mapped[float] = mapped_column(Float, default=0.0)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class PlaceRelation(Base):
    """POI 关联对（排程/文案原料）：从笔记文本规则挖掘，非 LLM。

    无向：同一对地点只存一行（from_name < to_name），顺序由消费端确定性规则决定。
    rel_type 目前恒为 combo（保留字段以便未来细分关联语义）。
    strength: direct=≥2 篇笔记支持 / weak=单篇
    """

    __tablename__ = "place_relation"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    city: Mapped[str] = mapped_column(String(64), nullable=False)
    from_name: Mapped[str] = mapped_column(String(128), nullable=False)
    to_name: Mapped[str] = mapped_column(String(128), nullable=False)
    rel_type: Mapped[str] = mapped_column(String(16), nullable=False)  # must_before/combo/viewpoint_of
    strength: Mapped[str] = mapped_column(String(16), default="weak")  # direct/weak
    note_count: Mapped[int] = mapped_column(Integer, default=1)         # 支持该关系的笔记数
    evidence: Mapped[str | None] = mapped_column(Text)                  # 命中的原文片段
    source_url: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    __table_args__ = (
        UniqueConstraint("city", "from_name", "to_name", "rel_type", name="uq_relation_edge"),
        Index("idx_relation_city", "city"),
    )


class PlaceRelationSnapshot(Base):
    """同城地点导出与关系导出共享的单调来源/图版本，不覆盖原始提及。"""

    __tablename__ = "place_relation_snapshot"

    city: Mapped[str] = mapped_column(String(64), primary_key=True)
    revision: Mapped[int] = mapped_column(Integer, nullable=False)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)


class NoteImage(Base):
    """笔记图片本地转存记录：CLIP 分类结果 + 单地点笔记的景点关联。

    合规：图片只用于展示预览，保留 source_url 以便溯源与下线。
    """

    __tablename__ = "note_image"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    raw_note_id: Mapped[int] = mapped_column(ForeignKey("raw_note.id"), nullable=False)
    city: Mapped[str] = mapped_column(String(64), nullable=False)
    img_index: Mapped[int] = mapped_column(Integer, nullable=False)  # 原笔记中的图片序号（0 起）
    file_path: Mapped[str] = mapped_column(Text, nullable=False)  # 相对仓库根目录
    source_url: Mapped[str | None] = mapped_column(Text)  # 小红书 CDN 原链（约 24h 过期，仅溯源）
    width: Mapped[int | None] = mapped_column(Integer)
    height: Mapped[int | None] = mapped_column(Integer)
    file_bytes: Mapped[int | None] = mapped_column(Integer)
    img_type: Mapped[str] = mapped_column(String(16), nullable=False)  # CLIP 分类：scenery/text_card/...
    img_score: Mapped[float | None] = mapped_column(Float)
    canonical_place_id: Mapped[int | None] = mapped_column(ForeignKey("canonical_place.id"))
    assignment: Mapped[dict | None] = mapped_column(JSONB(none_as_null=True))  # 图片级归属版本、依据与审核记录
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    __table_args__ = (
        UniqueConstraint("raw_note_id", "img_index", name="uq_note_image_note_idx"),
        Index("idx_note_image_canonical", "canonical_place_id"),
        Index("idx_note_image_city_type", "city", "img_type"),
    )


class City(Base):
    """登记的城市（侧栏城市列表的手动新增项）。

    库里已有数据的城市（raw_note / canonical_place）由查询直接得出，不必登记；
    这张表只存「还没跑过管道、但想先选中去跑采集」的城市名。
    """

    __tablename__ = "city"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


# 便捷导入：所有模型在 Base.metadata 上
ALL_MODELS = (
    PlaceEntity, PlaceEntityMember, PlaceEntityReview, PlaceEntityChange,
    PlaceIdentityScope, PlaceIdentityScopeSource, PlaceMentionAssignment, PlaceImageAssignment,
    CrawlTask,
    RawNote,
    ExtractLog,
    PlaceMention,
    CanonicalPlace,
    CanonicalPlaceSource,
    PlaceSummary,
    PlaceRelation, PlaceRelationSnapshot,
    NoteImage,
    City,
)
