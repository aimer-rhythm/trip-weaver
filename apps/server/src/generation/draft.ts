// DraftTrip：Agent 产出的内存草稿。编排/审校 Agent 经工具读写，审校通过后一次性 toTrip 入库。
// 完整性校验是 R2（小参数模型工具调用弱）的兜底 —— 校验失败信息回给 Agent 自愈。
import {
  ACTIVITY_CATEGORIES,
  MAX_OVERVIEW_POIS,
  MAX_SOURCE_NOTES,
  MAX_TRIP_DAYS,
  computeBudgetSummary,
  uid,
  type Activity,
  type ActivityCategory,
  type BudgetSummary,
  type DataSourceKind,
  type GenerateForm,
  type Lodging,
  type ResearchPoi,
  type SourceNote,
  type TransitLeg,
  type Trip,
} from '@tripweaver/shared';

export interface DraftActivityInput {
  name: string;
  startTime?: string;
  endTime?: string;
  description?: string;
  category?: string;
  cost?: number;
  lat?: number;
  lng?: number;
  coordSource?: 'geocoded' | 'estimated' | 'manual';
  sourceNotes?: SourceNote[];
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function normalizeCategory(raw: string | undefined): ActivityCategory {
  return (ACTIVITY_CATEGORIES as readonly string[]).includes(raw ?? '') ? (raw as ActivityCategory) : '其他';
}

function toActivity(input: DraftActivityInput): Activity {
  const hasCoord = typeof input.lat === 'number' && typeof input.lng === 'number' && (input.lat !== 0 || input.lng !== 0);
  return {
    id: uid(),
    name: input.name.slice(0, 100),
    startTime: TIME_RE.test(input.startTime ?? '') ? input.startTime! : '',
    endTime: TIME_RE.test(input.endTime ?? '') ? input.endTime! : '',
    description: (input.description ?? '').slice(0, 500),
    lat: hasCoord ? input.lat! : 0,
    lng: hasCoord ? input.lng! : 0,
    coordSource: hasCoord ? (input.coordSource ?? 'estimated') : 'estimated',
    // cost 可选化（ST3 预算区间化）：不确定就缺省，不再强行填 0
    ...(typeof input.cost === 'number' ? { cost: Math.max(0, input.cost) } : {}),
    category: normalizeCategory(input.category),
    sourceNotes: (input.sourceNotes ?? []).slice(0, MAX_SOURCE_NOTES),
  };
}

export class DraftTrip {
  title = '';
  /** 住宿锚点（ST3）：用户表单指定或规划 Agent 建议的区域；坐标由 geoPipeline 后处理解析 */
  lodging?: Lodging;
  /** lodging 是否来自用户表单（Agent 不得覆盖） */
  lodgingFromUser = false;
  private days: { title: string; activities: Activity[]; legs?: TransitLeg[] }[] = [];

  constructor(private form: GenerateForm) {
    const userLodging = form.lodging?.trim();
    if (userLodging) {
      this.lodging = { name: userLodging.slice(0, 60) };
      this.lodgingFromUser = true;
    }
  }

  /** 规划 Agent set_lodging 工具入口：仅在用户未指定时生效 */
  setLodging(name: string): string {
    if (this.lodgingFromUser) return `用户已指定住宿位置「${this.lodging!.name}」，无需建议`;
    const trimmed = name.trim();
    if (!trimmed) return '错误：住宿区域不能为空';
    this.lodging = { name: trimmed.slice(0, 60) };
    return `住宿区域建议已记录：${this.lodging.name}`;
  }

  setSkeleton(title: string, dayTitles: string[]): string {
    this.title = title.slice(0, 60);
    this.days = dayTitles.slice(0, MAX_TRIP_DAYS).map((t) => ({ title: t.slice(0, 30), activities: [] }));
    return `骨架已建立：${this.title}，共 ${this.days.length} 天`;
  }

  /** 确定性后处理专用（orchestrator geoPipeline）：暴露可变天列表以写回坐标与通勤段 */
  mutableDays(): { title: string; activities: Activity[]; legs?: TransitLeg[] }[] {
    return this.days;
  }

  /** dayIndex 从 1 开始；越界返回错误文本供 Agent 自愈 */
  addActivity(dayIndex: number, input: DraftActivityInput): string {
    const day = this.days[dayIndex - 1];
    if (!day) return `错误：第 ${dayIndex} 天不存在（当前共 ${this.days.length} 天，请先 set_trip_skeleton）`;
    if (!input.name?.trim()) return '错误：活动名称不能为空';
    day.activities.push(toActivity(input));
    return `已添加到第 ${dayIndex} 天：${input.name}（该天现有 ${day.activities.length} 个活动）`;
  }

  updateActivity(dayIndex: number, position: number, patch: DraftActivityInput): string {
    const day = this.days[dayIndex - 1];
    const existing = day?.activities[position - 1];
    if (!day || !existing) return `错误：第 ${dayIndex} 天第 ${position} 个活动不存在`;
    const merged = toActivity({
      name: patch.name ?? existing.name,
      startTime: patch.startTime ?? existing.startTime,
      endTime: patch.endTime ?? existing.endTime,
      description: patch.description ?? existing.description,
      category: patch.category ?? existing.category,
      cost: patch.cost ?? existing.cost,
      lat: patch.lat ?? existing.lat,
      lng: patch.lng ?? existing.lng,
      coordSource: patch.coordSource ?? existing.coordSource,
      sourceNotes: patch.sourceNotes ?? existing.sourceNotes,
    });
    day.activities[position - 1] = { ...merged, id: existing.id };
    return `已更新第 ${dayIndex} 天第 ${position} 个活动：${merged.name}`;
  }

  removeActivity(dayIndex: number, position: number): string {
    const day = this.days[dayIndex - 1];
    if (!day || !day.activities[position - 1]) return `错误：第 ${dayIndex} 天第 ${position} 个活动不存在`;
    const [removed] = day.activities.splice(position - 1, 1);
    return `已删除第 ${dayIndex} 天的「${removed!.name}」`;
  }

  /** 紧凑文本视图（控 token）：审校/修订轮的 get_draft 工具输出 */
  render(): string {
    if (!this.days.length) return '（草稿为空，尚未建立骨架）';
    const lines: string[] = [`行程：${this.title || '(未命名)'}｜目的地 ${this.form.destination}｜${this.days.length} 天`];
    this.days.forEach((day, i) => {
      lines.push(`第 ${i + 1} 天：${day.title}`);
      day.activities.forEach((a, j) => {
        const coord = a.lat === 0 && a.lng === 0 ? '无坐标' : `${a.lat.toFixed(4)},${a.lng.toFixed(4)}(${a.coordSource})`;
        const time = a.startTime ? `${a.startTime}-${a.endTime || '?'}` : '时间未定';
        const cost = typeof a.cost === 'number' ? `¥${a.cost}` : '费用未定';
        lines.push(`  ${j + 1}. ${a.name}｜${time}｜${a.category}｜${cost}｜${coord}${a.sourceNotes.length ? '｜有来源笔记' : ''}`);
      });
      if (!day.activities.length) lines.push('  （空）');
    });
    return lines.join('\n');
  }

  budget(): BudgetSummary {
    return computeBudgetSummary(this.toTrip());
  }

  /** 完整性校验：返回问题清单（空数组 = 通过） */
  validate(): string[] {
    const problems: string[] = [];
    if (!this.title.trim()) problems.push('缺少行程标题（set_trip_skeleton）');
    if (this.days.length !== this.form.days) {
      problems.push(`天数不符：要求 ${this.form.days} 天，当前 ${this.days.length} 天`);
    }
    this.days.forEach((day, i) => {
      if (!day.activities.length) problems.push(`第 ${i + 1} 天没有任何活动`);
      if (day.activities.length > 8) problems.push(`第 ${i + 1} 天活动过多（${day.activities.length} 个，应 ≤8）`);
    });
    // v0.5：坐标覆盖不再作为完整性问题 —— 审校后由确定性 geoPipeline 统一解析全量坐标
    return problems;
  }

  toTrip(reviewNotes: string[] = [], research?: { overview: ResearchPoi[]; dataSources: DataSourceKind[] }): Trip {
    const now = Date.now();
    return {
      id: uid(),
      title: this.title || `${this.form.destination}之旅`,
      destination: this.form.destination,
      startDate: this.form.startDate ?? '',
      budgetLevel: this.form.budgetLevel,
      totalBudget: this.form.totalBudget ?? 0,
      preferences: this.form.preferences ?? [],
      partySize: this.form.partySize,
      extraNotes: this.form.extraNotes ?? '',
      // 出行方式基调（ST3）：缺省 transit，持久化供未来重排复用
      transportMode: this.form.transportMode ?? 'transit',
      // 住宿锚点（ST3）：坐标解析成功与否均如实持久化名称；坐标由 geoPipeline 写入
      ...(this.lodging ? { lodging: this.lodging } : {}),
      days: this.days.map((day, i) => ({
        id: uid(),
        dayIndex: i + 1,
        title: day.title,
        activities: day.activities,
        // 通勤段（geoPipeline 后处理写入）；为空时不写字段，与旧行程 JSON 形状一致
        ...(day.legs?.length ? { legs: day.legs } : {}),
      })),
      // 调研候选池（行程概览页数据源）；为空时不写字段，与旧行程 JSON 形状一致
      ...(research?.overview.length ? { overview: research.overview.slice(0, MAX_OVERVIEW_POIS) } : {}),
      meta: {
        usedXhs: false,   // 小红书集成已移除；字段保留做旧行程只读兼容
        reviewNotes: reviewNotes.map((n) => n.slice(0, 200)),
        ...(research?.dataSources.length ? { dataSources: research.dataSources } : {}),
      },
      createdAt: now,
      updatedAt: now,
    };
  }
}
