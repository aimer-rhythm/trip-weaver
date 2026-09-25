// 行程按需编辑：纯函数，不读库、不调 LLM、不做网络解析 —— 与 brief.ts 同一设计。
//
// 设计约束（09-24 PRD R1）：
//   - 操作集只有替换/删除/新增三件套；坐标解析（异步）由路由层先做，这里只接收已解析结果。
//   - 防御性归一：dayIndex 越界、activityId 不存在、操作重复命中同一活动等一律按「该条拒绝」处理，
//     不丢整批。模型给的输入是 unknown，逐字段校验后才进入行程。
//   - 时刻轴恒为空（D5）：编辑只动活动列表，不推算时刻；通勤段 leg 凡触及变动活动的一律丢弃，
//     由后续 computeLegs 或消费方缺失处理兜底。
import {
  ACTIVITY_CATEGORIES,
  MAX_EDIT_OPS_PER_TURN,
  uid,
  type Activity,
  type EditOpOutcome,
  type ItineraryEditOp,
  type NewActivityDraft,
  type Trip,
} from '@tripweaver/shared';
import { asRecord, readString } from './models';

/** 路由层解析后的新活动：在模型草稿基础上补上坐标（可能解析失败 → 无坐标，走 estimated 兜底） */
export interface ResolvedNewActivity extends NewActivityDraft {
  lat?: number;
  lng?: number;
  openTime?: string;
}

export interface ResolvedEditOp {
  kind: ItineraryEditOp['kind'];
  dayIndex: number;
  activityId?: string;          // replace / delete 必填
  position?: number;            // add 可选
  activity?: ResolvedNewActivity; // replace / add 必填
}

export interface EditApplyResult {
  /** 应用后的新行程（未落库；调用方负责 createTrip 进版本链） */
  trip: Trip;
  outcomes: EditOpOutcome[];
  /** 是否有任何一条真正改动行程；全拒绝时调用方不应产生新版本 */
  changed: boolean;
}

const MAX_OPS = MAX_EDIT_OPS_PER_TURN;
const MAX_ACTIVITIES_PER_DAY = 12;   // 与排程器产出上限同量级；防模型把一天塞爆

function readDayIndex(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 ? raw : null;
}

function readActivityId(raw: unknown): string | null {
  const value = readString(raw, 'activityId')?.trim();
  return value ? value : null;
}

function readDraft(raw: unknown): ResolvedNewActivity | null {
  const node = asRecord(raw);
  const name = typeof node.name === 'string' ? node.name.trim() : '';
  if (!name) return null;
  const category = typeof node.category === 'string' && (ACTIVITY_CATEGORIES as readonly string[]).includes(node.category)
    ? (node.category as Activity['category'])
    : undefined;
  const description = typeof node.description === 'string' ? node.description.trim().slice(0, 500) : '';
  const draft: ResolvedNewActivity = { name: name.slice(0, 100), ...(category ? { category } : {}), ...(description ? { description } : {}) };
  if (typeof node.lat === 'number' && typeof node.lng === 'number') {
    draft.lat = node.lat;
    draft.lng = node.lng;
  }
  if (typeof node.openTime === 'string' && node.openTime.trim()) draft.openTime = node.openTime.trim().slice(0, 60);
  return draft;
}

/** 模型原始输出 → 已校验操作列表；非法条目直接丢弃（不调 LLM 重试，模型下轮自行修正） */
export function normalizeEditOps(raw: unknown): ResolvedEditOp[] {
  const list = Array.isArray(raw) ? raw.slice(0, MAX_OPS) : [];
  const ops: ResolvedEditOp[] = [];
  for (const item of list) {
    const node = asRecord(item);
    const kind = readString(node, 'kind');
    const dayIndex = readDayIndex(node.dayIndex);
    if (!dayIndex) continue;
    if (kind === 'delete_activity') {
      const activityId = readActivityId(node);
      if (activityId) ops.push({ kind, dayIndex, activityId });
      continue;
    }
    if (kind === 'replace_activity') {
      const activityId = readActivityId(node);
      const activity = readDraft(node.activity);
      if (activityId && activity) ops.push({ kind, dayIndex, activityId, activity });
      continue;
    }
    if (kind === 'add_activity') {
      const activity = readDraft(node.activity);
      const position = typeof node.position === 'number' && Number.isInteger(node.position) && node.position >= 0 ? node.position : undefined;
      if (activity) ops.push({ kind, dayIndex, ...(position !== undefined ? { position } : {}), activity });
    }
  }
  return ops;
}

function toActivity(draft: ResolvedNewActivity): Activity {
  const geocoded = draft.lat !== undefined && draft.lng !== undefined;
  return {
    id: uid(),
    name: draft.name,
    startTime: '',
    endTime: '',
    description: draft.description ?? '',
    lat: draft.lat ?? 0,
    lng: draft.lng ?? 0,
    coordSource: geocoded ? 'geocoded' : 'estimated',
    ...(geocoded ? { coordSystem: 'gcj02' as const } : {}),
    category: draft.category ?? '其他',
    ...(draft.openTime ? { openTime: draft.openTime } : {}),
    sourceNotes: [],
  };
}

/** 定位目标活动：dayIndex 与 activityId 双锚都必须命中，防模型张冠李戴 */
function findTarget(trip: Trip, dayIndex: number, activityId: string) {
  const day = trip.days.find((d) => d.dayIndex === dayIndex);
  const activity = day?.activities.find((a) => a.id === activityId);
  return day && activity ? { day, activity } : null;
}

/** 丢弃触及指定活动 id 的通勤段（失配 leg 的确定性清理，不靠消费方过滤兜底） */
function pruneLegs(trip: Trip, removedIds: ReadonlySet<string>): void {
  if (removedIds.size === 0) return;
  for (const day of trip.days) {
    if (!day.legs) continue;
    day.legs = day.legs.filter((leg) => !removedIds.has(leg.fromActivityId) && !removedIds.has(leg.toActivityId));
  }
}

/**
 * 应用编辑操作。同一条操作失败不影响其他条；全部失败时 changed=false，调用方不落新版本。
 * 同一活动被多条操作命中时只执行第一条（模型的重复输出视为噪声）。
 */
export function applyItineraryEdits(current: Trip, ops: ResolvedEditOp[]): EditApplyResult {
  const trip: Trip = structuredClone(current);
  const outcomes: EditOpOutcome[] = [];
  const touchedActivityIds = new Set<string>();
  const removedIds = new Set<string>();
  let changed = false;

  for (const op of ops) {
    if (op.kind === 'delete_activity') {
      const target = op.activityId && !touchedActivityIds.has(op.activityId) ? findTarget(trip, op.dayIndex, op.activityId) : null;
      if (!target || !op.activityId) {
        outcomes.push({ kind: op.kind, applied: false, summary: `第 ${op.dayIndex} 天没找到要删除的活动` });
        continue;
      }
      target.day.activities = target.day.activities.filter((a) => a.id !== op.activityId);
      touchedActivityIds.add(op.activityId);
      removedIds.add(op.activityId);
      changed = true;
      outcomes.push({ kind: op.kind, applied: true, summary: `第 ${op.dayIndex} 天：删除「${target.activity.name}」` });
      continue;
    }

    if (op.kind === 'replace_activity') {
      const target = op.activityId && !touchedActivityIds.has(op.activityId) ? findTarget(trip, op.dayIndex, op.activityId) : null;
      if (!target || !op.activityId || !op.activity) {
        outcomes.push({ kind: op.kind, applied: false, summary: `第 ${op.dayIndex} 天没找到要替换的活动` });
        continue;
      }
      const next = toActivity(op.activity);
      const index = target.day.activities.findIndex((a) => a.id === op.activityId);
      target.day.activities[index] = next;   // 原位替换，顺序不变
      touchedActivityIds.add(op.activityId);
      removedIds.add(op.activityId);         // 旧 id 的 leg 全部失效
      changed = true;
      outcomes.push({ kind: op.kind, applied: true, summary: `第 ${op.dayIndex} 天：「${target.activity.name}」换成「${next.name}」` });
      continue;
    }

    // add_activity
    const day = trip.days.find((d) => d.dayIndex === op.dayIndex);
    if (!day || !op.activity) {
      outcomes.push({ kind: op.kind, applied: false, summary: `第 ${op.dayIndex} 天不存在，无法新增活动` });
      continue;
    }
    if (day.activities.length >= MAX_ACTIVITIES_PER_DAY) {
      outcomes.push({ kind: op.kind, applied: false, summary: `第 ${op.dayIndex} 天活动已满（${MAX_ACTIVITIES_PER_DAY} 个），先删再加` });
      continue;
    }
    const next = toActivity(op.activity);
    const position = op.position !== undefined ? Math.min(op.position, day.activities.length) : day.activities.length;
    day.activities.splice(position, 0, next);
    changed = true;
    outcomes.push({ kind: op.kind, applied: true, summary: `第 ${op.dayIndex} 天：新增「${next.name}」` });
  }

  pruneLegs(trip, removedIds);
  trip.updatedAt = Date.now();
  return { trip, outcomes, changed };
}
