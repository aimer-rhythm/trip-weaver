// 领域常量 —— 前后端唯一来源
export const ACTIVITY_CATEGORIES = ['美食', '文化', '自然', '购物', '住宿', '交通', '娱乐', '其他'] as const;
export const BUDGET_LEVELS = ['经济', '舒适', '豪华'] as const;
export const COORD_SOURCES = ['geocoded', 'estimated', 'manual'] as const;
export const PREFERENCE_OPTIONS = ['美食', '文化', '自然', '购物', '亲子', '夜生活', '小众'] as const;

// 按天配色（地图标记/折线/清单徽章共用，dayIndex-1 后对 8 取模）
export const DAY_COLORS = ['#e63946', '#f4862f', '#2a9d8f', '#457b9d', '#8338ec', '#d81b60', '#0e9f6e', '#8d6e63'] as const;

export const TRIP_EXPORT_VERSION = 2;
export const MAX_TRIP_DAYS = 15;
export const MAX_TRIPS_PER_USER = 100;
export const MAX_SOURCE_NOTES = 3;
// 单次生成兜底超时（服务端中断 + 前端超时文案同源；32k 输出预算下单轮可达数分钟）
export const GENERATION_TIMEOUT_MINUTES = 15;

// 调研候选池（行程概览页）：类目 / 预约三态 / 数据源标注
export const POI_CATEGORIES = ['attraction', 'food', 'hotel'] as const;

// 地理数据层（v0.5）：坐标系标注 / 活动间通勤段
export const COORD_SYSTEMS = ['wgs84', 'gcj02'] as const;   // 活动缺省 = wgs84（旧数据），新生成一律 gcj02
export const LEG_MODES = ['walk', 'cycle', 'transit', 'drive'] as const;
// 通勤启发式分段速度模型（v0.6 估算修正）：estimateTransit 的唯一事实源。
// 市内段沿用基础速度；绕行距离超过 longHaul.fromKm 的里程按长途等效速度计
// （transit≈市郊铁路/快速公交，drive≈快速路/高速）——时长对距离连续且单调递增；walk/cycle 无长途段。
// cycle（09-22 新增）：共享单车城市均速 12~15km/h，取 13；overhead 含找车/锁车。
// 校准依据（2026-07-18 金集快照）：北京八达岭段（绕行 84.7km transit）264→156min
// （真实 S2/驾车 90-120min，保守略高）；市内段（绕行 ≤20km，如 19.5km→68min）估算不变。
export const LEG_SPEED_MODEL = {
  walk: { speedKmh: 4.5, overheadMin: 0, longHaul: null },
  cycle: { speedKmh: 13, overheadMin: 3, longHaul: null },
  transit: { speedKmh: 20, overheadMin: 10, longHaul: { fromKm: 20, speedKmh: 45 } },
  drive: { speedKmh: 30, overheadMin: 5, longHaul: { fromKm: 20, speedKmh: 70 } },
} as const;
// 长途点判定阈值（v0.6 远郊编排）：以 estimateTransit 按行程出行方式估算的单程通勤时长分级 ——
// ≥longHaulMin 为「长途级」（当天活动须同方向顺路），≥exclusiveMin 为「强独占级」（须独占一天）。
// 判定基准取通勤时长而非直线距离：「远」的本质是通勤久，天然自适应出行方式（drive 40km 不远、transit 40km 远）。
// 唯一事实源：编排期距离情报（层2 预防）与修订期修复器（层3 兜底）共用同一份，两层不得各写一套。
// 校准依据（2026-07-18 金集快照）：北京八达岭段 151min / 西安兵马俑段 106min → 强独占级；市区点 <60min 不标。
export const LONG_HAUL_THRESHOLDS = {
  longHaulMin: 60,     // 单程通勤 ≥60 分钟：长途级
  exclusiveMin: 90,    // 单程通勤 ≥90 分钟：强独占级
} as const;
// 出行方式基调（ST3）：生成输入与 Trip 持久化共用；缺省 transit。>1.5km 的通勤段按此基调估算
export const TRANSPORT_MODES = ['transit', 'drive', 'walk'] as const;
export const LEG_SOURCES = ['amap', 'heuristic'] as const;
export const RESERVATION_STATUSES = ['required', 'none', 'unknown'] as const;
export const DATA_SOURCE_KINDS = ['amap', 'websearch'] as const;
export const MAX_OVERVIEW_POIS = 40;

// ---------- 问答式行程生成入口（09-23） ----------
// 对话只负责三件事：抽取参数、回答旅行问答、更新 Planning Brief；
// 只有 Brief 齐备且用户确认，才创建正式生成任务（对话本身不生成行程）。

/** 旅行侧重点（三选一，必填字段之一；标签供确认卡与追问按钮渲染） */
export const TRIP_FOCUS_OPTIONS = ['sights_first', 'food_first', 'balanced'] as const;
export const TRIP_FOCUS_LABELS: Record<(typeof TRIP_FOCUS_OPTIONS)[number], string> = {
  sights_first: '景点为主',
  food_first: '吃吃喝喝为主',
  balanced: '均衡安排',
};

/** 旅行约束分类（11 枚举，确认卡分组标签） */
export const CONSTRAINT_CATEGORIES = [
  'attraction_preference',
  'food_preference',
  'dietary_requirement',
  'travel_pace',
  'budget_style',
  'transport_preference',
  'accommodation_preference',
  'schedule_preference',
  'companion_context',
  'accessibility_need',
  'other_travel_preference',
] as const;
export const CONSTRAINT_CATEGORY_LABELS: Record<(typeof CONSTRAINT_CATEGORIES)[number], string> = {
  attraction_preference: '景点',
  food_preference: '餐饮',
  dietary_requirement: '饮食要求',
  travel_pace: '旅行节奏',
  budget_style: '预算习惯',
  transport_preference: '交通',
  accommodation_preference: '住宿',
  schedule_preference: '作息',
  companion_context: '同行',
  accessibility_need: '无障碍',
  other_travel_preference: '其他',
};

/**
 * 约束极性：决定确认卡上的徽章文案与「本次排除」交互。
 * `fact` 是关键——「带着 3 岁小孩」是背景信息，不等于「必须安排亲子景点」。
 */
export const CONSTRAINT_POLARITIES = ['prefer', 'avoid', 'require', 'fact'] as const;

/** Brief 就绪判定的缺失清单：4 个必填字段 + dateRange（合成项，表示结束日期早于开始日期） */
export const BRIEF_MISSING_FIELDS = ['destination', 'startDate', 'endDate', 'tripFocus', 'dateRange'] as const;
export const BRIEF_MISSING_FIELD_LABELS: Record<(typeof BRIEF_MISSING_FIELDS)[number], string> = {
  destination: '目的地',
  startDate: '开始日期',
  endDate: '结束日期或游玩天数',
  tripFocus: '旅行侧重点',
  dateRange: '有效的日期范围',
};

/** Brief 状态机：collecting → ready → submitted / discarded */
export const BRIEF_STATUSES = ['collecting', 'ready', 'submitted', 'discarded'] as const;
export const CONVERSATION_STATUSES = ['active', 'archived'] as const;
export const CHAT_MESSAGE_ROLES = ['user', 'assistant'] as const;

/** 对话理解意图白名单（模型只有这几个动作可做）；前端据 confirm 决定是否自动开始生成 */
export const CHAT_INTENTS = ['update_brief', 'travel_qa', 'confirm', 'modify_itinerary', 'unclear'] as const;

/** 追问控件选项的来源：canonical = 服务端给的字段值（点击→PATCH）；natural = 模型给的自然语言（点击→当作消息发给模型解析） */
export const INTAKE_ENUM_KINDS = ['canonical', 'natural'] as const;

/** 单次生成的类型：全新生成 vs 基于已有行程的修订 */
export const GENERATION_KINDS = ['generation', 'revision'] as const;

export const MAX_TRIP_CONSTRAINTS = 30;
