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
