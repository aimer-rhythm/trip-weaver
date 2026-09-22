import { Type, type TLiteral, type TUnion } from '@sinclair/typebox';
import {
  ACTIVITY_CATEGORIES,
  BUDGET_LEVELS,
  COORD_SOURCES,
  COORD_SYSTEMS,
  DATA_SOURCE_KINDS,
  LEG_MODES,
  LEG_SOURCES,
  MAX_OVERVIEW_POIS,
  MAX_SOURCE_NOTES,
  MAX_TRIP_DAYS,
  POI_CATEGORIES,
  PREFERENCE_OPTIONS,
  RESERVATION_STATUSES,
  TRANSPORT_MODES,
  TRIP_EXPORT_VERSION,
} from './constants';

// 字符串枚举辅助：字面量 Union（标准 TypeBox 构造，类型收窄为字面量联合）
type LiteralTuple<T extends readonly string[]> = { -readonly [K in keyof T]: TLiteral<T[K] & string> };

const StringEnum = <T extends readonly string[]>(values: T) =>
  Type.Union(values.map((v) => Type.Literal(v))) as unknown as TUnion<LiteralTuple<T>>;

// ---------- 行程领域 ----------

export const SourceNoteSchema = Type.Object({
  title: Type.String({ maxLength: 100 }),
  url: Type.String({ maxLength: 300 }),
});

export const ActivitySchema = Type.Object({
  id: Type.String(),
  name: Type.String({ minLength: 1, maxLength: 100 }),
  startTime: Type.String({ maxLength: 5 }),   // "09:00"，允许空串
  endTime: Type.String({ maxLength: 5 }),
  description: Type.String({ maxLength: 500 }),
  lat: Type.Number({ minimum: -90, maximum: 90 }),
  lng: Type.Number({ minimum: -180, maximum: 180 }),
  coordSource: StringEnum(COORD_SOURCES),
  coordSystem: Type.Optional(StringEnum(COORD_SYSTEMS)),   // 缺省 = wgs84（旧数据兼容），新生成一律 gcj02
  cost: Type.Optional(Type.Number({ minimum: 0 })),   // 人均粗估档位值（ST3 预算区间化）：免费=0，不确定缺省；旧数据带值照读，读取方 ?? 0 兜底
  category: StringEnum(ACTIVITY_CATEGORIES),
  openTime: Type.Optional(Type.String({ maxLength: 60 })),   // 高德营业时间原文（仅 attraction；闭馆日检测用，非展示文案）
  sourceNotes: Type.Array(SourceNoteSchema, { maxItems: MAX_SOURCE_NOTES }),
});

// 住宿锚点（ST3）：仅作通勤锚点（非酒店推荐）。名称修改后坐标视为失效，需清空并丢弃相关住宿 leg
export const LodgingSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 60 }),
  area: Type.Optional(Type.String({ maxLength: 40 })),
  lat: Type.Optional(Type.Number({ minimum: -90, maximum: 90 })),
  lng: Type.Optional(Type.Number({ minimum: -180, maximum: 180 })),
  coordSystem: Type.Optional(StringEnum(COORD_SYSTEMS)),
});

// 活动间通勤段（v0.5）：以 from/to activityId 关联，活动重排/删除后失配的 leg 视为过期，由消费方过滤
// 哨兵约定（ST3）：fromActivityId/toActivityId 允许哨兵值 'lodging'（leg 挂在 day 上，作用域限当天）——
// {from:'lodging', to:<首活动id>} 表示「从住宿出发」，{from:<末活动id>, to:'lodging'} 表示「返回住宿」
export const TransitLegSchema = Type.Object({
  fromActivityId: Type.String(),
  toActivityId: Type.String(),
  mode: StringEnum(LEG_MODES),
  durationMin: Type.Number({ minimum: 0 }),
  distanceM: Type.Number({ minimum: 0 }),
  source: StringEnum(LEG_SOURCES),                              // amap 真实路径规划 / heuristic 启发式估算
  polyline: Type.Optional(Type.String({ maxLength: 4000 })),    // 「lng,lat;lng,lat…」抽稀后串，超长丢弃
});

export const TripDaySchema = Type.Object({
  id: Type.String(),
  dayIndex: Type.Integer({ minimum: 1 }),
  title: Type.String({ maxLength: 30 }),
  activities: Type.Array(ActivitySchema),
  legs: Type.Optional(Type.Array(TransitLegSchema)),   // 可选：旧行程无此字段
  lodging: Type.Optional(LodgingSchema),               // day 级住宿覆盖（多城市场景）；缺省用 Trip 级
});

// 调研候选（行程概览卡片）。高德协议 3.5：只落名称+短摘要+来源链接，图片仅存热链 URL 不转存文件
export const ResearchPoiSchema = Type.Object({
  id: Type.String(),
  name: Type.String({ minLength: 1, maxLength: 100 }),
  category: StringEnum(POI_CATEGORIES),
  coverUrl: Type.Optional(Type.String({ maxLength: 300 })),        // 预览图热链，可能失效（前端 onerror 兜底）
  intro: Type.String({ maxLength: 200 }),
  reservation: StringEnum(RESERVATION_STATUSES),                    // 预约三态，「以官方为准」
  reservationNote: Type.Optional(Type.String({ maxLength: 120 })),  // 预约渠道说明
  openTime: Type.Optional(Type.String({ maxLength: 60 })),          // 高德营业时间原文（add_candidate 自动回填，仅 attraction 用于闭馆日检测）
  sourceLinks: Type.Array(SourceNoteSchema, { maxItems: MAX_SOURCE_NOTES }),
});

export const TripMetaSchema = Type.Object({
  usedXhs: Type.Boolean(),   // 历史兼容：小红书时代旧行程可为 true，新生成恒 false
  reviewNotes: Type.Array(Type.String({ maxLength: 200 })),
  // 本次生成实际用到的外部数据源（可选：旧行程无此字段）
  dataSources: Type.Optional(Type.Array(StringEnum(DATA_SOURCE_KINDS), { maxItems: 2 })),
});

export const TripSchema = Type.Object({
  id: Type.String(),
  title: Type.String({ minLength: 1, maxLength: 60 }),
  destination: Type.String({ minLength: 1, maxLength: 40 }),
  startDate: Type.String({ maxLength: 10 }),  // "2026-07-10" 或 ''
  budgetLevel: StringEnum(BUDGET_LEVELS),
  totalBudget: Type.Number({ minimum: 0 }),
  preferences: Type.Array(Type.String({ maxLength: 10 }), { maxItems: 10 }),
  partySize: Type.Integer({ minimum: 1, maximum: 50 }),
  extraNotes: Type.String({ maxLength: 200 }),
  transportMode: Type.Optional(StringEnum(TRANSPORT_MODES)),   // 出行方式基调（缺省 transit；持久化供未来重排复用）
  lodging: Type.Optional(LodgingSchema),                       // Trip 级住宿锚点（day 级可覆盖）
  days: Type.Array(TripDaySchema, { maxItems: MAX_TRIP_DAYS }),
  // 调研候选池（行程概览页数据；可选：旧行程无此字段）
  overview: Type.Optional(Type.Array(ResearchPoiSchema, { maxItems: MAX_OVERVIEW_POIS })),
  meta: TripMetaSchema,
  createdAt: Type.Number(),
  updatedAt: Type.Number(),
});

// JSON 导出/导入格式
export const TripExportSchema = Type.Object({
  version: Type.Literal(TRIP_EXPORT_VERSION),
  trip: TripSchema,
});

// ---------- 生成表单 ----------

export const GenerateFormSchema = Type.Object({
  destination: Type.String({ minLength: 1, maxLength: 40 }),
  days: Type.Integer({ minimum: 1, maximum: MAX_TRIP_DAYS }),
  startDate: Type.String({ maxLength: 10, default: '' }),
  budgetLevel: StringEnum(BUDGET_LEVELS),
  totalBudget: Type.Number({ minimum: 0, default: 0 }),
  preferences: Type.Array(StringEnum(PREFERENCE_OPTIONS), { maxItems: 7, default: [] }),
  partySize: Type.Integer({ minimum: 1, maximum: 20 }),
  extraNotes: Type.String({ maxLength: 200, default: '' }),
  transportMode: Type.Optional(StringEnum(TRANSPORT_MODES)),         // 出行方式基调（缺省 transit）
  lodging: Type.Optional(Type.String({ maxLength: 60 })),            // 住宿位置（可选，酒店名或大致区域）；留空时由规划 Agent 建议一个区域
});

// ---------- 认证与设置 ----------

const EmailSchema = Type.String({
  pattern: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$',
  maxLength: 100,
});

export const RegisterBodySchema = Type.Object({
  email: EmailSchema,
  password: Type.String({ minLength: 8, maxLength: 72 }),
  inviteCode: Type.Optional(Type.String({ maxLength: 64 })),   // 仅 REGISTRATION_MODE=invite 时服务端校验
});

export const LoginBodySchema = Type.Object({
  email: EmailSchema,
  password: Type.String({ minLength: 1, maxLength: 72 }),
});

export const SettingsPutSchema = Type.Object({
  byokEnabled: Type.Boolean(),
  baseUrl: Type.Optional(Type.String({ maxLength: 200 })),
  apiKey: Type.Optional(Type.String({ maxLength: 200 })),   // 不传 = 保留原 Key
  model: Type.Optional(Type.String({ maxLength: 100 })),
  amapApiKey: Type.Optional(Type.String({ maxLength: 200 })), // 不传或空串 = 保留个人高德 Key
  clearAmapApiKey: Type.Optional(Type.Boolean()),             // 显式清除，避免空输入语义歧义
  searchApiKey: Type.Optional(Type.String({ maxLength: 200 })), // 不传或空串 = 保留个人搜索 Key
  searchApiBaseUrl: Type.Optional(Type.String({ maxLength: 200 })),
  clearSearchConfig: Type.Optional(Type.Boolean()),             // 显式同时清除个人搜索 Key 与 Base URL
});

export const RenameTripSchema = Type.Object({
  title: Type.String({ minLength: 1, maxLength: 60 }),
});
