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

// 调研候选池（行程概览页）：类目 / 预约三态 / 数据源标注
export const POI_CATEGORIES = ['attraction', 'food', 'hotel'] as const;
export const RESERVATION_STATUSES = ['required', 'none', 'unknown'] as const;
export const DATA_SOURCE_KINDS = ['amap', 'websearch'] as const;
export const MAX_OVERVIEW_POIS = 40;
